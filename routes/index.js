const express = require('express');
const router = express.Router();
const settings = require('../lib/settings');
const db = require('../lib/database');
const lib = require('../lib/explorer');
const historicalCollectors = require('../lib/historical_collectors');
const async = require('async');
const Orphans = require('../models/orphans');
const mongoose = require('mongoose');

function send_block_data(res, block, txs, title_text, orphan, orphan_siblings) {
  if (orphan_siblings === undefined) orphan_siblings = null;
  let extracted_by_addresses = [];

  // check if the extracted by addresses should be found
  if (settings.block_page.show_extracted_by == true && txs != null && txs.length > 0) {
    // find the block reward tx
    const block_reward_tx = txs.find(tx => tx.vin != null && (tx.vin.length === 0 || (tx.vin.length === 1 && tx.vin[0].addresses === 'coinbase' && tx.vin[0].amount != 0)));

    // get a list of all the block reward addresses
    extracted_by_addresses = (block_reward_tx ? block_reward_tx.vout.map(v => v.addresses) : []);

    // add claim name data to the array
    db.get_extracted_by_claim_names(extracted_by_addresses, function(updated_extracted_by_addresses) {
      finalize_send_block_data(res, block, txs, title_text, orphan, updated_extracted_by_addresses, orphan_siblings);
    });
  } else
    finalize_send_block_data(res, block, txs, title_text, orphan, extracted_by_addresses, orphan_siblings);
}

function finalize_send_block_data(res, block, txs, title_text, orphan, extracted_by_addresses, orphan_siblings) {
  if (orphan_siblings === undefined) orphan_siblings = null;
  res.render(
    'block',
    {
      active: 'block',
      block: block,
      orphan: orphan,
      orphan_siblings: orphan_siblings,
      reorg_warning_depth: settings.orphans_page.reorg_warning_depth,
      reorg_critical_depth: settings.orphans_page.reorg_critical_depth,
      confirmations: settings.shared_pages.confirmations,
      txs: txs,
      extracted_by_addresses: extracted_by_addresses,
      showSync: db.check_show_sync_message(),
      customHash: get_custom_hash(),
      styleHash: get_style_hash(),
      themeHash: get_theme_hash(),
      page_title_prefix: settings.coin.name + ' ' + title_text
    }
  );
}

function send_tx_data(res, tx, blockcount, orphan) {
  let extracted_by_addresses = [];

  // check if the extracted by addresses should be found
  if (
    settings.transaction_page.show_extracted_by == true &&
    tx != null &&
    tx.vout != null &&
    (
      tx.vin == null ||
      tx.vin.length === 0 ||
      (
        tx.vin.length === 1 &&
        tx.vin[0].addresses === 'coinbase' &&
        tx.vin[0].amount != 0
      )
    )
  ) {
    // get a list of all the block reward addresses
    extracted_by_addresses = tx.vout.map(v => v.addresses);

    // add claim name data to the array
    db.get_extracted_by_claim_names(extracted_by_addresses, function(updated_extracted_by_addresses) {
      finalize_send_tx_data(res, tx, blockcount, orphan, updated_extracted_by_addresses);
    });
  } else
    finalize_send_tx_data(res, tx, blockcount, orphan, extracted_by_addresses);
}

function finalize_send_tx_data(res, tx, blockcount, orphan, extracted_by_addresses) {
  res.render(
    'tx',
    {
      active: 'tx',
      tx: tx,
      orphan: orphan,
      confirmations: settings.shared_pages.confirmations,
      blockcount: blockcount,
      extracted_by_addresses: extracted_by_addresses,
      showSync: db.check_show_sync_message(),
      customHash: get_custom_hash(),
      styleHash: get_style_hash(),
      themeHash: get_theme_hash(),
      page_title_prefix: settings.coin.name + ' ' + 'Transaction ' + tx.txid
    }
  );
}

function send_address_data(res, address, claim_name, history_block, history_error, historical_summary) {
  const history_block_label = (history_block != null
    ? ('#' + history_block + (address.history_timestamp_text == null ? '' : ' (' + address.history_timestamp_text + ')'))
    : null);
  const history_suffix = (history_block_label != null ? ' - History up to Block ' + history_block_label : '');

  res.render(
    'address',
    {
      active: 'address',
      address: address,
      claim_name: claim_name,
      history_block: history_block,
      history_block_label: history_block_label,
      history_error: history_error,
      historical_summary: historical_summary,
      showSync: db.check_show_sync_message(),
      customHash: get_custom_hash(),
      styleHash: get_style_hash(),
      themeHash: get_theme_hash(),
      page_title_prefix: settings.coin.name + ' ' + 'Address ' + (claim_name == null || claim_name == '' ? address.a_id : claim_name) + history_suffix
    }
  );
}

function send_claimaddress_data(res, hash, claim_name) {
  res.render(
    'claim_address',
    {
      active: 'claim-address',
      hash: hash,
      claim_name: claim_name,
      showSync: db.check_show_sync_message(),
      customHash: get_custom_hash(),
      styleHash: get_style_hash(),
      themeHash: get_theme_hash(),
      page_title_prefix: settings.coin.name + ' Claim Wallet Address' + (hash == null || hash == '' ? '' : ' ' + hash)
    }
  );
}

function get_file_timestamp(file_name) {
  if (db.fs.existsSync(file_name))
    return parseInt(db.fs.statSync(file_name).mtimeMs / 1000);
  else
    return null;
}

function get_last_updated_date(show_last_updated, last_updated_field, cb) {
  // check if the last updated date is needed
  if (show_last_updated == true) {
    // lookup the stats record
    db.get_stats(settings.coin.name, function (stats) {
      // return the last updated date
      return cb(stats[last_updated_field]);
    });
  } else {
    return cb(null);
  }
}

function format_utc_timestamp(timestamp) {
  if (timestamp == null || isNaN(timestamp))
    return null;

  const dt = new Date(Number(timestamp) * 1000);

  if (isNaN(dt.getTime()))
    return null;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const month = months[dt.getUTCMonth()];
  const year = dt.getUTCFullYear();
  const hours = String(dt.getUTCHours()).padStart(2, '0');
  const minutes = String(dt.getUTCMinutes()).padStart(2, '0');
  const seconds = String(dt.getUTCSeconds()).padStart(2, '0');

  return `${month} ${day}, ${year} ${hours}:${minutes}:${seconds} UTC`;
}

