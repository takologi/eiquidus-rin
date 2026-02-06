var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var DashboardDailyStatsSchema = new Schema({
  date: { type: String, required: true, unique: true, index: true },
  blocks: { type: Number, default: 0 },
  tx_count_total: { type: Number, default: 0 },
  avg_block_time: { type: Number, default: 0 },
  avg_block_size: { type: Number, default: 0 },
  issuance: { type: Number, default: 0 },
  fees_total: { type: Number, default: 0 },
  block_reward_total: { type: Number, default: 0 },
  tx_value_total: { type: Number, default: 0 }
}, {id: false});

module.exports = mongoose.model('DashboardDailyStats', DashboardDailyStatsSchema);
