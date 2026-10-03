#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const request = require('postman-request');
const { MongoClient } = require('mongodb');
const jsonminify = require('jsonminify');

const UDF_BASE = 'https://tvdata.nestex.one';
const LIQ_BASE = 'https://api.nestex.one/v1/liquidity';
const INFO_BASE = 'https://api.nestex.one/v1/info';

const SLEEP_MIN_MS = 500;
const SLEEP_MAX_MS = 1500;

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function randomMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepRandom() {
  return sleep(randomMs(SLEEP_MIN_MS, SLEEP_MAX_MS));
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

function toNumber(val, fallback) {
  const n = Number(val);
  return (isNaN(n) ? fallback : n);
}

function requestJson(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    request({
      uri: url,
      json: true,
      timeout: timeout,
      headers: {
        'User-Agent': 'eiquidus-nestex-backfill/1.0'
      }
    }, (error, response, body) => {
      if (error)
        return reject(error);

      const status = (response && response.statusCode != null ? response.statusCode : 0);

      if (status < 200 || status >= 300)
        return reject(new Error(`HTTP ${status} for ${url}`));

      if (body == null || typeof body !== 'object')
        return reject(new Error(`Invalid JSON payload for ${url}`));

      return resolve(body);
    });
  });
}

function formatDate(ts) {
  return new Date(ts * 1000).toISOString();
}

function buildHistoryUrl(symbol, resolution, fromTs, toTs) {
  return `${UDF_BASE}/history?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${fromTs}&to=${toTs}`;
}

function createChunks(fromTs, toTs, chunkSeconds) {
  const chunks = [];
  let cursor = fromTs;

  while (cursor < toTs) {
    const end = Math.min(toTs, cursor + chunkSeconds);
    chunks.push({ from: cursor, to: end });
    cursor = end;
  }

  return chunks;
}

async function fetchHistoryChunked(opts) {
  const {
    symbol,
    resolution,
    fromTs,
    toTs,
    chunkSeconds,
    maxRetries,
    progressLabel
  } = opts;

  const chunks = createChunks(fromTs, toTs, chunkSeconds);
  const byTs = new Map();
  let requestsDone = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const url = buildHistoryUrl(symbol, resolution, c.from, c.to);
    let payload = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        payload = await requestJson(url);
        break;
      } catch (err) {
        lastErr = err;

        if (attempt < maxRetries)
          await sleep(randomMs(1200, 2600));
      }
    }

    if (payload == null)
      throw new Error(`[${progressLabel}] Failed after retries for chunk ${i + 1}/${chunks.length}: ${lastErr ? lastErr.message : 'unknown error'}`);

    if (payload.s !== 'ok' && payload.s !== 'no_data')
      throw new Error(`[${progressLabel}] Unexpected history status "${payload.s}" for chunk ${i + 1}/${chunks.length}`);

    if (payload.s === 'ok') {
      const t = (Array.isArray(payload.t) ? payload.t : []);
      const o = (Array.isArray(payload.o) ? payload.o : []);
      const h = (Array.isArray(payload.h) ? payload.h : []);
      const l = (Array.isArray(payload.l) ? payload.l : []);
      const cArr = (Array.isArray(payload.c) ? payload.c : []);
      const v = (Array.isArray(payload.v) ? payload.v : []);

      for (let idx = 0; idx < t.length; idx++) {
        const ts = Number(t[idx]);

        if (!(ts > 0) || isNaN(ts))
          continue;

        byTs.set(ts, {
          timestamp: ts,
          open: toNumber(o[idx], 0),
          high: toNumber(h[idx], 0),
          low: toNumber(l[idx], 0),
          close: toNumber(cArr[idx], 0),
          volume: toNumber(v[idx], 0)
        });
      }
    }

    requestsDone++;
    process.stdout.write(`\r[${progressLabel}] chunks ${requestsDone}/${chunks.length} | rows ${byTs.size}   `);

    if (i < chunks.length - 1)
      await sleepRandom();
  }

  process.stdout.write('\n');

  return Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath))
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeNdjson(filePath, rows) {
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
  fs.writeFileSync(filePath, payload, 'utf8');
}

function readSettings() {
  const settingsPath = path.resolve(__dirname, '..', 'settings.json');
  const raw = fs.readFileSync(settingsPath, 'utf8');
  return JSON.parse(jsonminify(raw));
}

function parseNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((x) => x.trim() !== '');
  return lines.map((line) => JSON.parse(line));
}

