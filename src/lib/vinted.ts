export const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "pl-PL,pl;q=0.9,en;q=0.8",
};

const ALLOWED_PAGE_HOST = /^([a-z0-9-]+\.)*vinted\.[a-z.]{2,6}$/;
const ALLOWED_IMAGE_HOST = /^images\d*\.vinted\.net$/;

export class VintedError extends Error {}

export function assertVintedItemUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new VintedError("To nie jest poprawny adres URL.");
  }
  if (url.protocol !== "https:" || !ALLOWED_PAGE_HOST.test(url.hostname)) {
    throw new VintedError("Podaj link do oferty na vinted.pl (lub innej domenie Vinted).");
  }
  if (!/^\/items\/\d+/.test(url.pathname)) {
    throw new VintedError("Link musi prowadzić do konkretnej oferty, np. https://www.vinted.pl/items/123456789-nazwa");
  }
  return url;
}

export function isVintedImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED_IMAGE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export type VintedItem = {
  itemId: string;
  title: string;
  images: string[];
};

function decode(value: string): string {
  return value.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/\\"/g, '"');
}

/**
 * Strona oferty zawiera wstrzyknięty stan aplikacji z adresami zdjęć.
 * Bierzemy `full_size_url` (oryginał), a gdy go brak — wariant `f800`.
 */
export function extractImages(html: string): string[] {
  const fullSize = [
    ...html.matchAll(/full_size_url\\?":\\?"(https:(?:\\\/|[^"\\])+)/g),
  ].map((m) => decode(m[1]));
  const fallback = [...html.matchAll(/https:\\?\/\\?\/images\d*\.vinted\.net[^"\\]*f800[^"\\]*/g)].map(
    (m) => decode(m[0]),
  );
  const candidates = (fullSize.length > 0 ? fullSize : fallback).filter(isVintedImageUrl);
  return [...new Set(candidates)];
}

export function extractTitle(html: string): string {
  const jsonTitle = html.match(/"title":"([^"\\]{3,160})"/);
  if (jsonTitle) return decode(jsonTitle[1]);
  const tag = html.match(/<title>([^<]+)<\/title>/i);
  return tag ? tag[1].split("|")[0].trim() : "Oferta Vinted";
}

export async function fetchVintedItem(rawUrl: string): Promise<VintedItem> {
  const url = assertVintedItemUrl(rawUrl);
  const response = await fetch(url.toString(), {
    headers: BROWSER_HEADERS,
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new VintedError(
      `Vinted odrzucił żądanie (HTTP ${response.status}). Spróbuj ponownie lub wgraj zdjęcia ręcznie.`,
    );
  }
  const html = await response.text();
  const images = extractImages(html);
  if (images.length === 0) {
    throw new VintedError(
      "Nie znaleziono zdjęć w tej ofercie. Możliwe, że została usunięta — wgraj zdjęcia ręcznie.",
    );
  }
  return {
    itemId: url.pathname.split("/")[2].split("-")[0],
    title: extractTitle(html),
    images,
  };
}
