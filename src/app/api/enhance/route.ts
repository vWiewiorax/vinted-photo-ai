import { NextResponse } from "next/server";
import { enhance, suggestParams } from "@/lib/enhance";
import { parseParams, parseStrength } from "@/lib/params";
import { BROWSER_HEADERS, isVintedImageUrl } from "@/lib/vinted";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

async function loadSource(form: FormData): Promise<Buffer> {
  const file = form.get("file");
  if (file instanceof Blob) {
    if (file.size > MAX_BYTES) {
      throw new Error("Plik jest za duży (limit 20 MB).");
    }
    return Buffer.from(await file.arrayBuffer());
  }

  const imageUrl = form.get("imageUrl");
  if (typeof imageUrl === "string" && isVintedImageUrl(imageUrl)) {
    const response = await fetch(imageUrl, { headers: BROWSER_HEADERS, cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Nie udało się pobrać zdjęcia (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error("Zdjęcie jest za duże (limit 20 MB).");
    }
    return buffer;
  }

  throw new Error("Brak zdjęcia do przetworzenia.");
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const source = await loadSource(form);

    const auto = form.get("auto") !== "false";
    let params;
    if (auto) {
      params = await suggestParams(source, parseStrength(form.get("strength")));
      // Kadr i czyszczenie tła są niezależne od automatyki tonalnej — to decyzja
      // użytkownika, więc przychodzą osobno także w trybie auto.
      params.autoCrop = form.get("autoCrop") !== "false";
      params.cleanBackground = form.get("cleanBackground") !== "false";
    } else {
      const raw = form.get("params");
      params = parseParams(typeof raw === "string" ? JSON.parse(raw) : {});
    }

    const output = await enhance(source, params);

    return new NextResponse(new Uint8Array(output), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "x-enhance-params": JSON.stringify(params),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się przetworzyć zdjęcia.";
    console.error("enhance failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
