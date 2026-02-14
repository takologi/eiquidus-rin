var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var DashboardBlockStatsSchema = new Schema({
  height: { type: Number, required: true, unique: true, index: true },
  time: { type: Number, required: true, index: true },
  block_interval: { type: Number, default: 0 },
  tx_count: { type: Number, default: 0 },
  block_size: { type: Number, default: 0 },
  fees: { type: Number, default: 0 },  // Total tx fees in satoshi
  block_reward: { type: Number, default: 0 },  // Block reward in satoshi (coinbase - fees)
  tx_value: { type: Number, default: 0 },  // Total tx value in satoshi (excluding coinbase)
  difficulty: { type: Number, default: 0 },
  hash: { type: String, required: true }
}, {id: false});

DashboardBlockStatsSchema.index({height: 1, time: 1});
DashboardBlockStatsSchema.index({height: 1, block_reward: 1});

module.exports = mongoose.model('DashboardBlockStats', DashboardBlockStatsSchema);
