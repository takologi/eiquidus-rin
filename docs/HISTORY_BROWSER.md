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

### Phase 4 (implemented, pending validation)

Add sortable behavior to History Browser wallets table, aligned with Phase 1 interaction model.

Implemented behavior:

- Clickable sorting on columns:
  - Wallet Address
  - Number of Transactions
  - Wallet Balance
  - Last Transaction to Wallet
  - Last Transaction from Wallet
- First click sorts **descending**, second click sorts **ascending**.
- Active sort column is highlighted.
- Sort direction is shown with a small arrow (`▲` / `▼`).
- Sorting remains server-side and persists through paging in DataTables internal mode.
- History mode (`history=...`) remains intact while sorting/paging.

Implementation details:

- `views/history_browser.pug`
  - Enabled DataTables ordering with descending-first order sequence.
  - Preserved DataTables query parameters in ajax `beforeSend` so sort choices are forwarded.
  - Added active-header highlight and direction arrow updates.
- `app.js`
  - Extended `/ext/gethistorywallets/:start/:length` to parse DataTables `order[0][column]` and `order[0][dir]` (nested and bracket-key formats).
  - Passed parsed ordering into DB layer.
- `lib/database.js`
  - Extended `get_history_wallets()` with sort column + direction args.
  - Added server-side sort mapping for all wallets-table columns.
  - Added deterministic secondary ordering via `last_activity_block` for non-activity-primary sorts.
  - Added robust string sort key for wallet addresses (`address_sort`).

Validation checklist for Phase 4:

1. Open `/history-browser` in latest mode.
2. Click each wallets-table header:
   - first click sorts descending
   - second click sorts ascending
3. Verify active sorted header highlight and arrow update.
4. Move to next table page and confirm selected ordering remains active.
5. Enable history mode and submit a valid historical block:
   - repeat sorting checks and confirm order remains correct
   - confirm `history` mode remains active while paging/sorting

### Phase 5 (implemented, pending validation)

Add wallets-table columns:

- `Deposited` (before `Balance`)
- `Withdrawn` (after `Balance`)

Implemented behavior:

- Both columns are computed per wallet up to the currently active height:
  - latest mode -> all synced history
  - history mode -> `blockindex <= history`
- `Deposited` sums positive wallet deltas.
- `Withdrawn` sums absolute value of negative wallet deltas.
- Both columns are sortable with the same desc-first/asc-second behavior.
- Existing user-customized table labels remain unchanged.

Implementation details:

- `lib/database.js`
  - Extended `get_history_wallets()` aggregation to compute `deposited` and `withdrawn` in the grouped wallet row.
  - Added sort mapping for the new columns.
- `app.js`
  - Extended `/ext/gethistorywallets/:start/:length` response payload for both internal and public output.
- `views/history_browser.pug`
  - Added `Deposited` and `Withdrawn` table headers and render formatting.
  - Updated DataTables sort column indexes and default balance sort index.

Index note:

- No new index was required for Phase 5.
- Existing `addresstxes` compound index on `(blockindex, a_id, amount)` already supports the filtered aggregation path used by this page.

### Phase 6 (implemented)

Scope:

- Fix History Browser difficulty showing as zero in historical mode.
- Add new `coin.decimals` setting to control displayed decimal precision for price/balance/value outputs.

Implemented behavior:

- History difficulty fallback order now resolves more robustly:
  1. `dashboard_block_stats.difficulty` if non-zero
  2. `networkhistory` at/under selected height with POW/POS cross-fallback
  3. RPC `getblock` difficulty for the selected historical block hash
- New `coin.decimals` setting:
  - `-1` or unset => keep legacy display behavior per page
  - `0..8` => force fixed decimal digits to that value (rounded and zero-padded)
  - `>8` => clamped to `8`
- Display formatting only is affected; underlying calculations continue to use full precision values.

Implementation details:

- `lib/database.js`
  - Enhanced `get_history_browser_overview()` difficulty resolution logic with block-level RPC fallback.
- `lib/settings.js`
  - Added default `coin.decimals` and loader sanitization/clamping.
- `settings.json.template` / `settings.json`
  - Added documented `coin.decimals` setting.
- `views/includes/common.pug`
  - Added shared display format helpers honoring `coin.decimals`.
- `views/layout.pug`, `views/history_browser.pug`, `views/address.pug`, `views/index.pug`, `views/movement.pug`
  - Wired key displayed price/balance/value formatting to the shared helper and safe zero-decimal rendering.

Follow-up updates:

- Applied alignment behavior for displayed numeric table values:
  - `coin.decimals` set (`0..8`) => right-aligned (`.text-end`)
  - `coin.decimals` unset or `-1` => centered (`.text-center`)
- Configuration sync correction:
  - Added `coin.decimals` entries to `settings.json` and `settings.json.template` files (JSON configs) in both test and production projects.

## Validation Checklist For Phase 1

1. Open main page (`/`).
2. Click each sortable header (Block, Tx Hash, Recipients, Amount, Timestamp):
   - first click sorts descending
   - second click sorts ascending
3. Verify active sorted header is highlighted and arrow updates correctly.
4. Move to next table page and confirm selected ordering remains active.
5. Repeat with table auto-reload enabled (if configured) and confirm ordering remains unchanged.
