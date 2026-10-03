var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var HistoricalTradeSchema = new Schema({
  market: { type: String, required: true, index: true },
  coin_symbol: { type: String, required: true, index: true },
  pair_symbol: { type: String, required: true, index: true },
  trade_id: { type: String, required: true },
  side: { type: String, default: '' },
  price: { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  timestamp: { type: Number, required: true, index: true },
  collected_at: { type: Number, required: true, index: true }
}, {id: false});

HistoricalTradeSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, trade_id: 1}, {unique: true});
HistoricalTradeSchema.index({market: 1, coin_symbol: 1, pair_symbol: 1, timestamp: -1});

module.exports = mongoose.model('HistoricalTrade', HistoricalTradeSchema);
