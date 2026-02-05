#!/usr/bin/env node

/**
 * Dashboard Initialization Script - BULK OPTIMIZED VERSION
 * 
 * Uses MongoDB aggregation and bulk operations for maximum performance
 */

const mongoose = require('mongoose');
const settings = require('../lib/settings');
const dashboardAggregation = require('../lib/dashboard_aggregation');
const Stats = require('../models/stats');

// Parse command line arguments
const startHeight = process.argv[2] ? parseInt(process.argv[2]) : null;
const endHeight = process.argv[3] ? parseInt(process.argv[3]) : null;

console.log('=== Dashboard Initialization (BULK MODE) ===');
console.log('Using MongoDB aggregation and bulk operations for maximum speed\n');

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
  Stats.findOne({ coin: settings.coin.name }).then((stats) => {
    if (!stats) {
      console.error('Error: No stats found. Please run block sync first.');
      process.exit(1);
    }

    const currentHeight = stats.last;
    const start = startHeight || Math.max(1, currentHeight - 43200); // Default: last 30 days
    const end = endHeight || currentHeight;

    console.log(`Current blockchain height: ${currentHeight}`);
    console.log(`Processing blocks from ${start} to ${end}`);
    console.log(`This will process approximately ${((end - start) / 1440).toFixed(1)} days of data\n`);

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
