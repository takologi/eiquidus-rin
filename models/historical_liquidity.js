var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalLiquiditySchema = new Schema({
  provider: { type: String, required: true, index: true },
  market: { type: String, default: '', index: true },
  coin_symbol: { type: String, required: true, index: true },
  pair_symbol: { type: String, default: '', index: true },
  bucket_timestamp: { type: Number, required: true, index: true },
  timestamp: { type: Number, required: true, index: true },
  liquidity_base: { type: Number, default: 0 },
  liquidity_quote: { type: Number, default: 0 },
  depth: { type: Number, default: 0 },
  raw: { type: Object, default: {} }
}, {id: false});

HistoricalLiquiditySchema.index({provider: 1, market: 1, coin_symbol: 1, pair_symbol: 1, bucket_timestamp: 1}, {unique: true});
HistoricalLiquiditySchema.index({provider: 1, coin_symbol: 1, pair_symbol: 1, timestamp: -1});

module.exports = mongoose.model('HistoricalLiquidity', HistoricalLiquiditySchema);
