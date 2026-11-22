/** Server-only: the "house" builder wallet that creates and settles markets. */
import "server-only";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { AnchorProvider } from "@anchor-lang/core";
import { PmAmmClient } from "@pm-amm/sdk";
import bs58 from "bs58";
import { createHash } from "crypto";
import { FAUCET_URL, PROGRAM_ID, RPC_URL, USDC_MINT } from "./config";

export const connection = new Connection(RPC_URL, "confirmed");

let cached: Keypair | null = null;
/**
 * The devnet house wallet. Uses HOUSE_SECRET_KEY if set; otherwise it is derived
 * from the project's own server-side Blob secret, so no key is ever handled by hand.
 */
export function houseKeypair(): Keypair {
  if (cached) return cached;
  const s = process.env.HOUSE_SECRET_KEY;
  if (s) cached = Keypair.fromSecretKey(bs58.decode(s));
  else {
    const base = process.env.BLOB_READ_WRITE_TOKEN;
    if (!base) throw new Error("House wallet not configured");
    cached = Keypair.fromSeed(createHash("sha256").update(`clout-house-v1:${base}`).digest());
  }
  return cached;
}

function derive(label: string): Keypair {
  const base = process.env.HOUSE_SECRET_KEY || process.env.BLOB_READ_WRITE_TOKEN;
  if (!base) throw new Error("House wallet not configured");
  return Keypair.fromSeed(createHash("sha256").update(`${label}:${base}`).digest());
}

/** Keypair for the Clout Perps program address (only needed once, to create it). */
export const perpsProgramKeypair = () => derive("clout-perps-program-v1");

export function houseClient(): PmAmmClient {
  const kp = houseKeypair();
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  const wallet = {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx: any) => sign(tx),
    signAllTransactions: async (txs: any[]) => txs.map(sign),
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  return PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);
}

export async function faucet(wallet: PublicKey, role?: "player"): Promise<{ ok: boolean; body: any; status: number }> {
  const r = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: wallet.toBase58(), ...(role ? { role } : {}) }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, body, status: r.status };
}
