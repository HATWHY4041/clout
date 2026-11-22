import { NextRequest, NextResponse } from "next/server";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DURATIONS, SEED_LIQUIDITY } from "@/lib/config";
import { getTokenClout } from "@/lib/gecko";
import { connection, faucet, houseClient, houseKeypair } from "@/lib/house";
import { listMarkets, saveMarket, type MarketMeta } from "@/lib/store";
import { fetchTweet } from "@/lib/tweet";
import { fetchChainMarket } from "@/lib/trade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const metas = await listMarkets();
  const withChain = await Promise.all(
    metas.slice(0, 40).map(async (m) => ({ ...m, chain: await fetchChainMarket(connection, m.id).catch(() => null) })),
  );
  return NextResponse.json({ markets: withChain });
}

function fmtClose(endTs: number) {
  const d = new Date(endTs * 1000);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${hh}:${mm}`;
}

/** Fit a UTF-8 string into the 64-byte on-chain name field. */
function fit64(s: string) {
  while (new TextEncoder().encode(s).length > 64) s = s.slice(0, -1);
  return s;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const durationSecs = Number(body.durationSecs);
    if (!DURATIONS.some((d) => d.secs === durationSecs)) throw new Error("Pick one of the offered durations");

    // Gentle spam guard: at most 30 new markets an hour across the app.
    const recent = (await listMarkets()).filter((m) => m.openedAt > Date.now() / 1000 - 3600);
    if (recent.length >= 30) throw new Error("Lots of markets opened this hour. Try again in a few minutes.");

    const clout = await getTokenClout(String(body.mint), 0);
    const threshold = Math.round(Number(body.threshold ?? Math.ceil(clout.score)));
    if (!(threshold >= 1 && threshold <= 99)) throw new Error("Target score must be between 1 and 99");

    let tweet: MarketMeta["tweet"] = null;
    if (body.tweetUrl) {
      const t = await fetchTweet(String(body.tweetUrl));
      tweet = { url: t.url, author: t.author, handle: t.handle, text: t.text.slice(0, 400) };
    }

    // Keep the house wallet topped up from the free devnet faucet.
    const house = houseKeypair().publicKey;
    const sol = (await connection.getBalance(house)) / LAMPORTS_PER_SOL;
    if (sol < 0.06) {
      await faucet(house).catch(() => null);
      if ((await connection.getBalance(house)) / LAMPORTS_PER_SOL < 0.05)
        throw new Error("The house wallet is out of devnet SOL. Please try again later.");
    }

    const endTs = Math.floor(Date.now() / 1000) + durationSecs;
    const question = fit64(`Will $${clout.symbol} Clout be ${threshold}+ at ${fmtClose(endTs)} UTC?`);

    const client = houseClient();
    let res;
    try {
      res = await client.send.createMarket({ name: question, durationSecs, initialPriceBps: 5000, depositUsdc: SEED_LIQUIDITY });
    } catch (e: any) {
      // Most likely out of mUSDC: refill once and retry.
      await faucet(house).catch(() => null);
      res = await client.send.createMarket({ name: question, durationSecs, initialPriceBps: 5000, depositUsdc: SEED_LIQUIDITY });
    }

    const meta: MarketMeta = {
      id: res.marketId,
      pda: res.marketPda,
      question,
      mint: clout.mint,
      symbol: clout.symbol,
      image: clout.image,
      threshold,
      scoreAtOpen: clout.score,
      openedAt: Math.floor(Date.now() / 1000),
      endTs,
      tweet,
      createdBy: body.createdBy ? String(body.createdBy).slice(0, 44) : null,
      resolution: null,
    };
    await saveMarket(meta);
    return NextResponse.json({ market: meta, signature: res.signature });
  } catch (e: any) {
    console.error("create market failed", e);
    return NextResponse.json({ error: e.message || "Failed to create market" }, { status: 400 });
  }
}
