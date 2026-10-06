/**
 * backfill_tx_flags.js
 *
 * Analyzes the raw transaction (version, signature hashtypes, coinbase tag) of already synced
 * txes and saves the result to the flags field. New txes get their flags during the block sync.
 * Only txes without flags are processed unless --force is used, so the script can be stopped
 * and run again at any time.
 *
 * Usage (run from the explorer directory):
 *   node scripts/backfill_tx_flags.js [--days N | --from-height H | --all] [--rate N] [--force]
 *
 *   --days N         txes with a timestamp within the last N days (default: 7)
 *   --from-height H  txes with blockindex >= H
 *   --all            all txes
 *   --rate N         max getrawtransaction calls per second (default: 50)
 *   --force          also re-analyze txes that already have flags
 */

'use strict';

const mongoose = require('../node_modules/mongoose');
const settings = require('../lib/settings');
const lib = require('../lib/explorer');
const tx_flags = require('../lib/tx_flags');
const Tx = require('../models/tx');

const LOCK_NAME = 'backfill_tx_flags';
const WRITE_BATCH_SIZE = 500;

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);

  if (idx > -1 && process.argv[idx + 1] != null)
    return process.argv[idx + 1];

  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function get_rawtransaction(txid) {
  return new Promise((resolve) => lib.get_rawtransaction(txid, resolve));
}

function build_filter() {
  let filter = {};
  let description;

  if (hasFlag('--all'))
    description = 'all txes';
  else if (getArg('--from-height', null) != null) {
    filter.blockindex = {$gte: parseInt(getArg('--from-height'), 10)};
    description = 'txes from block ' + filter.blockindex.$gte;
  } else {
    const days = Number(getArg('--days', 7));

    filter.timestamp = {$gte: Math.floor(Date.now() / 1000) - Math.round(days * 86400)};
    description = 'txes of the last ' + days + ' day(s)';
  }

  if (!hasFlag('--force'))
    filter.flags = null;

  return {filter: filter, description: description + (hasFlag('--force') ? '' : ' without flags')};
}

async function backfill() {
  const rate = Math.max(1, parseInt(getArg('--rate', 50), 10));
  const {filter, description} = build_filter();
  const total = await Tx.countDocuments(filter);

  console.log('Analyzing ' + total + ' ' + description + ' at max ' + rate + ' tx/s');

  const cursor = Tx.find(filter).select('txid').sort({blockindex: -1}).lean().batchSize(1000).cursor();
  let ops = [];
  let done = 0;
  let missing = 0;
  let chunk = [];

  async function process_chunk() {
    const started = Date.now();
    const results = await Promise.all(chunk.map((txid) => get_rawtransaction(txid)));

    results.forEach(function(tx, i) {
      if (tx == null || tx.txid == null)
        missing++;
      else
        ops.push({updateOne: {filter: {txid: chunk[i]}, update: {$set: {flags: tx_flags.analyze_tx(tx)}}}});
    });

    done += chunk.length;
    chunk = [];

    if (ops.length >= WRITE_BATCH_SIZE) {
      await Tx.bulkWrite(ops, {ordered: false});
      ops = [];
      console.log('  ' + done + '/' + total + ' analyzed' + (missing > 0 ? ', ' + missing + ' not found by the node' : ''));
    }

    // keep the rpc rate at or below the limit
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    chunk.push(doc.txid);

    if (chunk.length >= rate)
      await process_chunk();
  }

  if (chunk.length > 0)
    await process_chunk();

  if (ops.length > 0)
    await Tx.bulkWrite(ops, {ordered: false});

  console.log('Done. ' + done + ' tx(es) analyzed' + (missing > 0 ? ', ' + missing + ' not found by the node' : ''));
}

if (lib.is_locked([LOCK_NAME, 'backup', 'restore', 'delete']) == true) {
  console.log('Another backfill, backup, restore or delete process is running. Exiting.');
  process.exit(1);
}

lib.create_lock(LOCK_NAME);

const u = encodeURIComponent;
const uri = 'mongodb://' + u(settings.dbsettings.user) + ':' + u(settings.dbsettings.password) +
  '@' + settings.dbsettings.address + ':' + settings.dbsettings.port + '/' + settings.dbsettings.database;

mongoose.connect(uri).then(backfill).then(function() {
  lib.remove_lock(LOCK_NAME);
  return mongoose.disconnect().then(function() { process.exit(0); });
}).catch(function(err) {
  console.error('Error:', err);
  lib.remove_lock(LOCK_NAME);
  process.exit(1);
});
