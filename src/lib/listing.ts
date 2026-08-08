import sharp from "sharp";
import { clamp } from "@/lib/params";

/** Rozdzielczość analizy — maska i kadr są potem skalowane do pełnego obrazu. */
const SAMPLE = 320;

/** Docelowy udział produktu w powierzchni kadru (prompt: 70–90%). */
const TARGET_COVERAGE = 0.78;

/** Neutralne, lekko ciepłe tło studyjne. */
export const BACKGROUND_COLOR = { r: 247, g: 245, b: 242 };

export type Box = { left: number; top: number; width: number; height: number };

export type Analysis = {
  width: number;
  height: number;
  /** Prostokąt produktu w pikselach analizowanego obrazu. */
  box: Box | null;
  /** Kolor tła (mediana ramki kadru). */
  background: { r: number; g: number; b: number };
  /** Jednorodność tła — im mniej, tym „studyjniej”. */
  backgroundSpread: number;
  /** 255 = tło, 0 = produkt; rozmiar `width` × `height`. */
  mask: Uint8Array;
  coverage: number;
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/**
 * Wykrywa produkt na zdjęciu: kolor tła bierze z ramki kadru, a maskę tła
 * rozlewa (flood fill) od krawędzi. Dzięki temu jasne fragmenty samego produktu
 * (np. biała koszulka) nie są mylone z tłem, bo nie łączą się z brzegiem.
 */
export async function analyze(input: Buffer): Promise<Analysis> {
  const { data, info } = await sharp(input, { failOn: "none" })
    .removeAlpha()
    .resize({ width: SAMPLE, height: SAMPLE, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const at = (index: number) => index * channels;

  const border = Math.max(2, Math.round(Math.min(width, height) * 0.05));
  const samples: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge =
        x < border || y < border || x >= width - border || y >= height - border;
      if (!edge) continue;
      const offset = at(y * width + x);
      samples[0].push(data[offset]);
      samples[1].push(data[offset + 1]);
      samples[2].push(data[offset + 2]);
    }
  }

  const background = {
    r: median(samples[0]),
    g: median(samples[1]),
    b: median(samples[2]),
  };

  // Rozrzut ramki: mierzy, jak bardzo tło odstaje od własnej mediany.
  let spread = 0;
  for (let i = 0; i < samples[0].length; i += 1) {
    spread += Math.max(
      Math.abs(samples[0][i] - background.r),
      Math.abs(samples[1][i] - background.g),
      Math.abs(samples[2][i] - background.b),
    );
  }
  const backgroundSpread = samples[0].length > 0 ? spread / samples[0].length : 255;

  const tolerance = clamp(20 + backgroundSpread * 1.6, 24, 64);
  const similar = (index: number) => {
    const offset = at(index);
    return (
      Math.max(
        Math.abs(data[offset] - background.r),
        Math.abs(data[offset + 1] - background.g),
        Math.abs(data[offset + 2] - background.b),
      ) <= tolerance
    );
  };

  const mask = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (index: number) => {
    if (mask[index] === 255 || !similar(index)) return;
    mask[index] = 255;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (queue.length > 0) {
    const index = queue.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  despeckle(mask, width, height);
  const { box, coverage } = productBox(mask, width, height);

  return { width, height, box, background, backgroundSpread, mask, coverage };
}

/**
 * Filtr większościowy 3×3: kasuje pojedyncze piksele odstające od otoczenia,
 * czyli szum sensora i drobne refleksy, które inaczej rozciągałyby kadr.
 */
function despeckle(mask: Uint8Array, width: number, height: number) {
  for (let pass = 0; pass < 2; pass += 1) {
    const source = Uint8Array.from(mask);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        let votes = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (source[(y + dy) * width + x + dx] === 255) votes += 1;
          }
        }
        mask[y * width + x] = votes >= 5 ? 255 : 0;
      }
    }
  }
}

/**
 * Prostokąt produktu ze spójnych składowych maski. Bierzemy największą plamę
 * oraz wszystkie porównywalnie duże (rączka torebki bywa odcięta tłem od
 * korpusu), a pomijamy drobne — cienie, refleksy, elementy tła w narożnikach.
 */
function productBox(mask: Uint8Array, width: number, height: number) {
  const label = new Int32Array(mask.length).fill(-1);
  const boxes: (Box & { size: number })[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 255 || label[start] !== -1) continue;
    const id = boxes.length;
    const stack = [start];
    label[start] = id;
    let size = 0;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      size += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || mask[next] === 255 || label[next] !== -1) continue;
        label[next] = id;
        stack.push(next);
      }
    }

    boxes.push({ left, top, width: right - left + 1, height: bottom - top + 1, size });
  }

  if (boxes.length === 0) return { box: null, coverage: 0 };

  const largest = boxes.reduce((best, item) => (item.size > best.size ? item : best));
  const kept = boxes.filter((item) => item.size >= largest.size * 0.2);

  const left = Math.min(...kept.map((item) => item.left));
  const top = Math.min(...kept.map((item) => item.top));
  const right = Math.max(...kept.map((item) => item.left + item.width));
  const bottom = Math.max(...kept.map((item) => item.top + item.height));
  const size = kept.reduce((sum, item) => sum + item.size, 0);

  return {
    box: { left, top, width: right - left, height: bottom - top },
    coverage: size / (width * height),
  };
}

