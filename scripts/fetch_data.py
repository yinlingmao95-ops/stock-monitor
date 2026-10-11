#!/usr/bin/env python3
"""Fetch daily OHLC from Yahoo Finance chart API and write data/market.json (stdlib only)."""
import json, time, urllib.request, datetime, os, sys

SYMBOLS = ["AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","^TNX","BZ=F","^VIX","SPY"]
UA = {"User-Agent": "Mozilla/5.0"}

def fetch(sym):
    q = urllib.request.quote(sym)
    for host in ("query1", "query2"):
        url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{q}?range=2y&interval=1d"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                j = json.load(r)
            res = j["chart"]["result"][0]
            ts = res["timestamp"]; qd = res["indicators"]["quote"][0]
            candles = []
            for i, t in enumerate(ts):
                o, h, l, c = qd["open"][i], qd["high"][i], qd["low"][i], qd["close"][i]
                if None in (o, h, l, c): continue
                candles.append([t, round(o, 4), round(h, 4), round(l, 4), round(c, 4), qd["volume"][i] or 0])
            m = res["meta"]
            return {"symbol": sym, "currency": m.get("currency"), "price": m.get("regularMarketPrice"),
                    "marketTime": m.get("regularMarketTime"), "candles": candles}
        except Exception as e:
            print(f"{sym} via {host} failed: {e}", file=sys.stderr)
            time.sleep(1)
    return None

out = {"generated": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).replace(microsecond=0).isoformat() + "Z", "quotes": {}}
for s in SYMBOLS:
    d = fetch(s)
    if d: out["quotes"][s] = d
    time.sleep(0.4)
if not out["quotes"]:
    sys.exit("no data fetched")
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "market.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"wrote {len(out['quotes'])} symbols -> {path}")
