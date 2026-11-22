import { NextRequest, NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { connection, faucet, houseKeypair } from "@/lib/house";

export const maxDuration = 30;

const GAS_TOPUP = 0.02 * LAMPORTS_PER_SOL;
const recent = new Map<string, number>(); // wallet -> last gas top-up (per instance)

/**
 * Fund a visitor's test wallet: 1,000 mUSDC from the pm-AMM devnet faucet, plus a
 * little devnet SOL for fees from the house (the faucet's SOL reserve is often empty).
 */
export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();
    const pk = new PublicKey(wallet);
    const r = await faucet(pk, "player").catch((e) => ({ ok: false, body: { error: e.message }, status: 500 }));

    let gas: string | null = null;
    const bal = await connection.getBalance(pk);
    const last = recent.get(pk.toBase58()) || 0;
    if (bal < 0.008 * LAMPORTS_PER_SOL && Date.now() - last > 10 * 60_000) {
      const house = houseKeypair();
      if ((await connection.getBalance(house.publicKey)) > 0.5 * LAMPORTS_PER_SOL) {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: pk, lamports: GAS_TOPUP }));
        gas = await sendAndConfirmTransaction(connection, tx, [house], { commitment: "confirmed" });
        recent.set(pk.toBase58(), Date.now());
      }
    }

    if (!r.ok && !gas) return NextResponse.json({ error: r.body?.error || "Faucet busy, try again soon" }, { status: r.status || 500 });
    return NextResponse.json({ ...(r.ok ? r.body : { usdcError: r.body?.error }), gas });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
