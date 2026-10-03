'use strict';

// Orchestrates the network-wide peer crawler. Modeled on lib/historical_collectors.js's
// conventions: plain exported functions, no locking of its own (the caller - scripts/sync.js -
// owns the pid lock), and health/observability logged via the existing CollectorHealth model.
//
// Two entry points:
//   run_crawl(cb)       - light cycle (intended cadence: every ~30 min via cron): re-seeds from
//                         current live connections + the local daemon's own addrman, then
//                         verifies a bounded batch of never/least-recently-verified candidates
//                         by speaking the p2p protocol directly (lib/rincoin_p2p.js), discovering
//                         further addresses via each successful peer's addr gossip along the way.
//   run_full_rescan(cb) - deep cycle (intended cadence: monthly): re-verifies every known,
//                         non-onion node and re-resolves geolocation for all of them, not just
//                         new ones, to catch drift (ip reassignment, long-stale data) over time.

const async = require('async');
const net = require('net');
const NetworkNodeStatistics = require('../models/network_node_statistics');
const CollectorHealth = require('../models/collector_health');
const lib = require('./explorer');
const p2p = require('./rincoin_p2p');
const settings = require('./settings');
const RateLimit = require('./ratelimit').RateLimit;

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function agingCfg() {
  return (settings.network_crawler || {}).aging || {};
}

// a node only stays eligible for the "Full" view (and for the frequent handshake-only recheck in
// run_seed_only) while its last successful handshake is within this window
function reachableCutoff() {
  return new Date(Date.now() - (agingCfg().reachable_ttl_hours || 2) * 3600 * 1000);
}

// anything not seen alive for longer than this is deleted (pruneStale) or ignored on ingest (upsertDiscovered)
function retentionCutoff() {
  return new Date(Date.now() - (agingCfg().retention_days || 30) * 86400 * 1000);
}

function unreachableAfterFailures() {
  return Math.max(1, agingCfg().unreachable_after_failures || 2);
}

function record_health(component, status, message, meta, cb) {
  CollectorHealth.create({
    collector: 'network_crawler',
    component: component,
    status: status,
    message: (message || ''),
    meta: (meta || {}),
    timestamp: nowTs()
  }).then(() => cb && cb(true)).catch(() => cb && cb(false));
}

function classifyNetwork(address) {
  if (!address) return 'unknown';
  if (address.endsWith('.onion')) return 'onion';
  if (net.isIPv4(address)) return 'ipv4';
  if (net.isIPv6(address)) return 'ipv6';
  return 'unknown';
}

// splits a getpeerinfo-style "addr" string (either "1.2.3.4:9555" or "[2400:..]:9555") into { address, port }
function parseHostPort(addrStr) {
  if (!addrStr) return null;

  if (addrStr.charAt(0) === '[') {
    const closeIdx = addrStr.indexOf(']');
    if (closeIdx === -1) return null;
    return {
      address: addrStr.slice(1, closeIdx),
      port: parseInt(addrStr.slice(closeIdx + 2), 10) || 0
    };
  }

  const idx = addrStr.lastIndexOf(':');
  if (idx === -1) return { address: addrStr, port: 0 };
  return { address: addrStr.slice(0, idx), port: parseInt(addrStr.slice(idx + 1), 10) || 0 };
}

