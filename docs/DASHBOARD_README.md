# Rincoin Dashboard Documentation

## Overview

The Rincoin Dashboard is a comprehensive blockchain monitoring system built on top of eIquidus (note: folder name is "elquidus"). It provides real-time and historical blockchain statistics similar to Clark Moody Dashboard, but focused on blockchain data only (no market data).

## Architecture

### Database Collections

#### Existing eIquidus Collections (used by Dashboard)
- `coinstats` - Overall blockchain statistics
- `Tx` - Transaction data with block references
- `blocks` - Block data (if available)
- `addresses` - Address balances and activity

#### New Dashboard Collections

**dashboard_block_stats** (Phase 2)
- One document per block (append-only, source of truth)
- Fields: height, time, block_interval, tx_count, block_size, fees, difficulty, hash
- Purpose: Historical per-block data for time-series analysis

**dashboard_daily_stats** (Phase 2)
- One document per day
- Fields: date, blocks, tx_count_total, avg_block_time, avg_block_size, issuance, fees_total
- Purpose: Daily aggregates for trend analysis

**crawler_nodes** (Phase 3)
- Network node information from P2P crawler
- Fields: address, last_seen, version, services, height, top_hash, is_trusted, peer_list
- Purpose: Network-wide node monitoring

**crawler_snapshots** (Phase 3)
- Periodic snapshots of network state
- Fields: timestamp, total_nodes, avg_height, version_distribution, potential_forks
- Purpose: Network health monitoring and fork detection

## Implementation Phases

### Phase 1: Current Data Dashboard ✅

**Status: Complete**

**Features:**
- Dashboard page at `/dashboard`
- Current blockchain metrics from MongoDB
- No RPC calls required
- Displays:
  - Latest block height and hash
  - Current difficulty
  - Total supply
  - Total transaction count
  - Recent block statistics (last 10 blocks)
  - Average block interval
  - Average transaction count

**Files:**
- `routes/index.js` - Dashboard route handler
- `views/dashboard.pug` - Dashboard UI
- `lib/database.js` - Database query functions
- `models/stats.js` - Stats model (existing)

### Phase 2: Time-Series and Trends ✅

**Status: Complete**

**Features:**
- Per-block statistics collection
- Daily aggregates
- Rolling averages (50, 500, 1500 blocks)
- Incremental aggregation (no full blockchain scans)
- Reorg-safe updates
- Interactive charts using Chart.js

**Components:**

1. **Data Collection**
   - `lib/dashboard_aggregation.js` - Core aggregation logic
   - `lib/dashboard_sync.js` - Integration with block sync
   - `models/dashboard_block_stats.js` - Per-block stats model
   - `models/dashboard_daily_stats.js` - Daily aggregates model

2. **Aggregation Strategy**
   - Triggered on new block detection
   - Maintains rolling window cache (arrays for 50/500/1500 blocks)
   - Arrays only for caching; database is source of truth
   - Incremental updates using rolling sums

3. **Dashboard Display**
   - Rolling averages section
   - Daily trend charts:
     - Transaction count
     - Average block time
     - Blocks per day
     - Total fees
   - Chart.js for visualization

**Initialization:**
```bash
# Process historical blocks to populate dashboard data
node scripts/init_dashboard.js [start_height] [end_height]

# Default: processes last 1500 blocks
node scripts/init_dashboard.js
```

### Phase 3: Network Crawler Integration 📋

**Status: Planned**

**Features:**
- Standalone P2P network crawler
- Based on Bitnodes, modified for Rincoin
- Monitors all reachable nodes
- Trusted nodes configuration
- Fork detection and warnings

**Implementation Steps:**

1. **Fork Bitnodes Crawler**
   ```bash
   git clone https://github.com/ayeowch/bitnodes.git rincoin-crawler
   cd rincoin-crawler
   # Modify for Rincoin:
   # - Network magic bytes
   # - Default port
   # - DNS seeds
   # - MongoDB connection
   ```

2. **Configure Trusted Nodes**
   Add to `settings.json`:
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
         "crawl_interval": 300,
         "fork_threshold": 0.1
       }
     }
   }
   ```

3. **Dashboard Integration**
   - Display network node count
   - Version distribution
   - Average network height
   - Fork warnings
   - Network topology (optional)

**See:** `docs/PHASE3_NETWORK_CRAWLER.md` for detailed documentation

### Phase 4: Prometheus Integration 📋

**Status: Optional/Future**

**Features:**
- Prometheus metrics from trusted nodes
- Combined with crawler data
- Layered monitoring:
  - Trusted nodes: authoritative metrics
  - P2P crawler: observational trends
- Real-time alerting

## Usage

### Starting the Dashboard

The dashboard is integrated into eIquidus and starts with the main application:

```bash
npm start
```

Visit: `http://localhost:3001/dashboard`

### Initializing Time-Series Data

Before Phase 2 features are available, you must process historical blocks:

```bash
# Process last 1500 blocks (recommended minimum)
node scripts/init_dashboard.js

# Process specific range
node scripts/init_dashboard.js 1000 2000

# Process entire blockchain (may take hours!)
node scripts/init_dashboard.js 1
```

### Monitoring Dashboard Status