function withMetadata(rows, cfg) {
  const fetchedAt = nowTs();

  return rows.map((r) => ({
    market: cfg.market,
    coin_symbol: cfg.coin,
    pair_symbol: cfg.pair,
    provider: 'nestex_udf',
    granularity: cfg.granularity,
    resolution: cfg.resolution,
    timestamp: r.timestamp,
    bucket_timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    last: r.close,
    volume_base: r.volume,
    volume_quote: (r.volume * r.close),
    bid: null,
    ask: null,
    bid_ask_proxy_from_ohlc: false,
    lp_pooled_coin: null,
    lp_pooled_quote: null,
    lp_score: null,
    lp_growth: null,
    lp_is_replicated_snapshot: false,
    source: {
      udf: UDF_BASE,
      symbol: cfg.symbol
    },
    collected_at: fetchedAt
  }));
}

async function attachLiquiditySnapshot(rows, coinSymbol, quoteSymbol) {
  try {
    const [liq, info] = await Promise.all([
      requestJson(`${LIQ_BASE}/${encodeURIComponent(coinSymbol)}`),
      requestJson(`${INFO_BASE}/${encodeURIComponent(coinSymbol)}`)
    ]);

    if (!(liq && liq.success === true && liq.data != null))
      return rows;

    const pooledCoin = toNumber(liq.data.pooledCoin, null);
    const quoteKey = `pooled${quoteSymbol.charAt(0)}${quoteSymbol.slice(1).toLowerCase()}`;
    const pooledQuote = toNumber((liq.data[quoteKey] != null ? liq.data[quoteKey] : liq.data.pooledUsdt), null);
    const score = toNumber(liq.data.score, null);
    const growth = toNumber(liq.data.growth, null);

    return rows.map((row) => {
      const close = toNumber(row.close, 0);
      const low = toNumber(row.low, close);
      const high = toNumber(row.high, close);

      if (close > 0) {
        row.bid = Math.min(close, (low > 0 ? low : close));
        row.ask = Math.max(close, (high > 0 ? high : close));
        row.bid_ask_proxy_from_ohlc = true;
      }

      row.lp_pooled_coin = pooledCoin;
      row.lp_pooled_quote = pooledQuote;
      row.lp_score = score;
      row.lp_growth = growth;
      row.lp_is_replicated_snapshot = true;
      return row;
    });
  } catch (err) {
    return rows;
  }
}

async function ensureIndexes(db, collectionName) {
  const col = db.collection(collectionName);

  await col.createIndex({ market: 1, coin_symbol: 1, pair_symbol: 1, timestamp: 1 }, { unique: true, name: 'pair_timestamp_unique' });
  await col.createIndex({ timestamp: -1 }, { name: 'timestamp_desc' });
  await col.createIndex({ market: 1, coin_symbol: 1, pair_symbol: 1, granularity: 1, timestamp: -1 }, { name: 'pair_granularity_ts_desc' });
}

