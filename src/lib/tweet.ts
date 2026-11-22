/** Read a public tweet for free (no X API key) via X's oEmbed / syndication endpoints. */
export interface TweetInfo {
  id: string;
  url: string;
  author: string;
  handle: string;
  text: string;
}

export function tweetId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status(?:es)?\/(\d+)/i);
  return m ? m[2] : null;
}

function decode(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .trim();
}

export async function fetchTweet(url: string): Promise<TweetInfo> {
  const id = tweetId(url);
  if (!id) throw new Error("That doesn't look like a tweet link (x.com/<user>/status/<id>)");
  const handleFromUrl = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\//i)?.[1] || "";

  // 1) syndication JSON (has clean text)
  try {
    const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`, {
      headers: { "user-agent": "Mozilla/5.0" },
      cache: "no-store",
    });
    if (r.ok) {
      const j = await r.json();
      if (j?.text) {
        return {
          id,
          url: `https://x.com/${j.user?.screen_name || handleFromUrl}/status/${id}`,
          author: j.user?.name || handleFromUrl,
          handle: j.user?.screen_name || handleFromUrl,
          text: decode(j.text),
        };
      }
    }
  } catch {}

  // 2) oEmbed fallback
  const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/i/status/${id}`)}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Couldn't read that tweet. Is it public?");
  const j = await r.json();
  const p = (j.html as string).match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
  const handle = (j.author_url as string)?.split("/").pop() || handleFromUrl;
  return { id, url: `https://x.com/${handle}/status/${id}`, author: j.author_name || handle, handle, text: decode(p) };
}

/** $TICKERS and Solana addresses mentioned in a tweet. */
export function extractTokens(text: string): { tickers: string[]; mints: string[] } {
  const tickers = Array.from(new Set((text.match(/\$[A-Za-z][A-Za-z0-9]{1,9}\b/g) || []).map((t) => t.slice(1).toUpperCase())));
  const mints = Array.from(new Set(text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []));
  return { tickers: tickers.filter((t) => !/^\d/.test(t)), mints };
}
