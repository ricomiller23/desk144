"use client";

import { useMemo, useState } from "react";

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
interface Result {
  date: string;
  totalFilings: number;
  processed: number;
  truncated: boolean;
  returned: number;
  rows: Target[];
}

// Most recent weekday (UTC), as a default scan date.
function lastWeekday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Cold -> hot ramp across the plausible score band (~50 gate to ~120).
function scoreColor(s: number): string {
  const t = Math.max(0, Math.min(1, (s - 50) / 70));
  const cold = [62, 92, 126];
  const hot = [207, 106, 60];
  const c = cold.map((v, i) => Math.round(v + (hot[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const fmtInt = (n: number) =>
  n ? n.toLocaleString("en-US") : "—";
const fmtUsd = (n: number) =>
  n ? "$" + Math.round(n).toLocaleString("en-US") : "—";

export default function Page() {
  const [date, setDate] = useState(lastWeekday());
  const [otcOnly, setOtcOnly] = useState(true);
  const [limit, setLimit] = useState(400);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pull?date=${date}&otcOnly=${otcOnly}&limit=${limit}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      setData(json as Result);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const csv = useMemo(() => {
    if (!data?.rows?.length) return "";
    const cols: (keyof Target)[] = [
      "score", "seller", "relationship", "issuer", "issuerCik", "exchange",
      "isOtc", "isControl", "highValueBasis", "acquisitionBasis",
      "sharesToSell", "sharesOutstanding", "slicePct", "aggregateMktValue",
      "broker", "approxSaleDate", "accession",
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      cols.join(","),
      ...data.rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
    ].join("\n");
  }, [data]);

  function download() {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `desk144_${data?.date ?? "scan"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="wrap">
      <header className="mast">
        <div className="wordmark">
          Desk<span className="dot">·</span>144
        </div>
        <p className="tagline">
          Daily Form 144 sweep — restricted &amp; control sellers in illiquid OTC
          names, ranked by how stuck they are.
        </p>
      </header>

      <section className="controls">
        <div className="field">
          <label htmlFor="date">Scan date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="limit">Max filings</label>
          <input
            id="limit"
            type="number"
            min={1}
            max={800}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            style={{ width: 96 }}
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
        <button className="run" onClick={run} disabled={loading}>
          {loading ? "Scanning…" : "Run scan"}
        </button>
      </section>

      <div className="status">
        {loading && (
          <span className="scan">
            <span className="pip" /> pulling EDGAR…
          </span>
        )}
        {!loading && data && (
          <>
            <span>
              <b>{data.date}</b>
            </span>
            <span className="sep">/</span>
            <span>
              <b>{data.totalFilings}</b> filings
            </span>
            <span className="sep">/</span>
            <span>
              <b>{data.returned}</b> {otcOnly ? "OTC " : ""}targets
            </span>
            {data.truncated && (
              <>
                <span className="sep">/</span>
                <span className="dim">capped at {data.processed}</span>
              </>
            )}
            {data.rows.length > 0 && (
              <button className="dl" onClick={download}>
                Export CSV
              </button>
            )}
          </>
        )}
        {!loading && !data && !error && (
          <span className="dim">Pick a date and run a scan.</span>
        )}
      </div>

      {error && <div className="note err">{error}</div>}

      {!error && data && data.rows.length === 0 && (
        <div className="note">
          No {otcOnly ? "OTC " : ""}Form 144 sellers on {data.date}.
          {data.totalFilings === 0
            ? " EDGAR has no daily index for that date — try a weekday."
            : " Try widening with OTC only off."}
        </div>
      )}

      {!error && data && data.rows.length > 0 && (
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

          {data.rows.map((r) => (
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

              <div className="mono col-r hide-sm">{fmtUsd(r.aggregateMktValue)}</div>

              <div className="mono col-r">{fmtInt(r.sharesToSell)}</div>
            </div>
          ))}
        </div>
      )}

      <p className="foot">
        Source: SEC EDGAR daily index + structured Form 144 XML. Score ={" "}
        OTC gate + acquisition basis + sell/outstanding slice + capped size.
        Founders &amp; brand-name institutions still surface — judge control
        intent before calling. Set <code>SEC_USER_AGENT</code> in env for SEC
        fair-access. Non-reporting dark pinks don&apos;t file 144 on EDGAR and
        won&apos;t appear here.
      </p>
    </main>
  );
}
