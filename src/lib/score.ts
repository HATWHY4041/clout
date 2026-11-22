/**
 * Clout Score: a 0–100 measure of how much attention a token is getting
 * RIGHT NOW, built only from free, public trading data (GeckoTerminal).
 *
 *   momentum  30%  last-hour volume vs its 24h hourly average
 *   crowd     25%  last-hour unique buyers vs their 24h hourly average
 *   pressure  20%  share of last-hour trades that were buys
 *   scale     25%  size of 24h volume (log scale, $10k → 0, $100M → 1)
 *
 * Every input is shown next to the score so anyone can recompute it.
 */
export interface CloutInputs {
  volH1: number;
  volH24: number;
  buyersH1: number;
  buyersH24: number;
  buysH1: number;
  sellsH1: number;
}

export interface CloutBreakdown {
  momentum: number;
  crowd: number;
  pressure: number;
  scale: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** log2 ratio of the last hour to the hourly average, squashed to 0..1 */
function ratioScore(lastHour: number, day: number): number {
  const avg = day / 24;
  if (avg <= 0) return lastHour > 0 ? 1 : 0;
  if (lastHour <= 0) return 0;
  return (clamp(Math.log2(lastHour / avg), -2, 2) + 2) / 4;
}

export function computeClout(i: CloutInputs): { score: number; breakdown: CloutBreakdown } {
  const momentum = ratioScore(i.volH1, i.volH24);
  const crowd = ratioScore(i.buyersH1, i.buyersH24);
  const trades = i.buysH1 + i.sellsH1;
  const pressure = trades > 0 ? i.buysH1 / trades : 0;
  const scale = i.volH24 > 0 ? clamp((Math.log10(i.volH24) - 4) / 4, 0, 1) : 0;
  const raw = 100 * (0.3 * momentum + 0.25 * crowd + 0.2 * pressure + 0.25 * scale);
  return {
    score: Math.round(raw * 10) / 10,
    breakdown: { momentum, crowd, pressure, scale },
  };
}

export const SCORE_FORMULA =
  "Clout = 30% momentum (1h vs avg-hour volume) + 25% crowd (1h vs avg-hour unique buyers) + 20% buy pressure (1h buys ÷ trades) + 25% scale (log of 24h volume). Data: GeckoTerminal, top 3 pools.";