function get_block_data_from_wallet(block, res, orphan) {
  var ntxs = [];

  async.eachSeries(block.tx, function(block_tx, loop) {
    lib.get_rawtransaction(block_tx, function(tx) {
      if (tx && tx != `${settings.localization.ex_error}: ${settings.localization.check_console}`) {
        lib.prepare_vin(tx, function(vin, tx_type_vin) {
          lib.prepare_vout(tx.vout, block_tx, vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof tx.vjoinsplit === 'undefined' || tx.vjoinsplit == null) ? [] : tx.vjoinsplit), function(vout, nvin, tx_type_vout) {
            const total = lib.calculate_total(vout);

            ntxs.push({
              txid: block_tx,
              vout: vout,
              total: total.toFixed(8)
            });

            if (settings.block_page.show_extracted_by == true) {
              // add the vin object to the tx data
              ntxs[ntxs.length - 1].vin = (vin == null || vin.length == 0 ? [] : nvin);
            }

            loop();
          });
        });
      } else
        loop();
    });
  }, function() {
    send_block_data(res, block, ntxs, 'Block ' + block.height, orphan);
  });
}

function get_custom_hash() {
  return get_file_timestamp('./public/css/custom.scss');
}

function get_style_hash() {
  return get_file_timestamp('./public/css/style.scss');
}

function get_theme_hash() {
  return get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css');
}

const MARKET_HISTORY_SOURCE_COLLECTIONS = {
  m5: 'historical_market_5m',
  h1: 'historical_market_hourly',
  d1: 'historical_market_daily'
};

function normalize_market_history_rows(rows) {
  const byTs = new Map();

  (rows || []).forEach((row) => {
    const ts = Number(row.timestamp != null ? row.timestamp : row.x);
    let last = Number((row.last != null ? row.last : row.close));
    let bid = Number(row.bid);
    let ask = Number(row.ask);

    if (!(ts > 0) || isNaN(ts))
      return;

    last = (last > 0 && !isNaN(last) ? last : null);
    bid = (bid > 0 && !isNaN(bid) ? bid : null);
    ask = (ask > 0 && !isNaN(ask) ? ask : null);

    if (bid != null && ask != null && ask < bid)
      ask = bid;

    const existing = byTs.get(ts) || { x: ts, last: null, bid: null, ask: null };

    if (existing.last == null && last != null)
      existing.last = last;

    if (existing.bid == null && bid != null)
      existing.bid = bid;

    if (existing.ask == null && ask != null)
      existing.ask = ask;

    byTs.set(ts, existing);
  });

  return Array.from(byTs.values()).sort((a, b) => a.x - b.x);
}

function downsample_market_history_rows(rows, maxPoints) {
  const source = (Array.isArray(rows) ? rows.slice() : []);

  if (source.length <= maxPoints)
    return source;

  source.sort((a, b) => Number(a.x) - Number(b.x));
  const sampled = [];

  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * (source.length - 1)) / (maxPoints - 1));
    sampled.push(source[idx]);
  }

  return sampled;
}

function rows_to_series(rows, field) {
  return (rows || []).filter((r) => r[field] != null).map((r) => ({ x: Number(r.x), y: Number(r[field]) }));
}

function normalize_market_history_range(rangeRaw) {
  if (rangeRaw == null)
    return '30';

  const v = rangeRaw.toString().trim().toLowerCase();

  if (v === 'all')
    return 'all';

  const n = Number.parseInt(v, 10);

  if (Number.isNaN(n) || n <= 0)
    return '30';

  if (n <= 1)
    return '1';
  if (n <= 7)
    return '7';
  if (n <= 30)
    return '30';
  if (n <= 90)
    return '90';
  if (n <= 180)
    return '180';
  if (n <= 365)
    return '365';

  return 'all';
}

function get_default_market_history_source(range) {
  if (range === '1' || range === '7')
    return 'm5';

  if (range === '30')
    return 'h1';

  return 'd1';
}

function get_market_history_window_start(range, sourceKey) {
  const nowTs = Math.floor(Date.now() / 1000);

  if (range === 'all') {
    if (sourceKey === 'm5')
      return nowTs - (30 * 86400);
    if (sourceKey === 'h1')
      return nowTs - (400 * 86400);

    return null;
  }

  const days = Number.parseInt(range, 10);

  if (Number.isNaN(days) || days <= 0)
    return nowTs - (30 * 86400);

  return nowTs - (days * 86400);
}

async function fetch_market_history_rows(collectionName, filter, projection, fromTimestamp, limitRows) {
  const nativeDb = (mongoose.connection != null ? mongoose.connection.db : null);

  if (nativeDb == null)
    return [];

  const query = Object.assign({}, filter);

  if (fromTimestamp != null)
    query.timestamp = { $gte: Number(fromTimestamp) };

  const finalLimit = (limitRows != null && Number(limitRows) > 0 ? Number(limitRows) : 25000);

  try {
    const rows = await nativeDb.collection(collectionName)
      .find(query, { projection: projection })
      .sort({ timestamp: -1 })
      .limit(finalLimit)
      .toArray();

    return rows.reverse();
  } catch {
    return [];
  }
}

