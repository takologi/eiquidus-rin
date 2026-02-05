var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var DashboardBlockStatsSchema = new Schema({
  height: { type: Number, required: true, unique: true, index: true },
  time: { type: Number, required: true, index: true },
  block_interval: { type: Number, default: 0 },
  tx_count: { type: Number, default: 0 },
  block_size: { type: Number, default: 0 },
  fees: { type: Number, default: 0 },
  difficulty: { type: Number, default: 0 },
  hash: { type: String, required: true }
}, {id: false});

module.exports = mongoose.model('DashboardBlockStats', DashboardBlockStatsSchema);
