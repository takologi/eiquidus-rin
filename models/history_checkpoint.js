const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HistoryCheckpointSchema = new Schema({
  height: { type: Number, index: true, unique: true },
  tx_total: { type: Number, index: true },
  tx_interval: { type: Number, default: 0 },
  wallet_count: { type: Number, default: 0 },
  created_at: { type: Number, default: () => Math.floor(Date.now() / 1000) }
});

HistoryCheckpointSchema.index({ height: -1 });
HistoryCheckpointSchema.index({ tx_total: -1 });

module.exports = mongoose.model('HistoryCheckpoint', HistoryCheckpointSchema);
