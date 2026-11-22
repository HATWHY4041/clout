/**
 * Solana Action (Blink) for a Clout market: bet YES / NO straight from an X feed,
 * dial.to, or any Blinks-aware wallet. Devnet.
 */
import { NextRequest, NextResponse } from "next/server";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { DEVNET_CHAIN_ID, siteUrl } from "@/lib/config";
import { connection, faucet } from "@/lib/house";
import { getMarket } from "@/lib/store";
import { buildClaimTx, buildTradeTx, fetchChainMarket } from "@/lib/trade";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": DEVNET_CHAIN_ID,
  "Content-Type": "application/json",
};

const json = (body: any, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function OPTIONS() {
  return new NextResponse(null, { headers: HEADERS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getMarket(Number(id));
  const cm = meta ? await fetchChainMarket(connection, meta.id).catch(() => null) : null;
  if (!meta || !cm) return json({ message: "Market not found" }, 404);
  const base = `${siteUrl()}/api/actions/market/${id}`;
  const yesPct = Math.round(cm.yesPrice * 100);
  const closed = Math.floor(Date.now() / 1000) >= meta.endTs;

  const description = cm.resolved
    ? `Settled ${cm.winningSide === 1 ? "YES" : "NO"}: $${meta.symbol} Clout finished at ${meta.resolution?.score ?? "?"} (target ${meta.threshold}). Winners can claim 1 mUSDC per share.`
    : `$${meta.symbol} Clout Score is a live 0–100 hype meter from public trading data. It opened at ${meta.scoreAtOpen}; target ${meta.threshold}. Market says ${yesPct}% YES. Devnet test money: tap "Get test USDC" first.`;

  const actions = cm.resolved
    ? [{ type: "transaction", label: "Claim winnings", href: `${base}?claim=1` }]
    : closed
      ? []
      : [
          { type: "transaction", label: `YES ${yesPct}¢ · 10 USDC`, href: `${base}?side=yes&amount=10` },
          { type: "transaction", label: `NO ${100 - yesPct}¢ · 10 USDC`, href: `${base}?side=no&amount=10` },
          {
            type: "transaction",
            label: "Place bet",
            href: `${base}?side={side}&amount={amount}`,
            parameters: [
              { type: "select", name: "side", label: "Side", required: true, options: [{ label: "YES", value: "yes" }, { label: "NO", value: "no" }] },
              { type: "number", name: "amount", label: "Test USDC amount", required: true, min: 1, max: 500 },
            ],
          },
          { type: "transaction", label: "Get test USDC (free)", href: `${base}?faucet=1` },
        ];

  return json({
    type: "action",
    icon: `${siteUrl()}/api/og/${id}?sq=1`,
    title: meta.question,
    description,
    label: "Bet",
    disabled: !cm.resolved && closed,
    links: { actions },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sp = req.nextUrl.searchParams;
    const { account } = await req.json();
    const user = new PublicKey(account);
    const meta = await getMarket(Number(id));
    const cm = meta ? await fetchChainMarket(connection, meta.id) : null;
    if (!meta || !cm) return json({ message: "Market not found" }, 404);

    if (sp.get("faucet")) {
      const r = await faucet(user, "player");
      if (!r.ok) return json({ message: r.body?.error || "Faucet is busy. Try again in a bit." }, 422);
      const tx = new Transaction().add(
        new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(`Clout: got test USDC for market ${id}`) }),
      );
      tx.feePayer = user;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      return json({
        type: "transaction",
        transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
        message: "1,000 test USDC sent to your wallet. Sign this note to finish, then place your bet.",
      });
    }

    if (sp.get("claim")) {
      const tx = await buildClaimTx(connection, user, cm);
      return json({ type: "transaction", transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"), message: "Winnings claimed." });
    }

    const side = sp.get("side") === "no" ? "no" : "yes";
    const amount = Math.max(1, Math.min(500, Number(sp.get("amount")) || 10));
    if (cm.resolved || Math.floor(Date.now() / 1000) >= cm.endTs) return json({ message: "This market has closed." }, 422);
    const { tx, expectedOut } = await buildTradeTx(connection, user, cm, "buy", side, Math.floor(amount * 1e6));
    return json({
      type: "transaction",
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      message: `Bought ~${(expectedOut / 1e6).toFixed(2)} ${side.toUpperCase()} shares. Each pays 1 USDC if you're right.`,
    });
  } catch (e: any) {
    return json({ message: e.message || "Something went wrong" }, 400);
  }
}
