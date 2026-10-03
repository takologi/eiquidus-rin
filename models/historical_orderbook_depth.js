var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalOrderbookDepthSchema = new Schema({
  market: { type: String, required: true, index: true },
  coin_symbol: { type: String, required: true, index: true },
  pair_symbol: { type: String, required: true, index: true },
  bucket_timestamp: { type: Number, required: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  top_bid: { type: Number, default: 0 },
  top_ask: { type: Number, default: 0 },
  spread: { type: Number, default: 0 },
  mid: { type: Number, default: 0 },
  bids: { type: Array, default: [] },
  asks: { type: Array, default: [] },
  bid_liquidity_quote: { type: Number, default: 0 },
  ask_liquidity_quote: { type: Number, default: 0 }
}, {id: false});

HistoricalOrderbookDepthSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, bucket_timestamp: 1}, {unique: true});
HistoricalOrderbookDepthSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, timestamp: -1});

module.exports = mongoose.model('HistoricalOrderbookDepth', HistoricalOrderbookDepthSchema);