async function get_market_history_payload(marketId, coinSymbol, pairSymbol, rangeRaw, sourceRaw, maxPointsRaw) {
  const pairFilter = {
    market: marketId,
    coin_symbol: coinSymbol.toUpperCase(),
    pair_symbol: pairSymbol.toUpperCase()
  };

  const range = normalize_market_history_range(rangeRaw);
  const requestedSource = (sourceRaw == null ? 'auto' : sourceRaw.toString().trim().toLowerCase());
  const defaultSource = get_default_market_history_source(range);
  const maxPoints = Math.min(Math.max(Number.parseInt(maxPointsRaw, 10) || 300, 25), 1000);
  const sourceOrder = [];

  if (requestedSource === 'm5' || requestedSource === 'h1' || requestedSource === 'd1')
    sourceOrder.push(requestedSource);
  else
    sourceOrder.push(defaultSource);

  ['m5', 'h1', 'd1'].forEach((k) => {
    if (!sourceOrder.includes(k))
      sourceOrder.push(k);
  });

  const projection = { timestamp: 1, last: 1, close: 1, bid: 1, ask: 1, _id: 0 };
  let selectedSource = sourceOrder[0];
  let selectedRows = [];

  for (let i = 0; i < sourceOrder.length; i++) {
    const sourceKey = sourceOrder[i];
    const collectionName = MARKET_HISTORY_SOURCE_COLLECTIONS[sourceKey];
    const fromTimestamp = get_market_history_window_start(range, sourceKey);
    const rows = await fetch_market_history_rows(collectionName, pairFilter, projection, fromTimestamp, 25000);
    const normalizedRows = normalize_market_history_rows(rows);

    if (normalizedRows.length > 0 || i === sourceOrder.length - 1) {
      selectedSource = sourceKey;
      selectedRows = normalizedRows;
      break;
    }
  }

  const sampledRows = downsample_market_history_rows(selectedRows, maxPoints);

  return {
    ok: true,
    market: marketId,
    coin_symbol: coinSymbol.toUpperCase(),
    pair_symbol: pairSymbol.toUpperCase(),
    range: range,
    source: selectedSource,
    points: sampledRows,
    datasets: {
      bid: rows_to_series(sampledRows, 'bid'),
      last: rows_to_series(sampledRows, 'last'),
      ask: rows_to_series(sampledRows, 'ask')
    }
  };
}

async function check_market_history_exists(pairFilter) {
  const nativeDb = (mongoose.connection != null ? mongoose.connection.db : null);

  if (nativeDb == null)
    return false;

  try {
    const [row5m, rowHourly, rowDaily] = await Promise.all([
      nativeDb.collection('historical_market_5m').findOne(pairFilter, { projection: { _id: 1 } }),
      nativeDb.collection('historical_market_hourly').findOne(pairFilter, { projection: { _id: 1 } }),
      nativeDb.collection('historical_market_daily').findOne(pairFilter, { projection: { _id: 1 } })
    ]);

    return (row5m != null || rowHourly != null || rowDaily != null);
  } catch {
    return false;
  }
}

async function fetch_history_point_before_timestamp(pairFilter, beforeTimestamp) {
  const nativeDb = (mongoose.connection != null ? mongoose.connection.db : null);

  if (nativeDb == null)
    return null;

  const query = Object.assign({}, pairFilter, { timestamp: { $lte: Number(beforeTimestamp) } });
  const projection = { timestamp: 1, last: 1, close: 1, bid: 1, ask: 1, _id: 0 };
  const collections = ['historical_market_hourly', 'historical_market_daily', 'historical_market_5m'];

  for (let i = 0; i < collections.length; i++) {
    try {
      const row = await nativeDb.collection(collections[i])
        .find(query, { projection: projection })
        .sort({ timestamp: -1 })
        .limit(1)
        .next();

      if (row != null) {
        const normalized = normalize_market_history_rows([row]);

        if (normalized.length > 0 && normalized[0].last != null)
          return normalized[0];
      }
    } catch {
      // continue to next collection fallback
    }
  }

  return null;
}

/* GET functions */

function route_get_block(res, blockhash) {
  lib.get_block(blockhash, function (block) {
    if (block && block != `${settings.localization.ex_error}: ${settings.localization.check_console}`) {
      if (blockhash == settings.block_page.genesis_block)
        send_block_data(res, block, null, 'Genesis Block', null);
      else if (block.confirmations == -1) {
        // this is an orphaned block, so get the data from the wallet directly
        get_block_data_from_wallet(block, res, true);
      } else {
        db.get_txs(block, function(txs) {
          if (txs.length > 0) {
            // query for any orphaned blocks that this canonical block displaced
            Orphans.find({blockindex: block.height, good_blockhash: block.hash}).lean().exec().then(function(siblings) {
              send_block_data(res, block, txs, 'Block ' + block.height, null, (siblings && siblings.length > 0 ? siblings : null));
            }).catch(function() {
              send_block_data(res, block, txs, 'Block ' + block.height, null, null);
            });
          } else {
            // cannot find block in local database so get the data from the wallet directly
            get_block_data_from_wallet(block, res, false);
          }
        });
      }
    } else {
      if (!isNaN(blockhash)) {
        var height = blockhash;

        lib.get_blockhash(height, function(hash) {
          if (hash && hash != `${settings.localization.ex_error}: ${settings.localization.check_console}`)
            res.redirect('/block/' + hash);
          else
            route_get_txlist(res, 'Block not found: ' + blockhash);
        });
      } else
        route_get_txlist(res, 'Block not found: ' + blockhash);
    }
  });
}

