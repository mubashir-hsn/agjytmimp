import { useEffect, useState } from "react";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
const API = import.meta.env.VITE_API || "/api";
const get = (p) =>
  fetch(API + p).then((r) =>
    r.ok ? r.json() : r.json().then((e) => Promise.reject(e.detail || "error")),
  );
const n = (v, d = 0) =>
  v == null
    ? "–"
    : Number(v).toLocaleString("en-GB", { maximumFractionDigits: d });
const hhmm = (s) => new Date(s).toISOString().slice(11, 16);
const Kpi = ({ l, v, u, hint }) => (
  <div
    style={{
      background: "#f4f6f8",
      borderRadius: 8,
      padding: 12,
      minWidth: 150,
    }}
  >
    <div style={{ fontSize: 12, color: "#566" }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 600 }}>
      {v} <span style={{ fontSize: 12 }}>{u}</span>
    </div>
    {hint && <div style={{ fontSize: 11, color: "#778" }}>{hint}</div>}
  </div>
);
const Row = ({ children }) => (
  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "12px 0" }}>
    {children}
  </div>
);
const Box = ({ title, children }) => (
  <div style={{ margin: "16px 0" }}>
    <h3 style={{ margin: "0 0 6px" }}>{title}</h3>
    <ResponsiveContainer width="100%" height={280}>
      {children}
    </ResponsiveContainer>
  </div>
);