// upserts a node discovered via addr gossip or the local addrman. `entry` is the raw
// {address, port, services, time} shape shared by both sources (rincoin_p2p's parseAddrPayload
// and the getnodeaddresses RPC) - services/time are the gossiping side's own claim about the
// node, which is the only information obtainable for a node that can never itself be dialed, so
// it's captured here even though it's second-hand and possibly stale.
function upsertDiscovered(entry, discoveredVia, discoveredFrom, cb) {
  const address = entry && entry.address;
  const network = classifyNetwork(address);
  if (!address || network === 'unknown') return cb();

  // an address whose own last-seen time is already past the retention window (or missing) is one the
  // coin daemon itself treats as "terrible" - getnodeaddresses / getaddr replies only still contain such
  // entries when the daemon happened to dial them within the last minute. Skipping them here (instead of
  // upserting) is what stops dead addrman entries from being re-sampled and kept alive forever.
  if (!entry.time || new Date(entry.time * 1000) < retentionCutoff()) return cb();

  const port = entry.port;
  const now = new Date();
  // never record a last-seen time in the future (clock skew / bogus gossip), or the $max below would
  // pin it there and the node could never age out
  const gossipLastSeen = new Date(Math.min(entry.time * 1000, now.getTime()));

  const update = {
    $set: { network: network, last_gossiped: now },
    $setOnInsert: {
      first_seen: now,
      discovered_via: discoveredVia,
      discovered_from: (discoveredFrom || '')
    },
    $inc: { gossip_count: 1 }
  };

  if (entry.services != null) {
    update.$set.gossip_services = String(entry.services);
  }

  // entry.time is the gossiping side's own claim of when it last saw this address alive - only
  // keep the highest value seen so a stale re-gossip relayed through the network can't regress
  // a fresher timestamp we already recorded from a more recent source
  update.$max = { gossip_last_seen: gossipLastSeen };

  if (discoveredFrom) {
    // distinct-source corroboration: an address independently gossiped by several different peers
    // is a much stronger liveness signal than one gossiped repeatedly by a single source
    update.$addToSet = { gossip_sources: discoveredFrom };
  }

  NetworkNodeStatistics.updateOne(
    { address: address, port: String(port || '') },
    update,
    { upsert: true }
  ).then(() => cb()).catch((err) => {
    console.log(`Warning: network_crawler failed to upsert discovered node ${address}:${port}: ${err.message || err}`);
    cb();
  });
}

// upserts every currently-connected peer - this is free data (no crawl connection needed) since
// getpeerinfo already implies a completed handshake. Only OUTBOUND connections (our own daemon dialed
// the node) prove the node accepts connections, so only those are recorded as verified-reachable.
// An inbound connection only proves the node is alive (it may well be behind NAT/VPN/Tor and never
// dialable), so for inbound peers just the handshake metadata + last_connected_at are recorded and the
// node is left to prove reachability through a real crawler handshake like any other candidate.
function seedFromLivePeers(cb) {
  const cfg = settings.network_crawler || {};
  const defaultPort = cfg.p2p_port || 9555;

  lib.get_peerinfo(function(peers) {
    if (!Array.isArray(peers) || peers.length === 0) return cb(null, 0);

    const now = new Date();

    async.eachLimit(peers, 10, function(peer, next) {
      const hp = parseHostPort(peer.addr);
      if (!hp || !hp.address) return next();

      // for an inbound connection, peer.addr's port is the peer's ephemeral outbound source
      // port for ITS connection to us - not a port anyone else could dial them back on. Key on
      // the network's standard p2p port instead, or this creates one bogus duplicate record per
      // ephemeral port every time an inbound peer reconnects. Only outbound connections (where
      // our own daemon dialed peer.addr directly) give us a real, dialable listening address.
      const keyPort = peer.inbound ? defaultPort : hp.port;

      const fields = {
        network: classifyNetwork(hp.address),
        protocol: (typeof peer.version === 'number' ? peer.version : null),
        subversion: (peer.subver || '').replace(/^\/+|\/+$/g, ''),
        services: (peer.services || ''),
        last_connected_at: now
      };

      if (!peer.inbound) {
        Object.assign(fields, {
          reachable: true,
          last_verified_at: now,
          last_verified_ok_at: now,
          consecutive_failures: 0,
          next_retry_at: null
        });
      }

      NetworkNodeStatistics.updateOne(
        { address: hp.address, port: String(keyPort || '') },
        {
          $set: fields,
          $setOnInsert: { first_seen: now, discovered_via: 'getpeerinfo', discovered_from: '' }
        },
        { upsert: true }
      ).then(() => next()).catch((err) => {
        console.log(`Warning: network_crawler failed to seed live peer ${hp.address}: ${err.message || err}`);
        next();
      });
    }, function() {
      cb(null, peers.length);
    });
  });
}

// pulls the local daemon's own address book (addrman) as an additional discovery source,
// independent of whatever the raw crawl itself finds via addr gossip
function seedFromAddrman(cb) {
  lib.get_nodeaddresses(0, function(addresses) {
    if (!Array.isArray(addresses) || addresses.length === 0) return cb(null, 0);

    async.eachLimit(addresses, 10, function(entry, next) {
      if (!entry || !entry.address) return next();
      upsertDiscovered(entry, 'seed', '', next);
    }, function() {
      cb(null, addresses.length);
    });
  });
}