function route_get_tx(res, txid) {
  if (txid == settings.transaction_page.genesis_tx)
    route_get_block(res, settings.block_page.genesis_block);
  else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        lib.get_blockcount(function(blockcount) {
          if (settings.claim_address_page.enabled == true) {
            db.populate_claim_address_names(tx, function(tx) {
              send_tx_data(res, tx, (blockcount ? blockcount : 0), null);
            });
          } else
            send_tx_data(res, tx, (blockcount ? blockcount : 0), null);
        });
      } else {
        lib.get_rawtransaction(txid, function(rtx) {
          if (rtx && rtx.txid) {
            lib.prepare_vin(rtx, function(vin, tx_type_vin) {
              lib.prepare_vout(rtx.vout, rtx.txid, vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof rtx.vjoinsplit === 'undefined' || rtx.vjoinsplit == null) ? [] : rtx.vjoinsplit), function(rvout, rvin, tx_type_vout) {
                const total = lib.calculate_total(rvout);

                if (!rtx.confirmations > 0) {
                  lib.get_block(rtx.blockhash, function(block) {
                    if (block && block != `${settings.localization.ex_error}: ${settings.localization.check_console}`) {
                      var utx = {
                        txid: rtx.txid,
                        vin: rvin,
                        vout: rvout,
                        total: total.toFixed(8),
                        timestamp: (rtx.time == null ? block.time : rtx.time),
                        blockhash: (rtx.blockhash == null ? '-' : rtx.blockhash),
                        blockindex: block.height
                      };

                      if (settings.claim_address_page.enabled == true) {
                        db.populate_claim_address_names(utx, function(utx) {
                          send_tx_data(res, utx, (block.height - 1), true);
                        });
                      } else
                        send_tx_data(res, utx, (block.height - 1), true);
                    } else {
                      // cannot load tx
                      route_get_txlist(res, null);
                    }
                  });
                } else {
                  // check if blockheight exists
                  if (!rtx.blockheight && rtx.blockhash) {
                    // blockheight not found so look up the block
                    lib.get_block(rtx.blockhash, function(block) {
                      if (block && block != `${settings.localization.ex_error}: ${settings.localization.check_console}`) {
                        // create the tx object before rendering
                        var utx = {
                          txid: rtx.txid,
                          vin: rvin,
                          vout: rvout,
                          total: total.toFixed(8),
                          timestamp: rtx.time,
                          blockhash: rtx.blockhash,
                          blockindex: block.height
                        };

                        lib.get_blockcount(function(blockcount) {
                          if (settings.claim_address_page.enabled == true) {
                            db.populate_claim_address_names(utx, function(utx) {
                              send_tx_data(res, utx, (blockcount ? blockcount : 0), null);
                            });
                          } else
                            send_tx_data(res, utx, (blockcount ? blockcount : 0), null);
                        });
                      } else {
                        // cannot load tx
                        route_get_txlist(res, null);
                      }
                    });
                  } else {
                    // create the tx object before rendering
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      total: total.toFixed(8),
                      timestamp: rtx.time,
                      blockhash: rtx.blockhash,
                      blockindex: rtx.blockheight
                    };

                    lib.get_blockcount(function(blockcount) {
                      if (settings.claim_address_page.enabled == true) {
                        db.populate_claim_address_names(utx, function(utx) {
                          send_tx_data(res, utx, (blockcount ? blockcount : 0), null);
                        });
                      } else
                        send_tx_data(res, utx, (blockcount ? blockcount : 0), null);
                    });
                  }
                }
              });
            });
          } else
            route_get_txlist(res, null);
        });
      }
    });
  }
}

function route_get_txlist(res, error) {
  // lookup the last updated date if necessary
  get_last_updated_date(settings.index_page.page_header.show_last_updated, 'blockchain_last_updated', function(last_updated_date) {
    res.render(
      'index',
      {
        active: 'home',
        error: error,
        last_updated: last_updated_date,
        showSync: db.check_show_sync_message(),
        customHash: get_custom_hash(),
        styleHash: get_style_hash(),
        themeHash: get_theme_hash(),
        page_title_prefix: settings.coin.name + ' ' + 'Block Explorer'
      }
    );
  });
}

function route_get_address(res, hash, history_param) {
  function get_history_data(cb) {
    if (history_param == null || history_param.toString().trim() == '')
      return cb(null, null, null);

    // ignore non-number values
    if (!/^\d+$/.test(history_param.toString().trim()))
      return cb(null, null, null);

    const requested_history_block = Number(history_param);

    db.get_stats(settings.coin.name, function(stats) {
      // keep latest state and display validation error if out of range
      if (stats == null || stats.count == null || requested_history_block < 0 || requested_history_block > stats.count) {
        return cb(null, 'Invalid history block height. Showing latest blockchain state.', null);
      }

      lib.get_blockhash(requested_history_block, function(blockhash) {
        if (!blockhash || blockhash == `${settings.localization.ex_error}: ${settings.localization.check_console}`)
          return cb(null, 'Invalid history block height. Showing latest blockchain state.', null);

        lib.get_block(blockhash, function(block) {
          if (!block || block == `${settings.localization.ex_error}: ${settings.localization.check_console}` || block.time == null)
            return cb(null, 'Invalid history block height. Showing latest blockchain state.', null);

          return cb(requested_history_block, null, format_utc_timestamp(block.time));
        });
      });
    });
  }

  // check if trying to load a special address
  if (hash != null && hash.toLowerCase() != 'coinbase' && ((hash.toLowerCase() == 'hidden_address' && settings.address_page.enable_hidden_address_view == true) || (hash.toLowerCase() == 'unknown_address' && settings.address_page.enable_unknown_address_view == true) || (hash.toLowerCase() != 'hidden_address' && hash.toLowerCase() != 'unknown_address'))) {
    // lookup address in local collection
    db.get_address(hash, false, function(address) {
      if (address) {
        get_history_data(function(history_block, history_error, history_timestamp_text) {
          address.history_timestamp_text = history_timestamp_text;

          function finalize_address_render(claim_name, historical_summary) {
            send_address_data(res, address, claim_name, history_block, history_error, historical_summary);
          }

          function resolve_claim_name(cb) {
            if (settings.claim_address_page.enabled == true) {
              // lookup claim_name for this address if exists
              db.get_claim_name(hash, function(claim_name) {
                return cb(claim_name);
              });
            } else
              return cb(null);
          }

          if (history_block != null && history_error == null) {
            db.get_address_summary_at_block(hash, history_block, function(historical_summary) {
              resolve_claim_name(function(claim_name) {
                finalize_address_render(claim_name, historical_summary);
              });
            });
          } else {
            resolve_claim_name(function(claim_name) {
              finalize_address_render(claim_name, null);
            });
          }
        });
      } else
        route_get_txlist(res, hash + ' not found');
    });
  } else
    route_get_txlist(res, hash + ' not found');
}

function route_get_claim_form(res, hash) {
  // check if claiming addresses is enabled
  if (settings.claim_address_page.enabled == true) {
    // check if a hash was passed in
    if (hash == null || hash == '') {
      // no hash so just load the claim page without an address
      send_claimaddress_data(res, hash, '');
    } else {
      // lookup hash in the address collection
      db.get_claim_name(hash, function(claim_name) {
        // load the claim page regardless of whether the address exists or not
        send_claimaddress_data(res, hash, (claim_name == null ? '' : claim_name));
      });
    }
  } else
    route_get_address(res, hash);
}

