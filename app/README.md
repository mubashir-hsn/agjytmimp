# Wind Forecast Monitor (UK day-ahead buying)

React (Vite + Recharts) frontend, Python (FastAPI) backend, Docker. **AI tools (Claude) were used to help build this.**

## Run

`docker compose up --build` → http://localhost:3000 (first load downloads Jan 2026 data from Elexon, ~1 min, then cached in a volume).
Local dev: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`; `cd frontend && npm i && npm run dev`.

## Layout

- `backend/app/main.py` – Elexon client + cache, decision-time forecast selection, accuracy metrics, API (`/api/meta`, `/api/decision`, `/api/accuracy`)
- `frontend/src/App.jsx` – Decision view and Accuracy view; `frontend/nginx.conf` proxies `/api` to the backend
- `docker-compose.yml` – both services

## Key logic / assumptions

- Data: FUELHH (fuelType=WIND) actuals, WINDFOR forecasts only. Decisions on each day of Jan 2026 → delivery next day.
- **Decision-time forecast** = for each half-hour of the delivery day, the latest forecast with `publishTime` ≤ cut-off on the decision day (default 09:00 UTC, ≈ GB day-ahead gate closure; editable in UI). Never uses forecasts published later.
- Error = forecast − actual (+ve = over-forecast = shortfall risk). Metrics: MAE, RMSE, bias, MAE % of mean actual, P90 over/under-forecast; breakdowns by day, hour, forecast horizon, plus histogram.
- P10–P90 band = forecast shifted by empirical error quantiles from _earlier_ days only (falls back to full-month, flagged in-sample, for the first days).

## Deployment

Frontend → Vercel (set `VITE_API` to backend URL + `/api`); backend → Heroku/Render with `backend/Dockerfile`. Link: _add here_.
