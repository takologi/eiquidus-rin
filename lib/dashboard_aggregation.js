const DashboardBlockStats = require('../models/dashboard_block_stats');
const DashboardDailyStats = require('../models/dashboard_daily_stats');
const Tx = require('../models/tx');
const NetworkHistory = require('../models/networkhistory');
const Stats = require('../models/stats');
const settings = require('./settings');

module.exports = {
  
  /**
   * Bulk process blocks using MongoDB aggregation
   * Much faster than individual processing
   */
  bulkProcessBlocks: function(startHeight, endHeight, cb) {
    const self = this;
    const startTime = Date.now();
    
    console.log(`[BULK] Processing blocks ${startHeight}-${endHeight}...`);
    
    // Step 1: Use aggregation to calculate all block stats at once
    const aggregationStart = Date.now();
    Tx.aggregate([
      {
        $match: {
          blockindex: { $gte: startHeight, $lte: endHeight }
        }
      },
      {
        $group: {
          _id: '$blockindex',
          hash: { $first: '$blockhash' },
          time: { $first: '$timestamp' },
          tx_count: { $sum: 1 },
          fees: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$vin.addresses', 'coinbase'] },
                    { $gt: [{ $size: { $ifNull: ['$vin', []] } }, 0] }
                  ]
                },
                '$total',
                0
              ]
            }
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]).exec().then((blockAggregates) => {
      const aggregationTime = Date.now() - aggregationStart;
      console.log(`[BENCH] Aggregation completed in ${aggregationTime}ms for ${blockAggregates.length} blocks`);
      
      if (!blockAggregates || blockAggregates.length === 0) {
        return cb(false, 0);
      }

      // Step 2: Get difficulty data in bulk
      const difficultyStart = Date.now();
      NetworkHistory.find({
        blockindex: { $lte: endHeight }
      })
      .sort({ blockindex: -1 })
      .limit(100)  // Get last 100 nethist entries for difficulty lookup
      .exec()
      .then((nethists) => {
        const difficultyTime = Date.now() - difficultyStart;
        console.log(`[BENCH] Difficulty lookup in ${difficultyTime}ms`);
        
        // Create difficulty lookup map
        const difficultyMap = new Map();
        nethists.forEach(nh => {
          difficultyMap.set(nh.blockindex, nh.difficulty_pow || nh.difficulty_pos || 0);
        });

        // Step 3: Build block stats documents
        const buildStart = Date.now();
        const blockStatsArray = [];
        const dailyStatsMap = new Map();
        
        for (let i = 0; i < blockAggregates.length; i++) {
          const block = blockAggregates[i];
          const height = block._id;
          
          // Calculate block interval
          let blockInterval = 0;
          if (i > 0) {
            blockInterval = block.time - blockAggregates[i - 1].time;
          }
          
          // Find closest difficulty
          let difficulty = 0;
          for (const [nethHeight, nethDiff] of difficultyMap) {
            if (nethHeight <= height) {
              difficulty = nethDiff;
              break;
            }
          }
          
          // Create block stats document
          blockStatsArray.push({
            height: height,
            time: block.time,
            block_interval: blockInterval,
            tx_count: block.tx_count,
            block_size: 0,
            fees: block.fees,
            difficulty: difficulty,
            hash: block.hash
          });
          
          // Aggregate daily stats
          const date = new Date(block.time * 1000).toISOString().split('T')[0];
          if (!dailyStatsMap.has(date)) {
            dailyStatsMap.set(date, {
              blocks: 0,
              tx_count_total: 0,
              block_intervals: [],
              fees_total: 0
            });
          }
          const dailyStats = dailyStatsMap.get(date);
          dailyStats.blocks++;
          dailyStats.tx_count_total += block.tx_count;
          dailyStats.fees_total += block.fees;
          if (blockInterval > 0) {
            dailyStats.block_intervals.push(blockInterval);
          }
        }
        
        const buildTime = Date.now() - buildStart;
        console.log(`[BENCH] Document building in ${buildTime}ms`);

        // Step 4: Bulk insert block stats
        const insertStart = Date.now();
        DashboardBlockStats.insertMany(blockStatsArray, { ordered: false })
          .then(() => {
            const insertTime = Date.now() - insertStart;
            console.log(`[BENCH] Bulk insert ${blockStatsArray.length} blocks in ${insertTime}ms`);
            
            // Step 5: Update daily stats
            const dailyStart = Date.now();
            self.bulkUpdateDailyStats(dailyStatsMap, function(success) {
              const dailyTime = Date.now() - dailyStart;
              console.log(`[BENCH] Daily stats update in ${dailyTime}ms`);
              
              const totalTime = Date.now() - startTime;
              const blocksPerSec = (blockStatsArray.length / (totalTime / 1000)).toFixed(2);
              console.log(`[BENCH] TOTAL: ${totalTime}ms for ${blockStatsArray.length} blocks (${blocksPerSec} blocks/sec)`);
              
              return cb(true, blockStatsArray.length);
            });
          })
          .catch((err) => {
            // Ignore duplicate key errors (blocks already processed)
            if (err.code === 11000 && err.writeErrors) {
              const inserted = blockStatsArray.length - err.writeErrors.length;
              console.log(`[BULK] Inserted ${inserted} blocks (${err.writeErrors.length} duplicates skipped)`);
              
              // Still update daily stats
              self.bulkUpdateDailyStats(dailyStatsMap, function(success) {
                const totalTime = Date.now() - startTime;
                console.log(`[BENCH] TOTAL: ${totalTime}ms`);
                return cb(true, inserted);
              });
            } else {
              console.error('[BULK] Insert error:', err.message);
              return cb(false, 0);
            }
          });
      })
      .catch((err) => {
        console.error('[BULK] Difficulty lookup error:', err);
        return cb(false, 0);
      });
    }).catch((err) => {
      console.error('[BULK] Aggregation error:', err);
      return cb(false, 0);
    });
  },

  /**
   * Bulk update daily stats using aggregation
   */
  bulkUpdateDailyStats: function(dailyStatsMap, cb) {
    const bulkOps = [];
    
    for (const [date, stats] of dailyStatsMap) {
      const avgBlockTime = stats.block_intervals.length > 0
        ? stats.block_intervals.reduce((a, b) => a + b, 0) / stats.block_intervals.length
        : 0;
      
      bulkOps.push({
        updateOne: {
          filter: { date: date },
          update: {
            $inc: {
              blocks: stats.blocks,
              tx_count_total: stats.tx_count_total,
              fees_total: stats.fees_total
            },
            $set: {
              avg_block_time: avgBlockTime,
              avg_block_size: 0,
              issuance: 0
            }
          },
          upsert: true
        }
      });
    }
    
    if (bulkOps.length === 0) {
      return cb(true);
    }
    
    DashboardDailyStats.bulkWrite(bulkOps)
      .then(() => {
        return cb(true);
      })
      .catch((err) => {
        console.error('[BULK] Daily stats error:', err);
        return cb(false);
      });
  },

  /**
   * Initialize rolling cache from database
   */
  initializeRollingCache: function(currentHeight, cb) {
    DashboardBlockStats.find({ height: { $gte: currentHeight - 1500, $lte: currentHeight } })
      .sort({ height: 1 })
      .exec()
      .then((blocks) => {
        console.log(`[CACHE] Initialized with ${blocks.length} blocks`);
        return cb(true);
      })
      .catch((err) => {
        console.error('[CACHE] Initialization error:', err);
        return cb(false);
      });
  },

  /**
   * Get dashboard data for display
   */
  getDashboardData: function(cb) {
    Stats.findOne({ coin: settings.coin.name }).then((stats) => {
      if (!stats) {
        return cb(null);
      }

      // Get rolling averages using aggregation
      const promises = [
        this.getRollingAveragesAggregated(stats.last, 50),
        this.getRollingAveragesAggregated(stats.last, 500),
        this.getRollingAveragesAggregated(stats.last, 1500)
      ];

      Promise.all(promises).then(([avg50, avg500, avg1500]) => {
        // Get last 30 days of daily stats
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - (30 * 24 * 60 * 60 * 1000));
        const startDate = thirtyDaysAgo.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];

        DashboardDailyStats.find({ date: { $gte: startDate, $lte: endDate } })
          .sort({ date: 1 })
          .exec()
          .then((dailyStats) => {
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
                rolling: {
                  last50: avg50,
                  last500: avg500,
                  last1500: avg1500
                },
                daily: dailyStats
              };

              return cb(dashboardData);
            });
          });
      }).catch((err) => {
        console.error('Error getting dashboard data:', err);
        return cb(null);
      });
    }).catch((err) => {
      console.error('Error getting stats:', err);
      return cb(null);
    });
  },

  /**
   * Get rolling averages using aggregation
   */
  getRollingAveragesAggregated: function(currentHeight, windowSize) {
    return DashboardBlockStats.aggregate([
      {
        $match: {
          height: { $gt: currentHeight - windowSize, $lte: currentHeight }
        }
      },
      {
        $group: {
          _id: null,
          blockInterval: { $avg: '$block_interval' },
          txCount: { $avg: '$tx_count' },
          blockSize: { $avg: '$block_size' },
          fees: { $avg: '$fees' }
        }
      }
    ]).exec().then((result) => {
      if (result && result.length > 0) {
        return result[0];
      }
      return {
        blockInterval: 0,
        txCount: 0,
        blockSize: 0,
        fees: 0
      };
    });
  }
};
