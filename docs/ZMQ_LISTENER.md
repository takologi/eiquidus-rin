# ZMQ Block Listener

`scripts/zmq_listener.js` is a standalone Node.js daemon that subscribes to the Rincoin coin daemon's ZMQ publisher and triggers an incremental block sync (plus dashboard update) every time a new block is confirmed.

It replaces the high-frequency `*/1 * * * *` cron jobs for `sync.js update` and `update_dashboard.js` with a **near-instant, event-driven approach** while the existing cron jobs remain as a low-frequency safety net.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [How it compares to cron](#how-it-compares-to-cron)
3. [Prerequisites](#prerequisites)
4. [Rincoin daemon configuration](#rincoin-daemon-configuration)
5. [Settings reference](#settings-reference)
6. [Installation](#installation)
7. [Hybrid cron configuration](#hybrid-cron-configuration)
8. [Operator runbook](#operator-runbook)
9. [Troubleshooting](#troubleshooting)

---

## Architecture overview

```
Rincoin daemon
  │
  │ ZMQ PUB (tcp://127.0.0.1:28332)
  │  topic: "hashblock"
  │  payload: 32-byte block hash + 4-byte sequence number
  ▼
scripts/zmq_listener.js  (persistent daemon, managed by systemd)
  │
  │ debounce (default 5 s)   ← coalesces rapid notifications
  │ cooldown (default 30 s)  ← prevents back-to-back syncs
  │ rate limit (10/min)      ← circuit-breaker for unexpected bursts
  │
  ├─▶ node scripts/sync.js update
  │        (idempotent, lock-protected via tmp/index.pid)
  │
  └─▶ node scripts/update_dashboard.js
           (idempotent, lock-protected via tmp/update_dashboard.lock)
```

### What moves to ZMQ-triggered

| Job | Old cadence | New cadence | Reason |
|-----|-------------|-------------|--------|
| `sync.js update` | every 1 min (cron) | on each block (ZMQ) + 15 min fallback | Idempotent, lock-protected |
| `update_dashboard.js` | every 1 min (cron) | on each block (ZMQ) + 10 min fallback | Idempotent, own lock |

### What stays cron-only

| Job | Reason |
|-----|--------|
| `sync.js market` | External API rate limits; not block-triggered |
| `sync.js peers` | Full TCP peer scan; not block-triggered |
| `sync.js masternodes` | Full RPC list refresh; not block-triggered |
| `sync.js checkpoint` | Long-running batch aggregation; scheduled only |

---

## How it compares to cron

| Dimension | Cron (`*/1`) | ZMQ listener |
|-----------|-------------|--------------|
| Sync latency after new block | 0–60 s | ~5–10 s (debounce) |
| Resource usage | Spawns process every minute whether or not there's a block | Spawns process only when a block arrives |
| Missed-block recovery | Next cron tick picks it up | Startup sync + 15 min fallback cron |
| Complexity | Simple, no extra process | Requires systemd service + ZMQ config |

---

## Prerequisites

### System packages

```bash
# Already present on a Rincoin node (libzmq is a Rincoin runtime dependency)
# Install if missing:
sudo apt install libzmq3-dev build-essential
```

### Node.js dependency

`zeromq` (v6) is added to `package.json` and installed automatically by `npm install`.

Verify after install:

```bash
cd /opt/eiquidus-test
node -e "const { Subscriber } = require('zeromq'); console.log('zeromq OK')"
```

---

## Rincoin daemon configuration

Add the following lines to `~/.rincoin/rincoin.conf` (or wherever your Rincoin data directory is):

```ini
# ZMQ block-hash notifications
zmqpubhashblock=tcp://127.0.0.1:28332

# Optional: raw block bytes (not needed by the listener but useful for debugging)
# zmqpubrawblock=tcp://127.0.0.1:28333
```

Then restart Rincoin:

```bash
rincoin-cli stop
rincoind -daemon
```

Verify ZMQ is active:

```bash
rincoin-cli getzmqnotifications
# Should show:
# [ { "type": "pubhashblock", "address": "tcp://127.0.0.1:28332", "hwm": 1000 } ]
```

**Firewall note:** The ZMQ port (28332) must be reachable from `localhost` only. Do not expose it to the internet.

---

## Settings reference

All settings live under the `zmq_listener` key in `settings.json`.

```jsonc
"zmq_listener": {
  // Enable/disable the listener (safety switch; daemon must still be started)
  "enabled": true,

  // ZMQ endpoint published by the coin daemon
  // Must match zmqpubhashblock in rincoin.conf
  "endpoint": "tcp://127.0.0.1:28332",

  // ZMQ topics to subscribe to
  // "hashblock" is the only topic needed for block sync
  "topics": ["hashblock"],

  // Seconds to wait after the last notification before triggering sync
  // Coalesces bursts (e.g. during reorgs) into a single sync run
  "debounce_seconds": 5,

  // Minimum seconds between consecutive sync cycle starts
  "sync_cooldown_seconds": 30,

  // Hard cap: max sync cycles per minute (circuit-breaker)
  "max_triggers_per_minute": 10,

  // Also run update_dashboard.js after each sync cycle
  "run_dashboard_update": true
}
```

---

## Installation

### 1. Enable the feature in settings.json

Edit `/opt/eiquidus-test/settings.json` and set:

```json
"zmq_listener": {
  "enabled": true,
  "endpoint": "tcp://127.0.0.1:28332",
  ...
}
```

### 2. Configure Rincoin ZMQ

See [Rincoin daemon configuration](#rincoin-daemon-configuration) above.

### 3. Install the systemd service

```bash
sudo cp /opt/eiquidus-test/contrib/zmq_listener.service \
        /etc/systemd/system/eiquidus-zmq-listener.service

# Review and adjust User / WorkingDirectory / ExecStart if needed:
sudo nano /etc/systemd/system/eiquidus-zmq-listener.service

sudo systemctl daemon-reload
sudo systemctl enable eiquidus-zmq-listener
sudo systemctl start  eiquidus-zmq-listener
```

### 4. Verify it's running

```bash
sudo systemctl status eiquidus-zmq-listener
sudo journalctl -u eiquidus-zmq-listener -f
```

You should see startup sync messages followed by:

```
2025-xx-xxTxx:xx:xxZ [zmq-listener] Connected to tcp://127.0.0.1:28332 – waiting for blocks…
```

And when a block arrives:

```
2025-xx-xxTxx:xx:xxZ [zmq-listener] Block notification: topic=hashblock hash=00000… seq=12345
2025-xx-xxTxx:xx:xxZ [zmq-listener] ─── Sync cycle starting ───
2025-xx-xxTxx:xx:xxZ [zmq-listener] [sync.update] Updating...
2025-xx-xxTxx:xx:xxZ [zmq-listener] [sync.update] done
2025-xx-xxTxx:xx:xxZ [zmq-listener] [update_dashboard] done
2025-xx-xxTxx:xx:xxZ [zmq-listener] ─── Sync cycle complete ───
```

### 5. Update the crontab (hybrid mode)

See [Hybrid cron configuration](#hybrid-cron-configuration) below.

---

## Hybrid cron configuration

Keep cron jobs as a fallback at reduced frequency. Examples are in `scripts/cron_examples.txt` under the **HYBRID MODE** section.

```cron
# Block sync fallback – every 15 min (ZMQ handles the rest)
*/15 * * * * cd /opt/eiquidus-test && /usr/bin/node scripts/sync.js update >> /var/log/elquidus/sync_update.log 2>&1

# Dashboard update fallback – every 10 min
*/10 * * * * cd /opt/eiquidus-test && /usr/bin/node scripts/update_dashboard.js >> /var/log/elquidus/dashboard_update.log 2>&1

# Market sync – every 2 min (unchanged)
*/2 * * * * cd /opt/eiquidus-test && /usr/bin/node scripts/sync.js market >> /var/log/elquidus/sync_market.log 2>&1

# Peer sync – every 5 min (unchanged)
*/5 * * * * cd /opt/eiquidus-test && /usr/bin/node scripts/sync.js peers >> /var/log/elquidus/sync_peers.log 2>&1

# Masternode sync – every 5 min (unchanged, if enabled)
*/5 * * * * cd /opt/eiquidus-test && /usr/bin/node scripts/sync.js masternodes >> /var/log/elquidus/sync_masternodes.log 2>&1

# Checkpoint – every 6 hours (unchanged)
0 */6 * * * cd /opt/eiquidus-test && /usr/bin/node scripts/sync.js checkpoint 50000 >> /var/log/elquidus/checkpoint_update.log 2>&1
```

The existing `tmp/*.pid` lock files prevent any overlap between ZMQ-triggered and cron-triggered sync runs.

---

## Operator runbook

### Start / stop / restart

```bash
sudo systemctl start   eiquidus-zmq-listener
sudo systemctl stop    eiquidus-zmq-listener
sudo systemctl restart eiquidus-zmq-listener
```

### View live logs

```bash
sudo journalctl -u eiquidus-zmq-listener -f
```

### Check PID

```bash
cat /opt/eiquidus-test/tmp/zmq_listener.pid
```

### Temporarily disable (without touching systemd)

Set `"enabled": false` in `settings.json` → `zmq_listener`, then restart the service. The process will start and immediately exit cleanly.

### Disable and roll back to cron-only

```bash
sudo systemctl stop    eiquidus-zmq-listener
sudo systemctl disable eiquidus-zmq-listener

# Restore original cron frequency:
crontab -e
# Change */15 back to */1 for sync.js update
# Change */10 back to */1 for update_dashboard.js
```

### Promote to production

Once validated in `/opt/eiquidus-test`:

1. Commit all changes and push to git remote.
2. On the production server: `cd /opt/eiquidus && git pull`.
3. Run `npm install` (installs the `zeromq` package).
4. Copy and enable the systemd service with `WorkingDirectory=/opt/eiquidus`.
5. Update `settings.json` in production with `zmq_listener.enabled: true`.
6. Reduce production cron job frequencies.

---

## Troubleshooting

### Listener exits immediately

Check `settings.json`: `zmq_listener.enabled` must be `true`.

### `require('zeromq')` fails

```bash
cd /opt/eiquidus-test && npm install
node -e "require('zeromq')"
```

If it still fails, check that `libzmq3-dev` is installed:

```bash
dpkg -l | grep libzmq
```

### No block notifications arriving

1. Verify Rincoin ZMQ is configured: `rincoin-cli getzmqnotifications`
2. Check the endpoint matches `settings.json` → `zmq_listener.endpoint`
3. Test from the command line:

```bash
# Requires python3-zmq: apt install python3-zmq
python3 -c "
import zmq, binascii, sys
ctx = zmq.Context()
s = ctx.socket(zmq.SUB)
s.connect('tcp://127.0.0.1:28332')
s.setsockopt(zmq.SUBSCRIBE, b'hashblock')
print('Waiting for blocks...')
while True:
    parts = s.recv_multipart()
    print('block:', binascii.hexlify(parts[1]).decode())
"
```

### Sync runs too often (bursts)

Lower `max_triggers_per_minute` or increase `sync_cooldown_seconds` in `settings.json`.

### Sync is too slow to keep up

This is not a ZMQ listener problem — it means the block sync itself is slow. See `sync.block_parallel_tasks` and `sync.batch_size` settings.

### Stale PID file after crash

```bash
rm /opt/eiquidus-test/tmp/zmq_listener.pid
sudo systemctl restart eiquidus-zmq-listener
```

The listener also checks for stale PID files from the existing sync scripts via the lock mechanism in `lib/explorer.js`.
