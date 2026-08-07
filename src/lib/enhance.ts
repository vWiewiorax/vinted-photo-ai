import sharp from "sharp";
import {
  STRENGTHS,
  clamp,
  type EnhanceParams,
  type StrengthKey,
} from "@/lib/params";

export const MAX_DIMENSION = 2000;

/** Neutralna gamma sRGB; obniżenie wejściowej rozjaśnia cienie bez przepalania. */
const NEUTRAL_GAMMA = 2.2;

type Luminance = { mean: number; stdev: number; dark: number };

/**
 * `sharp.stats()` liczy statystyki wejścia i ignoruje operacje w potoku,
 * więc luminancję trzeba zmaterializować. Analizujemy miniaturę — wyniki są
 * praktycznie identyczne, a jest to znacznie szybsze.
 */
async function luminance(input: Buffer): Promise<Luminance> {
  const thumb = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer();

  const histogram = new Array<number>(256).fill(0);
  for (const value of thumb) histogram[value] += 1;

  const total = thumb.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  const mean = sum / total;

  let variance = 0;
  for (let value = 0; value < 256; value += 1) {
    variance += histogram[value] * (value - mean) ** 2;
  }

  // Udział pikseli w cieniach — decyduje o sile wyciągania cieni.
  let shadowPixels = 0;
  for (let value = 0; value < 70; value += 1) shadowPixels += histogram[value];

  return {
    mean,
    stdev: Math.sqrt(variance / total),
    dark: shadowPixels / total,
  };
}

/**
 * Dobiera parametry korekty na podstawie statystyk obrazu. Nastawienie jest na
 * rozjaśnianie: im ciemniejsze i im więcej cieni, tym mocniejsze podniesienie
 * jasności i wyciągnięcie cieni. `strength` skaluje odejście od neutralnych
 * wartości, więc "Mocno" nie zmienia charakteru korekty, tylko jej siłę.
 */
export async function suggestParams(
  input: Buffer,
  strength: StrengthKey = "standard",
): Promise<EnhanceParams> {
  const factor = STRENGTHS[strength].factor;
  const [{ channels }, grey] = await Promise.all([
    sharp(input, { failOn: "none" }).rotate().stats(),
    luminance(input),
  ]);

  const [r, g, b] = channels;
  const scale = (value: number) => 1 + (value - 1) * factor;

  const targetMean = 148 + 30 * factor;

  // Całe rozjaśnianie robi gamma, a nie mnożenie jasności: krzywa `x^e` z e<1
  // wyciąga cienie, zostawia biel bielą i nie może przepalić jasnych partii.
  // Wykładnik dobieramy tak, by średnia luminancja trafiła w `targetMean`.
  const mean = clamp(grey.mean, 1, 250);
  const exponent =
    Math.log(Math.min(targetMean, 250) / 255) / Math.log(mean / 255);
  const shadows = clamp(NEUTRAL_GAMMA * (1 - exponent), 0, 1.2);

  // Gamma ma minimum 1.0, więc dla bardzo ciemnych zdjęć wykładnik nie wystarcza
  // do trafienia w cel — resztę dokłada mnożnik jasności.
  const afterCurve =
    255 * (mean / 255) ** ((NEUTRAL_GAMMA - shadows) / NEUTRAL_GAMMA);
  const brightness = clamp(targetMean / afterCurve, 1, 1.35);

  // Niski rozrzut tonów = płaskie zdjęcie, warto podnieść kontrast.
  const contrast = clamp(scale(1 + (46 - Math.min(grey.stdev, 46)) / 110), 1, 1.35);

  const channelSpread =
    Math.max(r.mean, g.mean, b.mean) - Math.min(r.mean, g.mean, b.mean);
  const saturation = clamp(
    scale(1.06 + (26 - Math.min(channelSpread, 26)) / 140),
    1,
    1.25,
  );

  // Wyostrzanie tylko dla mało szczegółowych (rozmytych) zdjęć.
  const sharpness = clamp((1.1 - Math.min(grey.stdev, 55) / 70) * factor, 0.15, 1);

  const round = (value: number) => Number(value.toFixed(3));
  return {
    brightness: round(brightness),
    shadows: round(shadows),
    contrast: round(contrast),
    saturation: round(saturation),
    sharpness: round(sharpness),
    warmth: 0,
    whiteBalance: channelSpread > 6,
    autoLevels: grey.stdev < 28,
  };
}

export async function enhance(
  input: Buffer,
  params: EnhanceParams,
): Promise<Buffer> {
  let pipeline = sharp(input, { failOn: "none" }).rotate();

  const metadata = await pipeline.metadata();
  const longest = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  if (longest > MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const shadows = clamp(params.shadows, 0, NEUTRAL_GAMMA - 1);
  if (shadows > 0.01) {
    pipeline = pipeline.gamma(NEUTRAL_GAMMA - shadows, NEUTRAL_GAMMA);
  }

  if (params.whiteBalance) {
    const { channels } = await sharp(input, { failOn: "none" }).rotate().stats();
    const means = channels.slice(0, 3).map((channel) => channel.mean);
    if (means.length === 3) {
      const average = (means[0] + means[1] + means[2]) / 3;
      const gains = means.map((mean) => clamp(average / Math.max(mean, 1), 0.8, 1.25));
      pipeline = pipeline.linear(gains, [0, 0, 0]);
    }
  }

  if (params.autoLevels) {
    pipeline = pipeline.normalise({ lower: 1, upper: 99 });
  }

  const contrast = clamp(params.contrast, 0.5, 2);
  if (Math.abs(contrast - 1) > 0.001) {
    pipeline = pipeline.linear(contrast, 128 * (1 - contrast));
  }

  const warmth = clamp(params.warmth, -1, 1);
  if (Math.abs(warmth) > 0.001) {
    pipeline = pipeline.linear([1 + warmth * 0.12, 1, 1 - warmth * 0.12], [0, 0, 0]);
  }

  pipeline = pipeline.modulate({
    brightness: clamp(params.brightness, 0.5, 2),
    saturation: clamp(params.saturation, 0, 2),
  });

  const sharpness = clamp(params.sharpness, 0, 2);
  if (sharpness > 0.01) {
    pipeline = pipeline.sharpen({
      sigma: 1 + sharpness * 0.6,
      m1: 0.4,
      m2: sharpness * 2.2,
    });
  }

  return pipeline.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}
