"use client";
import "./polyfill";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { solscan } from "@/lib/config";
import {
  buildCloseTx,
  buildOpenTx,
  fetchPositions,
  MAX_STALENESS_SECS,
  OPEN_FEE_BPS,
  positionValue,
  type PerpMarket,
  type PerpPosition,
} from "@/lib/perps";
import { useWallet } from "./wallet";
import { Breakdown, ScoreRing, TokenAvatar } from "./ui";

type M = PerpMarket & { image: string | null; name: string; liveScore: number | null; breakdown: any; fundingPerHour: number };

const big = (m: any): M => ({ ...m, priceRaw: BigInt(m.priceRaw), fundingIndex: BigInt(m.fundingIndex) });
const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PerpsApp() {
  const w = useWallet();
  const [markets, setMarkets] = useState<M[] | null>(null);
  const [pool, setPool] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [positions, setPositions] = useState<PerpPosition[]>([]);
  const [isLong, setIsLong] = useState(true);
  const [collateral, setCollateral] = useState(20);
  const [lev, setLev] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (refresh?: string) => {
    const r = await fetch(`/api/perps${refresh ? `?refresh=${refresh}` : ""}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error); setMarkets([]); return; }
    const ms = (j.markets as any[]).map(big);
    setMarkets(ms);
    setPool(j.pool);
    setSel((s) => s ?? ms[0]?.token ?? null);
  }, []);

  const loadPositions = useCallback(async () => {
    if (!w.keypair) return;
    setPositions(await fetchPositions(w.connection, w.keypair.publicKey).catch(() => []));
  }, [w.keypair, w.connection]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { loadPositions(); }, [loadPositions, w.usdc]);

  const m = useMemo(() => markets?.find((x) => x.token === sel) ?? null, [markets, sel]);
  const byAddr = useMemo(() => new Map((markets || []).map((x) => [x.address, x])), [markets]);
  const myPos = m ? positions.find((p) => p.market === m.address) : undefined;

  const size = collateral * lev;
  const fee = (size * OPEN_FEE_BPS) / 10000;
  const net = collateral - fee;
  const liqMove = m ? ((net - size * 0.05) / size) * m.price : 0;
  const liqScore = m ? (isLong ? m.price - liqMove : m.price + liqMove) : 0;

  async function run(label: string, fn: () => Promise<string>, after: string) {
    setBusy(label); setNote(null);
    try {
      if (w.sol < 0.006 || (label === "open" && w.usdc < collateral)) await w.fund();
      const sig = await fn();
      setNote({ ok: true, sig, text: after });
      await Promise.all([load(), loadPositions()]);
    } catch (e: any) {
      const s = String(e?.message || e);
      setNote({ ok: false, text: /StalePrice|0x1772/.test(s) ? "Price was refreshing, please try again." : s.slice(0, 180) });
    } finally {
      setBusy(null);
    }
  }

  const open = () => m && run("open", async () => {
    await fetch(`/api/perps?refresh=${m.token}`, { cache: "no-store" }); // fresh on-chain Clout first
    const tx = await buildOpenTx(w.connection, w.keypair!.publicKey, new PublicKey(m.token), isLong, collateral, lev);
    return w.send(tx);
  }, `Opened ${lev}x ${isLong ? "LONG" : "SHORT"} on $${m.symbol} hype`);

  const close = (p: PerpPosition) => {
    const pm = byAddr.get(p.market);
    if (!pm) return;
    return run(`close-${p.address}`, async () => {
      await fetch(`/api/perps?refresh=${pm.token}`, { cache: "no-store" });
      return w.send(await buildCloseTx(w.connection, w.keypair!.publicKey, new PublicKey(pm.token)));
    }, `Closed $${pm.symbol} position`);
  };

  if (err) return <p className="err">Perps are being set up: {err}</p>;
  if (!markets) return <div className="card skel tall" />;
  if (markets.length === 0) return <p className="muted">Perp markets are launching shortly.</p>;
  const now = Date.now() / 1000;

  return (
    <div className="perps">
      <div className="pmarkets card">
        {markets.map((x) => (
          <button key={x.token} className={`pm ${x.token === sel ? "on" : ""}`} onClick={() => setSel(x.token)}>
            <TokenAvatar src={x.image} symbol={x.symbol} size={30} />
            <span className="sym">${x.symbol}</span>
            <span className="spacer" />
            <b className="mono">{x.price.toFixed(1)}</b>
          </button>
        ))}
        <p className="muted small">Pool backing all trades: <b>{usd(pool)}</b></p>
      </div>

      {m && (
        <div className="col">
          <div className="card">
            <div className="pickhead">
              <TokenAvatar src={m.image} symbol={m.symbol} size={52} />
              <div>
                <div className="muted small">Clout Perp</div>
                <h1 className="mtitle">${m.symbol} hype</h1>
              </div>
              <div className="spacer" />
              <div className="center"><ScoreRing score={m.price} size={78} /><div className="muted small">on-chain Clout</div></div>
            </div>
            <div className="stats">
              <div><span className="muted small">Live score</span><b>{m.liveScore?.toFixed(1) ?? "…"}</b></div>
              <div><span className="muted small">Open interest</span><b>{usd(m.oiLong + m.oiShort)}</b></div>
              <div><span className="muted small">Longs / Shorts</span><b>{m.oiLong + m.oiShort > 0 ? `${Math.round((m.oiLong / (m.oiLong + m.oiShort)) * 100)}/${Math.round((m.oiShort / (m.oiLong + m.oiShort)) * 100)}` : "—"}</b></div>
              <div><span className="muted small">Funding / hr</span><b className={m.fundingPerHour > 0 ? "no-t" : "yes-t"}>{(m.fundingPerHour * 100).toFixed(3)}%</b></div>
            </div>
            {m.breakdown && <Breakdown b={m.breakdown} />}
            <p className="muted small">
              Price updated {Math.max(0, Math.round((now - m.updatedAt) / 60))} min ago on-chain
              {now - m.updatedAt > MAX_STALENESS_SECS ? " (refreshes when you trade)" : ""}. Positive funding means longs pay shorts.
            </p>
          </div>

          <div className="card trade">
            <div className="sides">
              <button className={`side yes ${isLong ? "on" : ""}`} onClick={() => setIsLong(true)}>LONG ↑ hype</button>
              <button className={`side no ${!isLong ? "on" : ""}`} onClick={() => setIsLong(false)}>SHORT ↓ hype</button>
            </div>
            <label className="muted small">Collateral (test USDC)</label>
            <div className="inputrow"><input type="number" min={1} value={collateral} onChange={(e) => setCollateral(Number(e.target.value))} /></div>
            <div className="chips">{[10, 20, 50, 100].map((v) => <button key={v} className={`chip ${collateral === v ? "on" : ""}`} onClick={() => setCollateral(v)}>{v}</button>)}</div>
            <label className="muted small">Leverage: <b className="ok">{lev}x</b></label>
            <input className="slider" type="range" min={1} max={m.maxLeverage} value={lev} onChange={(e) => setLev(Number(e.target.value))} />
            <div className="kv">
              <span>Position size</span><b>{usd(size)}</b>
              <span>Open fee (0.1%)</span><b>{usd(fee)}</b>
              <span>Liquidation at score</span><b>{liqScore > 0 && liqScore < 100 ? liqScore.toFixed(1) : isLong ? "never (≤0)" : "never (≥100)"}</b>
              <span>If score moves 10%</span><b className={isLong ? "yes-t" : "no-t"}>{usd(size * 0.1)} ({Math.round(lev * 10)}%)</b>
            </div>
            <button className={`btn big ${isLong ? "" : "no"}`} disabled={!!busy || !!myPos || collateral < 1} onClick={open}>
              {busy === "open" ? "Opening on Solana…" : myPos ? "Close your position below first" : `${isLong ? "Long" : "Short"} $${m.symbol} hype · ${lev}x`}
            </button>
            {note && <p className={note.ok ? "ok" : "err"}>{note.text} {note.sig && <a href={solscan(note.sig, "tx")} target="_blank">view tx ↗</a>}</p>}
          </div>
        </div>
      )}

      <div className="card positions">
        <h3>Your positions</h3>
        {positions.length === 0 ? <p className="muted small">No open positions yet.</p> : positions.map((p) => {
          const pm = byAddr.get(p.market);
          if (!pm) return null;
          const v = positionValue(p, pm);
          return (
            <div key={p.address} className="posrow">
              <div>
                <b>${pm.symbol}</b> <span className={p.isLong ? "yes-t" : "no-t"}>{p.isLong ? "LONG" : "SHORT"} {v.leverage.toFixed(1)}x</span>
                <div className="muted small">entry {p.entryPrice.toFixed(1)} → now {pm.price.toFixed(1)} · liq {v.liqPrice.toFixed(1)}</div>
              </div>
              <div className="spacer" />
              <div className="right">
                <b className={v.pnl >= 0 ? "yes-t" : "no-t"}>{v.pnl >= 0 ? "+" : ""}{usd(v.pnl)}</b>
                <div className="muted small">{(v.roi * 100).toFixed(1)}% · equity {usd(v.equity)}</div>
              </div>
              <button className="btn ghost sm" disabled={!!busy} onClick={() => close(p)}>{busy === `close-${p.address}` ? "Closing…" : "Close"}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
