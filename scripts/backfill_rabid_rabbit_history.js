#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const request = require('postman-request');
const { MongoClient } = require('mongodb');
const jsonminify = require('jsonminify');

const API_BASE = 'https://rabid-rabbit.org/api/public/v1';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);

  if (idx > -1 && process.argv[idx + 1] != null)
    return process.argv[idx + 1];

  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return (isNaN(n) ? fallback : n);
}

function floor5m(ts) {
  const t = Number(ts || 0);
  return Math.floor(t / 300) * 300;
}

function readSettings() {
  const settingsPath = path.resolve(__dirname, '..', 'settings.json');
  const raw = fs.readFileSync(settingsPath, 'utf8');
  return JSON.parse(jsonminify(raw));
}

function requestJson(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    request({
      uri: url,
      json: true,
      timeout: timeout,
      headers: {
        'User-Agent': 'eiquidus-rabid-rabbit-backfill/1.0'
      }
    }, (error, response, body) => {
      if (error)
        return reject(error);

      const status = (response && response.statusCode != null ? response.statusCode : 0);

      if (status < 200 || status >= 300)
        return reject(new Error(`HTTP ${status} for ${url}`));

      return resolve(body);
    });
  });
}

function normalizeTrades(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    return {
      trade_id: (r.trade_id != null ? r.trade_id.toString() : ''),
      ts: parseInt(r.trade_timestamp, 10) || 0,
      price: toNum(r.price, 0),
      base_volume: toNum(r.base_volume, 0),
      quote_volume: toNum(r.quote_volume, 0),
      side: ((r.type || '').toString().toLowerCase())
    };
  }).filter((r) => r.ts > 0 && r.price > 0).sort((a, b) => a.ts - b.ts);
}

function build5mCandlesFromTrades(trades, fromTs, toTs, fillEmptyBuckets) {
  const byBucket = new Map();

  trades.forEach((t) => {
    if (t.ts < fromTs || t.ts > toTs)
      return;

    const b = floor5m(t.ts);
    const existing = byBucket.get(b);

    if (!existing) {
      byBucket.set(b, {
        timestamp: b,
        open: t.price,
        high: t.price,
        low: t.price,
        close: t.price,
        last: t.price,
        volume_base: t.base_volume,
        volume_quote: t.quote_volume,
        trade_count: 1
      });
    } else {
      existing.high = Math.max(existing.high, t.price);
      existing.low = Math.min(existing.low, t.price);
      existing.close = t.price;
      existing.last = t.price;
      existing.volume_base += t.base_volume;
      existing.volume_quote += t.quote_volume;
      existing.trade_count += 1;
    }
  });

  if (!fillEmptyBuckets)
    return Array.from(byBucket.values()).sort((a, b) => a.timestamp - b.timestamp);

  const result = [];
  const startBucket = floor5m(fromTs);
  const endBucket = floor5m(toTs);
  let prevClose = null;

  for (let ts = startBucket; ts <= endBucket; ts += 300) {
    const row = byBucket.get(ts);

    if (row) {
      result.push(row);
      prevClose = row.close;
    } else if (prevClose != null && prevClose > 0) {
      result.push({
        timestamp: ts,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        last: prevClose,
        volume_base: 0,
        volume_quote: 0,
        trade_count: 0
      });
    }
  }

  return result;
}

function withMetadata(rows, cfg) {
  const fetchedAt = nowTs();

  return rows.map((r) => ({
    market: cfg.market,
    coin_symbol: cfg.coin,
    pair_symbol: cfg.pair,
    provider: 'rabid_rabbit_public',
    granularity: '5m',
    resolution: '5',
    timestamp: r.timestamp,
    bucket_timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    last: r.last,
    volume_base: r.volume_base,
    volume_quote: r.volume_quote,
    bid: null,
    ask: null,
    bid_ask_proxy_from_ohlc: false,
    lp_pooled_coin: null,
    lp_pooled_quote: null,
    lp_score: null,
    lp_growth: null,
    lp_is_replicated_snapshot: false,
    source: {
      api: `${API_BASE}/trades/${cfg.coin}-${cfg.pair}`,
      notes: 'Built from public recent trades endpoint, then bucketed to 5m'
    },
    trade_count: r.trade_count,
    collected_at: fetchedAt
  }));
}

