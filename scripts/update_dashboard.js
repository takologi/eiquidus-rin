#!/usr/bin/env node

/**
 * Dashboard Update Script
 * 
 * Incrementally updates dashboard data from last processed block to current height
 * Safe to run repeatedly (idempotent) - skips already processed blocks
 * 
 * Designed to be run periodically (e.g., via cron every minute)
 * For coins with slower block times, can run less frequently
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const settings = require('../lib/settings');
const dashboardAggregation = require('../lib/dashboard_aggregation');
const Stats = require('../models/stats');
const DashboardBlockStats = require('../models/dashboard_block_stats');

console.log('=== Dashboard Update Script ===');

const lockPath = path.join(__dirname, '..', 'tmp', 'update_dashboard.lock');
let lockFd = null;
let shuttingDown = false;

function releaseLock() {
  if (lockFd !== null) {
    try {
      fs.closeSync(lockFd);
    } catch (e) {
      // no-op
    }

    try {
      fs.unlinkSync(lockPath);
    } catch (e) {
      // no-op
    }

    lockFd = null;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signalable by this user
    return error != null && error.code === 'EPERM';
  }
}

function connectAndExit(exitCode) {
  if (shuttingDown)
    return;

  shuttingDown = true;
  releaseLock();

  // attempt to close mongoose connection if open, but always exit
  Promise.resolve()
    .then(() => mongoose.connection.close())
    .catch(() => {})
    .finally(() => process.exit(exitCode));
}

function acquireDashboardLock() {
  try {
    lockFd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(lockFd, `${process.pid}`);
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('Failed to acquire dashboard update lock:', err.message);
      return false;
    }

    let activePid = null;

    try {
      const pidText = fs.readFileSync(lockPath, 'utf8').trim();
      activePid = parseInt(pidText, 10);
    } catch (readErr) {
      // continue and treat unreadable file as stale lock below
    }

    if (Number.isInteger(activePid) && activePid > 0 && isProcessRunning(activePid)) {
      console.log('Another update_dashboard instance is already running. Exiting.');
      return false;
    }

    try {
      fs.unlinkSync(lockPath);
      console.log('Removed stale update_dashboard lock file.');
    } catch (unlinkErr) {
      console.log('Another update_dashboard instance is already running. Exiting.');
      return false;
    }

    try {
      lockFd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(lockFd, `${process.pid}`);
      return true;
    } catch (retryErr) {
      if (retryErr.code === 'EEXIST') {
        console.log('Another update_dashboard instance is already running. Exiting.');
        return false;
      }

      console.error('Failed to acquire dashboard update lock:', retryErr.message);
      return false;
    }
  }
}

if (!acquireDashboardLock())
  process.exit(0);

process.on('exit', releaseLock);
process.on('SIGINT', () => {
  connectAndExit(1);
});
process.on('SIGTERM', () => {
  connectAndExit(1);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error && error.stack ? error.stack : error);
  connectAndExit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason && reason.stack ? reason.stack : reason);
  connectAndExit(1);
});

// Build connection string
const connectionString = 'mongodb://' + encodeURIComponent(settings.dbsettings.user) +
  ':' + encodeURIComponent(settings.dbsettings.password) +
  '@' + settings.dbsettings.address +
  ':' + settings.dbsettings.port +
  '/' + settings.dbsettings.database;

// Connect to database
mongoose.set('strictQuery', true);
mongoose.connect(connectionString).then(() => {
  console.log('Connected to database');
  
  // Get current blockchain height
  Stats.findOne({ coin: (settings.coin.dbname || settings.coin.name) }).then((stats) => {
    if (!stats) {
      console.error('Error: No stats found. Please run block sync first.');
      mongoose.connection.close();
      process.exit(1);
    }

    const currentHeight = stats.last;
    
    // Get last processed block in dashboard
    DashboardBlockStats.findOne().sort({ height: -1 }).exec().then((lastBlock) => {
      const lastProcessed = lastBlock ? lastBlock.height : 0;
      
      if (lastProcessed >= currentHeight) {
        console.log(`Dashboard is up to date (height: ${currentHeight})`);
        mongoose.connection.close();
        process.exit(0);
      }
      
      const startHeight = lastProcessed + 1;
      console.log(`Current blockchain height: ${currentHeight}`);
      console.log(`Last processed block: ${lastProcessed}`);
      console.log(`Updating blocks ${startHeight} to ${currentHeight} (${currentHeight - lastProcessed} blocks)\n`);
      
      const startTime = Date.now();
      
      // Process new blocks
      dashboardAggregation.bulkProcessBlocks(startHeight, currentHeight, function(success, processed) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (success) {
          console.log(`\n✓ Successfully updated ${processed} blocks in ${duration}s`);
          console.log('Dashboard is now current');
        } else {
          console.error('\n✗ Update failed');
        }
        
        mongoose.connection.close();
        process.exit(success ? 0 : 1);
      });
    }).catch((err) => {
      console.error('Error finding last processed block:', err);
      mongoose.connection.close();
      process.exit(1);
    });
  }).catch((err) => {
    console.error('Error getting stats:', err);
    mongoose.connection.close();
    process.exit(1);
  });
}).catch((err) => {
  console.error('Database connection error:', err);
  process.exit(1);
});
