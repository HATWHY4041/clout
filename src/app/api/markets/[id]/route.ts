import { NextRequest, NextResponse } from "next/server";
import { connection } from "@/lib/house";
import { getMarket } from "@/lib/store";
import { fetchChainMarket } from "@/lib/trade";
import { settleIfDue } from "@/lib/settle";
import { getTokenClout } from "@/lib/gecko";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getMarket(Number(id));
  if (!meta) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  const [chain, clout] = await Promise.all([
    fetchChainMarket(connection, meta.id).catch(() => null),
    getTokenClout(meta.mint).catch(() => null),
  ]);
  return NextResponse.json({ market: meta, chain, clout });
}

/** Settle the market if it has closed (anyone can trigger; the result is deterministic). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getMarket(Number(id));
  if (!meta) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  try {
    return NextResponse.json({ market: await settleIfDue(meta) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
