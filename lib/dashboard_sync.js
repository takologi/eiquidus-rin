/**
 * Dashboard Sync Service
 * 
 * This module hooks into the block sync process to trigger
 * dashboard aggregation when new blocks are detected.
 */

const dashboardAggregation = require('./dashboard_aggregation');
const settings = require('./settings');

let lastProcessedBlock = 0;
let isInitialized = false;

module.exports = {
  
  /**
   * Initialize the dashboard sync service
   * Load the last processed block and initialize cache
   */
  initialize: function(currentHeight, cb) {
    console.log('Initializing dashboard sync service...');
    
    dashboardAggregation.initializeRollingCache(currentHeight, function(success) {
      if (success) {
        isInitialized = true;
        lastProcessedBlock = currentHeight;
        console.log(`Dashboard sync initialized at block ${currentHeight}`);
      } else {
        console.log('Warning: Dashboard sync initialization failed');
      }
      
      if (cb) cb(success);
    });
  },

  /**
   * Process a new block
   * Called by block_sync.js when a new block is added
   */
  onNewBlock: function(blockHeight, blockHash, timestamp, cb) {
    // Skip if not initialized
    if (!isInitialized) {
      if (cb) cb(false);
      return;
    }

    // Skip if already processed
    if (blockHeight <= lastProcessedBlock) {
      if (cb) cb(true);
      return;
    }

    console.log(`Dashboard: Processing new block ${blockHeight}`);

    dashboardAggregation.processNewBlock(blockHeight, blockHash, timestamp, function(success) {
      if (success) {
        lastProcessedBlock = blockHeight;
        console.log(`Dashboard: Block ${blockHeight} processed successfully`);
      } else {
        console.log(`Dashboard: Failed to process block ${blockHeight}`);
      }

      if (cb) cb(success);
    });
  },

  /**
   * Handle chain reorganization
   * Roll back dashboard data to a specific height
   */
  onReorg: function(reorgHeight, cb) {
    console.log(`Dashboard: Handling reorg at height ${reorgHeight}`);
    
    dashboardAggregation.handleReorg(reorgHeight, function(success) {
      if (success) {
        lastProcessedBlock = reorgHeight;
        console.log(`Dashboard: Reorg handled, rolled back to ${reorgHeight}`);
      } else {
        console.log(`Dashboard: Failed to handle reorg`);
      }

      if (cb) cb(success);
    });
  },

  /**
   * Get the last processed block height
   */
  getLastProcessedBlock: function() {
    return lastProcessedBlock;
  },

  /**
   * Check if the service is initialized
   */
  isInitialized: function() {
    return isInitialized;
  }
};