async function ensureIndexes(db, collectionName) {
  const col = db.collection(collectionName);

  await col.createIndex({ market: 1, coin_symbol: 1, pair_symbol: 1, timestamp: 1 }, { unique: true, name: 'pair_timestamp_unique' });
  await col.createIndex({ timestamp: -1 }, { name: 'timestamp_desc' });
  await col.createIndex({ market: 1, coin_symbol: 1, pair_symbol: 1, granularity: 1, timestamp: -1 }, { name: 'pair_granularity_ts_desc' });
}

async function importDocs(db, collectionName, docs) {
  const col = db.collection(collectionName);

  if (!Array.isArray(docs) || docs.length === 0)
    return { upserted: 0 };

  const batchSize = 1000;
  let upserts = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const ops = batch.map((doc) => ({
      updateOne: {
        filter: {
          market: doc.market,
          coin_symbol: doc.coin_symbol,
          pair_symbol: doc.pair_symbol,
          timestamp: doc.timestamp
        },
        update: { $set: doc },
        upsert: true
      }
    }));

    const result = await col.bulkWrite(ops, { ordered: false });
    upserts += (result.upsertedCount || 0);
  }

  return { upserted: upserts };
}

async function run() {
  const market = getArg('--market', 'rabid_rabbit').toLowerCase();
  const coin = getArg('--coin', 'RIN').toUpperCase();
  const pair = getArg('--pair', 'USDT').toUpperCase();
  const pairDash = `${coin}-${pair}`;

  const start5mRaw = getArg('--start-5m-ts', null);
  const end5mRaw = getArg('--end-5m-ts', null);
  const fillEmpty = hasFlag('--no-fill-empty') ? false : true;

  const settings = readSettings();

  console.log(`Backfill target: ${market} ${coin}/${pair}`);

  const tradeUrl = `${API_BASE}/trades/${pairDash}`;
  const payload = await requestJson(tradeUrl);
  const trades = normalizeTrades(payload);

  if (trades.length === 0) {
    console.log('No trades returned from Rabid Rabbit trades endpoint; nothing to import.');
    return;
  }

  const apiMinTs = trades[0].ts;
  const apiMaxTs = trades[trades.length - 1].ts;
  const fromTs = (start5mRaw != null && start5mRaw !== '' ? Math.max(0, parseInt(start5mRaw, 10)) : apiMinTs);
  const toTs = (end5mRaw != null && end5mRaw !== '' ? Math.max(fromTs, parseInt(end5mRaw, 10)) : nowTs());

  console.log(`Trades returned: ${trades.length}`);
  console.log(`API trade range: ${apiMinTs}..${apiMaxTs}`);
  console.log(`5m candle range: ${fromTs}..${toTs} (fill_empty=${fillEmpty})`);

  const candles = build5mCandlesFromTrades(trades, fromTs, toTs, fillEmpty);
  const docs = withMetadata(candles, { market, coin, pair });

  console.log(`Built ${docs.length} 5m candles`);

  if (!hasFlag('--import')) {
    const outDir = path.resolve(__dirname, '..', 'tmp', 'rabid_rabbit_backfill');
    if (!fs.existsSync(outDir))
      fs.mkdirSync(outDir, { recursive: true });

    const outPath = path.join(outDir, `${coin}_${pair}_5m.ndjson`);
    fs.writeFileSync(outPath, docs.map((d) => JSON.stringify(d)).join('\n') + (docs.length > 0 ? '\n' : ''), 'utf8');
    console.log(`Saved to ${outPath}`);
    return;
  }

  const dbs = settings.dbsettings || {};
  const dbUser = encodeURIComponent(dbs.user || '');
  const dbPass = encodeURIComponent(dbs.password || '');
  const dbHost = (dbs.address || '127.0.0.1');
  const dbPort = (dbs.port || 27017);
  const dbName = (dbs.database || 'explorerdb');
  const uri = `mongodb://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}?authSource=${encodeURIComponent(dbName)}`;

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    const colName = 'historical_market_5m';

    if (hasFlag('--wipe-existing')) {
      const wipeFilter = { market: market, coin_symbol: coin, pair_symbol: pair };
      const wipeResult = await db.collection(colName).deleteMany(wipeFilter);
      console.log(`Wiped ${wipeResult.deletedCount} existing docs from ${colName}`);
    }

    await ensureIndexes(db, colName);
    const result = await importDocs(db, colName, docs);
    console.log(`Imported ${docs.length} docs (upserted ${result.upserted}) into ${colName}`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