async function importNdjsonToMongo(db, collectionName, docs) {
  const col = db.collection(collectionName);

  if (docs.length === 0)
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

async function probeResolutions(symbol) {
  const probes = ['D', '720', '360', '240', '120', '60', '15', '5'];
  const end = nowTs();
  const start = end - (2 * 86400);
  const results = [];

  for (let i = 0; i < probes.length; i++) {
    const res = probes[i];
    const url = buildHistoryUrl(symbol, res, start, end);

    try {
      const payload = await requestJson(url);
      const count = (payload.s === 'ok' && Array.isArray(payload.t) ? payload.t.length : 0);
      results.push({ resolution: res, status: payload.s, count: count });
    } catch (err) {
      results.push({ resolution: res, status: 'error', message: err.message });
    }

    if (i < probes.length - 1)
      await sleepRandom();
  }

  return results;
}

async function run() {
  const settings = readSettings();
  const market = getArg('--market', 'nestex').toLowerCase();
  const coin = getArg('--coin', 'RIN').toUpperCase();
  const pair = getArg('--pair', 'USDT').toUpperCase();
  const symbol = `${coin}`;

  // Rincoin market start requested by user: Apr 2025 onwards.
  const startDaily = getArg('--start-daily-ts', `${Math.floor(Date.UTC(2025, 3, 1, 0, 0, 0) / 1000)}`);
  const start5m = getArg('--start-5m-ts', null);
  const only5m = hasFlag('--only-5m');
  const chunk5mSeconds = Math.max(300, parseInt(getArg('--chunk-5m-seconds', `${12 * 3600}`), 10) || (12 * 3600));
  const now = nowTs();
  const fromDaily = Math.max(0, parseInt(startDaily, 10));
  const fromHourly = now - (30 * 86400);
  const from5m = (start5m != null && start5m !== '' ? Math.max(0, parseInt(start5m, 10)) : (now - (7 * 86400)));

  const outDir = path.resolve(__dirname, '..', 'tmp', 'nestex_backfill');
  ensureDir(outDir);

  console.log(`Backfill target: ${market} ${coin}/${pair}`);
  console.log(`Output dir: ${outDir}`);

  const probe = await probeResolutions(symbol);
  const probePath = path.join(outDir, `${coin}_${pair}_resolution_probe.json`);
  fs.writeFileSync(probePath, JSON.stringify({ symbol: symbol, probe: probe, timestamp: nowTs() }, null, 2));
  console.log(`Resolution probe saved: ${probePath}`);

  const allPlans = [
    {
      granularity: '1d',
      resolution: 'D',
      fromTs: fromDaily,
      toTs: now,
      chunkSeconds: 120 * 86400,
      label: 'daily',
      outFile: path.join(outDir, `${coin}_${pair}_daily.ndjson`),
      collection: 'historical_market_daily'
    },
    {
      granularity: '1h',
      resolution: '60',
      fromTs: fromHourly,
      toTs: now,
      chunkSeconds: 5 * 86400,
      label: 'hourly',
      outFile: path.join(outDir, `${coin}_${pair}_hourly.ndjson`),
      collection: 'historical_market_hourly'
    },
    {
      granularity: '5m',
      resolution: '5',
      fromTs: from5m,
      toTs: now,
      chunkSeconds: chunk5mSeconds,
      label: '5m',
      outFile: path.join(outDir, `${coin}_${pair}_5m.ndjson`),
      collection: 'historical_market_5m'
    }
  ];

  const plans = (only5m ? allPlans.filter((p) => p.granularity === '5m') : allPlans);

  const generated = [];

  for (const plan of plans) {
    console.log(`\nFetching ${plan.label} (${plan.resolution}) ${formatDate(plan.fromTs)} -> ${formatDate(plan.toTs)}`);

    const rows = await fetchHistoryChunked({
      symbol: symbol,
      resolution: plan.resolution,
      fromTs: plan.fromTs,
      toTs: plan.toTs,
      chunkSeconds: plan.chunkSeconds,
      maxRetries: 4,
      progressLabel: plan.label
    });

    let docs = withMetadata(rows, {
      market: market,
      coin: coin,
      pair: pair,
      symbol: symbol,
      granularity: plan.granularity,
      resolution: plan.resolution
    });

    docs = await attachLiquiditySnapshot(docs, coin, pair);
    writeNdjson(plan.outFile, docs);

    console.log(`Saved ${docs.length} rows to ${plan.outFile}`);

    generated.push({
      file: plan.outFile,
      collection: plan.collection,
      rows: docs.length,
      granularity: plan.granularity,
      first_timestamp: (docs.length > 0 ? docs[0].timestamp : null),
      last_timestamp: (docs.length > 0 ? docs[docs.length - 1].timestamp : null)
    });
  }

  if (!hasFlag('--import')) {
    const manifestPath = path.join(outDir, `${coin}_${pair}_manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      generated_at: nowTs(),
      market: market,
      coin: coin,
      pair: pair,
      files: generated
    }, null, 2));

    console.log(`\nManifest saved: ${manifestPath}`);
    console.log('Use --import to load these files into MongoDB.');
    return;
  }

  const dbs = settings.dbsettings || {};
  const wipeExisting = hasFlag('--wipe-existing');
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

    for (const item of generated) {
      console.log(`\nImporting ${path.basename(item.file)} -> ${item.collection}`);
      if (wipeExisting) {
        const wipeFilter = { market: market, coin_symbol: coin, pair_symbol: pair };
        const wipeResult = await db.collection(item.collection).deleteMany(wipeFilter);
        console.log(`Wiped ${wipeResult.deletedCount} existing docs from ${item.collection}`);
      }

      await ensureIndexes(db, item.collection);
      const docs = parseNdjson(item.file);
      const result = await importNdjsonToMongo(db, item.collection, docs);
      console.log(`Imported ${docs.length} docs (upserted ${result.upserted})`);
    }

    console.log('\nImport complete.');
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
