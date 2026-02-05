var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var CrawlerNodeSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true }, // IP:Port
  last_seen: { type: Number, required: true, index: true },
  version: { type: String, default: '' },
  services: { type: Number, default: 0 },
  height: { type: Number, default: 0, index: true },
  top_hash: { type: String, default: '' },
  is_trusted: { type: Boolean, default: false },
  peer_list: { type: Array, default: [] },
  user_agent: { type: String, default: '' },
  latency: { type: Number, default: 0 }
}, {id: false});

module.exports = mongoose.model('CrawlerNode', CrawlerNodeSchema);
