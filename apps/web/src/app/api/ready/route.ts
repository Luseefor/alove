import { NextResponse } from "next/server";
import { serviceReadiness } from "@/lib/serviceReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await serviceReadiness();
  return NextResponse.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
