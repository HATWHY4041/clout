import "server-only";
import { PublicKey } from "@solana/web3.js";
import { connection, houseClient } from "./house";
import { getTokenClout } from "./gecko";
import { saveMarket, type MarketMeta } from "./store";
import { fetchChainMarket } from "./trade";

/**
 * Settle a market once it has closed: read the live Clout Score, compare it with
 * the threshold, and resolve on-chain. Idempotent — safe to call any time.
 */
export async function settleIfDue(meta: MarketMeta): Promise<MarketMeta> {
  const now = Math.floor(Date.now() / 1000);
  if (meta.resolution || now < meta.endTs) return meta;
  const cm = await fetchChainMarket(connection, meta.id);
  if (!cm) return meta;

  const clout = await getTokenClout(meta.mint, 0);
  let side: "yes" | "no" = clout.score >= meta.threshold ? "yes" : "no";
  let signature = "already-resolved";
  if (cm.resolved) {
    side = cm.winningSide === 1 ? "yes" : "no";
  } else {
    signature = await houseClient().send.resolveMarket(new PublicKey(cm.pda), side);
  }
  const updated: MarketMeta = {
    ...meta,
    resolution: { side, score: clout.score, at: clout.at, signature, inputs: clout.inputs },
  };
  await saveMarket(updated);
  return updated;
}
