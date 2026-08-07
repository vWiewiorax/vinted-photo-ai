import { NextResponse } from "next/server";
import { VintedError, fetchVintedItem } from "@/lib/vinted";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe żądanie." }, { status: 400 });
  }

  if (typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: "Podaj link do oferty." }, { status: 400 });
  }

  try {
    const item = await fetchVintedItem(url);
    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof VintedError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("vinted fetch failed", error);
    return NextResponse.json(
      { error: "Nie udało się pobrać oferty. Spróbuj ponownie później." },
      { status: 502 },
    );
  }
}
