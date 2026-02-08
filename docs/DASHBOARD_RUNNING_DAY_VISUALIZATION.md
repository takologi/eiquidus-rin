# Dashboard Running Day Visualization

## Overview
Enhanced the dashboard charts to visually distinguish the current incomplete day (running day) from complete historical days.

## Changes Made

### Visual Indicators
1. **Bar Charts** (Transaction Count, Block Rewards, Blocks per Day):
   - Last bar is hatched with diagonal lines when it represents today
   - Uses a lighter fill with diagonal pattern overlay
   
2. **Line Charts** (Transaction Value, Fees, Block Time):
   - Last segment is dotted when it represents today
   - Uses `borderDash: [5, 5]` for the dotted line effect
   - Data is split into two datasets: complete days (solid) and running day (dotted)

### Implementation Details

#### Detection Logic
```javascript
const today = new Date().toISOString().split('T')[0];
const lastDataDate = dailyData[dailyData.length - 1].date;
const isLastDayRunning = lastDataDate === today;
```

#### Hatch Pattern Function
A helper function `createHatchPattern(color)` creates a diagonal hatch pattern for bar charts:
- Creates a 10x10 pixel canvas pattern
- Fills with 30% opacity of the original color
- Overlays diagonal lines in the original color
- Returns a repeatable canvas pattern

#### Line Chart Implementation
For line charts, data is split into two datasets when a running day is detected:
1. Complete days: Solid line with all historical data except the last point
2. Running day: Dotted line connecting the second-to-last point to the last point

### Benefits
- **Clear Visual Distinction**: Users can immediately see which data is complete vs. provisional
- **Professional Appearance**: Follows common data visualization best practices
- **Non-Intrusive**: The pattern doesn't interfere with readability
- **Automatic**: No configuration needed - automatically detects the running day

### Files Modified
- `/opt/eiquidus/views/dashboard.pug`
- `/opt/eiquidus-test/views/dashboard.pug`

### Testing
To see the effect:
1. Start the explorer: `npm start`
2. Visit the dashboard: `http://localhost:3001/dashboard`
3. Observe the last bar/line segment on each chart - it will be hatched/dotted if it represents today

### Technical Notes
- Pattern detection is based on comparing the last data point's date to today's date (ISO format)
- The hatch pattern uses Canvas API to create the diagonal line pattern
- Line charts use Chart.js's `borderDash` property for dotted lines
- Multiple datasets are used for line charts to seamlessly transition from solid to dotted
