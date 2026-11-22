import type { Metadata } from "next";
import { MarketView } from "@/components/market";
import { siteUrl } from "@/lib/config";
import { getMarket } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const m = await getMarket(Number(id)).catch(() => null);
  const title = m ? m.question : "Clout market";
  const image = `${siteUrl()}/api/og/${id}`;
  return {
    title: `${title} · Clout`,
    description: "Bet YES or NO on a token's hype. Live Clout Score, settled on Solana.",
    openGraph: { title, images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketView id={Number(id)} site={siteUrl()} />;
}
