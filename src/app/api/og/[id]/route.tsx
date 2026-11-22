import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { connection } from "@/lib/house";
import { getMarket } from "@/lib/store";
import { fetchChainMarket } from "@/lib/trade";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const square = req.nextUrl.searchParams.has("sq");
  const W = square ? 800 : 1200;
  const H = square ? 800 : 630;
  const meta = await getMarket(Number(id));
  const cm = meta ? await fetchChainMarket(connection, meta.id).catch(() => null) : null;
  const yes = cm ? Math.round(cm.yesPrice * 100) : 50;
  const settled = cm?.resolved ? (cm.winningSide === 1 ? "SETTLED YES" : "SETTLED NO") : null;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: "#0A0A0F", color: "#fff", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 900, letterSpacing: -2, color: "#D4FF3A" }}>CLOUT</div>
          <div style={{ display: "flex", fontSize: 24, color: "#8A8A99", border: "2px solid #2A2A35", borderRadius: 999, padding: "8px 20px" }}>
            hype markets · solana
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: square ? 64 : 40 }}>
          {meta?.image ? <img src={meta.image} width={96} height={96} style={{ borderRadius: 999, marginRight: 24 }} /> : null}
          <div style={{ display: "flex", fontSize: 64, fontWeight: 900 }}>${meta?.symbol ?? "???"}</div>
        </div>
        <div style={{ display: "flex", fontSize: square ? 46 : 52, fontWeight: 800, lineHeight: 1.15, marginTop: 24, maxWidth: W - 112 }}>
          {meta ? `Clout Score ${meta.threshold}+ by close?` : "Market not found"}
        </div>
        <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, color: "#8A8A99" }}>opened at</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 900 }}>{meta?.scoreAtOpen ?? "-"}</div>
          </div>
          {settled ? (
            <div style={{ display: "flex", fontSize: 56, fontWeight: 900, color: cm?.winningSide === 1 ? "#D4FF3A" : "#FF4D8D" }}>{settled}</div>
          ) : (
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", background: "#D4FF3A", color: "#0A0A0F", fontSize: 44, fontWeight: 900, padding: "18px 30px", borderRadius: 20 }}>YES {yes}¢</div>
              <div style={{ display: "flex", background: "#FF4D8D", color: "#0A0A0F", fontSize: 44, fontWeight: 900, padding: "18px 30px", borderRadius: 20 }}>NO {100 - yes}¢</div>
            </div>
          )}
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Cache-Control": "public, max-age=60" } },
  );
}
