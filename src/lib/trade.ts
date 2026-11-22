/**
 * Isomorphic pm-AMM helpers (browser burner wallet + server Blinks).
 */
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PmAmmClient, PROTOCOL_DAO, SWAP_FEE_BPS, decodeName, type SwapDirection } from "@pm-amm/sdk";
import { estimateSwapOutput, i80f48ToNumber, priceFromReserves } from "@pm-amm/sdk/math";
import { PROGRAM_ID, USDC_MINT } from "./config";

export const readClient = (connection: Connection) => PmAmmClient.readOnly(connection, PROGRAM_ID, USDC_MINT);

const bnNum = (v: any) => (typeof v === "number" ? v : Number(v?.toString?.() ?? 0));

export interface ChainMarket {
  pda: string;
  id: number;
  name: string;
  authority: string;
  endTs: number;
  resolved: boolean;
  winningSide: 0 | 1 | 2;
  yesPrice: number; // 0..1
  x: number; // reserves rescaled to now
  y: number;
  lEff: number;
}

export function decodeMarket(pda: PublicKey, m: any): ChainMarket {
  const now = Math.floor(Date.now() / 1000);
  const endTs = bnNum(m.endTs);
  const lZero = i80f48ToNumber(m.lZero);
  const lastTs = bnNum(m.lastAccrualTs);
  const lLast = lZero * Math.sqrt(Math.max(endTs - lastTs, 1));
  const lEff = lZero * Math.sqrt(Math.max(endTs - now, 1));
  const rx = i80f48ToNumber(m.reserveYes);
  const ry = i80f48ToNumber(m.reserveNo);
  const k = lLast > 0 ? lEff / lLast : 1;
  let yesPrice = 0.5;
  if (m.resolved) yesPrice = m.winningSide === 1 ? 1 : 0;
  else if (lLast > 0 && (rx > 0 || ry > 0)) yesPrice = Math.max(0.01, Math.min(0.99, priceFromReserves(rx, ry, lLast)));
  else if (m.initialPriceBps) yesPrice = m.initialPriceBps / 10000;
  return {
    pda: pda.toBase58(),
    id: bnNum(m.marketId),
    name: decodeName(m.name),
    authority: (m.authority as PublicKey).toBase58(),
    endTs,
    resolved: !!m.resolved,
    winningSide: m.winningSide,
    yesPrice,
    x: rx * k,
    y: ry * k,
    lEff,
  };
}

export async function fetchChainMarket(connection: Connection, id: number): Promise<ChainMarket | null> {
  const c = readClient(connection);
  const pda = c.marketPda(id);
  const m = await c.fetchMarket(pda);
  return m ? decodeMarket(pda, m) : null;
}

/** Estimated output (raw units) of a USDC→side buy, after the 2% fee. */
export function quoteBuy(cm: ChainMarket, side: "yes" | "no", usdcRaw: number): number {
  const net = Math.floor((usdcRaw * (10000 - SWAP_FEE_BPS)) / 10000);
  return Math.max(0, Math.floor(estimateSwapOutput(cm.x, cm.y, cm.lEff, net, side).output));
}

/** Estimated USDC (raw) from selling `amountRaw` of side, after the 2% fee. */
export function quoteSell(cm: ChainMarket, side: "yes" | "no", amountRaw: number): number {
  const est = estimateSwapOutput(cm.x, cm.y, cm.lEff, amountRaw, side === "yes" ? "no" : "yes");
  return Math.max(0, Math.floor((est.output * (10000 - SWAP_FEE_BPS)) / 10000));
}

function ataIxs(payer: PublicKey, owner: PublicKey, mints: PublicKey[], offCurve = false): TransactionInstruction[] {
  return mints.map((mint) =>
    createAssociatedTokenAccountIdempotentInstruction(payer, getAssociatedTokenAddressSync(mint, owner, offCurve), owner, mint),
  );
}

/** Build an unsigned swap transaction for any wallet. */
export async function buildTradeTx(
  connection: Connection,
  user: PublicKey,
  cm: ChainMarket,
  action: "buy" | "sell",
  side: "yes" | "no",
  amountRaw: number,
  slippageBps = 500,
): Promise<{ tx: Transaction; expectedOut: number }> {
  const c = readClient(connection);
  const market = new PublicKey(cm.pda);
  const creator = new PublicKey(cm.authority);
  const yes = c.yesMint(market);
  const no = c.noMint(market);
  const expectedOut = action === "buy" ? quoteBuy(cm, side, amountRaw) : quoteSell(cm, side, amountRaw);
  const minOutput = Math.floor((expectedOut * (10000 - slippageBps)) / 10000);
  const direction: SwapDirection =
    action === "buy" ? (side === "yes" ? "usdcToYes" : "usdcToNo") : side === "yes" ? "yesToUsdc" : "noToUsdc";
  const ix = await c.ix.swap({ signer: user, market, direction, amountIn: amountRaw, minOutput, creatorAuthority: creator } as any);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...ataIxs(user, user, [USDC_MINT, yes, no]),
    ...(creator.equals(user) ? [] : ataIxs(user, creator, [USDC_MINT], true)),
    ...ataIxs(user, PROTOCOL_DAO, [USDC_MINT], true),
    ix,
  );
  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return { tx, expectedOut };
}

export async function buildClaimTx(connection: Connection, user: PublicKey, cm: ChainMarket): Promise<Transaction> {
  const c = readClient(connection);
  const market = new PublicKey(cm.pda);
  const ix = await c.ix.claimWinnings({ signer: user, market } as any);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...ataIxs(user, user, [USDC_MINT, c.yesMint(market), c.noMint(market)]),
    ix,
  );
  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

/** YES / NO / USDC balances (raw) for a wallet in a market. */
export async function positions(connection: Connection, user: PublicKey, cm: ChainMarket) {
  const c = readClient(connection);
  const market = new PublicKey(cm.pda);
  const accts = [USDC_MINT, c.yesMint(market), c.noMint(market)].map((m) => getAssociatedTokenAddressSync(m, user));
  const infos = await connection.getMultipleAccountsInfo(accts);
  const bal = (i: number) => {
    const d = infos[i]?.data;
    return d && d.length >= 72 ? Number(new DataView(d.buffer, d.byteOffset).getBigUint64(64, true)) : 0;
  };
  return { usdc: bal(0), yes: bal(1), no: bal(2) };
}
