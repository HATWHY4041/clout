import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { WalletBar, WalletProvider } from "@/components/wallet";
import { siteUrl } from "@/lib/config";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Clout · trade the hype",
  description: "Turn any tweet into a prediction market on a token's hype. Live Clout Scores from public trading data, settled on Solana with the pm-AMM.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <header className="top">
            <Link href="/" className="logo">CLOUT<span>.</span></Link>
            <nav>
              <Link href="/#board">Board</Link>
              <Link href="/#markets">Markets</Link>
              <Link href="/how">How it works</Link>
            </nav>
            <WalletBar />
          </header>
          <main>{children}</main>
          <footer className="foot">
            Devnet build · test money only · markets run on the open-source{" "}
            <a href="https://predict-pm-amm.dev" target="_blank">pm-AMM</a> · scores from{" "}
            <a href="https://www.geckoterminal.com" target="_blank">GeckoTerminal</a> public data
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
