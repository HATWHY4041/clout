import { NextRequest, NextResponse } from "next/server";
import { listMarkets } from "@/lib/store";
import { settleIfDue } from "@/lib/settle";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Public and idempotent (settling is deterministic). Called every ~10 minutes by a free GitHub Actions schedule: settles closed markets. */
export async function GET(_req: NextRequest) {
  const now = Math.floor(Date.now() / 1000);
  const due = (await listMarkets()).filter((m) => !m.resolution && m.endTs <= now);
  const results: any[] = [];
  for (const m of due.slice(0, 10)) {
    try {
      const r = await settleIfDue(m);
      results.push({ id: m.id, side: r.resolution?.side, score: r.resolution?.score });
    } catch (e: any) {
      results.push({ id: m.id, error: e.message });
    }
  }
  return NextResponse.json({ settled: results, checked: due.length });
}
