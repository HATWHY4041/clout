import { PublicKey } from "@solana/web3.js";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
export const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ"); // devnet mock USDC, 6 dp
export const FAUCET_URL = "https://pm-amm-devnet.vercel.app/api/faucet";
export const DEVNET_CHAIN_ID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** Liquidity the house seeds into every new market (mUSDC). */
export const SEED_LIQUIDITY = 50;

export const DURATIONS: { label: string; secs: number }[] = [
  { label: "1 hour", secs: 3600 },
  { label: "6 hours", secs: 6 * 3600 },
  { label: "24 hours", secs: 24 * 3600 },
  { label: "3 days", secs: 3 * 24 * 3600 },
];

/** Tokens shown on the Clout board by default (Solana mints). */
export const BOARD_TOKENS: string[] = [
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", // WIF
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", // POPCAT
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", // TRUMP
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", // PENGU
  "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", // FARTCOIN
];

export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export const solscan = (addr: string, kind: "account" | "tx" = "account") =>
  `https://solscan.io/${kind}/${addr}?cluster=devnet`;
