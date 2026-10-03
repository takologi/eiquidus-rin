var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalRentalSnapshotSchema = new Schema({
  provider: { type: String, required: true, index: true },
  market: { type: String, default: '', index: true },
  algo: { type: String, default: '', index: true },
  bucket_timestamp: { type: Number, required: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  listings_count: { type: Number, default: 0 },
  avg_price: { type: Number, default: 0 },
  lowest_price: { type: Number, default: 0 },
  highest_price: { type: Number, default: 0 },
  hashpower_total: { type: Number, default: 0 },
  source_requires_auth: { type: Boolean, default: false },
  raw: { type: Object, default: {} }
}, {id: false});

HistoricalRentalSnapshotSchema.index({provider: 1, market: 1, algo: 1, bucket_timestamp: 1}, {unique: true});
HistoricalRentalSnapshotSchema.index({provider: 1, market: 1, algo: 1, timestamp: -1});

module.exports = mongoose.model('HistoricalRentalSnapshot', HistoricalRentalSnapshotSchema);
