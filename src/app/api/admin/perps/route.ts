import { NextRequest, NextResponse } from "next/server";
import { createBuffer, deploy, status, writeChunks } from "@/lib/loader";
import { setup } from "@/lib/perps-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Idempotent deploy pipeline for the CI-built Clout Perps program:
 *   ?step=status | buffer | write | deploy | setup
 * Only ever deploys this repo's own build to Clout's own program address.
 */
export async function GET(req: NextRequest) {
  const step = req.nextUrl.searchParams.get("step") || "status";
  try {
    const out =
      step === "buffer" ? await createBuffer()
      : step === "write" ? await writeChunks(Number(req.nextUrl.searchParams.get("max")) || 120)
      : step === "deploy" ? await deploy()
      : step === "setup" ? await setup()
      : await status();
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e.message, logs: e.logs?.slice?.(-8) }, { status: 500 });
  }
}
