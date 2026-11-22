import { SCORE_FORMULA } from "@/lib/score";

export default function How() {
  return (
    <section className="prose">
      <h1>How Clout works</h1>
      <h3>1. Every token gets a Clout Score</h3>
      <p>
        Clout is a 0–100 hype meter. It measures whether a token is getting <i>more</i> attention than usual right now,
        using only free, public on-chain trading data from GeckoTerminal. Nothing is self-reported and nothing is
        hidden: every market page shows the raw numbers and links to the source.
      </p>
      <p className="card mono small">{SCORE_FORMULA}</p>
      <h3>2. Any tweet becomes a market</h3>
      <p>
        Paste a tweet that shills, FUDs or hypes a token. Clout reads it (free, no X API), finds the tokens it mentions,
        and lets you open a YES/NO market: “Will $X’s Clout be 60+ in 24 hours?”
      </p>
      <h3>3. Markets run on the pm-AMM</h3>
      <p>
        Each market is a real pm-AMM market on Solana. The pm-AMM is Paradigm’s market maker built for prediction
        markets: its liquidity shrinks smoothly as the close gets nearer, so prices stay sharp right up to the deadline. You
        don’t need to wait for someone to take the other side of your bet. Fees: 2% on trades, half of which goes to the market
        creator.
      </p>
      <h3>4. Bet from anywhere with Blinks</h3>
      <p>
        Every market is also a Solana Action. Share the link and Blink-aware wallets and sites like dial.to show YES/NO buttons
        in place, with no need to visit the site.
      </p>
      <h3>5. Settlement</h3>
      <p>
        When a market closes, the next Clout reading (checked at least every 10 minutes, and instantly when someone opens the
        page) decides YES or NO. The result, the score and the input numbers are saved and resolved on-chain. Winners claim
        1 USDC per share.
      </p>
      <h3>What’s next: Clout Perps</h3>
      <p>
        The same score powers perpetual futures: go long or short a token’s hype with no expiry. Clout markets are the
        first step and price discovery for those perps.
      </p>
      <p className="muted small">
        This is a devnet build for the Solana Perps &amp; Prediction Markets hackathon. Test money only. Each visitor gets a
        free browser wallet with test USDC, so there’s nothing to install.
      </p>
    </section>
  );
}
