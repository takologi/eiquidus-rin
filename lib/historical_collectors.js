const Markets = require('../models/markets');
const NetworkHistory = require('../models/networkhistory');
const Orphans = require('../models/orphans');
const HistoricalMarketSnapshot = require('../models/historical_market_snapshot');
const HistoricalOrderbookDepth = require('../models/historical_orderbook_depth');
const HistoricalTrade = require('../models/historical_trade');
const HistoricalLiquidity = require('../models/historical_liquidity');
const HistoricalRentalSnapshot = require('../models/historical_rental_snapshot');
const HistoricalNetworkSecurity = require('../models/historical_network_security');
const HistoricalConfirmationPolicy = require('../models/historical_confirmation_policy');
const CollectorHealth = require('../models/collector_health');
const settings = require('./settings');

function getSettings() {
  return (settings.historical_collectors || {});
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function floorBucket(timestamp, bucketSeconds) {
  const ts = Number(timestamp || nowTs());
  const size = (Number(bucketSeconds) > 0 ? Number(bucketSeconds) : 300);
  return Math.floor(ts / size) * size;
}

function safeNum(val, fallback = 0) {
  const n = Number(val);
  return (isNaN(n) ? fallback : n);
}

function upsert_market_5m_sample(market, coin, pair, bucketTimestamp, currentTimestamp, summary, topBid, topAsk, last) {
  const db = (HistoricalMarketSnapshot != null && HistoricalMarketSnapshot.db != null ? HistoricalMarketSnapshot.db : null);

  if (db == null)
    return Promise.resolve();

  const high = safeNum(summary.high, 0);
  const low = safeNum(summary.low, 0);
  const volumeBase = safeNum(summary.volume, 0);
  const volumeQuote = safeNum(summary.volume_btc, 0);

  return db.collection('historical_market_5m').updateOne({
    market: market,
    coin_symbol: coin,
    pair_symbol: pair,
    timestamp: bucketTimestamp
  }, {
    $set: {
      market: market,
      coin_symbol: coin,
      pair_symbol: pair,
      provider: 'market_history_sampler',
      granularity: '5m',
      resolution: '5',
      timestamp: bucketTimestamp,
      bucket_timestamp: bucketTimestamp,
      open: last,
      high: (high > 0 ? Math.max(high, last) : last),
      low: (low > 0 ? Math.min(low, last) : last),
      close: last,
      last: last,
      volume_base: volumeBase,
      volume_quote: volumeQuote,
      bid: safeNum(summary.bid, topBid),
      ask: safeNum(summary.ask, topAsk),
      bid_ask_proxy_from_ohlc: false,
      source: {
        mode: 'market-history',
        sampled_from: 'markets.summary'
      },
      collected_at: currentTimestamp
    }
  }, { upsert: true });
}

function parseOptionalNonNegativeInt(val) {
  if (val == null || val === '')
    return null;

  const n = Number.parseInt(val, 10);

  if (isNaN(n) || n < 0)
    return null;

  return n;
}

function record_health(collector, component, status, message, meta, cb) {
  CollectorHealth.create({
    collector: collector,
    component: component,
    status: status,
    message: (message || ''),
    meta: (meta || {}),
    timestamp: nowTs()
  }).then(() => cb(true)).catch(() => cb(false));
}

function prune_by_timestamp(model, timestampField, retentionDays, cb) {
  const days = Number(retentionDays || 0);

  if (!(days > 0))
    return cb();

  const cutoff = nowTs() - (days * 86400);

  model.deleteMany({ [timestampField]: { $lt: cutoff } }).then(() => cb()).catch(() => cb());
}

function normalizeTrades(market, coin, pair, tradeRows, maxPerRun) {
  const trades = Array.isArray(tradeRows) ? tradeRows : [];
  const limit = (Number(maxPerRun) > 0 ? Number(maxPerRun) : 500);

  return trades.slice(0, limit).map((row, idx) => {
    const tradeId = (row.trade_id != null ? row.trade_id : (row.id != null ? row.id : `${row.timestamp || nowTs()}-${idx}`));
    const side = ((row.ordertype != null ? row.ordertype : (row.type != null ? row.type : '')) || '').toString().toLowerCase();
    const price = safeNum(row.price, 0);
    const quantity = safeNum((row.quantity != null ? row.quantity : row.base_volume), 0);
    const total = safeNum((row.total != null ? row.total : row.quote_volume), (price * quantity));
    const ts = safeNum(row.timestamp, nowTs());

    return {
      updateOne: {
        filter: {
          market: market,
          coin_symbol: coin,
          pair_symbol: pair,
          trade_id: tradeId.toString()
        },
        update: {
          $set: {
            market: market,
            coin_symbol: coin,
            pair_symbol: pair,
            trade_id: tradeId.toString(),
            side: side,
            price: price,
            quantity: quantity,
            total: total,
            timestamp: ts,
            collected_at: nowTs()
          }
        },
        upsert: true
      }
    };
  });
}

function calculateLiquidity(rows, maxLevels) {
  const levels = Array.isArray(rows) ? rows.slice(0, maxLevels) : [];
  let totalQuote = 0;

  levels.forEach((lvl) => {
    totalQuote += (safeNum(lvl.price, 0) * safeNum(lvl.quantity, 0));
  });

  return {
    rows: levels,
    totalQuote: totalQuote
  };
}

function fetchNestexLiquidity(coinSymbol, cb) {
  const request = require('postman-request');
  const symbol = (coinSymbol || '').toString().trim().toUpperCase();

  if (symbol === '')
    return cb(new Error('Missing coin symbol for NestEx liquidity request'), null);

  request({
    uri: `https://api.nestex.one/v1/liquidity/${encodeURIComponent(symbol)}`,
    json: true,
    timeout: 10000,
    headers: {
      'User-Agent': 'eiquidus-historical-collector/1.0'
    }
  }, function(error, response, body) {
    if (error)
      return cb(error, null);

    if (response == null || response.statusCode == null || response.statusCode < 200 || response.statusCode >= 300)
      return cb(new Error(`NestEx liquidity api returned status ${(response && response.statusCode != null ? response.statusCode : 'unknown')}`), null);

    if (body == null || typeof body !== 'object' || body.success !== true || body.data == null)
      return cb(new Error('NestEx liquidity api returned invalid payload'), null);

    return cb(null, body.data);
  });
}

function upsertNestexApiLiquidity(market, coin, pair, bucketTimestamp, currentTimestamp, cb) {
  if ((market || '').toLowerCase() !== 'nestex')
    return cb(null, null);

  fetchNestexLiquidity(coin, function(err, data) {
    if (err)
      return cb(err, null);

    const pooledCoin = safeNum(data.pooledCoin, 0);
    const pooledUsdt = safeNum(data.pooledUsdt, 0);
    const total = safeNum(data.total, pooledUsdt);

    HistoricalLiquidity.updateOne({
      provider: 'nestex_api',
      market: market,
      coin_symbol: coin,
      pair_symbol: pair,
      bucket_timestamp: bucketTimestamp
    }, {
      $set: {
        provider: 'nestex_api',
        market: market,
        coin_symbol: coin,
        pair_symbol: pair,
        bucket_timestamp: bucketTimestamp,
        timestamp: currentTimestamp,
        liquidity_base: pooledCoin,
        liquidity_quote: pooledUsdt,
        depth: 0,
        raw: {
          source: 'https://api.nestex.one/v1/liquidity/{symbol}',
          score: safeNum(data.score, 0),
          total: total,
          pooledCoin: pooledCoin,
          pooledUsdt: pooledUsdt,
          growth: safeNum(data.growth, 0),
          dump: (data.dump == null ? null : data.dump),
          leaderboard: (Array.isArray(data.leaderboard) ? data.leaderboard : [])
        }
      }
    }, { upsert: true }).then(() => {
      return cb(null, {
        pooledCoin: pooledCoin,
        pooledUsdt: pooledUsdt,
        score: safeNum(data.score, 0)
      });
    }).catch((dbErr) => {
      return cb(dbErr, null);
    });
  });
}

function collect_market_pair_from_document(market, coin, pair, marketDoc, cb) {
  const collectorSettings = getSettings();
  const marketSettings = (collectorSettings.market || {});

  if (collectorSettings.enabled === false || marketSettings.enabled === false)
    return cb(null, 'disabled');

  const currentTimestamp = nowTs();
  const bucketTimestamp = floorBucket(currentTimestamp, marketSettings.bucket_seconds);
  const summary = (marketDoc != null && marketDoc.summary != null ? marketDoc.summary : {});
  const buys = (marketDoc != null && Array.isArray(marketDoc.buys) ? marketDoc.buys : []);
  const sells = (marketDoc != null && Array.isArray(marketDoc.sells) ? marketDoc.sells : []);
  const trades = (marketDoc != null && Array.isArray(marketDoc.history) ? marketDoc.history : []);

  const topBid = (buys.length > 0 ? safeNum(buys[0].price, 0) : safeNum(summary.bid, 0));
  const topAsk = (sells.length > 0 ? safeNum(sells[0].price, 0) : safeNum(summary.ask, 0));
  const spread = (topAsk > 0 && topBid > 0 ? (topAsk - topBid) : 0);
  const mid = (topAsk > 0 && topBid > 0 ? ((topAsk + topBid) / 2) : 0);
  const last = safeNum(summary.last, 0);

  const maxOrderbookLevels = (Number(marketSettings.max_orderbook_levels) > 0 ? Number(marketSettings.max_orderbook_levels) : 25);
  const bidLiq = calculateLiquidity(buys, maxOrderbookLevels);
  const askLiq = calculateLiquidity(sells, maxOrderbookLevels);
  const totalBidBase = bidLiq.rows.reduce((sum, lvl) => sum + safeNum(lvl.quantity, 0), 0);
  const totalAskBase = askLiq.rows.reduce((sum, lvl) => sum + safeNum(lvl.quantity, 0), 0);
  const totalBaseLiquidity = totalBidBase + totalAskBase;
  const totalQuoteLiquidity = bidLiq.totalQuote + askLiq.totalQuote;

  upsert_market_5m_sample(market, coin, pair, bucketTimestamp, currentTimestamp, summary, topBid, topAsk, last).then(() => {
    HistoricalOrderbookDepth.updateOne({
      market: market,
      coin_symbol: coin,
      pair_symbol: pair,
      bucket_timestamp: bucketTimestamp
    }, {
      $set: {
        market: market,
        coin_symbol: coin,
        pair_symbol: pair,
        bucket_timestamp: bucketTimestamp,
        timestamp: currentTimestamp,
        top_bid: topBid,
        top_ask: topAsk,
        spread: spread,
        mid: mid,
        bids: bidLiq.rows,
        asks: askLiq.rows,
        bid_liquidity_quote: bidLiq.totalQuote,
        ask_liquidity_quote: askLiq.totalQuote
      }
    }, { upsert: true }).then(() => {
      HistoricalLiquidity.updateOne({
        provider: 'exchange',
        market: market,
        coin_symbol: coin,
        pair_symbol: pair,
        bucket_timestamp: bucketTimestamp
      }, {
        $set: {
          provider: 'exchange',
          market: market,
          coin_symbol: coin,
          pair_symbol: pair,
          bucket_timestamp: bucketTimestamp,
          timestamp: currentTimestamp,
          liquidity_base: totalBaseLiquidity,
          liquidity_quote: totalQuoteLiquidity,
          depth: maxOrderbookLevels,
          raw: {
            bid_liquidity_quote: bidLiq.totalQuote,
            ask_liquidity_quote: askLiq.totalQuote,
            spread: spread,
            mid: mid,
            top_bid: topBid,
            top_ask: topAsk
          }
        }
      }, { upsert: true }).then(() => {
      upsertNestexApiLiquidity(market, coin, pair, bucketTimestamp, currentTimestamp, function(nestexErr, nestexMeta) {
      const ops = normalizeTrades(market, coin, pair, trades, marketSettings.max_trade_records_per_run);

      const healthMeta = {
        trades_saved_attempt: ops.length,
        liquidity_quote: totalQuoteLiquidity
      };

      if (nestexMeta != null)
        healthMeta.nestex_api = nestexMeta;

      if (nestexErr)
        healthMeta.nestex_api_error = nestexErr.message;

      if (ops.length > 0) {
        HistoricalTrade.bulkWrite(ops, { ordered: false }).then(() => {
          prune_by_timestamp(HistoricalMarketSnapshot, 'timestamp', marketSettings.retention_days, function() {
            prune_by_timestamp(HistoricalOrderbookDepth, 'timestamp', marketSettings.retention_days, function() {
              prune_by_timestamp(HistoricalLiquidity, 'timestamp', marketSettings.retention_days, function() {
                prune_by_timestamp(HistoricalTrade, 'timestamp', marketSettings.retention_days, function() {
                  record_health('historical_market', `${market}:${coin}/${pair}`, 'ok', 'Market historical collection succeeded', {
                    trades_saved_attempt: ops.length,
                    liquidity_quote: totalQuoteLiquidity,
                    nestex_api: (nestexMeta || null),
                    nestex_api_error: (nestexErr ? nestexErr.message : null)
                  }, function() {
                    return cb(null, 'ok');
                  });
                });
              });
            });
          });
        }).catch((err) => {
          record_health('historical_market', `${market}:${coin}/${pair}`, 'error', err.message, {}, function() {
            return cb(err, null);
          });
        });
      } else {
        prune_by_timestamp(HistoricalMarketSnapshot, 'timestamp', marketSettings.retention_days, function() {
          prune_by_timestamp(HistoricalOrderbookDepth, 'timestamp', marketSettings.retention_days, function() {
            prune_by_timestamp(HistoricalLiquidity, 'timestamp', marketSettings.retention_days, function() {
              record_health('historical_market', `${market}:${coin}/${pair}`, 'ok', 'Market historical snapshot saved (no trades returned)', {
                liquidity_quote: totalQuoteLiquidity,
                nestex_api: (nestexMeta || null),
                nestex_api_error: (nestexErr ? nestexErr.message : null)
              }, function() {
                return cb(null, 'ok');
              });
            });
          });
        });
      }
      });
      }).catch((err) => {
        record_health('historical_market', `${market}:${coin}/${pair}`, 'error', err.message, {}, function() {
          return cb(err, null);
        });
      });
    }).catch((err) => {
      record_health('historical_market', `${market}:${coin}/${pair}`, 'error', err.message, {}, function() {
        return cb(err, null);
      });
    });
  }).catch((err) => {
    record_health('historical_market', `${market}:${coin}/${pair}`, 'error', err.message, {}, function() {
      return cb(err, null);
    });
  });
}

function collect_market_pair(market, coin, pair, cb) {
  Markets.findOne({ market: market, coin_symbol: coin, pair_symbol: pair }).lean().then((doc) => {
    if (!doc)
      return cb(new Error('Market pair not found in local DB'), null);

    return collect_market_pair_from_document(market, coin, pair, doc, cb);
  }).catch((err) => {
    return cb(err, null);
  });
}

function collect_all_configured_markets(cb) {
  const collectorSettings = getSettings();
  const marketSettings = (collectorSettings.market || {});

  if (collectorSettings.enabled === false || marketSettings.enabled === false)
    return cb(null, { total: 0, collected: 0, skipped: true });

  const exchanges = (settings.markets_page != null && settings.markets_page.exchanges != null ? settings.markets_page.exchanges : {});
  const jobs = [];

  Object.keys(exchanges).forEach((exchangeName) => {
    const exchange = exchanges[exchangeName];

    if (exchange != null && exchange.enabled === true && Array.isArray(exchange.trading_pairs)) {
      exchange.trading_pairs.forEach((pair) => {
        const split = pair.toUpperCase().split('/');

        if (split.length === 2)
          jobs.push({ market: exchangeName, coin: split[0], pair: split[1] });
      });
    }
  });

  if (jobs.length === 0)
    return cb(null, { total: 0, collected: 0 });

  let index = 0;
  let collected = 0;

  function next() {
    if (index >= jobs.length)
      return cb(null, { total: jobs.length, collected: collected });

    const job = jobs[index++];

    collect_market_pair(job.market, job.coin, job.pair, function(err) {
      if (!err)
        collected++;

      return next();
    });
  }

  next();
}

function collect_network_security(blockindex, cb) {
  const collectorSettings = getSettings();
  const networkSettings = (collectorSettings.network_security || {});

  if (collectorSettings.enabled === false || networkSettings.enabled === false)
    return cb(null, 'disabled');

  const height = Number(blockindex);

  if (!(height >= 0))
    return cb(new Error('Invalid block height'), null);

  NetworkHistory.findOne({ blockindex: height }).lean().then((networkRow) => {
    if (!networkRow)
      return cb(new Error('No networkhistory row found for block height'), null);

    Orphans.aggregate([
      { $match: { blockindex: height } },
      {
        $group: {
          _id: '$blockindex',
          orphan_events: { $sum: 1 },
          max_reorg_depth: { $max: '$reorg_depth' }
        }
      }
    ]).then((orphanAgg) => {
      const orphanEvents = (orphanAgg && orphanAgg.length > 0 ? safeNum(orphanAgg[0].orphan_events, 0) : 0);
      const maxReorgDepth = (orphanAgg && orphanAgg.length > 0 ? safeNum(orphanAgg[0].max_reorg_depth, 0) : 0);

      HistoricalNetworkSecurity.updateOne({
        blockindex: height
      }, {
        $set: {
          blockindex: height,
          timestamp: safeNum(networkRow.timestamp, nowTs()),
          nethash: safeNum(networkRow.nethash, 0),
          difficulty_pow: safeNum(networkRow.difficulty_pow, 0),
          difficulty_pos: safeNum(networkRow.difficulty_pos, 0),
          orphan_events: orphanEvents,
          max_reorg_depth: maxReorgDepth,
          confirmations_policy: safeNum(settings.shared_pages.confirmations, 0)
        }
      }, { upsert: true }).then(() => {
        prune_by_timestamp(HistoricalNetworkSecurity, 'timestamp', networkSettings.retention_days, function() {
          record_health('historical_network', 'network_security', 'ok', 'Network security snapshot saved', {
            blockindex: height,
            orphan_events: orphanEvents,
            max_reorg_depth: maxReorgDepth
          }, function() {
            return cb(null, 'ok');
          });
        });
      }).catch((err) => {
        record_health('historical_network', 'network_security', 'error', err.message, { blockindex: height }, function() {
          return cb(err, null);
        });
      });
    }).catch((err) => {
      return cb(err, null);
    });
  }).catch((err) => {
    return cb(err, null);
  });
}

function collect_confirmation_policy(cb) {
  const collectorSettings = getSettings();
  const policySettings = (collectorSettings.confirmation_policy || {});

  if (collectorSettings.enabled === false || policySettings.enabled === false)
    return cb(null, 'disabled');

  const ts = nowTs();
  const bucket = floorBucket(ts, policySettings.bucket_seconds);

  HistoricalConfirmationPolicy.updateOne({
    bucket_timestamp: bucket
  }, {
    $set: {
      bucket_timestamp: bucket,
      timestamp: ts,
      confirmations: safeNum(settings.shared_pages.confirmations, 0),
      reorg_warning_depth: safeNum((settings.orphans_page || {}).reorg_warning_depth, 0),
      reorg_critical_depth: safeNum((settings.orphans_page || {}).reorg_critical_depth, 0)
    }
  }, {
    upsert: true
  }).then(() => {
    prune_by_timestamp(HistoricalConfirmationPolicy, 'timestamp', policySettings.retention_days, function() {
      return cb(null, 'ok');
    });
  }).catch((err) => {
    return cb(err, null);
  });
}

function recordCoinpaprikaPostponed(cb) {
  const collectorSettings = getSettings();
  const cp = (collectorSettings.coinpaprika || {});

  if (cp.enabled === true)
    return cb();

  record_health(
    'historical_market',
    'coinpaprika',
    'postponed',
    'CoinPaprika historical collection postponed/disabled (external access issue or policy choice)',
    {},
    function() { return cb(); }
  );
}

module.exports = {
  collect_market_pair: collect_market_pair,
  collect_market_pair_from_document: collect_market_pair_from_document,
  collect_all_configured_markets: collect_all_configured_markets,
  collect_network_security: collect_network_security,
  collect_confirmation_policy: collect_confirmation_policy,
  record_health: record_health,
  record_coinpaprika_postponed: recordCoinpaprikaPostponed,

  get_market_snapshots: function(market, coin, pair, start, length, cb) {
    HistoricalMarketSnapshot.find({ market: market, coin_symbol: coin, pair_symbol: pair })
      .sort({ timestamp: -1 })
      .skip(Number(start || 0))
      .limit(Number(length || 100))
      .lean()
      .then((rows) => cb(rows || []))
      .catch(() => cb([]));
  },

  get_trade_history: function(market, coin, pair, start, length, cb) {
    HistoricalTrade.find({ market: market, coin_symbol: coin, pair_symbol: pair })
      .sort({ timestamp: -1 })
      .skip(Number(start || 0))
      .limit(Number(length || 100))
      .lean()
      .then((rows) => cb(rows || []))
      .catch(() => cb([]));
  },

  get_liquidity_history: function(market, coin, pair, startOrOptions, lengthOrCb, maybeCb) {
    let start = 0;
    let length = 100;
    let fromTimestamp = null;
    let toTimestamp = null;
    let provider = null;
    let cb = null;

    if (typeof startOrOptions === 'object' && startOrOptions != null && !Array.isArray(startOrOptions)) {
      start = Number(startOrOptions.start || 0);
      length = Number(startOrOptions.length || 100);
      fromTimestamp = parseOptionalNonNegativeInt(startOrOptions.from_timestamp);
      toTimestamp = parseOptionalNonNegativeInt(startOrOptions.to_timestamp);
      provider = (startOrOptions.provider == null ? null : startOrOptions.provider.toString().trim().toLowerCase());
      cb = lengthOrCb;
    } else {
      start = Number(startOrOptions || 0);
      length = Number(lengthOrCb || 100);
      cb = maybeCb;
    }

    if (isNaN(start) || start < 0)
      start = 0;

    if (isNaN(length) || length < 1)
      length = 100;

    const filter = { provider: 'exchange', market: market, coin_symbol: coin, pair_symbol: pair };

    if (provider === 'all') {
      filter.provider = { $in: ['exchange', 'nestex_api'] };
    } else if (provider != null && provider !== '') {
      filter.provider = provider;
    } else if ((market || '').toLowerCase() === 'nestex') {
      filter.provider = { $in: ['nestex_api', 'exchange'] };
    }

    if (fromTimestamp != null || toTimestamp != null) {
      filter.timestamp = {};

      if (fromTimestamp != null)
        filter.timestamp.$gte = fromTimestamp;

      if (toTimestamp != null)
        filter.timestamp.$lte = toTimestamp;
    }

    HistoricalLiquidity.find(filter)
      .sort({ timestamp: -1 })
      .skip(start)
      .limit(length)
      .lean()
      .then((rows) => cb(rows || []))
      .catch(() => cb([]));
  },

  get_collector_health: function(collector, start, length, cb) {
    const filter = (collector != null && collector !== '' ? { collector: collector } : {});

    CollectorHealth.find(filter)
      .sort({ timestamp: -1 })
      .skip(Number(start || 0))
      .limit(Number(length || 100))
      .lean()
      .then((rows) => cb(rows || []))
      .catch(() => cb([]));
  },

  // expose models for potential reuse
  models: {
    HistoricalMarketSnapshot,
    HistoricalOrderbookDepth,
    HistoricalTrade,
    HistoricalLiquidity,
    HistoricalRentalSnapshot,
    HistoricalNetworkSecurity,
    HistoricalConfirmationPolicy,
    CollectorHealth
  }
};