router.get('/', function(req, res) {
  route_get_txlist(res, null);
});

router.get('/dashboard', function(req, res) {
  // Check if dashboard is enabled
  if (!settings.blockchain_dashboard || !settings.blockchain_dashboard.enabled) {
    return res.render(
      'error',
      {
        active: 'dashboard',
        message: 'Dashboard page is disabled',
        showSync: db.check_show_sync_message(),
        customHash: get_custom_hash(),
        styleHash: get_style_hash(),
        themeHash: get_theme_hash(),
        page_title_prefix: settings.coin.name + ' Dashboard'
      }
    );
  }

  // Try to get Phase 2 data (with time-series), fallback to Phase 1
  const dashboardAggregation = require('../lib/dashboard_aggregation');
  
  // Parse time range from query parameter
  let days = req.query.days || 30;
  if (days !== 'all') {
    days = parseInt(days);
    if (isNaN(days) || days <= 0) {
      days = 30;
    }
  }
  
  dashboardAggregation.getDashboardData(days, function(dashboardData) {
    // get the last updated date
    get_last_updated_date(settings.blockchain_dashboard.page_header.show_last_updated, 'blockchain_last_updated', function(last_updated) {
      if (dashboardData) {
        res.render(
          'dashboard',
          {
            active: 'dashboard',
            data: dashboardData.current,
            rolling: dashboardData.rolling,
            daily: dashboardData.daily,
            hasTimeSeries: true,
            timeRange: days,
            dashboardSettings: settings.blockchain_dashboard,
            last_updated: last_updated,
            showSync: db.check_show_sync_message(),
            customHash: get_custom_hash(),
            styleHash: get_style_hash(),
            themeHash: get_theme_hash(),
            page_title_prefix: settings.coin.name + ' Dashboard'
          }
        );
      } else {
        // Fallback to Phase 1 simple data
        db.get_dashboard_current_data(function(simpleData) {
          if (simpleData) {
            res.render(
              'dashboard',
              {
                active: 'dashboard',
                data: simpleData,
                rolling: null,
                daily: null,
                hasTimeSeries: false,
                dashboardSettings: settings.blockchain_dashboard,
                last_updated: last_updated,
                showSync: db.check_show_sync_message(),
                customHash: get_custom_hash(),
                styleHash: get_style_hash(),
                themeHash: get_theme_hash(),
                page_title_prefix: settings.coin.name + ' Dashboard'
              }
            );
          } else {
            // Handle error case
            res.render(
              'error',
            {
              active: 'dashboard',
              message: 'Unable to load dashboard data',
              showSync: db.check_show_sync_message(),
              customHash: get_custom_hash(),
              styleHash: get_style_hash(),
              themeHash: get_theme_hash(),
              page_title_prefix: settings.coin.name + ' Dashboard Error'
            }
          );
        }
      });
    }
    });
  });
});

router.get('/history-browser', function(req, res) {
  const history_enabled = (req.query.history_enabled != null && req.query.history_enabled.toString() == '1');
  const requested_history = (history_enabled && req.query.history != null && /^\d+$/.test(req.query.history.toString().trim()) ? Number(req.query.history) : null);
  let history_error = null;

  if (history_enabled && requested_history == null)
    history_error = 'Invalid history block height. Showing latest blockchain state.';

  db.get_history_browser_overview(requested_history, function(overview) {
    if (!overview) {
      return res.render(
        'error',
        {
          active: 'history-browser',
          message: 'Unable to load history browser data',
          showSync: db.check_show_sync_message(),
          customHash: get_custom_hash(),
          styleHash: get_style_hash(),
          themeHash: get_theme_hash(),
          page_title_prefix: settings.coin.name + ' History Browser'
        }
      );
    }

    if (history_enabled && requested_history != null && overview.is_historical != true)
      history_error = 'Invalid history block height. Showing latest blockchain state.';

    const effective_history_block = (history_enabled && overview.is_historical == true ? overview.effective_height : null);
    const history_input_value = (history_enabled && requested_history != null ? requested_history : overview.current_height);
    const history_timestamp_text = (effective_history_block != null ? format_utc_timestamp(overview.latestBlockTime) : format_utc_timestamp(overview.lastUpdated));
    const history_block_label = (effective_history_block != null ? ('#' + effective_history_block + (history_timestamp_text == null ? '' : ' (' + history_timestamp_text + ')')) : null);
    const page_title_suffix = (history_block_label != null ? (' - History up to Block ' + history_block_label) : '');

    res.render(
      'history_browser',
      {
        active: 'history-browser',
        data: overview,
        history_enabled: history_enabled,
        history_block: effective_history_block,
        history_block_label: history_block_label,
        history_input_value: history_input_value,
        history_timestamp_text: history_timestamp_text,
        history_error: history_error,
        last_updated: overview.lastUpdated,
        showSync: db.check_show_sync_message(),
        customHash: get_custom_hash(),
        styleHash: get_style_hash(),
        themeHash: get_theme_hash(),
        page_title_prefix: settings.coin.name + ' History Browser' + page_title_suffix
      }
    );
  });
});

