import { NextResponse } from "next/server";
import { BROWSER_HEADERS, isVintedImageUrl } from "@/lib/vinted";

export const runtime = "nodejs";

/** Podgląd oryginałów z CDN Vinted (obchodzi ograniczenia referera). */
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target || !isVintedImageUrl(target)) {
    return NextResponse.json({ error: "Niedozwolony adres zdjęcia." }, { status: 400 });
  }

  const response = await fetch(target, { headers: BROWSER_HEADERS, cache: "no-store" });
  if (!response.ok) {
    return NextResponse.json(
      { error: `Nie udało się pobrać zdjęcia (HTTP ${response.status}).` },
      { status: 502 },
    );
  }

  return new NextResponse(response.body, {
    headers: {
      "content-type": response.headers.get("content-type") ?? "image/webp",
      "cache-control": "public, max-age=3600",
    },
  });
}
