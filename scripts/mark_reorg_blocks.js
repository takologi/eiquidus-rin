/**
 * mark_reorg_blocks.js
 *
 * One-time migration: for every orphan record whose blockindex is at or below
 * the specified height (default: 575000), set has_reorg=true on all txes at
 * that blockindex so the TX-list badge works without a secondary Orphans query.
 *
 * Usage (run from /opt/eiquidus-test/):
 *   node scripts/mark_reorg_blocks.js [max_blockindex]
 *
 * Example:
 *   node scripts/mark_reorg_blocks.js 575000
 */

'use strict';

const mongoose = require('../node_modules/mongoose');
const settings = require('../lib/settings');
const Orphan = require('../models/orphans');
const Tx = require('../models/tx');

const maxBlockIndex = parseInt(process.argv[2] || '575000', 10);

console.log('Marking has_reorg on txes for orphaned blocks with blockindex <=', maxBlockIndex);

var u = encodeURIComponent;
var uri = 'mongodb://' + u(settings.dbsettings.user) + ':' + u(settings.dbsettings.password) +
  '@' + settings.dbsettings.address + ':' + settings.dbsettings.port + '/' + settings.dbsettings.database;

mongoose.connect(uri).then(function() {
  return Orphan.find({blockindex: {$lte: maxBlockIndex}}).select('blockindex').lean().exec();
}).then(function(orphans) {
  if (orphans.length === 0) {
    console.log('No orphan records found at or below blockindex', maxBlockIndex);
    return mongoose.disconnect().then(function() { process.exit(0); });
  }

  console.log('Found', orphans.length, 'orphan record(s). Updating txes...');

  // collect unique blockindexes (multiple orphans can share the same height)
  var blockIndexes = [...new Set(orphans.map(function(o) { return o.blockindex; }))];
  var updated = 0;
  var skipped = 0;
  var i = 0;

  function next() {
    if (i >= blockIndexes.length) {
      console.log('Done. Marked has_reorg at', updated, 'blockindex(es);', skipped, 'had no txes (canonical block empty or already purged).');
      return mongoose.disconnect().then(function() { process.exit(0); });
    }

    var idx = blockIndexes[i++];

    Tx.updateMany({blockindex: idx}, {$set: {has_reorg: true}}).then(function(result) {
      if (result.matchedCount > 0) {
        console.log('  blockindex', idx, '-> marked', result.matchedCount, 'tx(es)');
        updated++;
      } else {
        console.log('  blockindex', idx, '-> no txes found');
        skipped++;
      }
      return next();
    }).catch(function(err) {
      console.error('  blockindex', idx, '-> error:', err.message);
      return next();
    });
  }

  next();
}).catch(function(err) {
  console.error('Error:', err.message);
  process.exit(1);
});