// computes the next-eligible-retry delay for a node that just failed verification again. Grows
// exponentially with consecutive_failures so a chronically-unreachable node (the common case -
// most known nodes are firewalled/NATed and will never answer) stops eating the light crawl
// cycle's limited concurrency budget on every single run, while a node that fails only once or
// twice is still retried promptly in case that was transient.
function computeBackoffMs(consecutiveFailures) {
  const cfg = (settings.network_crawler || {}).retry_backoff || {};
  const baseMs = (cfg.base_minutes || 30) * 60 * 1000;
  const maxMs = (cfg.max_days || 30) * 24 * 60 * 60 * 1000;
  const multiplier = cfg.multiplier || 2;

  return Math.min(maxMs, baseMs * Math.pow(multiplier, Math.max(0, consecutiveFailures - 1)));
}

// connects directly to each candidate (bounded concurrency), records the handshake result and
// upserts any newly-gossiped addresses it returns. opts.handshakeOnly skips the getaddr exchange
// (see rincoin_p2p.crawlNode) for a cheap liveness-only check.
function verifyCandidates(candidates, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  const cfg = settings.network_crawler || {};
  const concurrency = cfg.concurrency || 5;
  const defaultPort = cfg.p2p_port || 9555;

  let verifiedOk = 0;
  let verifiedFailed = 0;
  let discovered = 0;

  async.eachLimit(candidates, concurrency, function(doc, next) {
    const targetPort = parseInt(doc.port, 10) || defaultPort;
    const now = new Date();

    p2p.crawlNode(doc.address, targetPort, { handshakeOnly: !!opts.handshakeOnly }, function(err, result) {
      const updateOps = { $inc: { verify_attempts: 1 } };

      if (result && result.reachable) {
        verifiedOk++;
        updateOps.$set = {
          reachable: true,
          protocol: result.protocol,
          subversion: result.subversion,
          services: result.services,
          last_verified_at: now,
          last_verified_ok_at: now,
          consecutive_failures: 0,
          next_retry_at: null
        };
      } else {
        verifiedFailed++;
        const newConsecutiveFailures = (doc.consecutive_failures || 0) + 1;

        updateOps.$set = {
          last_verified_at: now,
          next_retry_at: new Date(now.getTime() + computeBackoffMs(newConsecutiveFailures))
        };
        updateOps.$inc.consecutive_failures = 1;

        // tolerate isolated transient failures - a node only drops out of the "Full" view once it
        // has failed aging.unreachable_after_failures handshakes in a row
        if (newConsecutiveFailures >= unreachableAfterFailures()) {
          updateOps.$set.reachable = false;
        }
      }

      NetworkNodeStatistics.updateOne({ _id: doc._id }, updateOps).catch((updateErr) => {
        console.log(`Warning: network_crawler failed to record verification for ${doc.address}: ${updateErr.message || updateErr}`);
      });

      const newAddrEntries = (result && Array.isArray(result.addresses)) ? result.addresses : [];

      async.eachLimit(newAddrEntries, 10, function(entry, nextEntry) {
        if (!entry || !entry.address) return nextEntry();
        discovered++;
        upsertDiscovered(entry, 'addr_gossip', doc.address, nextEntry);
      }, function() {
        next();
      });
    });
  }, function() {
    cb(null, { verifiedOk, verifiedFailed, discovered });
  });
}

