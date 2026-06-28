import { XMLParser } from "fast-xml-parser";

// SEC fair-access requires a descriptive User-Agent with contact info.
// Override in Vercel env: SEC_USER_AGENT="YourFirm Name you@email.com"
const UA =
  process.env.SEC_USER_AGENT ||
  "desk144 restricted-securities sourcing (set SEC_USER_AGENT env)";
const SEC_HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };

const LISTED = ["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "CBOE"];
const HIGH_VALUE_BASIS = [
  "conversion", "convert", "note", "debenture",
  "settlement", "private placement", "exchange", "pipe",
];
const CONTROL_WORDS = [
  "affiliate", "officer", "director", "10%",
  "ceo", "chairman", "president", "founder",
];

export interface Target {
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

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- global rate gate: space SEC requests ~120ms apart (~8/sec, under 10/sec ceiling) ----
const MIN_INTERVAL = 120;
let gate: Promise<void> = Promise.resolve();
async function rateGate(): Promise<void> {
  const prev = gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  await prev;
  setTimeout(release, MIN_INTERVAL);
}

// ---- fetch with throttle + exponential backoff on 429/403/503 ----
async function secFetch(url: string, tries = 4): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    await rateGate();
    const res = await fetch(url, { headers: SEC_HEADERS, cache: "no-store" });
    if (res.status !== 429 && res.status !== 403 && res.status !== 503) return res;
    last = res;
    const ra = Number(res.headers.get("retry-after"));
    const waitMs = ra ? ra * 1000 : Math.min(8000, 600 * 2 ** attempt);
    if (attempt < tries - 1) await sleep(waitMs);
  }
  return last as Response; // exhausted retries; caller handles the status
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function quarter(d: Date) {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}
function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}
function num(x: unknown): number {
  const n = parseFloat(String(x ?? "").replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Pull the pipe-delimited daily master index and return Form 144 / 144A filings. */
export async function listFilings(
  d: Date
): Promise<{ cik: string; accession: string }[]> {
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${d.getUTCFullYear()}/QTR${quarter(
    d
  )}/master.${ymd(d)}.idx`;
  const res = await secFetch(url);
  if (res.status === 404) return []; // weekend / holiday / future date
  if (res.status === 429 || res.status === 403)
    throw new Error(
      `SEC rate-limited (${res.status}) — wait a few minutes, lower Max filings/day, and confirm SEC_USER_AGENT is set`
    );
  if (!res.ok) throw new Error(`daily-index ${res.status}`);
  const text = await res.text();
  const out: { cik: string; accession: string }[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split("|");
    if (parts.length !== 5) continue;
    const form = parts[2];
    if (form === "144" || form === "144/A") {
      const accession = parts[4]
        .trim()
        .split("/")
        .pop()!
        .replace(".txt", "")
        .replace(/-/g, "");
      out.push({ cik: parts[0].trim(), accession });
    }
  }
  return out;
}

/** Fetch one filing's structured primary_doc.xml and return its formData node. */
export async function fetch144(cik: string, accession: string): Promise<any> {
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/primary_doc.xml`;
  const res = await secFetch(url);
  if (!res.ok) return null;
  const xml = await res.text();
  try {
    return parser.parse(xml)?.edgarSubmission?.formData ?? null;
  } catch {
    return null;
  }
}

/** Flatten + score one filing. All inputs come from the filing itself. */
export function evaluate(fd: any, accession: string): Target {
  const issuer = fd?.issuerInfo ?? {};
  const si = asArray<any>(fd?.securitiesInformation)[0] ?? {};
  const stb = asArray<any>(fd?.securitiesToBeSold);

  const exch = String(si.securitiesExchangeName ?? "").toUpperCase();
  const isOtc = !LISTED.some((x) => exch.includes(x));

  const rel = String(issuer.relationshipsToIssuer ?? "").toLowerCase();
  const isControl = CONTROL_WORDS.some((w) => rel.includes(w));

  const toSell = num(si.numberOfUnitsToBeSold);
  const outstanding = num(si.noOfUnitsOutstanding);
  const amv = num(si.aggregateMarketValue);
  const slicePct = outstanding ? (toSell / outstanding) * 100 : null;

  const basisText = stb
    .map((b) => `${b?.natureOfAcquisitionTransaction ?? ""} ${b?.natureOfPayment ?? ""}`)
    .join(" ")
    .toLowerCase()
    .trim();
  const highValueBasis = HIGH_VALUE_BASIS.some((k) => basisText.includes(k));

  let score = 0;
  if (isOtc) score += 50;
  if (highValueBasis) score += 25;
  if (isControl) score += 15;
  if (slicePct != null && slicePct < 1) score += 10;
  score += Math.min(amv / 100_000, 20);

  return {
    issuer: String(issuer.issuerName ?? ""),
    issuerCik: String(issuer.issuerCik ?? ""),
    seller: String(issuer.nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold ?? ""),
    relationship: String(issuer.relationshipsToIssuer ?? ""),
    exchange: String(si.securitiesExchangeName ?? ""),
    isOtc,
    sharesToSell: toSell,
    sharesOutstanding: outstanding,
    slicePct: slicePct != null ? +slicePct.toFixed(4) : null,
    aggregateMktValue: amv,
    acquisitionBasis: basisText,
    highValueBasis,
    isControl,
    broker: String(asArray<any>(si.brokerOrMarketMakerDetails)[0]?.name ?? ""),
    approxSaleDate: String(si.approxSaleDate ?? ""),
    score: +score.toFixed(1),
    accession,
  };
}

/** Bounded-concurrency map; the rate gate keeps total throughput under SEC's ceiling. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return out;
}
