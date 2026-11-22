import { NextRequest, NextResponse } from "next/server";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "@/lib/config";
import { connection, faucet, houseKeypair, perpsProgramKeypair } from "@/lib/house";

export const dynamic = "force-dynamic";

async function status() {
  const pk = houseKeypair().publicKey;
  const sol = (await connection.getBalance(pk)) / LAMPORTS_PER_SOL;
  const usdc = await connection
    .getTokenAccountBalance(getAssociatedTokenAddressSync(USDC_MINT, pk))
    .then((b) => Number(b.value.uiAmount ?? 0))
    .catch(() => 0);
  return { house: pk.toBase58(), sol, usdc, perpsProgram: perpsProgramKeypair().publicKey.toBase58() };
}

/** Public: the house wallet address and balances (for transparency). ?topup=1 refills it from free devnet faucets. */
export async function GET(req: NextRequest) {
  if (!req.nextUrl.searchParams.get("topup")) return NextResponse.json(await status());
  const pk = houseKeypair().publicKey;
  const r = await faucet(pk).catch((e) => ({ ok: false, body: { error: e.message }, status: 0 }));
  let airdrop: string | null = null;
  if ((await connection.getBalance(pk)) < 0.5 * LAMPORTS_PER_SOL) {
    try {
      const sig = await connection.requestAirdrop(pk, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      airdrop = sig;
    } catch (e: any) {
      airdrop = `failed: ${e.message?.slice(0, 120)}`;
    }
  }
  return NextResponse.json({ faucet: r.body, faucetStatus: r.status, airdrop, ...(await status()) });
}
