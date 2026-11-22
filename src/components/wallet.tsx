"use client";
import "./polyfill";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Connection, Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { RPC_URL, USDC_MINT } from "@/lib/config";

const KEY = "clout-burner-v1";

interface WalletCtx {
  ready: boolean;
  keypair: Keypair | null;
  address: string | null;
  usdc: number;
  sol: number;
  connection: Connection;
  funding: boolean;
  fund: () => Promise<string | null>;
  refresh: () => Promise<void>;
  send: (tx: Transaction) => Promise<string>;
  exportKey: () => string | null;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [usdc, setUsdc] = useState(0);
  const [sol, setSol] = useState(0);
  const [funding, setFunding] = useState(false);

  useEffect(() => {
    let kp: Keypair;
    try {
      const saved = localStorage.getItem(KEY);
      kp = saved ? Keypair.fromSecretKey(bs58.decode(saved)) : Keypair.generate();
      if (!saved) localStorage.setItem(KEY, bs58.encode(kp.secretKey));
    } catch {
      kp = Keypair.generate();
    }
    setKeypair(kp);
  }, []);

  const refresh = useCallback(async () => {
    if (!keypair) return;
    const ata = getAssociatedTokenAddressSync(USDC_MINT, keypair.publicKey);
    const [lamports, bal] = await Promise.all([
      connection.getBalance(keypair.publicKey).catch(() => 0),
      connection.getTokenAccountBalance(ata).then((b) => Number(b.value.uiAmount ?? 0)).catch(() => 0),
    ]);
    setSol(lamports / LAMPORTS_PER_SOL);
    setUsdc(bal);
  }, [keypair, connection]);

  const fund = useCallback(async () => {
    if (!keypair) return null;
    setFunding(true);
    try {
      const r = await fetch("/api/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: keypair.publicKey.toBase58() }),
      });
      const body = await r.json();
      if (!r.ok) return body.error || `Faucet error ${r.status}`;
      if (body.signature) await connection.confirmTransaction(body.signature, "confirmed").catch(() => null);
      await refresh();
      return null;
    } catch (e: any) {
      return e.message;
    } finally {
      setFunding(false);
    }
  }, [keypair, connection, refresh]);

  // First visit: auto-fund the fresh wallet so people can bet in one tap.
  useEffect(() => {
    if (!keypair) return;
    (async () => {
      await refresh();
      const ata = getAssociatedTokenAddressSync(USDC_MINT, keypair.publicKey);
      const exists = await connection.getAccountInfo(ata).catch(() => null);
      if (!exists && !localStorage.getItem(KEY + ":funded")) {
        localStorage.setItem(KEY + ":funded", "1");
        await fund();
      }
    })();
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), 20000);
    return () => clearInterval(t);
  }, [keypair]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (tx: Transaction) => {
      if (!keypair) throw new Error("Wallet not ready");
      tx.partialSign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(sig, "confirmed");
      refresh();
      return sig;
    },
    [keypair, connection, refresh],
  );

  const value: WalletCtx = {
    ready: !!keypair,
    keypair,
    address: keypair?.publicKey.toBase58() ?? null,
    usdc,
    sol,
    connection,
    funding,
    fund,
    refresh,
    send,
    exportKey: () => (typeof window !== "undefined" ? localStorage.getItem(KEY) : null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside provider");
  return c;
}

export function WalletBar() {
  const w = useWallet();
  const [msg, setMsg] = useState<string | null>(null);
  if (!w.ready) return null;
  return (
    <div className="walletbar">
      <span className="pill mono" title="Your free test wallet lives in this browser">
        {w.address!.slice(0, 4)}…{w.address!.slice(-4)}
      </span>
      <span className="pill strong">{w.usdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} tUSDC</span>
      <button
        className="btn ghost sm"
        disabled={w.funding}
        onClick={async () => setMsg(await w.fund())}
        title="Free devnet test money, once an hour"
      >
        {w.funding ? "Funding…" : "+ Test USDC"}
      </button>
      {msg && <span className="err small" onClick={() => setMsg(null)}>{msg}</span>}
    </div>
  );
}
