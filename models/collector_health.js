var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var CollectorHealthSchema = new Schema({
  collector: { type: String, required: true, index: true },
  component: { type: String, required: true, index: true },
  status: { type: String, required: true, index: true },
  message: { type: String, default: '' },
  meta: { type: Object, default: {} },
  timestamp: { type: Number, required: true, index: true }
}, {id: false});

CollectorHealthSchema.index({collector: 1, component: 1, timestamp: -1});

module.exports = mongoose.model('CollectorHealth', CollectorHealthSchema);
