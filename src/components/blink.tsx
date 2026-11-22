"use client";
import "./polyfill";
import { useEffect, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { solscan } from "@/lib/config";
import { useWallet } from "./wallet";

/**
 * A minimal Solana Actions (Blink) client: renders an Action's GET metadata as a
 * card with buttons and inputs, POSTs the chosen action with the signer's account,
 * and signs the returned transaction with Phantom (if present) or the test wallet.
 */
type Param = { name: string; label?: string; type?: string; required?: boolean; min?: number; max?: number; options?: { label: string; value: string }[] };
type Act = { type?: string; label: string; href: string; parameters?: Param[] };
type Meta = { icon: string; title: string; description: string; label: string; disabled?: boolean; links?: { actions: Act[] }; error?: { message: string } };

export function BlinkCard({ actionUrl }: { actionUrl: string }) {
  const w = useWallet();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [usePhantom, setUsePhantom] = useState(false);
  const phantom: any = typeof window !== "undefined" ? (window as any).phantom?.solana ?? ((window as any).solana?.isPhantom ? (window as any).solana : null) : null;

  const load = () =>
    fetch(actionUrl, { headers: { accept: "application/json" }, cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.title ? setMeta(j) : setErr(j.message || "Not a valid Blink")))
      .catch((e) => setErr(String(e.message || e)));
  useEffect(() => { load(); }, [actionUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const abs = (href: string) => new URL(href, actionUrl).toString();

  async function run(a: Act) {
    setBusy(a.label); setResult(null);
    try {
      let href = a.href;
      for (const p of a.parameters || []) {
        const v = vals[`${a.label}:${p.name}`] ?? "";
        if (p.required && !v) throw new Error(`Enter ${p.label || p.name}`);
        href = href.replace(`{${p.name}}`, encodeURIComponent(v));
      }
      let account: string;
      if (usePhantom && phantom) {
        const r = await phantom.connect();
        account = r.publicKey.toString();
      } else {
        if (!w.keypair) throw new Error("Wallet not ready");
        if (w.sol < 0.006) await w.fund();
        account = w.keypair.publicKey.toBase58();
      }
      const res = await fetch(abs(href), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
      const j = await res.json();
      if (!res.ok || !j.transaction) throw new Error(j.message || `Action failed (${res.status})`);
      const tx = Transaction.from(Buffer.from(j.transaction, "base64"));
      let sig: string;
      if (usePhantom && phantom) {
        const signed = await phantom.signTransaction(tx);
        sig = await w.connection.sendRawTransaction(signed.serialize());
        await w.connection.confirmTransaction(sig, "confirmed");
      } else {
        sig = await w.send(tx);
      }
      setResult({ ok: true, text: j.message || "Done", sig });
      load();
    } catch (e: any) {
      setResult({ ok: false, text: String(e?.message || e).slice(0, 200) });
    } finally {
      setBusy(null);
    }
  }

  if (err) return <p className="err">{err}</p>;
  if (!meta) return <div className="card skel tall" />;
  const acts = meta.links?.actions || [];
  const simple = acts.filter((a) => !a.parameters?.length);
  const forms = acts.filter((a) => a.parameters?.length);

  return (
    <div className="blink card">
      <img className="blink-icon" src={meta.icon} alt="" />
      <div className="blink-body">
        <div className="muted small">{new URL(actionUrl).host} · Solana Action · devnet</div>
        <h2>{meta.title}</h2>
        <p className="muted">{meta.description}</p>
        {meta.disabled && <p className="err">This Blink is closed.</p>}
        <div className="blink-btns">
          {simple.map((a) => (
            <button key={a.label} className="btn" disabled={!!busy || meta.disabled} onClick={() => run(a)}>
              {busy === a.label ? "Signing…" : a.label}
            </button>
          ))}
        </div>
        {forms.map((a) => (
          <div key={a.label} className="blink-form">
            {a.parameters!.map((p) =>
              p.type === "select" ? (
                <select key={p.name} value={vals[`${a.label}:${p.name}`] ?? ""} onChange={(e) => setVals({ ...vals, [`${a.label}:${p.name}`]: e.target.value })}>
                  <option value="">{p.label || p.name}</option>
                  {p.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input key={p.name} type={p.type === "number" ? "number" : "text"} min={p.min} max={p.max} placeholder={p.label || p.name}
                  value={vals[`${a.label}:${p.name}`] ?? ""} onChange={(e) => setVals({ ...vals, [`${a.label}:${p.name}`]: e.target.value })} />
              ),
            )}
            <button className="btn" disabled={!!busy || meta.disabled} onClick={() => run(a)}>{busy === a.label ? "Signing…" : a.label}</button>
          </div>
        ))}
        <label className="muted small blink-wallet">
          <input type="checkbox" checked={usePhantom} disabled={!phantom} onChange={(e) => setUsePhantom(e.target.checked)} />{" "}
          {phantom ? "Sign with Phantom (set it to Devnet)" : "Signing with your free Clout test wallet (install Phantom to use your own)"}
        </label>
        {result && <p className={result.ok ? "ok" : "err"}>{result.text} {result.sig && <a href={solscan(result.sig, "tx")} target="_blank">view tx ↗</a>}</p>}
      </div>
    </div>
  );
}
