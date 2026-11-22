import { NextRequest, NextResponse } from "next/server";
import { extractTokens, fetchTweet } from "@/lib/tweet";
import { findMintByTicker, getTokenClout, type TokenClout } from "@/lib/gecko";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  try {
    const tweet = await fetchTweet(url);
    const { tickers, mints } = extractTokens(tweet.text);
    const found = new Set<string>(mints);
    for (const t of tickers.slice(0, 4)) {
      const m = await findMintByTicker(t).catch(() => null);
      if (m) found.add(m);
    }
    // No $ticker or address? Try the posting account itself (e.g. @bonk_inu → BONK).
    if (found.size === 0) {
      const guesses = Array.from(new Set([
        tweet.handle.split(/[_\d]/)[0],
        tweet.author.replace(/[^A-Za-z0-9]/g, ""),
      ].map((g) => g.toUpperCase()).filter((g) => g.length >= 2 && g.length <= 10)));
      for (const g of guesses) {
        const m = await findMintByTicker(g).catch(() => null);
        if (m) { found.add(m); break; }
      }
    }
    const tokens: TokenClout[] = [];
    for (const m of Array.from(found).slice(0, 4)) {
      const c = await getTokenClout(m).catch(() => null);
      if (c) tokens.push(c);
    }
    return NextResponse.json({ tweet, tickers, tokens });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
