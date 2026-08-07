"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { DEFAULT_PARAMS, type EnhanceParams } from "@/lib/params";

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
  { key: "brightness", label: "Jasność", min: 0.6, max: 1.6, step: 0.01 },
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
  const [params, setParams] = useState<EnhanceParams>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const doneCount = photos.filter((photo) => photo.status === "done").length;
  const autoSummary = useMemo(
    () => photos.find((photo) => photo.usedParams)?.usedParams,
    [photos],
  );

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
    if (!auto) form.append("params", JSON.stringify(params));

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

  async function downloadZip() {
    const ready = photos.filter((photo) => photo.resultUrl);
    if (ready.length === 0) return;
    const zip = new JSZip();
    await Promise.all(
      ready.map(async (photo) => {
        const blob = await (await fetch(photo.resultUrl!)).blob();
        zip.file(`${photo.name}-ai.jpg`, blob);
      }),
    );
    const archive = await zip.generateAsync({ type: "blob" });
    const href = URL.createObjectURL(archive);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "vinted-photo-ai.zip";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Vinted Photo AI
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
          Wklej link do oferty z Vinted albo wgraj własne zdjęcia — aplikacja
          przeanalizuje każde ujęcie i automatycznie je rozświetli, wyrówna balans
          bieli, podbije kolory i wyostrzy szczegóły.
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

        {auto && autoSummary && (
          <p className="mt-3 text-xs text-neutral-500">
            Ostatni dobór: jasność {autoSummary.brightness}, kontrast{" "}
            {autoSummary.contrast}, nasycenie {autoSummary.saturation}, wyostrzenie{" "}
            {autoSummary.sharpness}
          </p>
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
            onClick={downloadZip}
            disabled={doneCount === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-700"
          >
            Pobierz ZIP ({doneCount})
          </button>
          {photos.length > 0 && (
            <button
              onClick={() => {
                setPhotos([]);
                setItemTitle(null);
              }}
              className="rounded-lg px-4 py-2 text-sm text-neutral-500"
            >
              Wyczyść
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.previewUrl}
                  alt={`${photo.name} — oryginał`}
                  className="aspect-3/4 w-full object-cover"
                />
                <figcaption className="px-2 py-1 text-center text-xs text-neutral-500">
                  przed
                </figcaption>
              </figure>
              <figure className="bg-white dark:bg-black">
                {photo.resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo.resultUrl}
                    alt={`${photo.name} — po korekcie`}
                    className="aspect-3/4 w-full object-cover"
                  />
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
            <div className="flex items-center justify-between gap-2 p-3">
              <span className="truncate text-xs text-neutral-500" title={photo.name}>
                {photo.name}
              </span>
              <div className="flex shrink-0 gap-2">
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
                    Pobierz
                  </a>
                )}
              </div>
            </div>
            {photo.error && (
              <p className="px-3 pb-3 text-xs text-red-600">{photo.error}</p>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
