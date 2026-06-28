import { NextRequest, NextResponse } from "next/server";
import { listFilings, fetch144, evaluate, mapPool, type Target } from "@/lib/form144";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const dateStr = sp.get("date"); // YYYY-MM-DD
  const otcOnly = sp.get("otcOnly") !== "false";
  const limit = Math.min(Math.max(parseInt(sp.get("limit") || "400", 10) || 400, 1), 800);

  const d = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  if (Number.isNaN(d.getTime())) {
    return NextResponse.json({ error: "Use date=YYYY-MM-DD." }, { status: 400 });
  }

  let filings: { cik: string; accession: string }[];
  try {
    filings = await listFilings(d);
  } catch (e: any) {
    return NextResponse.json(
      { error: `EDGAR index unavailable (${e?.message ?? e}).` },
      { status: 502 }
    );
  }

  const slice = filings.slice(0, limit);
  const parsed = await mapPool(slice, 6, async ({ cik, accession }) => {
    const fd = await fetch144(cik, accession);
    return fd ? evaluate(fd, accession) : null;
  });

  let rows = parsed.filter(Boolean) as Target[];
  if (otcOnly) rows = rows.filter((r) => r.isOtc);
  rows.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    date: dateStr ?? d.toISOString().slice(0, 10),
    totalFilings: filings.length,
    processed: slice.length,
    truncated: filings.length > slice.length,
    returned: rows.length,
    rows,
  });
}
