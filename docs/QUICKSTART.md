# Rincoin Dashboard - Quick Start Guide

## What Has Been Implemented

### ✅ Phase 1: Current Data Dashboard
- Dashboard page displaying current blockchain statistics
- No RPC calls required, uses MongoDB only
- Accessible at `/dashboard`

### ✅ Phase 2: Time-Series and Trends
- Per-block statistics collection
- Daily aggregates with charts
- Rolling averages (50, 500, 1500 blocks)
- Incremental aggregation (efficient, no full scans)
- Chart.js integration for visualization

### 📋 Phase 3: Network Crawler (Planned)
- Documentation created
- MongoDB models ready
- Implementation steps documented in `docs/PHASE3_NETWORK_CRAWLER.md`

## Getting Started

### 1. Install Dependencies

The dashboard uses the existing eIquidus dependencies. If you haven't already:

```bash
cd /opt/eiquidus
npm install
```

### 2. Initialize Dashboard Data (Phase 2)

Process historical blocks to enable time-series features:

```bash
# Process last 1500 blocks (recommended)
node scripts/init_dashboard.js

# Or specify a range
node scripts/init_dashboard.js 1000 5000
```

This will:
- Process each block in the range
- Create per-block statistics
- Compute daily aggregates
- Initialize rolling cache

**Note:** This may take 5-30 minutes depending on the block range.

### 3. Start eIquidus

```bash
npm start
```

### 4. Access the Dashboard

Open your browser and navigate to:
```
http://localhost:3001/dashboard
```

(Adjust port if you've configured a different one in settings.json)

## What You'll See

### Phase 1 Features (Always Available)
- Latest block height and hash
- Current difficulty
- Total supply
- Total transaction count

### Phase 2 Features (After Initialization)
- Rolling averages (3 time windows)
- Daily trend charts:
  - Transaction count over time
  - Average block time
  - Blocks per day
  - Total fees

## Integration with Block Sync

### Automatic Updates

To enable automatic dashboard updates when new blocks are synced, add the following to `lib/block_sync.js`:

```javascript
const dashboardSync = require('./dashboard_sync');

// Initialize on startup (add to init function)
dashboardSync.initialize(currentHeight, function(success) {
  if (success) {
    console.log('Dashboard sync initialized');
  }
});

// After syncing each new block (add after block is saved)
dashboardSync.onNewBlock(blockHeight, blockHash, timestamp, function(success) {
  // Dashboard updated
});

// On reorg detection (add to reorg handling)
dashboardSync.onReorg(reorgHeight, function(success) {
  // Dashboard rolled back
});
```

## File Structure

```
/opt/eiquidus/
├── lib/
│   ├── dashboard_aggregation.js  # Aggregation logic
│   ├── dashboard_sync.js         # Block sync hooks
│   └── database.js               # Updated with dashboard functions
├── models/
│   ├── dashboard_block_stats.js  # Per-block model
│   ├── dashboard_daily_stats.js  # Daily aggregates
│   ├── crawler_node.js           # For Phase 3
│   └── crawler_snapshot.js       # For Phase 3
├── routes/
│   └── index.js                  # Dashboard route added
├── views/
│   └── dashboard.pug             # Dashboard UI
├── scripts/
│   └── init_dashboard.js         # Initialization script
└── docs/
    ├── DASHBOARD_README.md       # Full documentation
    ├── PHASE3_NETWORK_CRAWLER.md # Phase 3 guide
    └── QUICKSTART.md            # This file
```

## Common Issues

### "No time-series data available"

**Solution:** Run the initialization script:
```bash
node scripts/init_dashboard.js
```

### Charts not showing

**Possible causes:**
1. Initialization not complete
2. No data in last 7 days
3. JavaScript error (check browser console)

**Solution:** Re-run initialization with wider range:
```bash
node scripts/init_dashboard.js 1 [current_height]
```

### Dashboard not updating with new blocks

**Solution:** Integrate dashboard_sync with block_sync (see above)

## Next Steps

### Recommended
1. ✅ Initialize dashboard with historical data
2. ✅ Test dashboard access
3. 🔄 Integrate with block sync for automatic updates
4. 📋 Implement Phase 3 network crawler (optional)

### Phase 3 Implementation
See `docs/PHASE3_NETWORK_CRAWLER.md` for:
- Forking and modifying Bitnodes crawler
- Configuring trusted nodes
- Network fork detection
- Dashboard integration

## Performance Tips

1. **Initial sync:** Process blocks in batches
   ```bash
   node scripts/init_dashboard.js 1 1000
   node scripts/init_dashboard.js 1001 2000
   # etc.
   ```

2. **Memory:** Rolling cache uses ~50-100MB RAM

3. **Storage:** ~1KB per block in dashboard_block_stats

4. **CPU:** Minimal, only processes on new block (every 60s for Rincoin)

## Customization

### Change Rolling Window Sizes

Edit `lib/dashboard_aggregation.js`:

```javascript
let rollingCache = {
  window50: [],    // Change to window100 for 100 blocks
  window500: [],   // Change to window1000 for 1000 blocks
  window1500: []   // Change to window2000 for 2000 blocks
};
```

Update corresponding functions and dashboard view.

### Add More Charts

Edit `views/dashboard.pug` and add Chart.js charts using the daily data:

```jade
canvas#myNewChart

script.
  new Chart(document.getElementById('myNewChart'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'My Metric',
        data: dailyData.map(d => d.my_field)
      }]
    }
  });
```

## Support & Documentation

- **Full documentation:** `docs/DASHBOARD_README.md`
- **Phase 3 guide:** `docs/PHASE3_NETWORK_CRAWLER.md`
- **eIquidus docs:** Official eIquidus repository

## Summary

✅ **Phase 1 Complete:** Basic dashboard with current data  
✅ **Phase 2 Complete:** Time-series, trends, and charts  
📋 **Phase 3 Planned:** Network crawler and fork detection  
📋 **Phase 4 Optional:** Prometheus integration

The dashboard is ready to use! Initialize the data and start exploring Rincoin blockchain statistics.
