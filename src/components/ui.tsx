"use client";
import { useEffect, useState } from "react";

export function ScoreRing({ score, size = 72, target }: { score: number; size?: number; target?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const hot = score >= 60;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#23232E" strokeWidth="6" fill="none" />
        {target != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="#ffffff55"
            strokeWidth="6"
            fill="none"
            strokeDasharray={`2 ${c}`}
            strokeDashoffset={-c * (target / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={hot ? "#D4FF3A" : "#7C7CFF"}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b style={{ fontSize: size * 0.3 }}>{score.toFixed(0)}</b>
    </div>
  );
}

export function Breakdown({ b }: { b: { momentum: number; crowd: number; pressure: number; scale: number } }) {
  const rows: [string, number, string][] = [
    ["Momentum", b.momentum, "30%"],
    ["Crowd", b.crowd, "25%"],
    ["Buy pressure", b.pressure, "20%"],
    ["Scale", b.scale, "25%"],
  ];
  return (
    <div className="breakdown">
      {rows.map(([k, v, w]) => (
        <div key={k} className="brow">
          <span>{k} <em>{w}</em></span>
          <div className="bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></div>
          <span className="mono">{Math.round(v * 100)}</span>
        </div>
      ))}
    </div>
  );
}

export function Countdown({ endTs }: { endTs: number }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor(endTs - now));
  if (s === 0) return <span>closed</span>;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="mono">{d ? `${d}d ` : ""}{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}</span>;
}

export function TokenAvatar({ src, symbol, size = 36 }: { src: string | null; symbol: string; size?: number }) {
  return src ? (
    <img src={src} alt="" width={size} height={size} className="avatar" />
  ) : (
    <span className="avatar ph" style={{ width: size, height: size }}>{symbol.slice(0, 2)}</span>
  );
}
