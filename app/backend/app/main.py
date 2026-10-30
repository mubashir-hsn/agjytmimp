"""Wind forecast vs actual API (Elexon FUELHH + WINDFOR). All times UTC (= UK time in January)."""
import os, json, datetime as dt
from functools import lru_cache
from pathlib import Path
import httpx, numpy as np, pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
CACHE = Path(os.getenv("CACHE_DIR", "/tmp/cache")); CACHE.mkdir(parents=True, exist_ok=True)
# Decisions made on every day of Jan 2026 -> delivery day = decision day + 1
FIRST, LAST = dt.date(2026, 1, 1), dt.date(2026, 1, 31)
DEFAULT_CUTOFF = os.getenv("DEFAULT_CUTOFF", "09:00")  # approx. GB day-ahead gate closure

app = FastAPI(title="Wind Forecast Monitor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def _get(path, params, name):
    f = CACHE / f"{name}.json"
    if f.exists(): return json.loads(f.read_text())
    r = httpx.get(f"{BASE}/{path}/stream", params={**params, "format": "json"}, timeout=60)
    r.raise_for_status(); data = r.json(); f.write_text(json.dumps(data)); return data

def _chunks(a, b, days):
    while a < b:
        yield a, min(a + dt.timedelta(days=days), b); a += dt.timedelta(days=days)

@lru_cache(1)
def load():
    act, fc = [], []
    for a, b in _chunks(FIRST, LAST + dt.timedelta(days=2), 7):
        act += _get("FUELHH", {"settlementDateFrom": a.isoformat(), "settlementDateTo": b.isoformat(),
                               "fuelType": "WIND"}, f"act_{a}")
    for a, b in _chunks(FIRST - dt.timedelta(days=3), LAST + dt.timedelta(days=1), 3):
        fc += _get("WINDFOR", {"publishDateTimeFrom": f"{a}T00:00:00Z", "publishDateTimeTo": f"{b}T00:00:00Z"}, f"fc_{a}")
    A = pd.DataFrame(act); F = pd.DataFrame(fc)
    if A.empty or F.empty: raise RuntimeError("Elexon returned no data")
    A = A[A.fuelType == "WIND"] if "fuelType" in A else A
    A["startTime"] = pd.to_datetime(A.startTime, utc=True)
    A = A.drop_duplicates("startTime").set_index("startTime").generation.rename("actual")
    F["startTime"] = pd.to_datetime(F.startTime, utc=True); F["publishTime"] = pd.to_datetime(F.publishTime, utc=True)
    F = F[["startTime", "publishTime", "generation"]].rename(columns={"generation": "forecast"})
    F["horizon_h"] = (F.startTime - F.publishTime).dt.total_seconds() / 3600
    return A, F.drop_duplicates(["startTime", "publishTime"])

def _cut(date, cutoff):
    return pd.Timestamp(f"{date}T{cutoff}:00Z")

def decision_frame(date: dt.date, cutoff: str):
    """Latest forecast per half-hour of delivery day (date+1) published <= cutoff on `date`."""
    A, F = load(); c = _cut(date, cutoff)
    d0 = pd.Timestamp(date, tz="UTC") + pd.Timedelta(days=1)
    f = F[(F.publishTime <= c) & (F.startTime >= d0) & (F.startTime < d0 + pd.Timedelta(days=1))]
    f = f.sort_values("publishTime").groupby("startTime").last().reset_index()
    f["actual"] = f.startTime.map(A); f["error"] = f.forecast - f.actual  # +ve = over-forecast = shortfall risk
    f["decision_date"] = date
    return f

@lru_cache(8)
def history(cutoff):
    days = [FIRST + dt.timedelta(days=i) for i in range((LAST - FIRST).days + 1)]
    return pd.concat([decision_frame(d, cutoff) for d in days], ignore_index=True)

def metrics(e, actual):
    e = e.dropna()
    if e.empty: return {}
    return {"n": int(len(e)), "mae": e.abs().mean(), "rmse": float(np.sqrt((e**2).mean())), "bias": e.mean(),
            "mae_pct_of_mean_actual": 100 * e.abs().mean() / actual.mean(),
            "p90_over_forecast": e.quantile(.9), "p90_under_forecast": -e.quantile(.1)}

def clean(o):
    return json.loads(pd.io.json.ujson_dumps(o) if False else json.dumps(o, default=lambda x: None if pd.isna(x) else (x.isoformat() if hasattr(x, "isoformat") else float(x))).replace("NaN", "null"))

@app.get("/api/meta")
def meta():
    return {"first_decision_date": FIRST, "last_decision_date": LAST, "default_cutoff": DEFAULT_CUTOFF}

@app.get("/api/decision")
def decision(date: dt.date, cutoff: str = DEFAULT_CUTOFF):
    if not FIRST <= date <= LAST: raise HTTPException(400, "date outside Jan 2026")
    try: f = decision_frame(date, cutoff); H = history(cutoff)
    except Exception as ex: raise HTTPException(502, f"Elexon data error: {ex}")
    past = H[(H.decision_date < date)].error.dropna()
    in_sample = len(past) < 96  # < 2 days of history -> fall back to full-month errors
    errs = H.error.dropna() if in_sample else past
    q10, q90 = errs.quantile(.1), errs.quantile(.9)
    f["p10"], f["p90"] = f.forecast - q90, f.forecast - q10  # 80% band on actual wind
    s = {"delivery_date": date + dt.timedelta(days=1), "cutoff_utc": _cut(date, cutoff), "mean_forecast_mw": f.forecast.mean(),
         "min_forecast_mw": f.forecast.min(), "max_forecast_mw": f.forecast.max(), "latest_publish_time": f.publishTime.max(),
         "oldest_publish_time": f.publishTime.min(), "periods": len(f), "band_in_sample": in_sample,
         "risk_adjusted_mean_mw": f.p10.mean(), "day_metrics": metrics(f.error, f.actual.dropna())}
    return clean({"summary": s, "rows": f.drop(columns=["decision_date"]).to_dict("records")})

@app.get("/api/accuracy")
def accuracy(cutoff: str = DEFAULT_CUTOFF):
    try: H = history(cutoff); _, F = load()
    except Exception as ex: raise HTTPException(502, f"Elexon data error: {ex}")
    A, _ = load(); H = H.dropna(subset=["actual"]).copy()
    H["hour"] = H.startTime.dt.hour
    daily = [{"decision_date": d, **metrics(g.error, g.actual)} for d, g in H.groupby("decision_date")]
    hourly = [{"hour": h, "mae": g.error.abs().mean(), "bias": g.error.mean()} for h, g in H.groupby("hour")]
    X = F.copy(); X["actual"] = X.startTime.map(A); X = X.dropna(subset=["actual"])
    X = X[(X.startTime >= "2026-01-01") & (X.startTime < "2026-02-01") & (X.horizon_h >= 0) & (X.horizon_h <= 48)]
    X["bucket"] = (X.horizon_h // 6 * 6).astype(int); X["error"] = X.forecast - X.actual
    horizon = [{"horizon_h": f"{b}-{b+6}h", "mae": g.error.abs().mean(), "bias": g.error.mean()} for b, g in X.groupby("bucket")]
    hist, edges = np.histogram(H.error, bins=20)
    dist = [{"bin": float(edges[i]), "count": int(hist[i])} for i in range(len(hist))]
    return clean({"overall": metrics(H.error, H.actual), "daily": daily, "hourly": hourly, "horizon": horizon, "error_hist": dist})

@app.get("/api/health")
def health(): return {"ok": True}
