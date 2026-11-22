/**
 * Isomorphic client for the Clout Perps program (hand-written Anchor encoding,
 * no IDL needed). Mirrors programs/clout-perps/src/lib.rs.
 */
import { sha256 } from "@noble/hashes/sha2";
import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USDC_MINT } from "./config";

export const PERPS_PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PERPS_PROGRAM_ID || "2TnMRv2z42aBnxSFFefSd71sYNreRrtUR2oSVJf3cP3W");
export const PRICE_SCALE = 1_000_000;
export const FUNDING_SCALE = 1_000_000_000_000n;
export const MAINT_BPS = 500;
export const OPEN_FEE_BPS = 10;
export const MAX_FUNDING_BPS_PER_HOUR = 10;
export const MAX_STALENESS_SECS = 20 * 60;

const enc = new TextEncoder();
const disc = (s: string) => Buffer.from(sha256(enc.encode(s))).subarray(0, 8);
const ixd = (name: string) => disc(`global:${name}`);

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from("config")], PERPS_PROGRAM_ID)[0];
export const vaultPda = () => PublicKey.findProgramAddressSync([Buffer.from("vault")], PERPS_PROGRAM_ID)[0];
export const marketPda = (token: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("market"), token.toBuffer()], PERPS_PROGRAM_ID)[0];
export const positionPda = (market: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer()], PERPS_PROGRAM_ID)[0];

// ---------- borsh helpers
const u8 = (n: number) => Buffer.from([n]);
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = (s: string) => { const d = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(d.length); return Buffer.concat([l, d]); };
const bool = (v: boolean) => Buffer.from([v ? 1 : 0]);

function readI128(b: Buffer, o: number): bigint {
  const lo = b.readBigUInt64LE(o);
  const hi = b.readBigInt64LE(o + 8);
  return (hi << 64n) + lo;
}

// ---------- accounts
export interface PerpMarket {
  address: string;
  token: string;
  symbol: string;
  price: number; // score
  priceRaw: bigint;
  updatedAt: number;
  oiLong: number; // USDC
  oiShort: number;
  fundingIndex: bigint;
  lastFundingTs: number;
  maxLeverage: number;
}

export function decodeMarket(address: PublicKey, data: Buffer): PerpMarket {
  let o = 8;
  const token = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const symbol = Buffer.from(data.subarray(o, o + 12)).toString("utf8").replace(/\0+$/, ""); o += 12;
  const priceRaw = data.readBigUInt64LE(o); o += 8;
  const updatedAt = Number(data.readBigInt64LE(o)); o += 8;
  const oiLong = Number(data.readBigUInt64LE(o)) / 1e6; o += 8;
  const oiShort = Number(data.readBigUInt64LE(o)) / 1e6; o += 8;
  const fundingIndex = readI128(data, o); o += 16;
  const lastFundingTs = Number(data.readBigInt64LE(o)); o += 8;
  const maxLeverage = data[o];
  return { address: address.toBase58(), token, symbol, price: Number(priceRaw) / PRICE_SCALE, priceRaw, updatedAt, oiLong, oiShort, fundingIndex, lastFundingTs, maxLeverage };
}

export interface PerpPosition {
  address: string;
  owner: string;
  market: string;
  isLong: boolean;
  collateral: number; // USDC
  size: number; // USDC notional
  entryPrice: number; // score
  entryPriceRaw: bigint;
  entryFunding: bigint;
  openedAt: number;
}

export function decodePosition(address: PublicKey, data: Buffer): PerpPosition {
  let o = 8;
  const owner = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const market = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const isLong = data[o] === 1; o += 1;
  const collateral = Number(data.readBigUInt64LE(o)) / 1e6; o += 8;
  const size = Number(data.readBigUInt64LE(o)) / 1e6; o += 8;
  const entryPriceRaw = data.readBigUInt64LE(o); o += 8;
  const entryFunding = readI128(data, o); o += 16;
  const openedAt = Number(data.readBigInt64LE(o));
  return { address: address.toBase58(), owner, market, isLong, collateral, size, entryPrice: Number(entryPriceRaw) / PRICE_SCALE, entryPriceRaw, entryFunding, openedAt };
}

export const MARKET_DISC = disc("account:Market");
export const POSITION_DISC = disc("account:Position");

/** Funding index projected to `now` (same formula as the program). */
export function projectedIndex(m: PerpMarket, now = Math.floor(Date.now() / 1000)): bigint {
  const dt = BigInt(Math.max(0, now - m.lastFundingTs));
  const L = BigInt(Math.round(m.oiLong * 1e6));
  const S = BigInt(Math.round(m.oiShort * 1e6));
  if (dt === 0n || L + S === 0n) return m.fundingIndex;
  return m.fundingIndex + (BigInt(MAX_FUNDING_BPS_PER_HOUR) * FUNDING_SCALE / 10000n) * (L - S) / (L + S) * dt / 3600n;
}

/** Hourly funding rate paid by longs (negative = longs receive), as a fraction. */
export function fundingRatePerHour(m: PerpMarket): number {
  const t = m.oiLong + m.oiShort;
  return t > 0 ? (MAX_FUNDING_BPS_PER_HOUR / 10000) * (m.oiLong - m.oiShort) / t : 0;
}

