# Clout: trade the hype, not the price

**Live demo:** https://clout-hype.vercel.app

**Clout** turns any tweet into a prediction market on a token's *hype*.

- **Clout Score (0–100):** a live attention meter for every Solana token, built only from free, public trading data (GeckoTerminal): last-hour momentum, unique buyers, buy pressure and scale. Every input is shown and linked, so anyone can recompute it.
- **Tweet → market:** paste a tweet, Clout finds the tokens it mentions and opens a YES/NO market: *"Will $WIF Clout be 60+ in 24h?"*
- **Powered by the pm-AMM:** every market is a real [pm-AMM](https://predict-pm-amm.dev) market on Solana (Paradigm's prediction-market AMM, where liquidity shrinks as the close nears). The creator earns half of the 2% fee.
- **Blinks:** every market is a Solana Action (`/api/actions/market/:id`), so people can bet from X / dial.to without visiting the site.
- **Zero-install:** visitors get a browser test wallet funded with devnet test USDC.
- **Settlement:** closed markets are settled with the next Clout reading (on page view, and every 10 minutes by a free GitHub Actions schedule), resolved on-chain by the house wallet. The score and raw inputs are stored for audit.

Roadmap: **Clout Perps**, perpetual long/short on a token's Clout Score.

Built for the Solana *Perps and Prediction Markets* hackathon. Devnet only, test money.

## Stack
Next.js on Vercel (free plan), `@pm-amm/sdk`, Vercel Blob for market metadata, GeckoTerminal public API, X public embeds (no API key).

## Config
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob (added automatically when the store is connected)
- `HOUSE_SECRET_KEY` (optional): base58 devnet keypair. If it's unset, the house wallet is derived from the server-side Blob secret.
- GitHub repo variable `SITE_URL` (optional): the live URL for the settle schedule (defaults to https://clout-hype.vercel.app)
