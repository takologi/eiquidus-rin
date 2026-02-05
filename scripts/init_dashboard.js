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
  let successCount = 0;
  let errorCount = 0;
  const batchSize = 1000; // Process 1000 blocks at a time
  let currentBatch = startHeight;

  console.log(`Processing in batches of ${batchSize} blocks...`);

  function processBatch() {
    const batchEnd = Math.min(currentBatch + batchSize - 1, endHeight);
    
    if (currentBatch > endHeight) {
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

    // Fetch a batch of transactions at once
    Tx.find({ 
      blockindex: { $gte: currentBatch, $lte: batchEnd } 
    })
    .select('blockindex blockhash timestamp')
    .sort({ blockindex: 1 })
    .exec()
    .then((txs) => {
      if (!txs || txs.length === 0) {
        console.log(`Warning: No transactions found for batch ${currentBatch}-${batchEnd}`);
        errorCount += (batchEnd - currentBatch + 1);
        currentBatch = batchEnd + 1;
        setImmediate(processBatch);
        return;
      }

      // Create a map of block data for quick lookup
      const blockMap = new Map();
      txs.forEach(tx => {
        if (!blockMap.has(tx.blockindex)) {
          blockMap.set(tx.blockindex, {
            hash: tx.blockhash,
            timestamp: tx.timestamp
          });
        }
      });

      // Process blocks in sequence
      let blockIndex = 0;
      const blockHeights = Array.from(blockMap.keys()).sort((a, b) => a - b);

      function processNextBlock() {
        if (blockIndex >= blockHeights.length) {
          console.log(`Processed batch ${currentBatch}-${batchEnd} (${successCount} total)`);
          currentBatch = batchEnd + 1;
          setImmediate(processBatch);
          return;
        }

        const height = blockHeights[blockIndex];
        const blockData = blockMap.get(height);

        dashboardAggregation.processNewBlock(height, blockData.hash, blockData.timestamp, function(success) {
          if (success) {
            successCount++;
          } else {
            errorCount++;
          }
          blockIndex++;
          setImmediate(processNextBlock);
        });
      }

      processNextBlock();
    })
    .catch((err) => {
      console.error(`Error fetching batch ${currentBatch}-${batchEnd}:`, err);
      errorCount += (batchEnd - currentBatch + 1);
      currentBatch = batchEnd + 1;
      setImmediate(processBatch);
    });
  }

  processBatch();
}
