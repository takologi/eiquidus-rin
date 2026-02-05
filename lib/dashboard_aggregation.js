const DashboardBlockStats = require('../models/dashboard_block_stats');
const DashboardDailyStats = require('../models/dashboard_daily_stats');
const Tx = require('../models/tx');
const Stats = require('../models/stats');
const settings = require('./settings');

// Rolling window cache for performance
let rollingCache = {
  lastProcessedHeight: 0,
  window50: [],  // Last 50 blocks
  window500: [], // Last 500 blocks
  window1500: [] // Last 1500 blocks
};

module.exports = {
  
  // Process a new block and update all aggregates
  processNewBlock: function(blockHeight, blockHash, timestamp, cb) {
    const self = this;
    
    // Get block data from Tx collection
    Tx.find({ blockindex: blockHeight }).exec().then((txs) => {
      if (!txs || txs.length === 0) {
        return cb(false);
      }

      // Calculate block metrics
      let totalFees = 0;
      let txCount = txs.length;
      let blockSize = 0; // Would need actual block size data

      txs.forEach(tx => {
        // Calculate fees (simplified - needs proper coinbase detection)
        if (tx.vin && tx.vin.length > 0 && tx.vin[0].addresses !== 'coinbase') {
          totalFees += tx.total || 0;
        }
      });

      // Get previous block to calculate interval
      self.getBlockStats(blockHeight - 1, function(prevBlock) {
        let blockInterval = 0;
        if (prevBlock && prevBlock.time) {
          blockInterval = timestamp - prevBlock.time;
        }

        // Get difficulty from networkhistories collection
        const NetworkHistory = require('../models/networkhistory');
        NetworkHistory.findOne({ blockindex: { $lte: blockHeight } })
          .sort({ blockindex: -1 })
          .exec()
          .then((nethist) => {
            let difficulty = 0;
            if (nethist) {
              // Use POW difficulty as default (adjust based on settings if needed)
              difficulty = nethist.difficulty_pow || nethist.difficulty_pos || 0;
            }

        // Create block stats document
        const blockStats = new DashboardBlockStats({
          height: blockHeight,
          time: timestamp,
          block_interval: blockInterval,
          tx_count: txCount,
          block_size: blockSize,
          fees: totalFees,
          difficulty: difficulty,
          hash: blockHash
        });

        // Save block stats
        blockStats.save().then(() => {
          // Update rolling cache
          self.updateRollingCache(blockStats, function() {
            // Update daily stats
            self.updateDailyStats(blockStats, function() {
              return cb(true);
            });
          });
        }).catch((err) => {
          // Handle duplicate key error (block already processed)
          if (err.code === 11000) {
            return cb(true);
          }
          console.log('Error saving block stats:', err);
          return cb(false);
        });
      }).catch((err) => {
        console.log('Error getting difficulty:', err);
        return cb(false);
      });
      });
    }).catch((err) => {
      console.log('Error processing block:', err);
      return cb(false);
    });
  },

  // Get block stats by height
  getBlockStats: function(height, cb) {
    DashboardBlockStats.findOne({ height: height }).then((stats) => {
      return cb(stats);
    }).catch((err) => {
      console.log(err);
      return cb(null);
    });
  },

  // Update rolling cache with new block
  updateRollingCache: function(blockStats, cb) {
    // Add to cache arrays
    rollingCache.window50.push(blockStats);
    rollingCache.window500.push(blockStats);
    rollingCache.window1500.push(blockStats);

    // Remove oldest if exceeds window size
    if (rollingCache.window50.length > 50) {
      rollingCache.window50.shift();
    }
    if (rollingCache.window500.length > 500) {
      rollingCache.window500.shift();
    }
    if (rollingCache.window1500.length > 1500) {
      rollingCache.window1500.shift();
    }

    rollingCache.lastProcessedHeight = blockStats.height;
    
    return cb();
  },

  // Initialize rolling cache from database
  initializeRollingCache: function(currentHeight, cb) {
    const self = this;
    
    // Load last 1500 blocks into cache
    DashboardBlockStats.find({ height: { $gte: currentHeight - 1500, $lte: currentHeight } })
      .sort({ height: 1 })
      .exec()
      .then((blocks) => {
        rollingCache.window1500 = blocks;
        rollingCache.window500 = blocks.slice(-500);
        rollingCache.window50 = blocks.slice(-50);
        rollingCache.lastProcessedHeight = currentHeight;
        
        return cb(true);
      }).catch((err) => {
        console.log('Error initializing cache:', err);
        return cb(false);
      });
  },

  // Get rolling averages
  getRollingAverages: function(cb) {
    const calculateAvg = (arr, field) => {
      if (arr.length === 0) return 0;
      const sum = arr.reduce((acc, block) => acc + (block[field] || 0), 0);
      return sum / arr.length;
    };

    const averages = {
      last50: {
        blockInterval: calculateAvg(rollingCache.window50, 'block_interval'),
        txCount: calculateAvg(rollingCache.window50, 'tx_count'),
        blockSize: calculateAvg(rollingCache.window50, 'block_size'),
        fees: calculateAvg(rollingCache.window50, 'fees')
      },
      last500: {
        blockInterval: calculateAvg(rollingCache.window500, 'block_interval'),
        txCount: calculateAvg(rollingCache.window500, 'tx_count'),
        blockSize: calculateAvg(rollingCache.window500, 'block_size'),
        fees: calculateAvg(rollingCache.window500, 'fees')
      },
      last1500: {
        blockInterval: calculateAvg(rollingCache.window1500, 'block_interval'),
        txCount: calculateAvg(rollingCache.window1500, 'tx_count'),
        blockSize: calculateAvg(rollingCache.window1500, 'block_size'),
        fees: calculateAvg(rollingCache.window1500, 'fees')
      }
    };

    return cb(averages);
  },

  // Update daily stats
  updateDailyStats: function(blockStats, cb) {
    // Get date string (YYYY-MM-DD)
    const date = new Date(blockStats.time * 1000);
    const dateStr = date.toISOString().split('T')[0];

    // Find or create daily stats
    DashboardDailyStats.findOne({ date: dateStr }).then((dailyStats) => {
      if (!dailyStats) {
        dailyStats = new DashboardDailyStats({
          date: dateStr,
          blocks: 0,
          tx_count_total: 0,
          avg_block_time: 0,
          avg_block_size: 0,
          issuance: 0,
          fees_total: 0
        });
      }

      // Update daily stats
      dailyStats.blocks += 1;
      dailyStats.tx_count_total += blockStats.tx_count;
      dailyStats.fees_total += blockStats.fees;
      
      // Recalculate averages
      dailyStats.avg_block_time = ((dailyStats.avg_block_time * (dailyStats.blocks - 1)) + blockStats.block_interval) / dailyStats.blocks;
      dailyStats.avg_block_size = ((dailyStats.avg_block_size * (dailyStats.blocks - 1)) + blockStats.block_size) / dailyStats.blocks;

      // Save daily stats
      dailyStats.save().then(() => {
        return cb(true);
      }).catch((err) => {
        console.log('Error updating daily stats:', err);
        return cb(false);
      });
    }).catch((err) => {
      console.log('Error finding daily stats:', err);
      return cb(false);
    });
  },

  // Get daily stats for a date range
  getDailyStats: function(startDate, endDate, cb) {
    DashboardDailyStats.find({
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 }).exec().then((stats) => {
      return cb(stats);
    }).catch((err) => {
      console.log(err);
      return cb([]);
    });
  },

  // Handle chain reorg - remove blocks after a certain height
  handleReorg: function(reorgHeight, cb) {
    const self = this;
    
    // Remove block stats after reorg height
    DashboardBlockStats.deleteMany({ height: { $gt: reorgHeight } }).then(() => {
      // Reinitialize rolling cache
      self.initializeRollingCache(reorgHeight, function(success) {
        // Recalculate affected daily stats
        // This is simplified - would need more sophisticated logic
        return cb(success);
      });
    }).catch((err) => {
      console.log('Error handling reorg:', err);
      return cb(false);
    });
  },

  // Get comprehensive dashboard data including time-series
  getDashboardData: function(cb) {
    const self = this;
    
    // Get current data
    Stats.findOne({ coin: settings.coin.name }).then((stats) => {
      if (!stats) {
        return cb(null);
      }

      // Get rolling averages
      self.getRollingAverages(function(averages) {
        // Get last 30 days of daily stats
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
        const startDate = thirtyDaysAgo.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];

        self.getDailyStats(startDate, endDate, function(dailyStats) {
          // Get latest block stats
          DashboardBlockStats.findOne().sort({ height: -1 }).exec().then((latestBlock) => {
            const dashboardData = {
              current: {
                latestBlockHeight: stats.last,
                latestBlockHash: latestBlock ? latestBlock.hash : '',
                difficulty: latestBlock ? latestBlock.difficulty : 0,
                totalSupply: stats.supply,
                totalTxCount: stats.txes
              },
              rolling: averages,
              daily: dailyStats
            };

            return cb(dashboardData);
          }).catch((err) => {
            console.log(err);
            return cb(null);
          });
        });
      });
    }).catch((err) => {
      console.log(err);
      return cb(null);
    });
  }
};