/**
 * Kadr wokół produktu: dokłada margines tak, by produkt zajął ~`TARGET_COVERAGE`
 * powierzchni, wyrównuje do proporcji 3:4 (lub 4:3 dla ujęć poziomych) i przycina
 * do granic zdjęcia. Zwraca `null`, gdy kadrowanie nic nie zmienia albo detekcja
 * jest niepewna (produkt wypełnia całe zdjęcie lub prawie go nie ma).
 */
export function cropBox(
  analysis: Analysis,
  target: { width: number; height: number },
): Box | null {
  const { box } = analysis;
  if (!box) return null;
  if (analysis.coverage < 0.04 || analysis.coverage > 0.92) return null;

  const scaleX = target.width / analysis.width;
  const scaleY = target.height / analysis.height;
  const product = {
    left: box.left * scaleX,
    top: box.top * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };

  // Margines wynikający z docelowego pokrycia (produkt jest wpisany w kadr).
  const growth = 1 / Math.sqrt(TARGET_COVERAGE);
  let width = product.width * growth;
  let height = product.height * growth;

  const ratio = product.width > product.height ? 4 / 3 : 3 / 4;
  if (width / height > ratio) height = width / ratio;
  else width = height * ratio;

  const centerX = product.left + product.width / 2;
  const centerY = product.top + product.height / 2;

  width = Math.min(width, target.width);
  height = Math.min(height, target.height);

  const left = clamp(centerX - width / 2, 0, target.width - width);
  const top = clamp(centerY - height / 2, 0, target.height - height);

  const crop = {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
  crop.width = Math.min(crop.width, target.width - crop.left);
  crop.height = Math.min(crop.height, target.height - crop.top);

  const shrink = (crop.width * crop.height) / (target.width * target.height);
  if (shrink > 0.97) return null;
  return crop;
}

/** Balans bieli liczony z tła: neutralizuje przebarwienie oświetlenia. */
export function backgroundGains(analysis: Analysis): [number, number, number] | null {
  const { r, g, b } = analysis.background;
  const mean = (r + g + b) / 3;
  if (mean < 90) return null;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 3) return null;
  return [
    clamp(mean / Math.max(r, 1), 0.86, 1.16),
    clamp(mean / Math.max(g, 1), 0.86, 1.16),
    clamp(mean / Math.max(b, 1), 0.86, 1.16),
  ];
}

/** Czyścimy tło tylko gdy jest jasne i jednorodne — inaczej to nie jest tło studyjne. */
export function backgroundIsCleanable(analysis: Analysis) {
  const { r, g, b } = analysis.background;
  const mean = (r + g + b) / 3;
  return (
    analysis.box !== null &&
    analysis.coverage > 0.04 &&
    analysis.coverage < 0.9 &&
    mean > 120 &&
    analysis.backgroundSpread < 26
  );
}

/**
 * Warstwa neutralnego tła z maską alfa produktu. Kryjemy tło tylko częściowo
 * (`strength` < 1), więc naturalne cienie i gradient światła zostają widoczne.
 */
export async function backgroundLayer(
  analysis: Analysis,
  target: { width: number; height: number },
  crop: Box | null,
  strength = 0.72,
): Promise<Buffer> {
  const scaleX = analysis.width / target.width;
  const scaleY = analysis.height / target.height;

  let alpha = sharp(analysis.mask, {
    raw: { width: analysis.width, height: analysis.height, channels: 1 },
  });

  if (crop) {
    alpha = alpha.extract({
      left: Math.floor(crop.left * scaleX),
      top: Math.floor(crop.top * scaleY),
      width: Math.max(1, Math.round(crop.width * scaleX)),
      height: Math.max(1, Math.round(crop.height * scaleY)),
    });
  }

  const width = crop ? crop.width : target.width;
  const height = crop ? crop.height : target.height;

  // Rozmycie wtapia krawędź maski, a progowanie (linear z ujemnym offsetem)
  // cofa ją od produktu — bez tego na obrysie powstaje jasna obwódka.
  const threshold = 70;
  const gain = (255 / (255 - threshold)) * strength;
  // `toColourspace("b-w")` jest konieczne: bez tego sharp rozwija maskę do sRGB
  // i `joinChannel` dostaje trzy kanały zamiast jednego.
  const alphaData = await alpha
    .resize({ width, height, fit: "fill" })
    .blur(Math.max(1, Math.min(width, height) * 0.008))
    .linear(gain, -threshold * gain)
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  return sharp({
    create: { width, height, channels: 3, background: BACKGROUND_COLOR },
  })
    .joinChannel(alphaData, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}
