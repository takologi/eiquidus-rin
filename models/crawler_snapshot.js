var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var CrawlerSnapshotSchema = new Schema({
  timestamp: { type: Number, required: true, unique: true, index: true },
  total_nodes: { type: Number, default: 0 },
  avg_height: { type: Number, default: 0 },
  max_height: { type: Number, default: 0 },
  min_height: { type: Number, default: 0 },
  version_distribution: { type: Object, default: {} },
  potential_forks: { type: Array, default: [] },
  trusted_nodes_height: { type: Number, default: 0 },
  trusted_nodes_hash: { type: String, default: '' },
  height_distribution: { type: Object, default: {} }
}, {id: false});

module.exports = mongoose.model('CrawlerSnapshot', CrawlerSnapshotSchema);
