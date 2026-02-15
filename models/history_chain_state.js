const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HistoryChainStateSchema = new Schema({
  height: { type: Number, index: true, unique: true },
  tx_total: { type: Number, index: true },
  supply: { type: Number, default: 0 },
  tx_count: { type: Number, default: 0 },
  hash: { type: String, default: '' },
  time: { type: Number, default: 0 },
  difficulty: { type: Number, default: 0 },
  created_at: { type: Number, default: () => Math.floor(Date.now() / 1000) }
});

HistoryChainStateSchema.index({ height: -1 });
HistoryChainStateSchema.index({ tx_total: -1 });

module.exports = mongoose.model('HistoryChainState', HistoryChainStateSchema);
