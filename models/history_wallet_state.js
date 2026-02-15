const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const HistoryWalletStateSchema = new Schema({
  checkpoint_height: { type: Number, index: true },
  a_id: { type: String, index: true },
  address_sort: { type: String, index: true },
  tx_count: { type: Number, default: 0 },
  deposited: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  withdrawn: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  received: { type: Number, default: 0 },
  last_to_block: { type: Number, default: 0 },
  last_from_block: { type: Number, default: 0 }
});

HistoryWalletStateSchema.index({ checkpoint_height: 1, a_id: 1 }, { unique: true });
HistoryWalletStateSchema.index({ checkpoint_height: 1, balance: -1, a_id: 1 });
HistoryWalletStateSchema.index({ checkpoint_height: 1, tx_count: -1, a_id: 1 });
HistoryWalletStateSchema.index({ checkpoint_height: 1, deposited: -1, a_id: 1 });
HistoryWalletStateSchema.index({ checkpoint_height: 1, withdrawn: -1, a_id: 1 });
HistoryWalletStateSchema.index({ checkpoint_height: 1, last_to_block: -1, a_id: 1 });
HistoryWalletStateSchema.index({ checkpoint_height: 1, last_from_block: -1, a_id: 1 });

module.exports = mongoose.model('HistoryWalletState', HistoryWalletStateSchema);