// resolves geolocation for known nodes, regardless of whether they're currently verified
// reachable - a geo lookup only needs the ip address itself, not a completed p2p handshake, so
// there is no reason to gate it on reachability (unlike protocol/subversion, which genuinely
// can only be learned via a direct handshake). This deliberately runs as its own pass rather
// than being tucked inside the raw-crawl verification loop, which would otherwise only ever
// reach nodes that happen to cycle back through the verification candidate queue (nodes seeded
// fresh every run via getpeerinfo never do, since their last_verified_at keeps getting
// refreshed to "now")
function resolveMissingGeo(geoRateLimit, resolveAllNodes, cb) {
  const cfg = settings.network_crawler || {};
  const maxPerRun = cfg.geo_max_per_run || 200;
  // onion addresses have no meaningful ip-based geolocation - exclude them so the budget isn't
  // spent on lookups that can never succeed
  const query = Object.assign(
    { network: { $ne: 'onion' } },
    resolveAllNodes ? {} : { $or: [ { country: '' }, { country: null } ] }
  );

  // nodes with no country yet sort first (empty string / null sort before any resolved country
  // name), so a capped run still makes forward progress on the backlog before re-refreshing
  // already-resolved entries
  NetworkNodeStatistics.find(query).sort({ country: 1 }).limit(maxPerRun).then((nodes) => {
    let geoResolved = 0;

    async.eachSeries(nodes, function(doc, next) {
      geoRateLimit.schedule(function() {
        lib.get_geo_location(doc.address, function(error, geo) {
          if (error || !geo || typeof geo !== 'object' || !geo.country_name) {
            return next();
          }

          geoResolved++;
          NetworkNodeStatistics.updateOne(
            { _id: doc._id },
            { $set: { country: geo.country_name, country_code: (geo.country_code || '') } }
          ).then(() => next()).catch((geoErr) => {
            console.log(`Warning: network_crawler failed to save geolocation for ${doc.address}: ${geoErr.message || geoErr}`);
            next();
          });
        });
      });
    }, function() {
      cb(null, geoResolved);
    });
  }).catch((err) => cb(err, 0));
}

// deletes nodes not seen alive for aging.retention_days - "alive" being the newest of: the last-seen
// time other nodes report for it (gossip_last_seen), our own last successful handshake, and its last
// connection to the local wallet. Deliberately NOT keyed on last_gossiped (when we last *heard about*
// the address): the coin daemon keeps dead addrman entries forever and keeps re-offering them, which
// would otherwise refresh last_gossiped indefinitely and keep long-dead addresses in the ALL tab.
// A record carrying none of those timestamps at all falls back to first_seen, so it still gets the
// full retention window before being deleted.
function pruneStale(cb) {
  const cutoff = retentionCutoff();
  const aliveFields = ['gossip_last_seen', 'last_verified_ok_at', 'last_connected_at'];

  NetworkNodeStatistics.deleteMany({
    $and: aliveFields.map((field) => ({ $or: [ { [field]: null }, { [field]: { $lt: cutoff } } ] })).concat([
      { $or: [ { first_seen: { $lt: cutoff } } ].concat(aliveFields.map((field) => ({ [field]: { $ne: null } }))) }
    ])
  }).then((result) => cb(null, result.deletedCount || 0)).catch((err) => cb(err, 0));
}

// re-handshakes (handshake only, no getaddr wait) every node with a successful handshake within
// aging.reachable_ttl_hours, so the "Full" view drops a node that stopped answering within a couple of
// run_seed_only cycles (aging.unreachable_after_failures) instead of trusting a single old success.
// Selection is by last success rather than by the current reachable flag, so a node that only blipped
// (e.g. a daemon restart) is still rechecked and returns to "Full" on its next successful handshake
// instead of falling into the slow retry_backoff queue. Nodes refreshed by seedFromLivePeers during
// this same run (live outbound connections) are skipped - they were just proven reachable.
function recheckRecentlyReachable(refreshedSince, cb) {
  NetworkNodeStatistics.find({
    network: { $ne: 'onion' },
    last_verified_ok_at: { $gte: reachableCutoff(), $lt: refreshedSince }
  }).then((candidates) => {
    verifyCandidates(candidates, { handshakeOnly: true }, (err, stats) => {
      cb(null, Object.assign({ rechecked: candidates.length }, stats));
    });
  }).catch((err) => cb(err, { rechecked: 0 }));
}

function makeGeoRateLimit() {
  const intervalMs = (settings.sync && settings.sync.rate_limit && settings.sync.rate_limit.network_crawl_rate_limit) || 2000;
  return new RateLimit(1, intervalMs, false);
}

