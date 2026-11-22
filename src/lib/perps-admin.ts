/** Server-only: Clout Perps setup, oracle price pushes and liquidation keeper. */
import "server-only";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BOARD_TOKENS, USDC_MINT } from "./config";
import { getTokenClout } from "./gecko";
import { connection, faucet, houseKeypair } from "./house";
import {
  collateralTokenProgram,
  configPda,
  decodeMarket,
  fetchPerpMarkets,
  fetchPositions,
  ixCreateMarket,
  ixFundPool,
  ixInitConfig,
  ixLiquidate,
  ixUpdatePrice,
  marketPda,
  positionValue,
  vaultPda,
} from "./perps";

const send = (tx: Transaction) => sendAndConfirmTransaction(connection, tx, [houseKeypair()], { commitment: "confirmed" });
const POOL_TARGET = 400; // mUSDC kept in the pool

export async function vaultBalance(): Promise<number> {
  return connection.getTokenAccountBalance(vaultPda()).then((b) => Number(b.value.uiAmount ?? 0)).catch(() => 0);
}

/** Idempotent: config, one market per board token, and a funded pool. */
export async function setup() {
  const house = houseKeypair();
  const tp = await collateralTokenProgram(connection);
  const log: string[] = [];
  if (!(await connection.getAccountInfo(configPda()))) {
    log.push(`init_config ${await send(new Transaction().add(ixInitConfig(house.publicKey, house.publicKey, tp)))}`);
  }
  for (const mint of BOARD_TOKENS) {
    const token = new PublicKey(mint);
    if (await connection.getAccountInfo(marketPda(token))) continue;
    const c = await getTokenClout(mint, 60);
    log.push(`market ${c.symbol} ${await send(new Transaction().add(ixCreateMarket(house.publicKey, token, c.symbol, c.score, 5)))}`);
  }
  const pool = await vaultBalance();
  if (pool < POOL_TARGET) {
    const ata = getAssociatedTokenAddressSync(USDC_MINT, house.publicKey, false, tp);
    let have = await connection.getTokenAccountBalance(ata).then((b) => Number(b.value.uiAmount ?? 0)).catch(() => 0);
    if (have < POOL_TARGET - pool + 50) { await faucet(house.publicKey).catch(() => null); have = await connection.getTokenAccountBalance(ata).then((b) => Number(b.value.uiAmount ?? 0)).catch(() => 0); }
    const amt = Math.min(POOL_TARGET - pool, Math.max(0, have - 100));
    if (amt > 0) log.push(`fund_pool ${amt} ${await send(new Transaction().add(ixFundPool(house.publicKey, tp, Math.floor(amt * 1e6))))}`);
  }
  return { log, pool: await vaultBalance() };
}

/** Push fresh Clout Scores on-chain for markets older than `maxAgeSecs` (or one token). */
export async function pushPrices(maxAgeSecs = 300, onlyToken?: string) {
  const house = houseKeypair();
  const now = Math.floor(Date.now() / 1000);
  const markets = (await fetchPerpMarkets(connection)).filter((m) => (!onlyToken || m.token === onlyToken) && now - m.updatedAt > maxAgeSecs);
  const pushed: { symbol: string; score: number }[] = [];
  const ixs = [];
  for (const m of markets) {
    try {
      const c = await getTokenClout(m.token, 30);
      ixs.push(ixUpdatePrice(house.publicKey, new PublicKey(m.token), c.score));
      pushed.push({ symbol: m.symbol, score: c.score });
    } catch {}
  }
  const sigs: string[] = [];
  for (let i = 0; i < ixs.length; i += 6) sigs.push(await send(new Transaction().add(...ixs.slice(i, i + 6))));
  return { pushed, sigs };
}

/** Liquidate every position whose equity is below maintenance. */
export async function liquidateAll() {
  const house = houseKeypair();
  const [markets, positions] = await Promise.all([fetchPerpMarkets(connection), fetchPositions(connection)]);
  const byAddr = new Map(markets.map((m) => [m.address, m]));
  const done: string[] = [];
  for (const p of positions) {
    const m = byAddr.get(p.market);
    if (!m || !positionValue(p, m).liquidatable) continue;
    try {
      const ix = await ixLiquidate(connection, house.publicKey, p, new PublicKey(m.token));
      done.push(await send(new Transaction().add(ix)));
    } catch (e: any) {
      done.push(`failed ${p.address}: ${String(e.message).slice(0, 80)}`);
    }
  }
  return { checked: positions.length, liquidated: done };
}

export async function marketAccount(token: string) {
  const info = await connection.getAccountInfo(marketPda(new PublicKey(token)));
  return info ? decodeMarket(marketPda(new PublicKey(token)), info.data as Buffer) : null;
}
