#!/usr/bin/env node
/**
 * ZMQ Block Listener Daemon for eIquidus
 *
 * Subscribes to Rincoin (or any Bitcoin-protocol coin) ZMQ block notifications
 * and triggers incremental block sync + dashboard update on each new block.
 *
 * Design goals:
 *   - Isolated: runs as its own process; a crash does not affect the web app
 *   - Lock-safe: the spawned scripts own their tmp/*.pid lock files; no races
 *   - Debounced: rapid notifications are coalesced before triggering a sync
 *   - Rate-limited: hard cap on sync triggers per minute + per-cycle cooldown
 *   - Resilient: zeromq reconnects automatically; systemd restarts the daemon
 *   - Fallback-compatible: safe to keep reduced-frequency cron jobs running
 *
 * Prerequisites:
 *   - npm install zeromq   (v6.x, installed automatically by npm install)
 *   - Rincoin configured with zmqpubhashblock=tcp://127.0.0.1:28332
 *     (or whichever endpoint is set in settings.zmq_listener.endpoint)
 *
 * Usage:
 *   cd /opt/eiquidus-test && node scripts/zmq_listener.js
 *
 * Managed via systemd (see contrib/zmq_listener.service).
 */

'use strict';

const { execFile }   = require('child_process');
const { Subscriber } = require('zeromq');
const fs             = require('fs');
const path           = require('path');
const settings       = require('../lib/settings');

// ── Configuration ─────────────────────────────────────────────────────────────
// settings.zmq_listener is populated by lib/settings.js from settings.json.
// All keys here match the exports.zmq_listener defaults in lib/settings.js.
const cfg         = settings.zmq_listener || {};
const ENABLED     = cfg.enabled !== false;
const ENDPOINT    = cfg.endpoint                 || 'tcp://127.0.0.1:28332';
const TOPICS      = Array.isArray(cfg.topics) && cfg.topics.length > 0
                      ? cfg.topics : ['hashblock'];
const DEBOUNCE_MS = (cfg.debounce_seconds      || 5)  * 1000;
const COOLDOWN_MS = (cfg.sync_cooldown_seconds != null ? cfg.sync_cooldown_seconds : 0) * 1000;
const MAX_PER_MIN = cfg.max_triggers_per_minute  || 10;
const RUN_DASH    = cfg.run_dashboard_update !== false;

const ROOT        = path.join(__dirname, '..');
const NODE_BIN    = process.execPath;
const SYNC_SCRIPT = path.join(ROOT, 'scripts', 'sync.js');
const DASH_SCRIPT = path.join(ROOT, 'scripts', 'update_dashboard.js');
const PID_FILE    = path.join(ROOT, 'tmp', 'zmq_listener.pid');

// ── State ─────────────────────────────────────────────────────────────────────
let debounceTimer    = null;   // pending setTimeout before next sync cycle
let syncRunning      = false;  // true while scripts/sync.js is in flight
let pendingAfterSync = false;  // block arrived while sync was running
let lastSyncTime     = 0;      // epoch ms of last sync cycle start
let triggersThisMin  = 0;      // rate limit counter (resets each minute)
let minuteStart      = Date.now();
let shuttingDown     = false;
let zmqSocket        = null;   // active Subscriber, for clean close on shutdown

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  process.stdout.write(`${new Date().toISOString()} [zmq-listener] ${msg}\n`);
}

function logErr(msg, err) {
  const detail = err ? (err.stack || String(err)) : '';
  process.stderr.write(
    `${new Date().toISOString()} [zmq-listener] ERROR ${msg}${detail ? ': ' + detail : ''}\n`
  );
}

// ── PID file ──────────────────────────────────────────────────────────────────
function writePid() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
    log(`PID ${process.pid} written to ${path.relative(ROOT, PID_FILE)}`);
  } catch (e) {
    logErr('Cannot write PID file', e);
  }
}

function removePid() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch { /* best-effort */ }
}

// ── Script spawner ────────────────────────────────────────────────────────────
/**
 * Spawn a Node.js script with the given args and resolve when it exits.
 * stdout/stderr are forwarded to the listener log with a label prefix.
 */
function spawnScript(scriptPath, args, label) {
  return new Promise((resolve) => {
    const relPath = path.relative(ROOT, scriptPath);
    log(`Spawning: node ${relPath}${args.length ? ' ' + args.join(' ') : ''}`);

    execFile(
      NODE_BIN,
      [scriptPath, ...args],
      { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout) {
          stdout.trim().split('\n').forEach(l => { if (l) log(`[${label}] ${l}`); });
        }
        if (stderr) {
          stderr.trim().split('\n').forEach(l => { if (l) log(`[${label}:err] ${l}`); });
        }
        // exit code != 0 is not fatal: sync.js exits 1 when already locked
        if (err && err.code && err.code !== 0) {
          log(`[${label}] exited with code ${err.code}`);
        } else {
          log(`[${label}] completed`);
        }
        resolve();
      }
    );
  });
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
function withinRateLimit() {
  const now = Date.now();
  if (now - minuteStart > 60_000) { minuteStart = now; triggersThisMin = 0; }
  if (triggersThisMin >= MAX_PER_MIN) {
    log(`Rate limit (${MAX_PER_MIN} triggers/min) reached – skipping cycle`);
    return false;
  }
  triggersThisMin++;
  return true;
}

