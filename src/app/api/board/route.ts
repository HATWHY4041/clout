import { NextResponse } from "next/server";
import { BOARD_TOKENS } from "@/lib/config";
import { getTokenClout, type TokenClout } from "@/lib/gecko";
import { listMarkets } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  let mints = [...BOARD_TOKENS];
  try {
    const markets = await listMarkets();
    for (const m of markets) if (!mints.includes(m.mint)) mints.push(m.mint);
  } catch {}
  mints = mints.slice(0, 14);
  const out: TokenClout[] = [];
  for (const mint of mints) {
    try {
      out.push(await getTokenClout(mint, 120));
    } catch {}
  }
  out.sort((a, b) => b.score - a.score);
  return NextResponse.json({ tokens: out, at: Math.floor(Date.now() / 1000) });
}
