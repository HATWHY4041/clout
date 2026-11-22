import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { faucet } from "@/lib/house";

/** Proxy to the pm-AMM devnet faucet for player wallets (1,000 mUSDC + a little SOL). */
export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();
    const r = await faucet(new PublicKey(wallet), "player");
    return NextResponse.json(r.body, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