// ── Sync cycle ────────────────────────────────────────────────────────────────
async function runSyncCycle() {
  if (shuttingDown) return;
  if (!withinRateLimit()) return;

  const now = Date.now();
  const sinceLastSync = now - lastSyncTime;
  if (lastSyncTime > 0 && sinceLastSync < COOLDOWN_MS) {
    const waitMs = COOLDOWN_MS - sinceLastSync;
    log(`Cooldown active (${Math.ceil(waitMs / 1000)}s left) – deferring`);
    // re-schedule so this notification isn't lost
    if (!debounceTimer) {
      debounceTimer = setTimeout(onDebounce, waitMs);
    }
    return;
  }

  syncRunning  = true;
  lastSyncTime = Date.now();
  log('─── Sync cycle starting ───');

  await spawnScript(SYNC_SCRIPT, ['update'], 'sync.update');

  if (!shuttingDown && RUN_DASH) {
    await spawnScript(DASH_SCRIPT, [], 'update_dashboard');
  }

  syncRunning = false;
  log('─── Sync cycle complete ───');

  if (pendingAfterSync && !shuttingDown) {
    pendingAfterSync = false;
    log('Block arrived during sync – scheduling follow-up cycle');
    debounceTimer = setTimeout(onDebounce, DEBOUNCE_MS);
  }
}

function onDebounce() {
  debounceTimer = null;
  if (syncRunning) {
    // Another cycle is already running; flag it and let the cycle re-trigger
    pendingAfterSync = true;
    log('Debounce fired while sync in progress – follow-up queued');
    return;
  }
  runSyncCycle().catch(err => logErr('Sync cycle threw unexpectedly', err));
}

// ── ZMQ message handler ───────────────────────────────────────────────────────
/**
 * Called for each complete multipart message from the publisher.
 * frames: [topic: Buffer, hash: Buffer(32), seq: Buffer(4)]
 */
function onBlockNotification(frames) {
  if (shuttingDown) return;

  const topic  = frames[0] ? frames[0].toString()   : '?';
  const hash   = frames[1] ? frames[1].toString('hex') : '?';
  const seqBuf = frames[2];
  const seq    = seqBuf && seqBuf.length >= 4 ? seqBuf.readUInt32LE(0) : '?';

  log(`Block notification: topic=${topic} hash=${hash} seq=${seq}`);

  // Reset (or start) the debounce timer on each notification
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  debounceTimer = setTimeout(onDebounce, DEBOUNCE_MS);
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received – shutting down`);

  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

  if (zmqSocket) {
    try { zmqSocket.close(); } catch { /* ignore */ }
    zmqSocket = null;
  }

  removePid();

  if (!syncRunning) {
    log('Shutdown complete');
    process.exit(0);
  }

  log('Waiting for in-flight sync to finish…');
  const watchdog = setTimeout(() => {
    log('Force exit after 90 s watchdog');
    process.exit(1);
  }, 90_000);

  const poll = setInterval(() => {
    if (!syncRunning) {
      clearInterval(poll);
      clearTimeout(watchdog);
      log('Shutdown complete');
      process.exit(0);
    }
  }, 500);
}

process.on('SIGINT',  () => shutdown('SIGINT').catch(() => process.exit(1)));
process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));

process.on('uncaughtException', err => {
  logErr('Uncaught exception', err);
  removePid();
  process.exit(1);
});

process.on('unhandledRejection', err => {
  logErr('Unhandled rejection', err);
  removePid();
  process.exit(1);
});

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  if (!ENABLED) {
    log('zmq_listener.enabled = false in settings – exiting');
    process.exit(0);
  }

  writePid();

  log(`Endpoint : ${ENDPOINT}`);
  log(`Topics   : ${TOPICS.join(', ')}`);
  log(`Debounce : ${DEBOUNCE_MS / 1000}s`);
  log(`Cooldown : ${COOLDOWN_MS / 1000}s`);
  log(`Max/min  : ${MAX_PER_MIN}`);
  log(`Dashboard: ${RUN_DASH}`);

  // ── Startup sync ──────────────────────────────────────────────────────────
  // Catch any blocks that arrived while the listener was offline.
  log('=== Startup sync ===');
  await spawnScript(SYNC_SCRIPT, ['update'], 'sync.update:startup');
  if (RUN_DASH) {
    await spawnScript(DASH_SCRIPT, [], 'update_dashboard:startup');
  }
  log('=== Startup sync done – entering ZMQ listen loop ===');

  // ── ZMQ subscriber ────────────────────────────────────────────────────────
  const sock = new Subscriber({ linger: 0 });
  zmqSocket  = sock;

  // Subscribe to configured topics before connecting
  for (const topic of TOPICS) {
    sock.subscribe(topic);
    log(`Subscribed to topic: ${topic}`);
  }

  // connect() is non-blocking; zeromq handles reconnection automatically
  sock.connect(ENDPOINT);
  log(`Connected to ${ENDPOINT} – waiting for blocks…`);

  // Async iterator: each iteration yields one complete multipart message
  // (all frames of the message as an array of Buffers).
  // The loop blocks until a message arrives, so the process stays alive.
  for await (const frames of sock) {
    if (shuttingDown) break;
    onBlockNotification(frames);
  }

  // Loop exited (socket closed during shutdown)
  removePid();
}

main().catch(err => {
  logErr('Fatal startup error', err);
  removePid();
  process.exit(1);
});
