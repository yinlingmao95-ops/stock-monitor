# 市场监控 · Market Monitor

A static, password-gated stock dashboard for GitHub Pages (no build step).

- **Gauges**: Mag 7 average daily %, VIX, a "momentum" tachometer (SPY move + watchlist breadth), 10Y yield change (bp), Brent daily %.
- **Watchlist**: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, US 10Y yield (`^TNX`), Brent crude (`BZ=F`) with 1D / 1M (21 trading days) / 1Y (252 trading days) change; fastest gainers/losers highlighted. Click a row for a candlestick (K-line) chart, MA20, volume and daily change %.
- **龙虎榜**: today's top gainers / losers / biggest absolute moves among watched instruments.

## Data
1. `data/market.json` — snapshot (2y of daily OHLC) produced by `scripts/fetch_data.py` (Python stdlib, Yahoo Finance chart API). The GitHub Actions workflow `.github/workflows/update-data.yml` refreshes it on a schedule and commits it, so the page always has same-origin data (no CORS issues).
2. The browser then tries live data from Yahoo directly and via public CORS proxies (corsproxy.io, allorigins, codetabs). If all fail, it keeps the snapshot (or the last cached copy in localStorage) and shows a warning.

## Deploy
Push this folder to a public repo → Settings → Pages → Deploy from branch (`main`, root). Make sure Actions have *Read and write* workflow permissions so the snapshot can be committed. Run the workflow once manually via *Actions → Update market data snapshot → Run workflow*.

## Note
The password gate is a client-side check (SHA-256 hash in `app.js`); it keeps casual visitors out but is not real security. Data is for reference only, not investment advice.
