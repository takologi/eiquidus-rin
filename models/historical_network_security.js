var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalNetworkSecuritySchema = new Schema({
  blockindex: { type: Number, required: true, unique: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  nethash: { type: Number, default: 0 },
  difficulty_pow: { type: Number, default: 0 },
  difficulty_pos: { type: Number, default: 0 },
  orphan_events: { type: Number, default: 0 },
  max_reorg_depth: { type: Number, default: 0 },
  confirmations_policy: { type: Number, default: 0 }
}, {id: false});

HistoricalNetworkSecuritySchema.index({timestamp: -1, blockindex: -1});

module.exports = mongoose.model('HistoricalNetworkSecurity', HistoricalNetworkSecuritySchema);
