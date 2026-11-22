import { put, list } from "@vercel/blob";

/** Off-chain details for a Clout market (the money lives on-chain in pm-AMM). */
export interface MarketMeta {
  id: number; // pm-AMM market id
  pda: string;
  question: string;
  mint: string;
  symbol: string;
  image: string | null;
  threshold: number;
  scoreAtOpen: number;
  openedAt: number;
  endTs: number;
  tweet?: { url: string; author: string; handle: string; text: string } | null;
  createdBy?: string | null; // wallet of whoever spun it up
  resolution?: { side: "yes" | "no"; score: number; at: number; signature: string; inputs: any } | null;
}

const PREFIX = "markets/";

export async function saveMarket(m: MarketMeta) {
  await put(`${PREFIX}${m.id}.json`, JSON.stringify(m), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

async function readUrl(url: string): Promise<any> {
  const r = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

export async function listMarkets(): Promise<MarketMeta[]> {
  const out: MarketMeta[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    const items = await Promise.all(page.blobs.map((b) => readUrl(b.url).catch(() => null)));
    out.push(...items.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.openedAt - a.openedAt);
}

export async function getMarket(id: number): Promise<MarketMeta | null> {
  const page = await list({ prefix: `${PREFIX}${id}.json`, limit: 1 });
  const b = page.blobs.find((x) => x.pathname === `${PREFIX}${id}.json`);
  return b ? readUrl(b.url) : null;
}
