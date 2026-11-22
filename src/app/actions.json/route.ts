import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      rules: [
        { pathPattern: "/m/*", apiPath: "/api/actions/market/*" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}

export const OPTIONS = GET;
