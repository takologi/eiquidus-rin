var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var NetworkNodeStatisticsSchema = new Schema({
  address:              { type: String, required: true },
  port:                 { type: String, default: "" },
  network:              { type: String, enum: ["ipv4", "ipv6", "onion", "unknown"], default: "unknown", index: true },
  protocol:             { type: Number, default: null },
  subversion:           { type: String, default: "" },
  services:             { type: String, default: "" },
  country:              { type: String, default: "" },
  country_code:         { type: String, default: "" },
  reachable:            { type: Boolean, default: false, index: true },
  first_seen:           { type: Date, default: Date.now },
  last_gossiped:        { type: Date, default: Date.now },
  last_verified_at:     { type: Date, default: null },
  last_verified_ok_at:  { type: Date, default: null },
  verify_attempts:      { type: Number, default: 0 },
  consecutive_failures: { type: Number, default: 0 },
  // last_connected_at: last time this node was seen in the local wallet's getpeerinfo (inbound or outbound).
  // An inbound connection proves the node is alive but NOT that it accepts connections, so it only counts
  // towards retention (see aging.retention_days), never towards the "Full" view.
  last_connected_at:    { type: Date, default: null },
  // next_retry_at: earliest time the light crawl cycle will attempt this node again. Null/unset means
  // "eligible immediately" (never verified, or last attempt succeeded). Grows via exponential backoff
  // each time a verification attempt confirms the node unreachable again - see settings.network_crawler.retry_backoff.
  // The monthly full rescan (network-crawl-full) deliberately ignores this and checks every node regardless.
  next_retry_at:        { type: Date, default: null, index: true },
  // gossip_services / gossip_last_seen / gossip_sources / gossip_count: secondhand data reported *about*
  // this node by other peers via addr gossip or the local daemon's own addrman (getnodeaddresses) - the only
  // information obtainable for a node the crawler can never directly dial (e.g. firewalled/NATed with no
  // port forward). Self-reported by whoever gossiped it, so treat as lower-confidence than the verified
  // protocol/subversion/services fields above, which only ever come from a completed p2p handshake.
  gossip_services:      { type: String, default: "" },
  gossip_last_seen:     { type: Date, default: null },
  gossip_sources:       { type: [String], default: [] },
  gossip_count:         { type: Number, default: 0 },
  discovered_via: {
    type:    String,
    enum:    ["getpeerinfo", "addr_gossip", "seed"],
    default: "seed"
  },
  discovered_from:      { type: String, default: "" },
  createdAt:            { type: Date, default: Date.now }
});

NetworkNodeStatisticsSchema.index({ address: 1, port: 1 }, { unique: true, name: 'node_addr_port_unique' });
NetworkNodeStatisticsSchema.index({ reachable: 1, last_verified_ok_at: -1 }, { name: 'node_reachable_verified_idx' });
NetworkNodeStatisticsSchema.index({ country: 1 });
NetworkNodeStatisticsSchema.index({ subversion: 1 });

module.exports = mongoose.model('NetworkNodeStatistics', NetworkNodeStatisticsSchema);
