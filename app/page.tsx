"use client";

import { useMemo, useRef, useState } from "react";

interface Target {
  issuer: string;
  issuerCik: string;
  seller: string;
  relationship: string;
  exchange: string;
  isOtc: boolean;
  sharesToSell: number;
  sharesOutstanding: number;
  slicePct: number | null;
  aggregateMktValue: number;
  acquisitionBasis: string;
  highValueBasis: boolean;
  isControl: boolean;
  broker: string;
  approxSaleDate: string;
  score: number;
  accession: string;
}
type Agg = Target & { filings: number; lastDate: string };
interface Meta {
  daysTotal: number;
  daysDone: number;
  daysSkipped: number;
  filingsSeen: number;
  windowStart: string;
  windowEnd: string;
}

const LOOKBACKS = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 31 },
  { label: "3 months", days: 92 },
  { label: "6 months", days: 183 },
];
const RENDER_CAP = 500;

function lastWeekday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Weekdays from end date back over `days` calendar days, newest -> oldest.
function weekdays(endISO: string, days: number): string[] {
  const end = new Date(`${endISO}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const out: string[] = [];
  const cur = new Date(end);
  while (cur >= start) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() - 1);
  }
  return out;
}

function scoreColor(s: number): string {
  const t = Math.max(0, Math.min(1, (s - 50) / 70));
  const cold = [62, 92, 126];
  const hot = [207, 106, 60];
  const c = cold.map((v, i) => Math.round(v + (hot[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const fmtInt = (n: number) => (n ? n.toLocaleString("en-US") : "—");
const fmtUsd = (n: number) =>
  n ? "$" + Math.round(n).toLocaleString("en-US") : "—";

const inputStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  fontFamily: "var(--mono)",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 3,
  colorScheme: "dark",
};

export default function Page() {
  const [date, setDate] = useState(lastWeekday());
  const [lookback, setLookback] = useState(1);
  const [otcOnly, setOtcOnly] = useState(true);
  const [limit, setLimit] = useState(400);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Agg[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const stopRef = useRef(false);

  async function run() {
    setRunning(true);
    setError(null);
    setRows([]);
    setMeta(null);
    stopRef.current = false;

    const dates = weekdays(date, lookback);
    const map = new Map<string, Agg>();
    let done = 0,
      skipped = 0,
      filingsSeen = 0;

    for (const dt of dates) {
      if (stopRef.current) break;
      try {
        const res = await fetch(
          `/api/pull?date=${dt}&otcOnly=${otcOnly}&limit=${limit}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        filingsSeen += json.totalFilings || 0;
        for (const r of json.rows as Target[]) {
          const key = `${r.seller}|${r.issuerCik}`;
          const prev = map.get(key);
          if (!prev) {
            map.set(key, { ...r, filings: 1, lastDate: dt });
          } else {
            const filings = prev.filings + 1;
            const lastDate = dt > prev.lastDate ? dt : prev.lastDate;
            // keep the highest-score snapshot, preserve repeat-filing tally
            if (r.score > prev.score) map.set(key, { ...r, filings, lastDate });
            else {
              prev.filings = filings;
              prev.lastDate = lastDate;
            }
          }
        }
      } catch {
        skipped += 1;
      }
      done += 1;
      const arr = Array.from(map.values()).sort(
        (a, b) => b.score - a.score || b.filings - a.filings
      );
      setRows(arr);
      setMeta({
        daysTotal: dates.length,
        daysDone: done,
        daysSkipped: skipped,
        filingsSeen,
        windowStart: dates[dates.length - 1],
        windowEnd: dates[0],
      });
    }
    setRunning(false);
  }

  function stop() {
    stopRef.current = true;
  }

  const csv = useMemo(() => {
    if (!rows.length) return "";
    const cols: (keyof Agg)[] = [
      "score", "filings", "lastDate", "seller", "relationship", "issuer",
      "issuerCik", "exchange", "isOtc", "isControl", "highValueBasis",
      "acquisitionBasis", "sharesToSell", "sharesOutstanding", "slicePct",
      "aggregateMktValue", "broker", "approxSaleDate", "accession",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
    ].join("\n");
  }, [rows]);

  function download() {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `desk144_${meta?.windowStart ?? "scan"}_${meta?.windowEnd ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = meta ? Math.round((meta.daysDone / meta.daysTotal) * 100) : 0;
  const shown = rows.slice(0, RENDER_CAP);
  const isRange = lookback > 1;

  return (
    <main className="wrap">
      <header className="mast">
        <div className="wordmark">
          Desk<span className="dot">·</span>144
        </div>
        <p className="tagline">
          Form 144 sweep — restricted &amp; control sellers in illiquid OTC
          names, ranked by how stuck they are.
        </p>
      </header>

      <section className="controls">
        <div className="field">
          <label htmlFor="date">End date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div className="field">
          <label htmlFor="lookback">Lookback</label>
          <select
            id="lookback"
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            style={inputStyle}
          >
            {LOOKBACKS.map((l) => (
              <option key={l.days} value={l.days}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="limit">Max filings / day</label>
          <input
            id="limit"
            type="number"
            min={1}
            max={800}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{ ...inputStyle, width: 96 }}
          />
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={otcOnly}
            onChange={(e) => setOtcOnly(e.target.checked)}
          />
          OTC only
        </label>
        {running ? (
          <button className="run" onClick={stop} style={{ marginLeft: "auto", background: "var(--warn)", color: "#fff" }}>
            Stop
          </button>
        ) : (
          <button className="run" onClick={run}>
            {isRange ? "Run lookback" : "Run scan"}
          </button>
        )}
      </section>

      {isRange && !meta && !running && (
        <div className="status">
          <span className="dim">
            Scans {weekdays(date, lookback).length} weekdays, one at a time. A
            6-month run can take 15–40 min — you can Stop anytime and keep
            what&apos;s gathered.
          </span>
        </div>
      )}

      <div className="status">
        {meta && (
          <>
            {running && (
              <span className="scan">
                <span className="pip" /> {meta.windowEnd}…{meta.windowStart}
              </span>
            )}
            <span>
              <b>
                {meta.daysDone}/{meta.daysTotal}
              </b>{" "}
              days
            </span>
            <span className="sep">/</span>
            <span>
              <b>{meta.filingsSeen.toLocaleString()}</b> filings
            </span>
            <span className="sep">/</span>
            <span>
              <b>{rows.length.toLocaleString()}</b> {otcOnly ? "OTC " : ""}sellers
            </span>
            {meta.daysSkipped > 0 && (
              <>
                <span className="sep">/</span>
                <span className="dim">{meta.daysSkipped} days skipped</span>
              </>
            )}
            {rows.length > 0 && (
              <button className="dl" onClick={download}>
                Export CSV ({rows.length.toLocaleString()})
              </button>
            )}
          </>
        )}
        {!meta && !running && !error && (
          <span className="dim">Pick a window and run.</span>
        )}
      </div>

      {meta && (
        <div
          aria-hidden
          style={{
            height: 3,
            background: "var(--line-soft)",
            borderRadius: 2,
            overflow: "hidden",
            marginTop: 4,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: running ? "var(--teal)" : "var(--faint)",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {error && <div className="note err">{error}</div>}

      {!error && meta && !running && rows.length === 0 && (
        <div className="note">
          No {otcOnly ? "OTC " : ""}Form 144 sellers in that window.
          {meta.filingsSeen === 0
            ? " EDGAR returned no filings — check the date range falls on weekdays."
            : " Try OTC only off to widen."}
        </div>
      )}

      {rows.length > 0 && (
        <div className="tape" role="table" aria-label="Form 144 targets">
          <div className="row head" role="row">
            <div role="columnheader">Score</div>
            <div role="columnheader">Seller / Issuer</div>
            <div role="columnheader" className="hide-sm">
              Venue / Slice
            </div>
            <div role="columnheader" className="hide-sm col-r">
              Value
            </div>
            <div role="columnheader" className="col-r">
              Shares
            </div>
          </div>

          {shown.map((r) => (
            <div className="row body" role="row" key={r.accession + r.seller}>
              <div
                className="gauge"
                style={{ background: scoreColor(r.score) }}
                title={`score ${r.score}`}
              >
                <span className="num">{Math.round(r.score)}</span>
              </div>

              <div className="tgt">
                <div className="seller">{r.seller || "—"}</div>
                <div className="issuer">
                  {r.issuer || "—"}
                  {r.relationship ? ` · ${r.relationship}` : ""}
                </div>
                <div className="tags">
                  {r.isOtc && <span className="chip otc">OTC</span>}
                  {r.highValueBasis && (
                    <span className="chip basis">debt/convert</span>
                  )}
                  {r.isControl && <span className="chip ctrl">affiliate</span>}
                  {r.filings > 1 && (
                    <span
                      className="chip"
                      style={{ color: "var(--hot)", background: "#2a1a12" }}
                    >
                      {r.filings}× filed
                    </span>
                  )}
                </div>
              </div>

              <div className="venue hide-sm">
                {r.exchange || "—"}
                <span className="sub">
                  {r.slicePct != null
                    ? `${r.slicePct.toFixed(2)}% of o/s`
                    : "o/s n/a"}
                </span>
              </div>

              <div className="mono col-r hide-sm">
                {fmtUsd(r.aggregateMktValue)}
              </div>

              <div className="mono col-r">{fmtInt(r.sharesToSell)}</div>
            </div>
          ))}

          {rows.length > RENDER_CAP && (
            <div className="row body" role="row">
              <div />
              <div className="dim mono" style={{ fontSize: 12 }}>
                showing top {RENDER_CAP} of {rows.length.toLocaleString()} —
                Export CSV for the full list
              </div>
            </div>
          )}
        </div>
      )}

      <p className="foot">
        Source: SEC EDGAR daily index + structured Form 144 XML. Score = OTC gate
        + acquisition basis + sell/outstanding slice + capped size. Repeat filers
        (<code>N× filed</code>) are dribbling a stuck position — strong signal.
        Founders &amp; brand-name institutions still surface — judge control
        intent before calling. Non-reporting dark pinks don&apos;t file 144 on
        EDGAR and won&apos;t appear.
      </p>
    </main>
  );
}
