var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalConfirmationPolicySchema = new Schema({
  bucket_timestamp: { type: Number, required: true, unique: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  confirmations: { type: Number, default: 0 },
  reorg_warning_depth: { type: Number, default: 0 },
  reorg_critical_depth: { type: Number, default: 0 }
}, {id: false});

HistoricalConfirmationPolicySchema.index({timestamp: -1});

module.exports = mongoose.model('HistoricalConfirmationPolicy', HistoricalConfirmationPolicySchema);