/** Live equity / PnL for a position at a given score. */
export function positionValue(p: PerpPosition, m: PerpMarket, score?: number) {
  const price = score ?? m.price;
  const move = p.isLong ? price - p.entryPrice : p.entryPrice - price;
  const pnl = (p.size * move) / p.entryPrice;
  const idx = projectedIndex(m) - p.entryFunding;
  const fundingOwed = Number((BigInt(Math.round(p.size * 1e6)) * idx) / FUNDING_SCALE) / 1e6;
  const fundingPaid = p.isLong ? fundingOwed : -fundingOwed;
  const equity = p.collateral + pnl - fundingPaid;
  const maint = (p.size * MAINT_BPS) / 10000;
  // score at which equity hits maintenance (ignoring future funding)
  const lev = p.size / p.collateral;
  const liqMove = ((p.collateral - fundingPaid - maint) / p.size) * p.entryPrice;
  const liqPrice = p.isLong ? p.entryPrice - liqMove : p.entryPrice + liqMove;
  return { pnl, fundingPaid, equity, maint, liquidatable: equity < maint, liqPrice, leverage: lev, roi: pnl / p.collateral };
}

// ---------- reads
export async function fetchPerpMarkets(connection: Connection): Promise<PerpMarket[]> {
  const accs = await connection.getProgramAccounts(PERPS_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: bs58Encode(MARKET_DISC) } }],
  });
  return accs.map((a) => decodeMarket(a.pubkey, a.account.data as Buffer));
}

export async function fetchPositions(connection: Connection, owner?: PublicKey): Promise<PerpPosition[]> {
  const filters: any[] = [{ memcmp: { offset: 0, bytes: bs58Encode(POSITION_DISC) } }];
  if (owner) filters.push({ memcmp: { offset: 8, bytes: owner.toBase58() } });
  const accs = await connection.getProgramAccounts(PERPS_PROGRAM_ID, { filters });
  return accs.map((a) => decodePosition(a.pubkey, a.account.data as Buffer));
}

// minimal base58 for 8-byte discriminators
const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(buf: Buffer): string {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) { out = ALPH[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = "1" + out; else break; }
  return out;
}

let tokenProgramCache: PublicKey | null = null;
export async function collateralTokenProgram(connection: Connection): Promise<PublicKey> {
  if (tokenProgramCache) return tokenProgramCache;
  const info = await connection.getAccountInfo(USDC_MINT);
  if (!info) throw new Error("Collateral mint not found");
  tokenProgramCache = info.owner;
  return info.owner;
}

// ---------- instructions
export function ixInitConfig(admin: PublicKey, oracle: PublicKey, tokenProgram: PublicKey) {
  return new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixd("init_config"), oracle.toBuffer()]),
  });
}

export function ixCreateMarket(admin: PublicKey, token: PublicKey, symbol: string, score: number, maxLeverage: number) {
  return new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: marketPda(token), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixd("create_market"), token.toBuffer(), str(symbol.slice(0, 12)), u64(Math.round(score * PRICE_SCALE)), u8(maxLeverage)]),
  });
}

export function ixUpdatePrice(oracle: PublicKey, token: PublicKey, score: number) {
  return new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: oracle, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: marketPda(token), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([ixd("update_price"), u64(Math.round(score * PRICE_SCALE))]),
  });
}

export function ixFundPool(funder: PublicKey, tokenProgram: PublicKey, amountRaw: number) {
  return new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: funder, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(USDC_MINT, funder, false, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixd("fund_pool"), u64(amountRaw)]),
  });
}

export async function buildOpenTx(connection: Connection, owner: PublicKey, token: PublicKey, isLong: boolean, collateralUsdc: number, leverage: number) {
  const tp = await collateralTokenProgram(connection);
  const market = marketPda(token);
  const ix = new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: positionPda(market, owner), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(USDC_MINT, owner, false, tp), isSigner: false, isWritable: true },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: tp, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([ixd("open_position"), bool(isLong), u64(Math.floor(collateralUsdc * 1e6)), u8(leverage)]),
  });
  return finish(connection, owner, [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix]);
}

export async function buildCloseTx(connection: Connection, owner: PublicKey, token: PublicKey) {
  const tp = await collateralTokenProgram(connection);
  const market = marketPda(token);
  const ownerAta = getAssociatedTokenAddressSync(USDC_MINT, owner, false, tp);
  const ix = new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: positionPda(market, owner), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: ownerAta, isSigner: false, isWritable: true },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: tp, isSigner: false, isWritable: false },
    ],
    data: ixd("close_position"),
  });
  return finish(connection, owner, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    createAssociatedTokenAccountIdempotentInstruction(owner, ownerAta, owner, USDC_MINT, tp),
    ix,
  ]);
}

export async function ixLiquidate(connection: Connection, liquidator: PublicKey, p: PerpPosition, token: PublicKey) {
  const tp = await collateralTokenProgram(connection);
  return new TransactionInstruction({
    programId: PERPS_PROGRAM_ID,
    keys: [
      { pubkey: liquidator, isSigner: true, isWritable: false },
      { pubkey: new PublicKey(p.owner), isSigner: false, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: marketPda(token), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(p.address), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(USDC_MINT, liquidator, false, tp), isSigner: false, isWritable: true },
      { pubkey: vaultPda(), isSigner: false, isWritable: true },
      { pubkey: tp, isSigner: false, isWritable: false },
    ],
    data: ixd("liquidate"),
  });
}

async function finish(connection: Connection, payer: PublicKey, ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}
