var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalMarketSnapshotSchema = new Schema({
  market: { type: String, required: true, index: true },
  coin_symbol: { type: String, required: true, index: true },
  pair_symbol: { type: String, required: true, index: true },
  bucket_timestamp: { type: Number, required: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  last: { type: Number, default: 0 },
  bid: { type: Number, default: 0 },
  ask: { type: Number, default: 0 },
  high: { type: Number, default: 0 },
  low: { type: Number, default: 0 },
  volume: { type: Number, default: 0 },
  volume_quote: { type: Number, default: 0 },
  change: { type: Number, default: 0 },
  source: { type: String, default: 'exchange' },
  extra: { type: Object, default: {} }
}, {id: false});

HistoricalMarketSnapshotSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, bucket_timestamp: 1}, {unique: true});
HistoricalMarketSnapshotSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, timestamp: -1});

module.exports = mongoose.model('HistoricalMarketSnapshot', HistoricalMarketSnapshotSchema);
