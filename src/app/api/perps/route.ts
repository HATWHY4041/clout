import { NextRequest, NextResponse } from "next/server";
import { connection } from "@/lib/house";
import { fetchPerpMarkets, fundingRatePerHour } from "@/lib/perps";
import { pushPrices, vaultBalance } from "@/lib/perps-admin";
import { getTokenClout } from "@/lib/gecko";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ser = (x: any) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Perp markets with on-chain state + live Clout. ?refresh=<token> pushes a fresh on-chain price first. */
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh");
  try {
    if (refresh) await pushPrices(45, refresh).catch(() => null);
    const markets = await fetchPerpMarkets(connection);
    const enriched = [];
    for (const m of markets) {
      const live = await getTokenClout(m.token, 120).catch(() => null);
      enriched.push({ ...m, fundingPerHour: fundingRatePerHour(m), image: live?.image ?? null, name: live?.name ?? m.symbol, liveScore: live?.score ?? null, breakdown: live?.breakdown ?? null });
    }
    enriched.sort((a, b) => (b.oiLong + b.oiShort) - (a.oiLong + a.oiShort) || (b.liveScore ?? 0) - (a.liveScore ?? 0));
    return NextResponse.json(ser({ markets: enriched, pool: await vaultBalance(), at: Math.floor(Date.now() / 1000) }));
  } catch (e: any) {
    return NextResponse.json({ error: e.message, markets: [] }, { status: 500 });
  }
}
