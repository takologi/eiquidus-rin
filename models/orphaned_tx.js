var mongoose = require('mongoose'),
   Schema = mongoose.Schema;

// Archive of transaction data from orphaned blocks.
// Records are inserted before the originals are deleted by delete_and_cleanup_tx(),
// allowing historical inspection of what was in a competing chain.
var OrphanedTxSchema = new Schema({
  txid: { type: String, lowercase: true, index: true },
  vin: { type: Array, default: [] },
  vout: { type: Array, default: [] },
  total: { type: Number, default: 0 },
  timestamp: { type: Number, default: 0 },
  blockhash: { type: String, index: true },
  blockindex: { type: Number, default: 0, index: true },
  tx_type: { type: String, default: null },
  op_return: { type: String, default: null },
  algo: { type: String, default: null },
  // Hash of the orphaned block this TX belonged to (matches orphan_blockhash in Orphans collection)
  orphan_blockhash: { type: String, index: true },
  orphaned_at: { type: Date, default: Date.now }
}, {id: false});

// Compound unique index: same txid can appear in multiple orphaned blocks (chain splits)
OrphanedTxSchema.index({ txid: 1, orphan_blockhash: 1 }, { unique: true });

module.exports = mongoose.model('OrphanedTx', OrphanedTxSchema);
