# History Browser Feature Plan

This document tracks the staged implementation of the History Browser capability in `eiquidus-test`.

## Branch

- Working branch: `history-browser`

## Goal

Allow users to simulate blockchain state at a selected point in time (block height), with consistent filtering, balances, paging, and sorting across relevant pages.

## Phase Breakdown

### Phase 1 (completed)

Add sorting to the **Latest Transactions** table on the main page.

Implemented behavior:

- Clickable sorting on columns:
  - Block
  - Transaction Hash
  - Recipients
  - Amount
  - Timestamp
- First click sorts **descending**, second click sorts **ascending**.
- Sorting is server-side and remains intact when moving between table pages.
- Secondary ordering by `timestamp` is always applied for non-timestamp primary sorts.
- Active sort column is highlighted.
- Sort direction is shown with a small arrow (`▲` / `▼`) next to the active column header.

Implementation details:

- `views/index.pug`
  - Enabled DataTables ordering for selected columns.
  - Enforced descending-first order sequence.
  - Passed selected sort column and direction to backend endpoint.
  - Added active-header highlight and arrow indicator handling.
- `app.js`
  - Extended `/ext/getlasttxs/:min` parsing for internal sort column + direction.
- `lib/database.js`
  - Extended latest tx query methods to accept sort column and direction.
  - Added deterministic server-side sort mapping:
    - Block -> `blockindex`, then `timestamp`
    - Tx Hash -> `txid`, then `timestamp`
    - Recipients -> computed `recipients_count`, then `timestamp`
    - Amount -> `total`, then `timestamp`
    - Timestamp -> `timestamp` (with `blockindex` tie-breaker)
  - Query uses aggregation pipeline to support sorting by recipients count (`$size(vout)`).

Notes:

- Per current plan, no new DB indexes were added in Phase 1.
- Index tuning will be considered after validation testing.
- Follow-up fix: adjusted DataTables `columnDefs` in `views/index.pug` to explicitly disable only non-sortable columns. This corrected a regression where only the timestamp column appeared sortable and header clicks had no effect.
- Follow-up fix: switched latest-transactions sort parsing in `app.js` to read DataTables `order[0][column]` and `order[0][dir]` from query params (with safe fallback). This corrected a regression where UI clicks triggered reloads but backend ordering could be ignored.

### Phase 2a (implemented, pending validation)

Address page accepts `history=xxx` and applies:

- title suffix: ` - History up to Block #xxx`
- transaction list filtered to block `<= xxx`
- pagination preserved
- invalid/non-numeric handling (ignore)
- out-of-range handling (show validation message, keep latest state)

Implementation details:

- `routes/index.js`
  - Extended address route handling to parse `history`.
  - Added validation against current chain height (`stats.count`).
  - Added warning message for out-of-range values while keeping latest state.
  - Added page title suffix for valid history mode.
- `views/address.pug`
  - Appends `?history=...` to internal address tx table requests.
  - Shows title suffix ` - History up to Block #xxx (Mon DD, YYYY HH:mm:ss UTC)` for valid history mode.
  - Shows warning alert when history value is out of range and latest state is shown.
  - Uses historical summary overrides (balance, total sent, total received) when history mode is active.
  - Shows text under balance value: `WARNING! This is a balance from the history up to block #xxx (Mon DD, YYYY HH:mm:ss UTC)`.
- `app.js`
  - Extended `/ext/getaddresstxs/:address/:start/:length` to accept optional `history` query parameter.
- `lib/database.js`
  - Extended `get_address_txs_ajax()` with optional history filter (`blockindex <= history`).
  - Preserved server-side paging/count/running-balance flow on the filtered dataset.

Validation checklist for Phase 2a:

1. Open an address page without `history`; verify default behavior unchanged.
2. Open same address with valid `history` less than latest block; verify:
   - page title includes ` - History up to Block #xxx`
   - tx table excludes newer blocks
   - paging still works across filtered rows
3. Use non-numeric `history` (`abc`); verify latest view loads with no history mode.
4. Use out-of-range `history` (`very large value`); verify warning appears and latest view is shown.

### Phase 2b (pending)

Address summary values become history-aware for `history=xxx`:

- balance at selected historical block
- sent/received consistency with historical transaction window

### Phase 3 (implemented, pending validation)

Create new **History Browser** page with:

- dashboard-style header
- history toggle controls (checkbox, block input, submit, timestamp text)
- latest vs historical state switching
- four top metric blocks
- wallets table and history-aware address links
- retained history controls during paging
- header menu entry

Implementation details:

- `routes/index.js`
  - Added route: `/history-browser`.
  - Handles checkbox mode (`history_enabled=1`) and block input (`history=xxx`).
  - Validates history range and falls back to latest state with warning on invalid values.
  - Uses historical block timestamp (UTC) when history mode is active.
- `views/history_browser.pug`
  - Added page title: `<coin.name> History Browser`.
  - Added control div with checkbox, numeric input, submit button, and timestamp text.
  - Default unchecked mode keeps input + submit disabled and uses latest state.
  - Added top four metric cards: latest block, difficulty, total supply, total transactions.
  - Added wallets DataTable with columns:
    - wallet address (history-aware link to `/address/:hash?history=...` when active)
    - number of transactions
    - wallet balance
    - last transaction to wallet timestamp
    - last transaction from wallet timestamp
  - Retains history state during table page switching.
- `app.js`
  - Added endpoint: `/ext/gethistorywallets/:start/:length`.
  - Supports optional `history` query parameter and internal DataTables payload shape.
- `lib/database.js`
  - Added overview method for latest/historical top metrics.
  - Added wallets aggregation method with optional history filtering.
  - Optimized wallet timestamp calculation using block-height lookups (avoids per-tx joins).
- `views/layout.pug`
  - Added History Browser menu entry in both header menu layouts.
  - Enabled common client scripts for active page id `history-browser`.

Validation checklist for Phase 3:

1. Open `/history-browser`:
   - checkbox is unchecked by default
   - input + submit are disabled
   - input value equals latest block height
   - timestamp text matches Last updated under title
2. Check checkbox:
   - input + submit become enabled
3. Enter valid historical block and submit:
   - top metric cards switch to historical values
   - timestamp text switches to selected block time
   - wallet links include `?history=...`
4. Use table paging in history mode:
   - history mode and values stay intact
5. Submit invalid/out-of-range history:
   - warning is shown
   - page falls back to latest state

### Phase 4 (pending)

Add sortable behavior to History Browser wallets table, aligned with Phase 1 interaction model.

## Validation Checklist For Phase 1

1. Open main page (`/`).
2. Click each sortable header (Block, Tx Hash, Recipients, Amount, Timestamp):
   - first click sorts descending
   - second click sorts ascending
3. Verify active sorted header is highlighted and arrow updates correctly.
4. Move to next table page and confirm selected ordering remains active.
5. Repeat with table auto-reload enabled (if configured) and confirm ordering remains unchanged.
