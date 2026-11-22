import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/config";
import { connection, faucet, houseKeypair } from "@/lib/house";

export const dynamic = "force-dynamic";

async function status() {
  const pk = houseKeypair().publicKey;
  const sol = (await connection.getBalance(pk)) / LAMPORTS_PER_SOL;
  const usdc = await connection
    .getTokenAccountBalance(getAssociatedTokenAddressSync(USDC_MINT, pk))
    .then((b) => Number(b.value.uiAmount ?? 0))
    .catch(() => 0);
  return { house: pk.toBase58(), sol, usdc };
}

/** Public: the house wallet address and balances (for transparency). */
export async function GET() {
  return NextResponse.json(await status());
}

/** Top the house wallet up from the free pm-AMM devnet faucet. */
export async function POST() {
  const r = await faucet(houseKeypair().publicKey);
  return NextResponse.json({ faucet: r.body, status: r.status, ...(await status()) });
}