The dashboard will display a notice if time-series data is not available. Once initialized, rolling averages and charts will automatically appear.

## Integration with Block Sync

### Automatic Updates

The dashboard is designed to automatically update when new blocks are synced. Integration points:

1. **Block Sync Hook**
   - `lib/block_sync.js` should call `dashboardSync.onNewBlock()`
   - Triggers aggregation for new blocks

2. **Reorg Handling**
   - `lib/block_sync.js` should call `dashboardSync.onReorg()`
   - Rolls back dashboard data

**Example Integration** (add to `lib/block_sync.js`):

```javascript
const dashboardSync = require('./dashboard_sync');

// After syncing a new block:
dashboardSync.onNewBlock(blockHeight, blockHash, timestamp, function(success) {
  if (success) {
    console.log('Dashboard updated');
  }
});

// On reorg detection:
dashboardSync.onReorg(reorgHeight, function(success) {
  if (success) {
    console.log('Dashboard rolled back');
  }
});
```

## Performance Considerations

### Query Optimization

1. **Indexes**
   - All collections have appropriate indexes on height/timestamp
   - MongoDB aggregation pipelines optimized

2. **Caching**
   - Rolling window cache in memory
   - Reduces database queries for recent data
   - Invalidated on reorg

3. **Incremental Updates**
   - No full blockchain scans after initialization
   - Only new blocks trigger aggregation
   - Daily stats updated incrementally

### Resource Usage

- **Memory**: ~50-100MB for rolling cache (1500 blocks)
- **Disk**: ~1KB per block in dashboard_block_stats
- **CPU**: Minimal, only on new block (60s interval for Rincoin)

## Reorg Safety

### Detection Strategy

1. **Primary (Authoritative)**
   - Monitor trusted nodes (Phase 3)
   - Definitive reorg detection

2. **Secondary (Observational)**
   - P2P crawler divergence signals (Phase 3)
   - Early warning only

### Recovery Process

1. Detect reorg at height N
2. Delete dashboard_block_stats where height > N
3. Recalculate affected daily stats
4. Reinitialize rolling cache from height N
5. Resume normal operation

## API Endpoints

### Current Data
```
GET /dashboard
```
Returns rendered dashboard page

### Future API Endpoints (optional)

```
GET /api/dashboard/current
GET /api/dashboard/rolling/:window
GET /api/dashboard/daily/:start/:end
GET /api/dashboard/network
```

## Configuration

### Enabling Dashboard

The dashboard is enabled by default. To disable, add to `settings.json`:

```json
{
  "dashboard": {
    "enabled": false
  }
}
```

### Window Sizes

Default rolling averages:
- 50 blocks (~50 minutes)
- 500 blocks (~8.3 hours)
- 1500 blocks (~25 hours)

To customize, modify `lib/dashboard_aggregation.js`:

```javascript
let rollingCache = {
  window50: [],   // Customize size
  window500: [],
  window1500: []
};
```

## Troubleshooting

### Dashboard Shows No Time-Series Data

**Solution:** Run initialization script:
```bash
node scripts/init_dashboard.js
```

### Charts Not Appearing

**Causes:**
1. Time-series data not initialized
2. No data for last 7 days
3. JavaScript error (check browser console)

### Aggregation Falling Behind

**Causes:**
1. Block sync very fast
2. Database overloaded

**Solution:** Aggregation runs async; may lag slightly during fast sync. Will catch up.

### Reorg Not Detected

**Cause:** Dashboard sync not integrated with block sync

**Solution:** Add `dashboardSync.onReorg()` calls to `lib/block_sync.js`

## File Structure

```
/opt/elquidus/
├── lib/
│   ├── dashboard_aggregation.js  # Core aggregation logic
│   ├── dashboard_sync.js         # Block sync integration
│   └── database.js               # Database functions (updated)
├── models/
│   ├── dashboard_block_stats.js  # Per-block stats model
│   ├── dashboard_daily_stats.js  # Daily aggregates model
│   ├── crawler_node.js           # Network node model (Phase 3)
│   └── crawler_snapshot.js       # Network snapshot model (Phase 3)
├── routes/
│   └── index.js                  # Dashboard route (updated)
├── views/
│   └── dashboard.pug             # Dashboard UI
├── scripts/
│   └── init_dashboard.js         # Initialization script
└── docs/
    ├── DASHBOARD_README.md       # This file
    └── PHASE3_NETWORK_CRAWLER.md # Phase 3 documentation
```

## Development Roadmap

### Completed
- ✅ Phase 1: Current data dashboard
- ✅ Phase 2: Time-series and trends

### In Progress
- 🔄 Integration with block sync

### Planned
- 📋 Phase 3: Network crawler
- 📋 Phase 4: Prometheus integration
- 📋 Geographic node distribution
- 📋 Network topology visualization
- 📋 Historical network growth charts

## Contributing

When adding features to the dashboard:

1. Maintain reorg safety
2. Use incremental aggregation (avoid full scans)
3. Index all query fields in MongoDB
4. Update this documentation
5. Add appropriate error handling

## Support

For issues or questions:
1. Check this documentation
2. Review Phase 3 documentation for network crawler
3. Check eIquidus documentation for base functionality

## License

Same as eIquidus base project.