router.get('/info', function(req, res) {
  let pluginApisExt = [];

  // ensure api page is enabled
  if (settings.api_page.enabled == true) {
    // loop through all plugins defined in the settings
    settings.plugins.allowed_plugins.forEach(function (plugin) {
      // check if this plugin is enabled
      if (plugin.enabled) {
        // check if this plugin has a public_apis section
        if (plugin.public_apis != null) {
          // check if there is an ext section
          if (plugin.public_apis.ext != null) {
            // loop through all ext apis for this plugin
            Object.keys(plugin.public_apis.ext).forEach(function(key, index, map) {
              // check if this api is enabled
              if (plugin.public_apis.ext[key].enabled == true) {
                // add this api into the list of ext apis for plugins
                pluginApisExt.push(plugin.public_apis.ext[key]);
              }
            });
          }
        }
      }
    });

    // load the api page
    res.render(
      'info',
      {
        active: 'info',
        address: req.headers.host,
        showSync: db.check_show_sync_message(),
        customHash: get_custom_hash(),
        styleHash: get_style_hash(),
        themeHash: get_theme_hash(),
        page_title_prefix: settings.coin.name + ' Public API',
        pluginApisExt: pluginApisExt
      }
    );
  } else {
    // api page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/markets/history/:market/:coin_symbol/:pair_symbol', function(req, res) {
  if (settings.markets_page.enabled != true)
    return res.status(404).json({ error: 'markets_disabled' });

  const marketId = req.params.market;
  const coinSymbol = req.params.coin_symbol;
  const pairSymbol = req.params.pair_symbol;
  const pairKey = coinSymbol.toLowerCase() + '/' + pairSymbol.toLowerCase();
  const exchangeSettings = (settings.markets_page.exchanges != null ? settings.markets_page.exchanges[marketId] : null);

  if (exchangeSettings == null || exchangeSettings.enabled != true || exchangeSettings.trading_pairs.findIndex((p) => p.toLowerCase() == pairKey) < 0)
    return res.status(404).json({ error: 'market_pair_not_found' });

  get_market_history_payload(marketId, coinSymbol, pairSymbol, req.query.range, req.query.source, req.query.max_points)
    .then((payload) => {
      res.json(payload);
    })
    .catch(() => {
      res.status(500).json({ error: 'history_fetch_failed' });
    });
});

router.get('/markets/:market/:coin_symbol/:pair_symbol', function(req, res) {
  // ensure markets page is enabled
  if (settings.markets_page.enabled == true) {
    var market_id = req.params['market'];
    var coin_symbol = req.params['coin_symbol'];
    var pair_symbol = req.params['pair_symbol'];

    // check if the market and trading pair exists and market is enabled in settings.json
    if (settings.markets_page.exchanges[market_id] != null && settings.markets_page.exchanges[market_id].enabled == true && settings.markets_page.exchanges[market_id].trading_pairs.findIndex(p => p.toLowerCase() == coin_symbol.toLowerCase() + '/' + pair_symbol.toLowerCase()) > -1) {
      // lookup market data
      db.get_market(market_id, coin_symbol, pair_symbol, function(data) {
        // load market data
        var market_data = require('../lib/markets/' + market_id);
        var isAlt = false;
        var url = '';

        // build the external exchange url link and determine if using the alt name + logo
        if (market_data.market_url_template != null && market_data.market_url_template != '') {
          switch ((market_data.market_url_case == null || market_data.market_url_case == '' ? 'l' : market_data.market_url_case.toLowerCase())) {
            case 'l':
            case 'lower':
              url = market_data.market_url_template.replace('{base}', pair_symbol.toLowerCase()).replace('{coin}', coin_symbol.toLowerCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toLowerCase(), exchange: pair_symbol.toLowerCase()}) : ''));
              isAlt = (market_data.isAlt != null ? market_data.isAlt({coin: coin_symbol.toLowerCase(), exchange: pair_symbol.toLowerCase()}) : false);
              break;
            case 'u':
            case 'upper':
              url = market_data.market_url_template.replace('{base}', pair_symbol.toUpperCase()).replace('{coin}', coin_symbol.toUpperCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toUpperCase(), exchange: pair_symbol.toUpperCase()}) : ''));
              isAlt = (market_data.isAlt != null ? market_data.isAlt({coin: coin_symbol.toUpperCase(), exchange: pair_symbol.toUpperCase()}) : false);
              break;
            default:
          }
        }

        var market_name = (isAlt ? (market_data.market_name_alt == null ? '' : market_data.market_name_alt) : (market_data.market_name == null ? '' : market_data.market_name));
        var market_logo = (isAlt ? (market_data.market_logo_alt == null ? '' : market_data.market_logo_alt) : (market_data.market_logo == null ? '' : market_data.market_logo));
        var marketdata = {
          market_name: market_name,
          market_logo: market_logo,
          coin: coin_symbol,
          exchange: pair_symbol,
          data: data,
          url: url
        };

        function buildDepthLevels(orderRows) {
          const rows = (Array.isArray(orderRows) ? orderRows : []);
          const levels = [];

          rows.forEach((row) => {
            const price = Number(row.price);
            const quantity = Number(row.quantity);
            const totalQuote = (row.total != null ? Number(row.total) : (price * quantity));

            if (price > 0 && quantity > 0 && totalQuote > 0 && !isNaN(price) && !isNaN(quantity) && !isNaN(totalQuote)) {
              levels.push({
                price: price,
                quantity: quantity,
                total_quote: totalQuote
              });
            }
          });

          return levels;
        }

        const baseSymbol = coin_symbol.toUpperCase();
        const quoteSymbol = pair_symbol.toUpperCase();
        const summaryLastPrice = Number((data && data.summary ? data.summary.last : 0) || 0);

        const depthChart = {
          base_symbol: baseSymbol,
          quote_symbol: quoteSymbol,
          center_price: (summaryLastPrice > 0 ? summaryLastPrice : null),
          default_span_pct: 25,
          span_options_pct: [1, 2.5, 5, 10, 25, 50],
          bids: buildDepthLevels((data && data.buys ? data.buys : [])),
          asks: buildDepthLevels((data && data.sells ? data.sells : []))
        };

        const HistoricalLiquidity = historicalCollectors.models.HistoricalLiquidity;
        const nowTimestamp = Math.floor(Date.now() / 1000);

        const pairFilter = {
          market: market_id,
          coin_symbol: coin_symbol.toUpperCase(),
          pair_symbol: pair_symbol.toUpperCase()
        };

        const shouldFixPrevFromHistory = (market_id.toLowerCase() === 'nestex' && marketdata.data != null && marketdata.data.summary != null && !(Number(marketdata.data.summary.prev || 0) > 0));

        Promise.all([
          HistoricalLiquidity.findOne({
            market: market_id,
            coin_symbol: coin_symbol.toUpperCase(),
            pair_symbol: pair_symbol.toUpperCase(),
            provider: { $ne: 'exchange' }
          }).sort({ timestamp: -1 }).lean(),
          check_market_history_exists(pairFilter),
          (shouldFixPrevFromHistory ? fetch_history_point_before_timestamp(pairFilter, (nowTimestamp - 86400)) : Promise.resolve(null))
        ]).then(([poolRow, hasHistory, prevHistoryPoint]) => {
          if (market_id.toLowerCase() === 'nestex' && marketdata.data != null && marketdata.data.summary != null) {
            const summary = marketdata.data.summary;
            const currentLast = Number(summary.last || 0);
            const currentPrev = Number(summary.prev || 0);

            if (!(currentPrev > 0) && prevHistoryPoint != null && Number(prevHistoryPoint.last) > 0)
              summary.prev = Number(prevHistoryPoint.last);

            if (currentLast > 0 && Number(summary.prev || 0) > 0)
              summary.change = ((currentLast - Number(summary.prev)) / Number(summary.prev)) * 100;
          }

          let poolLiquidity = null;

          if (poolRow != null) {
            const raw = (poolRow.raw || {});
            const quoteKey = `pooled${quoteSymbol.charAt(0)}${quoteSymbol.slice(1).toLowerCase()}`;
            const pooledBase = Number((raw.pooledCoin != null ? raw.pooledCoin : poolRow.liquidity_base));
            const pooledQuote = Number((raw[quoteKey] != null ? raw[quoteKey] : (raw.pooledQuote != null ? raw.pooledQuote : (raw.pooledUsdt != null ? raw.pooledUsdt : poolRow.liquidity_quote))));
            const totalQuote = Number((raw.total != null ? raw.total : pooledQuote));

            poolLiquidity = {
              provider: poolRow.provider,
              score: (raw.score != null ? Number(raw.score) : null),
              pooled_base: (isNaN(pooledBase) ? 0 : pooledBase),
              pooled_quote: (isNaN(pooledQuote) ? 0 : pooledQuote),
              total_quote: (isNaN(totalQuote) ? 0 : totalQuote),
              growth: (raw.growth != null ? raw.growth : null),
              base_symbol: coin_symbol.toUpperCase(),
              quote_symbol: quoteSymbol,
              raw: raw
            };
          }

          marketdata.depth_chart = depthChart;
          marketdata.price_history_30d = { has_data: hasHistory };
          marketdata.price_history_api_url = '/markets/history/' + encodeURIComponent(market_id) + '/' + encodeURIComponent(coin_symbol.toUpperCase()) + '/' + encodeURIComponent(pair_symbol.toUpperCase());
          marketdata.pool_liquidity = poolLiquidity;

          // lookup the last updated date if necessary
          get_last_updated_date(settings.markets_page.page_header.show_last_updated, 'markets_last_updated', function(last_updated_date) {
            res.render(
              './market',
              {
                active: 'markets',
                marketdata: marketdata,
                market: market_id,
                last_updated: last_updated_date,
                showSync: db.check_show_sync_message(),
                customHash: get_custom_hash(),
                styleHash: get_style_hash(),
                themeHash: get_theme_hash(),
                page_title_prefix: settings.localization.mkt_title.replace('{1}', marketdata.market_name + ' (' + marketdata.coin + '/' + marketdata.exchange + ')')
              }
            );
          });
        }).catch(() => {
          marketdata.depth_chart = depthChart;
          marketdata.price_history_30d = { has_data: false };
          marketdata.price_history_api_url = '/markets/history/' + encodeURIComponent(market_id) + '/' + encodeURIComponent(coin_symbol.toUpperCase()) + '/' + encodeURIComponent(pair_symbol.toUpperCase());
          marketdata.pool_liquidity = null;

          // lookup the last updated date if necessary
          get_last_updated_date(settings.markets_page.page_header.show_last_updated, 'markets_last_updated', function(last_updated_date) {
            res.render(
              './market',
              {
                active: 'markets',
                marketdata: marketdata,
                market: market_id,
                last_updated: last_updated_date,
                showSync: db.check_show_sync_message(),
                customHash: get_custom_hash(),
                styleHash: get_style_hash(),
                themeHash: get_theme_hash(),
                page_title_prefix: settings.localization.mkt_title.replace('{1}', marketdata.market_name + ' (' + marketdata.coin + '/' + marketdata.exchange + ')')
              }
            );
          });
        });
      });
    } else {
      // selected market does not exist or is not enabled so default to the tx list page
      route_get_txlist(res, null);
    }
  } else {
    // markets page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/richlist', function(req, res) {
  // ensure richlist page is enabled
  if (settings.richlist_page.enabled == true) {
    db.get_stats(settings.coin.name, function (stats) {
      db.get_richlist(settings.coin.name, function(richlist) {
        if (richlist) {
          db.get_distribution(richlist, stats, function(distribution) {
            res.render(
              'richlist',
              {
                active: 'richlist',
                balance: richlist.balance,
                received: richlist.received,
                burned: richlist.burned,
                stats: stats,
                dista: distribution.t_1_25,
                distb: distribution.t_26_50,
                distc: distribution.t_51_75,
                distd: distribution.t_76_100,
                diste: distribution.t_101plus,
                last_updated: (settings.richlist_page.page_header.show_last_updated == true ? stats.richlist_last_updated : null),
                showSync: db.check_show_sync_message(),
                customHash: get_custom_hash(),
                styleHash: get_style_hash(),
                themeHash: get_theme_hash(),
                page_title_prefix: 'Top ' + settings.coin.name + ' Coin Holders'
              }
            );
          });
        } else {
          // richlist data not found so default to the tx list page
          route_get_txlist(res, null);
        }
      });
    });
  } else {
    // richlist page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/movement', function(req, res) {
  // ensure movement page is enabled
  if (settings.movement_page.enabled == true) {
    // lookup the last updated date if necessary
    get_last_updated_date(settings.movement_page.page_header.show_last_updated, 'blockchain_last_updated', function(last_updated_date) {
      res.render(
        'movement',
        {
          active: 'movement',
          last_updated: last_updated_date,
          showSync: db.check_show_sync_message(),
          customHash: get_custom_hash(),
          styleHash: get_style_hash(),
          themeHash: get_theme_hash(),
          page_title_prefix: settings.coin.name + ' ' + 'Coin Movements'
        }
      );
    });
  } else {
    // movement page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/network', function(req, res) {
  // ensure network page is enabled
  if (
    settings.network_page.enabled == true &&
    (
      settings.network_page.connections_table.enabled == true ||
      settings.network_page.addnodes_table.enabled == true ||
      settings.network_page.onetry_table.enabled == true
    )
  ) {
    // lookup the last updated date if necessary
    get_last_updated_date(settings.network_page.page_header.show_last_updated, 'network_last_updated', function(last_updated_date) {
      res.render(
        'network',
        {
          active: 'network',
          last_updated: last_updated_date,
          showSync: db.check_show_sync_message(),
          customHash: get_custom_hash(),
          styleHash: get_style_hash(),
          themeHash: get_theme_hash(),
          page_title_prefix: settings.coin.name + ' ' + 'Network Peers'
        }
      );
    });
  } else {
    // network page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

// masternode list page
router.get('/masternodes', function(req, res) {
  // ensure masternode page is enabled
  if (settings.masternodes_page.enabled == true) {
    // lookup the last updated date if necessary
    get_last_updated_date(settings.masternodes_page.page_header.show_last_updated, 'masternodes_last_updated', function(last_updated_date) {
      res.render(
        'masternodes',
        {
          active: 'masternodes',
          last_updated: last_updated_date,
          showSync: db.check_show_sync_message(),
          customHash: get_custom_hash(),
          styleHash: get_style_hash(),
          themeHash: get_theme_hash(),
          page_title_prefix: settings.coin.name + ' ' + 'Masternodes'
        }
      );
    });
  } else {
    // masternode page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/reward', function(req, res) {
  // ensure reward page is enabled
  if (settings.blockchain_specific.heavycoin.enabled == true && settings.blockchain_specific.heavycoin.reward_page.enabled == true) {
    db.get_stats(settings.coin.name, function (stats) {
      db.get_heavy(settings.coin.name, function (heavy) {
        if (!heavy)
          heavy = { coin: settings.coin.name, lvote: 0, reward: 0, supply: 0, cap: 0, estnext: 0, phase: 'N/A', maxvote: 0, nextin: 'N/A', votes: [] };

        var votes = heavy.votes;

        votes.sort(function (a, b) {
          if (a.count < b.count)
            return -1;
          else if (a.count > b.count)
            return 1;
          else
            return 0;
        });

        res.render(
          'reward',
          {
            active: 'reward',
            stats: stats,
            heavy: heavy,
            votes: votes,
            last_updated: (settings.blockchain_specific.heavycoin.reward_page.page_header.show_last_updated == true ? stats.reward_last_updated : null),
            showSync: db.check_show_sync_message(),
            customHash: get_custom_hash(),
            styleHash: get_style_hash(),
            themeHash: get_theme_hash(),
            page_title_prefix: settings.coin.name + ' Reward/Voting Details'
          }
        );
      });
    });
  } else {
    // reward page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.get('/tx/:txid', function(req, res) {
  route_get_tx(res, req.params.txid);
});

router.get('/block/:hash', function(req, res) {
  route_get_block(res, req.params.hash);
});

router.get('/claim', function(req, res) {
  route_get_claim_form(res, '');
});

router.get('/claim/:hash', function(req, res) {
  route_get_claim_form(res, req.params.hash);
});

router.get('/address/:hash', function(req, res) {
  route_get_address(res, req.params.hash, req.query.history);
});

router.get('/orphans', function(req, res) {
  // ensure orphans page is enabled
  if (settings.orphans_page.enabled == true) {
    // lookup the last updated date if necessary
    get_last_updated_date(settings.orphans_page.page_header.show_last_updated, 'blockchain_last_updated', function(last_updated_date) {
      res.render(
        'orphans',
        {
          active: 'orphans',
          last_updated: last_updated_date,
          showSync: db.check_show_sync_message(),
          customHash: get_custom_hash(),
          styleHash: get_style_hash(),
          themeHash: get_theme_hash(),
          page_title_prefix: settings.localization.orphan_title.replace('{1}', settings.coin.name)
        }
      );
    });
  } else {
    // orphans page is not enabled so default to the tx list page
    route_get_txlist(res, null);
  }
});

router.post('/search', function(req, res) {
  if (settings.shared_pages.page_header.search.enabled == true) {
    var query = req.body.search.trim();

    if (query.length == 64) {
      if (query == settings.transaction_page.genesis_tx)
        res.redirect('/block/' + settings.block_page.genesis_block);
      else {
        db.get_tx(query, function(tx) {
          if (tx)
            res.redirect('/tx/' + tx.txid);
          else {
            lib.get_block(query, function(block) {
              if (block && block != `${settings.localization.ex_error}: ${settings.localization.check_console}`)
                res.redirect('/block/' + query);
              else {
                // check wallet for transaction
                lib.get_rawtransaction(query, function(tx) {
                  if (tx && tx.txid)
                    res.redirect('/tx/' + tx.txid);
                  else {
                    // search found nothing so display the tx list page with an error msg
                    route_get_txlist(res, settings.localization.ex_search_error + query );
                  }
                });
              }
            });
          }
        });
      }
    } else {
      db.get_address(query, false, function(address) {
        if (address)
          res.redirect('/address/' + address.a_id);
        else {
          lib.get_blockhash(query, function(hash) {
            if (hash && hash != `${settings.localization.ex_error}: ${settings.localization.check_console}`)
              res.redirect('/block/' + hash);
            else
              route_get_txlist(res, settings.localization.ex_search_error + query);
          });
        }
      });
    }
  } else {
    // Search is disabled so load the tx list page with an error msg
    route_get_txlist(res, 'Search is disabled');
  }
});

router.get('/qr/:string', function(req, res) {
  if (req.params.string) {
    const qr = require('qr-image');

    var address = qr.image(req.params.string, {
      type: 'png',
      size: 4,
      margin: 1,
      ec_level: 'M'
    });

    res.type('png');
    address.pipe(res);
  }
});

module.exports = router;