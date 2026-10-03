# Market History & Pricing Notes

This document summarizes the market-history and market-price behavior currently used by this workspace.

## 1) Market history source of truth

- `node scripts/sync.js market-history` collects sampled market data every run.
- The collector now upserts directly into `historical_market_5m` using a unique key:
  - `(market, coin_symbol, pair_symbol, timestamp)`
- Timestamp is normalized to 5-minute buckets.
- This makes the data path cron-safe and idempotent (no duplicate candles for same bucket).

### Cron recommendation

Run market-history every 5 minutes:

- `*/5 * * * * cd /path/to/explorer && /usr/bin/node scripts/sync.js market-history > /dev/null 2>&1`

## 2) Market page history sources

Market page history is loaded from:

1. `historical_market_5m` (short ranges)
2. `historical_market_hourly` (mid ranges)
3. `historical_market_daily` (long ranges)

Snapshot fallback dependency was removed from the market route for chart rendering in this workspace.

## 3) `markets_page.market_price = "AVERAGE"` formula

### Exchange-average step (same quote currency)

For each quote currency (for example `USDT`), exchange prices are averaged arithmetically:

$$
P_{quote} = \frac{1}{N}\sum_{i=1}^{N} p_i
$$

Where:
- $N$ = number of enabled exchanges for that quote currency
- $p_i$ = each exchange `summary.last`

This is **not volume-weighted**.

### If all markets already use the default quote currency

When every enabled market pair is already in the default quote currency
(e.g. all are `RIN/USDT` and default pair is `RIN/USDT`), the final `last_price`
is set directly from the local arithmetic mean above, without external conversion.

### Cross-currency conversion case

If multiple quote currencies are used (e.g. BTC + USDT), CoinGecko is used to convert each quote currency into the default quote currency before combining.

## 4) API resiliency fix

CoinGecko requests now send a descriptive `User-Agent` header to satisfy current API policy and avoid rejected requests during market price updates.

## 5) Fallback behavior if conversion API fails

If conversion fails in `AVERAGE` mode:
- `last_price` falls back to direct arithmetic mean from collected exchange prices.
- `last_usd_price` is set from fallback when default quote is USD-stable (`USD`, `USDT`, `USDC`, `BUSD`, `DAI`, `TUSD`, `USDP`, `FDUSD`, `USDE`), otherwise it keeps the previous value.

This prevents homepage price from stalling when conversion APIs are temporarily unavailable.
