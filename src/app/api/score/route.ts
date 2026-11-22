import { NextRequest, NextResponse } from "next/server";
import { findMintByTicker, getTokenClout } from "@/lib/gecko";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "Pass ?q=<ticker or mint>" }, { status: 400 });
  try {
    const mint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? q : await findMintByTicker(q);
    if (!mint) return NextResponse.json({ error: `No Solana token found for "${q}"` }, { status: 404 });
    return NextResponse.json(await getTokenClout(mint));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
