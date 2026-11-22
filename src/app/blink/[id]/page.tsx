import type { Metadata } from "next";
import { BlinkCard } from "@/components/blink";
import { siteUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const image = `${siteUrl()}/api/og/${id}`;
  return { title: "Clout Blink", openGraph: { images: [image] }, twitter: { card: "summary_large_image", images: [image] } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = `${siteUrl()}/api/actions/market/${id}`;
  return (
    <section className="blinkpage">
      <p className="muted small center">
        This is the market&apos;s Solana Action (Blink), rendered by Clout&apos;s own Blink client. The same link works in any
        Blinks-aware wallet or site: <code className="mono">solana-action:{url}</code>
      </p>
      <BlinkCard actionUrl={url} />
    </section>
  );
}
