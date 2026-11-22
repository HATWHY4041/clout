import { computeClout, type CloutBreakdown, type CloutInputs } from "./score";

const GT = "https://api.geckoterminal.com/api/v2";
const HEADERS = { accept: "application/json;version=20230302" };

export interface TokenClout {
  mint: string;
  symbol: string;
  name: string;
  image: string | null;
  priceUsd: number | null;
  score: number;
  breakdown: CloutBreakdown;
  inputs: CloutInputs;
  pools: string[];
  at: number; // unix secs
}

const mem = new Map<string, { at: number; data: any }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GeckoTerminal GET with an in-memory cache, the Next data cache, and backoff on rate limits. */
async function gt(path: string, revalidate = 60): Promise<any> {
  const hit = mem.get(path);
  if (hit && revalidate > 0 && Date.now() - hit.at < revalidate * 1000) return hit.data;
  let last = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${GT}${path}`, {
      headers: HEADERS,
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" }),
    } as any);
    if (res.ok) {
      const data = await res.json();
      mem.set(path, { at: Date.now(), data });
      return data;
    }
    last = res.status;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1200 * 2 ** attempt);
  }
  // Rate-limited: fall back to the last good reading if it is recent (≤ 10 min).
  if (hit && Date.now() - hit.at < 600_000) return hit.data;
  throw new Error(last === 429 ? "Score data is busy right now. Try again in a few seconds." : `GeckoTerminal error ${last}`);
}

const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0);

/** Clout score for one Solana token, aggregated over its top 3 pools by liquidity. */
export async function getTokenClout(mint: string, revalidate = 60): Promise<TokenClout> {
  const data = await gt(`/networks/solana/tokens/${mint}/pools?page=1&include=base_token`, revalidate);
  const pools: any[] = (data.data || [])
    .filter((p: any) => p.relationships?.base_token?.data?.id === `solana_${mint}`)
    .sort((a: any, b: any) => num(b.attributes.reserve_in_usd) - num(a.attributes.reserve_in_usd))
    .slice(0, 3);
  if (!pools.length) throw new Error("No trading pools found for this token");

  const inputs: CloutInputs = { volH1: 0, volH24: 0, buyersH1: 0, buyersH24: 0, buysH1: 0, sellsH1: 0 };
  for (const p of pools) {
    const a = p.attributes;
    inputs.volH1 += num(a.volume_usd?.h1);
    inputs.volH24 += num(a.volume_usd?.h24);
    inputs.buyersH1 += num(a.transactions?.h1?.buyers);
    inputs.buyersH24 += num(a.transactions?.h24?.buyers);
    inputs.buysH1 += num(a.transactions?.h1?.buys);
    inputs.sellsH1 += num(a.transactions?.h1?.sells);
  }
  const tok = (data.included || []).find((x: any) => x.id === `solana_${mint}`)?.attributes || {};
  const { score, breakdown } = computeClout(inputs);
  return {
    mint,
    symbol: (tok.symbol || pools[0].attributes.name?.split(" / ")[0] || "???").replace(/^\$/, "").toUpperCase(),
    name: tok.name || tok.symbol || mint.slice(0, 6),
    image: tok.image_url && tok.image_url !== "missing.png" ? tok.image_url : null,
    priceUsd: pools[0].attributes.base_token_price_usd ? Number(pools[0].attributes.base_token_price_usd) : null,
    score,
    breakdown,
    inputs,
    pools: pools.map((p) => p.attributes.address),
    at: Math.floor(Date.now() / 1000),
  };
}

/** Find a Solana token mint by ticker (e.g. "WIF"), picking the most liquid match. */
/** Well-known tickers, so copycat tokens with the same symbol never win. */
const KNOWN: Record<string, string> = {
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  PENGU: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  FARTCOIN: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
  SOL: "So11111111111111111111111111111111111111112",
};

export async function findMintByTicker(ticker: string): Promise<string | null> {
  const t = ticker.replace(/^\$/, "").toUpperCase();
  if (KNOWN[t]) return KNOWN[t];
  const data = await gt(`/search/pools?query=${encodeURIComponent(t)}&network=solana&include=base_token`, 300);
  const tokens = new Map<string, string>();
  for (const inc of data.included || []) tokens.set(inc.id, (inc.attributes?.symbol || "").replace(/^\$/, "").toUpperCase());
  const matches = (data.data || [])
    .filter((p: any) => tokens.get(p.relationships?.base_token?.data?.id) === t)
    .sort((a: any, b: any) => num(b.attributes.volume_usd?.h24) - num(a.attributes.volume_usd?.h24));
  const id: string | undefined = matches[0]?.relationships?.base_token?.data?.id;
  return id ? id.replace(/^solana_/, "") : null;
}
