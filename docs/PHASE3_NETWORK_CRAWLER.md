# Network Crawler Integration - Phase 3

## Overview

Phase 3 integrates a P2P network crawler to monitor the Rincoin network and detect potential chain divergences and network-wide metrics.

## Architecture

### Standalone Crawler
- Based on Bitnodes crawler: https://github.com/ayeowch/bitnodes
- Modified for Rincoin: network magic, default port, DNS seeds
- Runs as separate process, not tightly integrated with eIquidus
- Stores results in MongoDB collections accessible by dashboard

### MongoDB Collections

#### crawler_nodes
```javascript
{
  address: String,        // IP:Port
  last_seen: Number,      // Unix timestamp
  version: String,        // Node version
  services: Number,       // Service flags
  height: Number,         // Reported block height
  top_hash: String,       // Top block hash
  is_trusted: Boolean,    // Is this a trusted node
  peer_list: Array        // List of peers this node knows
}
```

#### crawler_snapshots
```javascript
{
  timestamp: Number,      // Unix timestamp
  total_nodes: Number,    // Total reachable nodes
  avg_height: Number,     // Average reported height
  max_height: Number,     // Maximum reported height
  min_height: Number,     // Minimum reported height
  version_distribution: Object,  // {version: count}
  potential_forks: Array  // List of detected divergences
}
```

## Integration Points

### 1. Crawler Setup
- Fork Bitnodes repository
- Modify for Rincoin parameters:
  - Network magic bytes
  - Default P2P port (typically 9999 or similar for Rincoin)
  - DNS seed nodes
  - Version message formatting

### 2. Trusted Nodes
- Configure 3 trusted nodes in settings
- These nodes are always included in crawler targets
- Their data is weighted higher for consensus detection

### 3. Data Collection
- Crawler runs continuously
- Connects to all reachable nodes
- Collects:
  - Version information
  - Block height
  - Top block hash
  - Peer lists for network topology
- Stores data in MongoDB

### 4. Dashboard Integration
- Add network statistics to dashboard
- Display:
  - Total reachable nodes
  - Average network height
  - Version distribution pie chart
  - Detected divergences/forks
  - Network topology visualization (optional)

### 5. Fork Detection
- Compare top block hashes across nodes
- If >10% of nodes report different hash at same height:
  - Flag as potential fork
  - Display warning on dashboard
  - Log event for investigation

## Implementation Steps

### Step 1: Fork and Modify Bitnodes
```bash
git clone https://github.com/ayeowch/bitnodes.git rincoin-crawler
cd rincoin-crawler
# Modify protocol.py for Rincoin
# Update DNS seeds
# Configure MongoDB connection
```

### Step 2: Create MongoDB Models
- See models/crawler_nodes.js
- See models/crawler_snapshots.js

### Step 3: Create Crawler Service
- Standalone Node.js or Python script
- Runs independently of eIquidus
- Writes to shared MongoDB

### Step 4: Update Dashboard
- Add network crawler data queries
- Display network-wide metrics
- Add fork detection warnings

## Configuration

### settings.json additions
```json
{
  "dashboard": {
    "network_crawler": {
      "enabled": true,
      "trusted_nodes": [
        "192.168.1.100:9999",
        "192.168.1.101:9999",
        "192.168.1.102:9999"
      ],
      "crawl_interval": 300,  // seconds
      "fork_threshold": 0.1   // 10% divergence triggers warning
    }
  }
}
```

## Distinguishing Observational vs Authoritative

### Trusted Nodes (Authoritative)
- Used for definitive chain state
- Source of truth for reorg detection
- High reliability expected

### P2P Crawler (Observational)
- Indicates network-wide trends
- Signals potential issues
- Not used for definitive reorg detection
- Helps identify minority forks

## Reorg Detection Strategy

### Primary (Authoritative)
- Monitor trusted nodes' top block hash
- If trusted nodes change top hash at height N:
  - Likely reorg occurred
  - Update dashboard aggregates
  - Roll back affected data

### Secondary (Observational)
- P2P crawler shows divergence
- Used as early warning signal
- Prompts investigation
- Not automatic trigger for data changes

## Security Considerations

1. Validate all data from untrusted nodes
2. Rate limit connections to prevent DoS
3. Sanitize peer lists before storage
4. Monitor for eclipse attacks
5. Cross-reference with trusted nodes

## Performance Considerations

1. Crawler runs as separate process
2. MongoDB aggregation for network statistics
3. Cache recent crawler snapshots
4. Limit peer list storage (max 100 per node)
5. Archive old crawler data (>30 days)

## Future Enhancements (Phase 4)

- Prometheus integration for trusted nodes
- Real-time alerting on divergences
- Network topology visualization
- Historical network growth charts
- Geographic distribution of nodes