function run_crawl(cb) {
  const cfg = settings.network_crawler || {};
  if (!cfg.enabled) return cb(null, { skipped: true });

  const startedAt = Date.now();
  const geoRateLimit = makeGeoRateLimit();

  async.waterfall([
    (next) => seedFromLivePeers((err, livePeerCount) => next(null, livePeerCount)),
    (livePeerCount, next) => seedFromAddrman((err, seededCount) => next(null, livePeerCount, seededCount)),
    (livePeerCount, seededCount, next) => {
      // skip candidates still serving out their backoff from a recent confirmed-unreachable
      // result - a node that has failed repeatedly gets checked less and less often here, freeing
      // the concurrency budget for candidates more likely to actually succeed. This filter is
      // deliberately absent from run_full_rescan, which exists precisely to re-check everyone
      // (including backed-off nodes) on a slower, unconditional cadence.
      NetworkNodeStatistics.find({
        network: { $ne: 'onion' },
        $or: [ { next_retry_at: null }, { next_retry_at: { $lte: new Date() } } ]
      })
        .sort({ last_verified_at: 1 })
        .limit(cfg.max_candidates_per_run || 100)
        .then((candidates) => next(null, livePeerCount, seededCount, candidates))
        .catch((err) => next(err));
    },
    (livePeerCount, seededCount, candidates, next) => {
      verifyCandidates(candidates, (err, stats) => {
        next(null, livePeerCount, seededCount, candidates.length, stats);
      });
    },
    (livePeerCount, seededCount, candidateCount, stats, next) => {
      resolveMissingGeo(geoRateLimit, false, (err, geoResolved) => {
        next(null, livePeerCount, seededCount, candidateCount, Object.assign({}, stats, { geoResolved: geoResolved || 0 }));
      });
    },
    (livePeerCount, seededCount, candidateCount, stats, next) => {
      pruneStale((err, prunedCount) => next(null, livePeerCount, seededCount, candidateCount, stats, prunedCount || 0));
    }
  ], (err, livePeerCount, seededCount, candidateCount, stats, prunedCount) => {
    if (err) {
      return record_health('crawl', 'error', (err.message || String(err)), {}, () => cb(err));
    }

    const summary = Object.assign({}, stats, {
      livePeerCount: livePeerCount,
      seededCount: seededCount,
      candidatesChecked: candidateCount,
      prunedCount: prunedCount,
      duration_ms: Date.now() - startedAt
    });

    record_health('crawl', 'ok', 'Network crawl completed', summary, () => cb(null, summary));
  });
}

function run_full_rescan(cb) {
  const cfg = settings.network_crawler || {};
  if (!cfg.enabled) return cb(null, { skipped: true });

  const startedAt = Date.now();
  const geoRateLimit = makeGeoRateLimit();

  NetworkNodeStatistics.find({ network: { $ne: 'onion' } })
    .then((candidates) => {
      verifyCandidates(candidates, (err, stats) => {
        resolveMissingGeo(geoRateLimit, true, (geoErr, geoResolved) => {
          pruneStale((pruneErr, prunedCount) => {
            const summary = Object.assign({}, stats, {
              geoResolved: geoResolved || 0,
              candidatesChecked: candidates.length,
              prunedCount: (prunedCount || 0),
              duration_ms: Date.now() - startedAt
            });

            record_health('full_rescan', 'ok', 'Network full rescan completed', summary, () => cb(null, summary));
          });
        });
      });
    })
    .catch((err) => {
      record_health('full_rescan', 'error', (err.message || String(err)), {}, () => cb(err));
    });
}

// run_seed_only: cheap cycle intended to run far more often than the light crawl (e.g. every 5 min via
// cron). It does two things:
//   1. reads getpeerinfo, which is the only place full handshake data (protocol/subversion/services)
//      ever exists for a node that is itself unreachable from the outside: if such a node happens to
//      dial our own daemon between light-crawl cycles, this is what actually catches it instead of the
//      connection coming and going unnoticed between 30-minute samples.
//   2. re-handshakes the handful of recently-reachable nodes (recheckRecentlyReachable) to keep the
//      "Full" view fresh - a short version/verack exchange per node, no address crawling.
function run_seed_only(cb) {
  const cfg = settings.network_crawler || {};
  if (!cfg.enabled) return cb(null, { skipped: true });

  const startedAt = Date.now();
  const runStart = new Date(startedAt);

  seedFromLivePeers((err, livePeerCount) => {
    recheckRecentlyReachable(runStart, (recheckErr, recheckStats) => {
      const summary = Object.assign({ livePeerCount: livePeerCount || 0 }, recheckStats, { duration_ms: Date.now() - startedAt });
      record_health('seed', (recheckErr ? 'error' : 'ok'), (recheckErr ? (recheckErr.message || String(recheckErr)) : 'Network live-peer seed completed'), summary, () => cb(null, summary));
    });
  });
}

module.exports = {
  run_crawl,
  run_full_rescan,
  run_seed_only
};
