"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  DEFAULT_PARAMS,
  STRENGTHS,
  type EnhanceParams,
  type StrengthKey,
} from "@/lib/params";

type PhotoSource =
  | { kind: "vinted"; url: string }
  | { kind: "file"; file: File };

type Photo = {
  id: string;
  name: string;
  source: PhotoSource;
  previewUrl: string;
  status: "idle" | "working" | "done" | "error";
  resultUrl?: string;
  usedParams?: EnhanceParams;
  error?: string;
};

const SLIDERS: {
  key: keyof EnhanceParams;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "brightness", label: "Jasność", min: 0.6, max: 1.7, step: 0.01 },
  { key: "shadows", label: "Wyciąganie cieni", min: 0, max: 1.2, step: 0.02 },
  { key: "contrast", label: "Kontrast", min: 0.8, max: 1.5, step: 0.01 },
  { key: "saturation", label: "Nasycenie", min: 0.5, max: 1.8, step: 0.01 },
  { key: "sharpness", label: "Wyostrzenie", min: 0, max: 1.5, step: 0.05 },
  { key: "warmth", label: "Ciepło barw", min: -1, max: 1, step: 0.05 },
];

const makeId = () => Math.random().toString(36).slice(2, 10);

function baseName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

export default function Home() {
  const [link, setLink] = useState("");
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [auto, setAuto] = useState(true);
  const [strength, setStrength] = useState<StrengthKey>("standard");
  const [params, setParams] = useState<EnhanceParams>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: string; variant: "before" | "after" } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const doneCount = photos.filter((photo) => photo.status === "done").length;
  const previewPhoto = photos.find((photo) => photo.id === preview?.id);
  const autoSummary = useMemo(
    () => photos.find((photo) => photo.usedParams)?.usedParams,
    [photos],
  );

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    );
  }, []);

  async function loadFromVinted() {
    setFetching(true);
    setFetchError(null);
    try {
      const response = await fetch("/api/vinted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Nie udało się pobrać oferty.");
      setItemTitle(data.title);
      setPhotos(
        (data.images as string[]).map((url, index) => ({
          id: makeId(),
          name: `vinted-${data.itemId}-${index + 1}`,
          source: { kind: "vinted", url },
          previewUrl: `/api/image?url=${encodeURIComponent(url)}`,
          status: "idle",
        })),
      );
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Coś poszło nie tak.");
    } finally {
      setFetching(false);
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added: Photo[] = [...files]
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        id: makeId(),
        name: baseName(file.name),
        source: { kind: "file", file },
        previewUrl: URL.createObjectURL(file),
        status: "idle",
      }));
    setPhotos((current) => [...current, ...added]);
  }

  async function enhancePhoto(photo: Photo) {
    updatePhoto(photo.id, { status: "working", error: undefined });
    const form = new FormData();
    if (photo.source.kind === "file") {
      form.append("file", photo.source.file);
    } else {
      form.append("imageUrl", photo.source.url);
    }
    form.append("auto", String(auto));
    if (auto) {
      form.append("strength", strength);
      form.append("autoCrop", String(params.autoCrop));
      form.append("cleanBackground", String(params.cleanBackground));
    } else {
      form.append("params", JSON.stringify(params));
    }

    try {
      const response = await fetch("/api/enhance", { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Nie udało się przetworzyć zdjęcia.");
      }
      const usedParams = response.headers.get("x-enhance-params");
      const blob = await response.blob();
      updatePhoto(photo.id, {
        status: "done",
        resultUrl: URL.createObjectURL(blob),
        usedParams: usedParams ? (JSON.parse(usedParams) as EnhanceParams) : undefined,
      });
    } catch (error) {
      updatePhoto(photo.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Błąd przetwarzania.",
      });
    }
  }

  async function enhanceAll() {
    setBusy(true);
    // Kolejno, żeby nie zajechać pamięci sharpa na wielu dużych zdjęciach.
    for (const photo of photos) {
      await enhancePhoto(photo);
    }
    setBusy(false);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const photo = current.find((item) => item.id === id);
      if (photo) {
        if (photo.source.kind === "file") URL.revokeObjectURL(photo.previewUrl);
        if (photo.resultUrl) URL.revokeObjectURL(photo.resultUrl);
      }
      return current.filter((item) => item.id !== id);
    });
    setPreview((current) => (current?.id === id ? null : current));
  }

  function saveBlob(blob: Blob, filename: string) {
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function downloadOriginal(photo: Photo) {
    const blob = await (await fetch(photo.previewUrl)).blob();
    const extension = blob.type.split("/")[1]?.split("+")[0] ?? "jpg";
    saveBlob(blob, `${photo.name}.${extension}`);
  }

  /** `variant: "ai"` pakuje poprawione zdjęcia, `"original"` — pobrane oryginały. */
  async function downloadZip(variant: "ai" | "original") {
    const selected =
      variant === "ai" ? photos.filter((photo) => photo.resultUrl) : photos;
    if (selected.length === 0) return;

    const zip = new JSZip();
    await Promise.all(
      selected.map(async (photo) => {
        const url = variant === "ai" ? photo.resultUrl! : photo.previewUrl;
        const blob = await (await fetch(url)).blob();
        const extension =
          variant === "ai" ? "jpg" : (blob.type.split("/")[1]?.split("+")[0] ?? "jpg");
        zip.file(
          `${photo.name}${variant === "ai" ? "-ai" : ""}.${extension}`,
          blob,
        );
      }),
    );
    saveBlob(
      await zip.generateAsync({ type: "blob" }),
      variant === "ai" ? "vinted-photo-ai.zip" : "vinted-oryginaly.zip",
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Vinted Photo AI
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
          Wklej link do oferty z Vinted albo wgraj własne zdjęcia — aplikacja
          przeanalizuje każde ujęcie, rozświetli je, wyrówna balans bieli, przytnie
          kadr wokół produktu i wyczyści tło. Sam produkt zostaje nietknięty:
          kolor, kształt, materiał, metki i ślady używania.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-medium">1a. Link do oferty</h2>
          <div className="mt-3 flex gap-2">
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && link.trim() && !fetching) loadFromVinted();
              }}
              placeholder="https://www.vinted.pl/items/123456789-kurtka"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <button
              onClick={loadFromVinted}
              disabled={fetching || link.trim() === ""}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {fetching ? "Pobieram…" : "Pobierz"}
            </button>
          </div>
          {fetchError && <p className="mt-2 text-sm text-red-600">{fetchError}</p>}
          {itemTitle && !fetchError && (
            <p className="mt-2 text-sm text-neutral-500">Oferta: {itemTitle}</p>
          )}
        </div>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(event.dataTransfer.files);
          }}
          className="rounded-xl border border-dashed border-neutral-300 p-4 dark:border-neutral-700"
        >
          <h2 className="text-sm font-medium">1b. Własne zdjęcia</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Przeciągnij pliki tutaj albo wybierz je z dysku.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => addFiles(event.target.files)}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="mt-3 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
          >
            Wybierz z dysku
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">2. Korekta</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => setAuto(event.target.checked)}
            />
            Auto (dobór parametrów per zdjęcie)
          </label>
        </div>

        {!auto && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SLIDERS.map((slider) => (
              <label key={slider.key} className="text-sm">
                <span className="flex justify-between text-neutral-500">
                  {slider.label}
                  <span>{Number(params[slider.key]).toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={slider.min}
                  max={slider.max}
                  step={slider.step}
                  value={Number(params[slider.key])}
                  onChange={(event) =>
                    setParams({ ...params, [slider.key]: Number(event.target.value) })
                  }
                  className="mt-1 w-full"
                />
              </label>
            ))}
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={params.whiteBalance}
                  onChange={(event) =>
                    setParams({ ...params, whiteBalance: event.target.checked })
                  }
                />
                Balans bieli
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={params.autoLevels}
                  onChange={(event) =>
                    setParams({ ...params, autoLevels: event.target.checked })
                  }
                />
                Auto-poziomy
              </label>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-2 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-900">
          <span className="text-neutral-500">Przygotowanie pod ofertę</span>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={params.autoCrop}
              onChange={(event) =>
                setParams({ ...params, autoCrop: event.target.checked })
              }
            />
            <span>
              Auto-kadr — przycina kadr wokół produktu (ok. 80% powierzchni, 3:4)
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={params.cleanBackground}
              onChange={(event) =>
                setParams({ ...params, cleanBackground: event.target.checked })
              }
            />
            <span>
              Czyste tło — wyrównuje tło do neutralnej bieli, nie dotyka produktu
            </span>
          </label>
          <p className="text-xs text-neutral-500">
            Oba działają tylko wtedy, gdy produkt da się pewnie wykryć (jednolite,
            jasne tło). Przy złożonej scenie zdjęcie zostaje w oryginalnym kadrze —
            lepiej nie ruszyć niż obciąć produkt.
          </p>
        </div>

        {auto && (
          <div className="mt-4">
            <span className="text-sm text-neutral-500">Siła rozjaśnienia</span>
            <div className="mt-2 flex gap-2">
              {(Object.keys(STRENGTHS) as StrengthKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setStrength(key)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    strength === key
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 dark:border-neutral-700"
                  }`}
                >
                  {STRENGTHS[key].label}
                </button>
              ))}
            </div>
            {autoSummary && (
              <p className="mt-3 text-xs text-neutral-500">
                Ostatni dobór: jasność {autoSummary.brightness}, cienie{" "}
                {autoSummary.shadows}, kontrast {autoSummary.contrast}, nasycenie{" "}
                {autoSummary.saturation}, wyostrzenie {autoSummary.sharpness}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={enhanceAll}
            disabled={busy || photos.length === 0}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {busy ? "Przetwarzam…" : `Popraw zdjęcia (${photos.length})`}
          </button>
          <button
            onClick={() => downloadZip("ai")}
            disabled={doneCount === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
          >
            Pobierz poprawione ZIP ({doneCount})
          </button>
          <button
            onClick={() => downloadZip("original")}
            disabled={photos.length === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
          >
            Pobierz oryginały ZIP ({photos.length})
          </button>
          {photos.length > 0 && (
            <button
              onClick={() => {
                photos.forEach((photo) => removePhoto(photo.id));
                setItemTitle(null);
              }}
              className="rounded-lg px-4 py-2 text-sm text-neutral-500"
            >
              Usuń wszystkie
            </button>
          )}
        </div>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {photos.map((photo) => (
          <article
            key={photo.id}
            className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
          >
            <div className="grid grid-cols-2 gap-px bg-neutral-200 dark:bg-neutral-800">
              <figure className="bg-white dark:bg-black">
                <button
                  onClick={() => setPreview({ id: photo.id, variant: "before" })}
                  title="Powiększ oryginał"
                  className="block w-full cursor-zoom-in"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={`${photo.name} — oryginał`}
                    className="aspect-3/4 w-full object-cover"
                  />
                </button>
                <figcaption className="px-2 py-1 text-center text-xs text-neutral-500">
                  przed
                </figcaption>
              </figure>
              <figure className="bg-white dark:bg-black">
                {photo.resultUrl ? (
                  <button
                    onClick={() => setPreview({ id: photo.id, variant: "after" })}
                    title="Powiększ poprawione"
                    className="block w-full cursor-zoom-in"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.resultUrl}
                      alt={`${photo.name} — po korekcie`}
                      className="aspect-3/4 w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex aspect-3/4 w-full items-center justify-center text-xs text-neutral-400">
                    {photo.status === "working" ? "przetwarzam…" : "—"}
                  </div>
                )}
                <figcaption className="px-2 py-1 text-center text-xs text-neutral-500">
                  po
                </figcaption>
              </figure>
            </div>
            <div className="p-3">
              <span className="block truncate text-xs text-neutral-500" title={photo.name}>
                {photo.name}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => enhancePhoto(photo)}
                  disabled={photo.status === "working"}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700"
                >
                  {photo.resultUrl ? "Ponów" : "Popraw"}
                </button>
                {photo.resultUrl && (
                  <a
                    href={photo.resultUrl}
                    download={`${photo.name}-ai.jpg`}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                  >
                    Pobierz poprawione
                  </a>
                )}
                <button
                  onClick={() => downloadOriginal(photo)}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
                >
                  Pobierz oryginał
                </button>
                <button
                  onClick={() => removePhoto(photo.id)}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 dark:border-red-900"
                >
                  Usuń
                </button>
              </div>
            </div>
            {photo.error && (
              <p className="px-3 pb-3 text-xs text-red-600">{photo.error}</p>
            )}
          </article>
        ))}
      </section>

      {previewPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              preview?.variant === "after" && previewPhoto.resultUrl
                ? previewPhoto.resultUrl
                : previewPhoto.previewUrl
            }
            alt={previewPhoto.name}
            className="max-h-[80vh] max-w-full object-contain"
          />
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex flex-wrap items-center justify-center gap-2 text-sm text-white"
          >
            <span className="mr-2">
              {previewPhoto.name} — {preview?.variant === "after" ? "po korekcie" : "oryginał"}
            </span>
            {previewPhoto.resultUrl && (
              <button
                onClick={() =>
                  setPreview({
                    id: previewPhoto.id,
                    variant: preview?.variant === "after" ? "before" : "after",
                  })
                }
                className="rounded-md border border-white/40 px-3 py-1"
              >
                Pokaż {preview?.variant === "after" ? "oryginał" : "poprawione"}
              </button>
            )}
            <button
              onClick={() => setPreview(null)}
              className="rounded-md border border-white/40 px-3 py-1"
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
