#!/usr/bin/env node

/**
 * Dashboard Initialization Script - BULK OPTIMIZED VERSION
 * 
 * Uses MongoDB aggregation and bulk operations for maximum performance
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const settings = require('../lib/settings');
const dashboardAggregation = require('../lib/dashboard_aggregation');
const Stats = require('../models/stats');
const DashboardBlockStats = require('../models/dashboard_block_stats');
const DashboardDailyStats = require('../models/dashboard_daily_stats');
const Tx = require('../models/tx');

// Parse command line arguments
const startHeight = process.argv[2] ? parseInt(process.argv[2]) : null;
const endHeight = process.argv[3] ? parseInt(process.argv[3]) : null;

console.log('=== Dashboard Initialization (BULK MODE) ===');
console.log('Using MongoDB aggregation and bulk operations for maximum speed\n');

const lockPath = path.join(__dirname, '..', 'tmp', 'update_dashboard.lock');
let lockFd = null;

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

try {
  lockFd = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(lockFd, `${process.pid}`);
} catch (err) {
  if (err.code === 'EEXIST') {
    console.log('Another dashboard process is already running (init/update). Exiting.');
    process.exit(0);
  }

  console.error('Failed to acquire dashboard lock:', err.message);
  process.exit(1);
}

process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(1);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(1);
});

// Build connection string
const connectionString = 'mongodb://' + encodeURIComponent(settings.dbsettings.user) +
  ':' + encodeURIComponent(settings.dbsettings.password) +
  '@' + settings.dbsettings.address +
  ':' + settings.dbsettings.port +
  '/' + settings.dbsettings.database;

console.log('Connecting to database...');

// Connect to database
mongoose.set('strictQuery', true);
mongoose.connect(connectionString).then(() => {
  console.log('Connected to database\n');
  
  // Get the current blockchain height
  Stats.findOne({ coin: (settings.coin.dbname || settings.coin.name) }).then((stats) => {
    if (!stats) {
      console.error('Error: No stats found. Please run block sync first.');
      process.exit(1);
    }

    const currentHeight = stats.last;
    const start = startHeight || 1; // Default: full history from block 1
    const end = endHeight || currentHeight;

    console.log(`Current blockchain height: ${currentHeight}`);
    console.log(`Processing blocks from ${start} to ${end}`);
    console.log(`This will process approximately ${((end - start) / 1440).toFixed(1)} days of data\n`);

    // Clean old data for this block range before processing
    console.log('Cleaning old dashboard data for this block range...');

    cleanDashboardRange(start, end).then(() => {
      processBlocksBulk(start, end, function(success) {
        if (success) {
          console.log('\n=== Dashboard initialization complete ===');
          console.log('The dashboard is now ready to use.');
          console.log('Visit /dashboard to view the dashboard.');
        } else {
          console.error('\n=== Dashboard initialization failed ===');
        }

        mongoose.connection.close();
        process.exit(success ? 0 : 1);
      });
    }).catch((err) => {
      console.error('Error cleaning dashboard data:', err);
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

function processBlocksBulk(startHeight, endHeight, callback) {
  const batchSize = 5000; // Process 5000 blocks at once with aggregation
  let currentBatch = startHeight;
  let totalProcessed = 0;
  const overallStart = Date.now();

  console.log(`Processing in batches of ${batchSize} blocks using aggregation...\n`);

  function processNext() {
    const batchEnd = Math.min(currentBatch + batchSize - 1, endHeight);
    
    if (currentBatch > endHeight) {
      const totalTime = ((Date.now() - overallStart) / 1000).toFixed(2);
      const avgSpeed = (totalProcessed / (totalTime || 1)).toFixed(2);
      
      console.log(`\n[SUMMARY] Processed ${totalProcessed} blocks in ${totalTime}s (${avgSpeed} blocks/sec)`);
      
      // Initialize rolling cache
      console.log('\nInitializing rolling cache...');
      dashboardAggregation.initializeRollingCache(endHeight, function(success) {
        if (success) {
          console.log('Rolling cache initialized');
        } else {
          console.error('Failed to initialize rolling cache');
        }
        callback(success);
      });
      return;
    }

    // Process entire batch with aggregation
    dashboardAggregation.bulkProcessBlocks(currentBatch, batchEnd, function(success, count) {
      if (success) {
        totalProcessed += count;
        console.log(`Progress: ${totalProcessed}/${endHeight - startHeight + 1} blocks\n`);
      } else {
        console.error(`Failed to process batch ${currentBatch}-${batchEnd}`);
      }

      currentBatch = batchEnd + 1;
      setImmediate(processNext);
    });
  }

  processNext();
}

function cleanDashboardRange(start, end) {
  return DashboardBlockStats.deleteMany({ height: { $gte: start, $lte: end } })
    .then((blockDeleteResult) => {
      console.log(`Old block stats cleaned (${blockDeleteResult.deletedCount || 0} docs)\n`);

      return Tx.aggregate([
        {
          $match: {
            blockindex: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: '$blockindex',
            time: { $first: '$timestamp' }
          }
        },
        {
          $project: {
            _id: 0,
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $toDate: { $multiply: ['$time', 1000] } }
              }
            }
          }
        },
        {
          $group: {
            _id: '$date'
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]).exec();
    })
    .then((affectedDates) => {
      const dates = affectedDates.map((item) => item._id);

      if (dates.length === 0) {
        console.log('Old daily stats cleaned (0 docs, no dates found in tx range)\n');
        return;
      }

      return DashboardDailyStats.deleteMany({ date: { $in: dates } })
        .then((dailyDeleteResult) => {
          console.log(`Old daily stats cleaned (${dailyDeleteResult.deletedCount || 0} docs across ${dates.length} day(s))\n`);
        });
    });
}