export default function App() {
  const [meta, setMeta] = useState(null),
    [date, setDate] = useState("2026-01-15"),
    [cutoff, setCutoff] = useState("09:00");
  const [tab, setTab] = useState("decision"),
    [reveal, setReveal] = useState(false),
    [dec, setDec] = useState(null),
    [acc, setAcc] = useState(null),
    [err, setErr] = useState("");
  useEffect(() => {
    get("/meta")
      .then((m) => {
        setMeta(m);
        setCutoff(m.default_cutoff);
      })
      .catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => {
    setErr("");
    setDec(null);
    get(`/decision?date=${date}&cutoff=${cutoff}`)
      .then(setDec)
      .catch((e) => setErr(String(e)));
  }, [date, cutoff]);
  useEffect(() => {
    setAcc(null);
    get(`/accuracy?cutoff=${cutoff}`)
      .then(setAcc)
      .catch((e) => setErr(String(e)));
  }, [cutoff]);
  const rows = dec?.rows.map((r) => ({
    ...r,
    t: hhmm(r.startTime),
    band: [r.p10, r.p90],
    actual: reveal ? r.actual : null,
  }));
  const s = dec?.summary,
    o = acc?.overall;
  return (
    <div
      style={{
        fontFamily: "system-ui",
        maxWidth: 1100,
        margin: "0 auto",
        padding: 16,
      }}
    >
      <h2>UK Wind Generation – Day-Ahead Buying Assistant</h2>
      <p style={{ color: "#566", marginTop: -8 }}>
        National wind (Elexon WINDFOR forecasts vs FUELHH actuals). Times UTC.
        Data: January 2026 decisions.
      </p>
      <Row>
        <label>
          Decision date (buy for next day){" "}
          <input
            type="date"
            min={meta?.first_decision_date}
            max={meta?.last_decision_date}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Gate cut-off (UTC){" "}
          <input
            type="time"
            value={cutoff}
            onChange={(e) => setCutoff(e.target.value)}
          />
        </label>
        <button
          onClick={() => setTab("decision")}
          disabled={tab === "decision"}
        >
          Decision view
        </button>
        <button
          onClick={() => setTab("accuracy")}
          disabled={tab === "accuracy"}
        >
          Forecast accuracy
        </button>
      </Row>
      {err && <p style={{ color: "crimson" }}>Error: {err}</p>}
      {tab === "decision" &&
        (!dec ? (
          <p>Loading…</p>
        ) : (
          <>
            <Row>
              <Kpi l="Delivery day" v={s.delivery_date} />
              <Kpi
                l="Avg forecast wind"
                v={n(s.mean_forecast_mw)}
                u="MW"
                hint={`range ${n(s.min_forecast_mw)}–${n(s.max_forecast_mw)}`}
              />
              <Kpi
                l="Risk-adjusted wind (P10)"
                v={n(s.risk_adjusted_mean_mw)}
                u="MW"
                hint={
                  s.band_in_sample
                    ? "band: full-month errors (in-sample)"
                    : "band: past days only"
                }
              />
              <Kpi
                l="Latest forecast used"
                v={s.latest_publish_time?.slice(5, 16).replace("T", " ")}
                hint={`cut-off ${s.cutoff_utc?.slice(5, 16).replace("T", " ")}`}
              />
            </Row>
            <label>
              <input
                type="checkbox"
                checked={reveal}
                onChange={(e) => setReveal(e.target.checked)}
              />{" "}
              Reveal actuals (hindsight)
            </label>
            <Box title="Forecast known at decision time, with 80% error band">
              <ComposedChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" interval={3} />
                <YAxis unit=" MW" width={80} />
                <Tooltip />
                <Legend />
                <Area
                  dataKey="band"
                  name="P10–P90 expected actual"
                  fill="#9cc5ee"
                  stroke="none"
                  fillOpacity={0.5}
                />
                <Line
                  dataKey="forecast"
                  name="Forecast"
                  stroke="#0a5"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  dataKey="actual"
                  name="Actual"
                  stroke="#d33"
                  dot={false}
                  strokeWidth={2}
                />
              </ComposedChart>
            </Box>
            <p style={{ fontSize: 13 }}>
              Buy from thermal/market ≈ demand − wind. Plan on the P10 line to
              limit shortfall exposure; the forecast line is the central case.
              {reveal &&
                s.day_metrics?.mae != null &&
                ` Day MAE: ${n(s.day_metrics.mae)} MW, bias: ${n(s.day_metrics.bias)} MW (+ = over-forecast).`}
            </p>
          </>
        ))}
      {tab === "accuracy" &&
        (!acc ? (
          <p>Loading…</p>
        ) : (
          <>
            <Row>
              <Kpi
                l="MAE"
                v={n(o.mae)}
                u="MW"
                hint={`${n(o.mae_pct_of_mean_actual, 1)}% of mean actual`}
              />
              <Kpi l="RMSE" v={n(o.rmse)} u="MW" />
              <Kpi l="Bias (fcst − actual)" v={n(o.bias)} u="MW" />
              <Kpi
                l="P90 over-forecast"
                v={n(o.p90_over_forecast)}
                u="MW"
                hint="shortfall risk (90% of periods are better)"
              />
              <Kpi
                l="P90 under-forecast"
                v={n(o.p90_under_forecast)}
                u="MW"
                hint="surplus risk"
              />
            </Row>
            <Box title="Daily MAE of decision-time forecast (MW)">
              <BarChart data={acc.daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="decision_date"
                  tickFormatter={(d) => d.slice(8)}
                />
                <YAxis />
                <Tooltip />
                <Bar dataKey="mae" fill="#0a5" />
              </BarChart>
            </Box>
            <Box title="MAE & bias by time of day (UTC hour)">
              <BarChart data={acc.hourly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="mae" fill="#0a5" />
                <Bar dataKey="bias" fill="#e90" />
              </BarChart>
            </Box>
            <Box title="MAE by forecast horizon (all published forecasts)">
              <BarChart data={acc.horizon}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="horizon_h" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="mae" fill="#36c" />
              </BarChart>
            </Box>
            <Box title="Error distribution (forecast − actual, MW)">
              <BarChart data={acc.error_hist}>
                <XAxis dataKey="bin" tickFormatter={(b) => Math.round(b)} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#888" />
              </BarChart>
            </Box>
          </>
        ))}
    </div>
  );
}
