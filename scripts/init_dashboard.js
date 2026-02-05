#!/usr/bin/env node

/**
 * Dashboard Initialization Script
 * 
 * This script initializes the dashboard by:
 * 1. Processing historical blocks to populate dashboard_block_stats
 * 2. Computing daily aggregates
 * 3. Initializing rolling cache
 * 
 * Usage: node scripts/init_dashboard.js [start_height] [end_height]
 */

const mongoose = require('mongoose');
const settings = require('../lib/settings');
const db = require('../lib/database');
const dashboardAggregation = require('../lib/dashboard_aggregation');
const Tx = require('../models/tx');
const Stats = require('../models/stats');

// Parse command line arguments
const startHeight = process.argv[2] ? parseInt(process.argv[2]) : null;
const endHeight = process.argv[3] ? parseInt(process.argv[3]) : null;

console.log('=== Dashboard Initialization ===');
console.log('This script will process historical blocks to populate the dashboard.');
console.log('This may take a while depending on the blockchain size.\n');

// Build connection string like database.js does
const connectionString = 'mongodb://' + encodeURIComponent(settings.dbsettings.user) +
  ':' + encodeURIComponent(settings.dbsettings.password) +
  '@' + settings.dbsettings.address +
  ':' + settings.dbsettings.port +
  '/' + settings.dbsettings.database;

console.log('Connecting to database...');

// Connect to database
mongoose.set('strictQuery', true);
mongoose.connect(connectionString).then(() => {
  console.log('Connected to database');
  
  // Get the current blockchain height
  Stats.findOne({ coin: settings.coin.name }).then((stats) => {
    if (!stats) {
      console.error('Error: No stats found. Please run block sync first.');
      process.exit(1);
    }

    const currentHeight = stats.last;
    const start = startHeight || Math.max(1, currentHeight - 43200); // Default: last 30 days (43200 blocks at 60s/block)
    const end = endHeight || currentHeight;

    console.log(`Current blockchain height: ${currentHeight}`);
    console.log(`Processing blocks from ${start} to ${end}`);
    console.log(`This will process approximately ${((end - start) / 1440).toFixed(1)} days of data\n`);

    processBlocks(start, end, function(success) {
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
    console.error('Error getting stats:', err);
    mongoose.connection.close();
    process.exit(1);
  });
}).catch((err) => {
  console.error('Database connection error:', err);
  process.exit(1);
});

function processBlocks(startHeight, endHeight, callback) {
  let currentHeight = startHeight;
  let successCount = 0;
  let errorCount = 0;

  function processNext() {
    if (currentHeight > endHeight) {
      console.log(`\nProcessed ${successCount} blocks successfully, ${errorCount} errors`);
      
      // Initialize rolling cache
      console.log('Initializing rolling cache...');
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

    // Get block data
    Tx.findOne({ blockindex: currentHeight }).sort({ blockindex: 1 }).exec().then((tx) => {
      if (!tx) {
        console.log(`Warning: No transaction found for block ${currentHeight}`);
        errorCount++;
        currentHeight++;
        processNext();
        return;
      }

      const blockHash = tx.blockhash;
      const timestamp = tx.timestamp;

      // Process the block
      dashboardAggregation.processNewBlock(currentHeight, blockHash, timestamp, function(success) {
        if (success) {
          successCount++;
          if (currentHeight % 100 === 0) {
            console.log(`Processed block ${currentHeight}/${endHeight}`);
          }
        } else {
          errorCount++;
          console.log(`Failed to process block ${currentHeight}`);
        }

        currentHeight++;
        
        // Add small delay to avoid overwhelming the database
        setTimeout(processNext, 10);
      });
    }).catch((err) => {
      console.error(`Error fetching block ${currentHeight}:`, err);
      errorCount++;
      currentHeight++;
      processNext();
    });
  }

  processNext();
}
