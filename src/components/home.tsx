"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DURATIONS } from "@/lib/config";
import type { TokenClout } from "@/lib/gecko";
import { useWallet } from "./wallet";
import { Breakdown, Countdown, ScoreRing, TokenAvatar } from "./ui";

export function CreateMarket() {
  const router = useRouter();
  const w = useWallet();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tweet, setTweet] = useState<any>(null);
  const [tokens, setTokens] = useState<TokenClout[]>([]);
  const [pick, setPick] = useState<TokenClout | null>(null);
  const [threshold, setThreshold] = useState(50);
  const [duration, setDuration] = useState(DURATIONS[2].secs);
  const [creating, setCreating] = useState(false);
  const [ticker, setTicker] = useState("");

  async function findTicker() {
    setErr(null); setLoading(true);
    try {
      const r = await fetch(`/api/score?q=${encodeURIComponent(ticker.trim())}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setTokens([j]);
      choose(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isTweet = /(x|twitter)\.com\/[^/]+\/status/i.test(input);

  async function lookup() {
    setErr(null); setTweet(null); setTokens([]); setPick(null); setLoading(true);
    try {
      if (isTweet) {
        const r = await fetch(`/api/tweet?url=${encodeURIComponent(input.trim())}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setTweet(j.tweet);
        setTokens(j.tokens);
        if (j.tokens[0]) choose(j.tokens[0]);
        else setErr("No Solana token found in that tweet. Type which token it's about below.");
      } else {
        const r = await fetch(`/api/score?q=${encodeURIComponent(input.trim())}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setTokens([j]);
        choose(j);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  function choose(t: TokenClout) {
    setPick(t);
    setThreshold(Math.min(99, Math.max(1, Math.ceil(t.score))));
  }

  async function create() {
    if (!pick) return;
    setCreating(true); setErr(null);
    try {
      const r = await fetch("/api/markets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint: pick.mint, threshold, durationSecs: duration, tweetUrl: tweet?.url, createdBy: w.address }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      router.push(`/m/${j.market.id}?new=1`);
    } catch (e: any) {
      setErr(e.message);
      setCreating(false);
    }
  }

  return (
    <div className="card create">
      <div className="inputrow">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && input && lookup()}
          placeholder="Paste a tweet link… or type a ticker like WIF"
        />
        <button className="btn" disabled={!input || loading} onClick={lookup}>{loading ? "Reading…" : "Go"}</button>
      </div>

      {tweet && (
        <blockquote className="tweet">
          <div className="tweet-h"><b>{tweet.author}</b> <span>@{tweet.handle}</span></div>
          <p>{tweet.text}</p>
        </blockquote>
      )}

      {tweet && !pick && (
        <div className="inputrow" style={{ marginTop: 12 }}>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ticker && findTicker()} placeholder="Which token? e.g. BONK or a mint address" />
          <button className="btn ghost" disabled={!ticker || loading} onClick={findTicker}>Find</button>
        </div>
      )}

      {tokens.length > 1 && (
        <div className="chips">
          {tokens.map((t) => (
            <button key={t.mint} className={`chip ${pick?.mint === t.mint ? "on" : ""}`} onClick={() => choose(t)}>${t.symbol}</button>
          ))}
        </div>
      )}

      {pick && (
        <div className="builder">
          <div className="pickhead">
            <TokenAvatar src={pick.image} symbol={pick.symbol} size={44} />
            <div>
              <div className="sym">${pick.symbol}</div>
              <div className="muted small">{pick.name}</div>
            </div>
            <div className="spacer" />
            <div className="center">
              <ScoreRing score={pick.score} target={threshold} />
              <div className="muted small">Clout now</div>
            </div>
          </div>
          <Breakdown b={pick.breakdown} />

          <div className="q">
            Will <b>${pick.symbol}</b> Clout be{" "}
            <span className="num">
              <button onClick={() => setThreshold(Math.max(1, threshold - 1))}>−</button>
              <b>{threshold}+</b>
              <button onClick={() => setThreshold(Math.min(99, threshold + 1))}>+</button>
            </span>{" "}
            in
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.secs} value={d.secs}>{d.label}</option>)}
            </select>
            ?
          </div>
          <button className="btn big" disabled={creating} onClick={create}>
            {creating ? "Opening market on Solana…" : "Open market"}
          </button>
          <p className="muted small">The house seeds 50 test USDC of liquidity. You earn half the 2% trading fee as the creator.</p>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

export function Board() {
  const [tokens, setTokens] = useState<TokenClout[] | null>(null);
  useEffect(() => {
    fetch("/api/board").then((r) => r.json()).then((j) => setTokens(j.tokens || [])).catch(() => setTokens([]));
  }, []);
  return (
    <section id="board">
      <div className="sechead">
        <h2>Clout Board</h2>
        <span className="muted small">Live hype scores · refresh every 2 min</span>
      </div>
      {!tokens ? (
        <div className="grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card skel" />)}</div>
      ) : (
        <div className="grid">
          {tokens.map((t, i) => (
            <div key={t.mint} className="card tok">
              <div className="tokhead">
                <span className="rank">#{i + 1}</span>
                <TokenAvatar src={t.image} symbol={t.symbol} />
                <div>
                  <div className="sym">${t.symbol}</div>
                  <div className="muted small">${Math.round(t.inputs.volH1).toLocaleString()} vol last hour</div>
                </div>
                <div className="spacer" />
                <ScoreRing score={t.score} size={60} />
              </div>
              <Breakdown b={t.breakdown} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Markets() {
  const [markets, setMarkets] = useState<any[] | null>(null);
  useEffect(() => {
    fetch("/api/markets").then((r) => r.json()).then((j) => setMarkets(j.markets || [])).catch(() => setMarkets([]));
  }, []);
  return (
    <section id="markets">
      <div className="sechead">
        <h2>Live markets</h2>
        <span className="muted small">Each one runs on the pm-AMM on Solana devnet</span>
      </div>
      {!markets ? (
        <div className="list"><div className="card skel" /></div>
      ) : markets.length === 0 ? (
        <p className="muted">No markets yet. Be the first: paste a tweet above.</p>
      ) : (
        <div className="list">
          {markets.map((m) => {
            const yes = m.chain ? Math.round(m.chain.yesPrice * 100) : 50;
            const settled = m.chain?.resolved;
            return (
              <Link href={`/m/${m.id}`} key={m.id} className="card mrow">
                <TokenAvatar src={m.image} symbol={m.symbol} />
                <div className="grow">
                  <div className="mq">{m.question}</div>
                  <div className="muted small">
                    {m.tweet ? `from @${m.tweet.handle} · ` : ""}
                    {settled ? `settled ${m.chain.winningSide === 1 ? "YES" : "NO"}` : <>closes in <Countdown endTs={m.endTs} /></>}
                  </div>
                </div>
                <div className="odds">
                  <span className="yes">{settled ? (m.chain.winningSide === 1 ? "YES ✓" : "") : `YES ${yes}¢`}</span>
                  <span className="no">{settled ? (m.chain.winningSide === 2 ? "NO ✓" : "") : `NO ${100 - yes}¢`}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
