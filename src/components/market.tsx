"use client";
import "./polyfill";
import { useCallback, useEffect, useState } from "react";
import { siteUrl, solscan } from "@/lib/config";
import { buildClaimTx, buildTradeTx, positions, quoteBuy, type ChainMarket } from "@/lib/trade";
import { useWallet } from "./wallet";
import { Breakdown, Countdown, ScoreRing, TokenAvatar } from "./ui";

export function MarketView({ id, site }: { id: number; site: string }) {
  const w = useWallet();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState({ usdc: 0, yes: 0, no: 0 });
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/markets/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setData(j);
    const closed = Date.now() / 1000 >= j.market.endTs;
    if (closed && !j.market.resolution) {
      // closed but not settled yet → settle now
      const s = await fetch(`/api/markets/${id}`, { method: "POST" }).then((x) => x.json()).catch(() => null);
      if (s?.market?.resolution) setTimeout(load, 1500);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  const cm: ChainMarket | null = data?.chain ?? null;
  useEffect(() => {
    if (cm && w.keypair) positions(w.connection, w.keypair.publicKey, cm).then(setPos).catch(() => {});
  }, [cm?.pda, w.keypair, w.usdc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="err">{err}</p>;
  if (!data) return <div className="card skel tall" />;
  const m = data.market;
  const clout = data.clout;
  const now = Date.now() / 1000;
  const closed = now >= m.endTs;
  const yes = cm ? Math.round(cm.yesPrice * 100) : 50;
  const resolved = cm?.resolved;
  const won = resolved ? (cm!.winningSide === 1 ? pos.yes : pos.no) : 0;
  const pageUrl = `${site}/m/${id}`;
  const blinkUrl = `https://dial.to/?action=${encodeURIComponent(`solana-action:${site}/api/actions/market/${id}`)}&cluster=devnet`;
  const est = cm && amount > 0 ? quoteBuy(cm, side, Math.floor(amount * 1e6)) / 1e6 : 0;

  async function trade(action: "buy" | "sell", s: "yes" | "no", raw: number) {
    if (!cm || !w.keypair) return;
    setBusy(true); setNote(null);
    try {
      if ((action === "buy" && w.usdc < raw / 1e6) || w.sol < 0.006) {
        const e = await w.fund();
        if (e && action === "buy" && w.usdc < raw / 1e6) throw new Error(`Not enough test USDC (${e})`);
      }
      const fresh = (await fetch(`/api/markets/${id}`, { cache: "no-store" }).then((r) => r.json())).chain ?? cm;
      const { tx, expectedOut } = await buildTradeTx(w.connection, w.keypair.publicKey, fresh, action, s, raw);
      const sig = await w.send(tx);
      setNote({
        ok: true,
        sig,
        text: action === "buy" ? `Bought ${(expectedOut / 1e6).toFixed(2)} ${s.toUpperCase()} shares` : `Sold for ${(expectedOut / 1e6).toFixed(2)} USDC`,
      });
      await load();
    } catch (e: any) {
      setNote({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  async function claim() {
    if (!cm || !w.keypair) return;
    setBusy(true); setNote(null);
    try {
      if (w.sol < 0.006) await w.fund();
      const sig = await w.send(await buildClaimTx(w.connection, w.keypair.publicKey, cm));
      setNote({ ok: true, sig, text: "Winnings claimed" });
      await load();
    } catch (e: any) {
      setNote({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  const shareText = `Will $${m.symbol}'s hype hold? Clout ${m.threshold}+ by close. Market's at ${yes}% YES. Place your bet 👇`;
  const xIntent = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;

  return (
    <div className="mgrid">
      <div className="col">
        <div className="card">
          <div className="pickhead">
            <TokenAvatar src={m.image} symbol={m.symbol} size={52} />
            <div>
              <div className="muted small">Clout market #{m.id}</div>
              <h1 className="mtitle">{m.question}</h1>
            </div>
          </div>
          <div className="stats">
            <div><span className="muted small">Opened at</span><b>{m.scoreAtOpen}</b></div>
            <div><span className="muted small">Target</span><b>{m.threshold}+</b></div>
            <div><span className="muted small">{resolved ? "Final score" : "Clout now"}</span><b>{resolved ? m.resolution?.score : clout ? clout.score : "…"}</b></div>
            <div><span className="muted small">{closed ? "Status" : "Closes in"}</span><b>{resolved ? "Settled" : closed ? "Settling…" : <Countdown endTs={m.endTs} />}</b></div>
          </div>
          <div className="probbar">
            <i style={{ width: `${yes}%` }} />
            <span className="l">YES {yes}%</span>
            <span className="r">NO {100 - yes}%</span>
          </div>
        </div>

        {m.tweet && (
          <a className="tweet card" href={m.tweet.url} target="_blank">
            <div className="tweet-h"><b>{m.tweet.author}</b> <span>@{m.tweet.handle}</span></div>
            <p>{m.tweet.text}</p>
          </a>
        )}

        {clout && (
          <div className="card">
            <div className="sechead tight">
              <h3>Live Clout for ${m.symbol}</h3>
              <ScoreRing score={clout.score} target={m.threshold} size={56} />
            </div>
            <Breakdown b={clout.breakdown} />
            <p className="muted small">
              Last hour: ${Math.round(clout.inputs.volH1).toLocaleString()} volume, {clout.inputs.buyersH1} unique buyers,{" "}
              {clout.inputs.buysH1} buys / {clout.inputs.sellsH1} sells. 24h volume ${Math.round(clout.inputs.volH24).toLocaleString()}.{" "}
              <a href={`https://www.geckoterminal.com/solana/pools/${clout.pools[0]}`} target="_blank">Check the source data ↗</a>
            </p>
          </div>
        )}

        {m.resolution && (
          <div className="card">
            <h3>Settlement</h3>
            <p>
              Closed with ${m.symbol} Clout at <b>{m.resolution.score}</b> vs target <b>{m.threshold}</b> → <b>{m.resolution.side.toUpperCase()}</b> wins.{" "}
              {m.resolution.signature !== "already-resolved" && <a href={solscan(m.resolution.signature, "tx")} target="_blank">On-chain proof ↗</a>}
            </p>
          </div>
        )}
      </div>

      <div className="col side">
        <div className="card trade">
          {resolved ? (
            <>
              <h3>Market settled: {cm!.winningSide === 1 ? "YES" : "NO"}</h3>
              <p className="muted">You hold {(pos.yes / 1e6).toFixed(2)} YES · {(pos.no / 1e6).toFixed(2)} NO</p>
              <button className="btn big" disabled={busy || won === 0} onClick={claim}>
                {won > 0 ? `Claim ${(won / 1e6).toFixed(2)} USDC` : "Nothing to claim"}
              </button>
            </>
          ) : closed ? (
            <p className="muted">Trading closed. Settling with the latest Clout reading…</p>
          ) : (
            <>
              <div className="sides">
                <button className={`side yes ${side === "yes" ? "on" : ""}`} onClick={() => setSide("yes")}>YES {yes}¢</button>
                <button className={`side no ${side === "no" ? "on" : ""}`} onClick={() => setSide("no")}>NO {100 - yes}¢</button>
              </div>
              <label className="muted small">Amount (test USDC)</label>
              <div className="inputrow">
                <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </div>
              <div className="chips">
                {[5, 10, 25, 50].map((v) => <button key={v} className={`chip ${amount === v ? "on" : ""}`} onClick={() => setAmount(v)}>{v}</button>)}
              </div>
              <p className="muted small">≈ {est.toFixed(2)} shares · pays {est.toFixed(2)} USDC if {side.toUpperCase()} wins</p>
              <button className={`btn big ${side}`} disabled={busy || amount <= 0} onClick={() => trade("buy", side, Math.floor(amount * 1e6))}>
                {busy ? "Confirming on Solana…" : `Buy ${side.toUpperCase()}`}
              </button>
              {(pos.yes > 0 || pos.no > 0) && (
                <div className="mypos">
                  <span>Your position</span>
                  {pos.yes > 0 && <button className="chip" disabled={busy} onClick={() => trade("sell", "yes", pos.yes)}>Sell {(pos.yes / 1e6).toFixed(2)} YES</button>}
                  {pos.no > 0 && <button className="chip" disabled={busy} onClick={() => trade("sell", "no", pos.no)}>Sell {(pos.no / 1e6).toFixed(2)} NO</button>}
                </div>
              )}
            </>
          )}
          {note && (
            <p className={note.ok ? "ok" : "err"}>
              {note.text} {note.sig && <a href={solscan(note.sig, "tx")} target="_blank">view tx ↗</a>}
            </p>
          )}
        </div>

        <div className="card share">
          <h3>Spread it</h3>
          <a className="btn big" href={xIntent} target="_blank">Post on X</a>
          <a className="btn ghost" href={blinkUrl} target="_blank">Open as Blink ↗</a>
          <button className="btn ghost" onClick={() => { navigator.clipboard.writeText(pageUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "Copied!" : "Copy link"}
          </button>
          <p className="muted small">The market creator earns 1% of every trade. Bring the crowd.</p>
        </div>
        {cm && <p className="muted small center"><a href={solscan(cm.pda)} target="_blank">Market account on Solscan ↗</a></p>}
      </div>
    </div>
  );
}

function friendly(e: any): string {
  const s = String(e?.message || e);
  if (s.includes("6007") || /Slippage/i.test(s)) return "Price moved. Try again.";
  if (/insufficient|0x1\b/i.test(s)) return "Not enough test funds. Tap + Test USDC.";
  if (/429/.test(s)) return "Solana devnet is busy. Try again in a few seconds.";
  return s.length > 160 ? s.slice(0, 160) + "…" : s;
}
