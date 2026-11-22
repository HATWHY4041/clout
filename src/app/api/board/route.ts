import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { BOARD_TOKENS } from "@/lib/config";
import { getTokenClout, type TokenClout } from "@/lib/gecko";
import { listMarkets } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const buildBoard = unstable_cache(
  async () => {
    let mints = [...BOARD_TOKENS];
    try {
      const markets = await listMarkets();
      for (const m of markets) if (!mints.includes(m.mint)) mints.push(m.mint);
    } catch {}
    mints = mints.slice(0, 12);
    const out: TokenClout[] = [];
    for (const mint of mints) {
      try {
        out.push(await getTokenClout(mint, 120));
      } catch {}
    }
    out.sort((a, b) => b.score - a.score);
    if (out.length === 0) throw new Error("no data"); // don't cache an empty board
    return { tokens: out, at: Math.floor(Date.now() / 1000) };
  },
  ["clout-board-v1"],
  { revalidate: 120 },
);

export async function GET() {
  try {
    return NextResponse.json(await buildBoard());
  } catch {
    return NextResponse.json({ tokens: [], at: Math.floor(Date.now() / 1000) });
  }
}
