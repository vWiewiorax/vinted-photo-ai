import sharp from "sharp";
import { clamp, type EnhanceParams } from "@/lib/params";

export const MAX_DIMENSION = 2000;

/**
 * Dobiera parametry korekty na podstawie statystyk obrazu: jasności,
 * rozrzutu tonów i nasycenia. Zdjęcia z Vinted są zwykle niedoświetlone
 * i płaskie, więc ciemniejsze wejście dostaje mocniejszą korektę.
 */
export async function suggestParams(input: Buffer): Promise<EnhanceParams> {
  const image = sharp(input, { failOn: "none" }).rotate();
  const [stats, greyStats] = await Promise.all([
    image.clone().stats(),
    image.clone().greyscale().stats(),
  ]);

  const [r, g, b] = stats.channels;
  const grey = greyStats.channels[0];

  const targetMean = 152;
  const brightness = clamp(targetMean / Math.max(grey.mean, 1), 0.85, 1.55);

  // Niski rozrzut tonów = płaskie zdjęcie, warto podnieść kontrast.
  const contrast = clamp(1 + (46 - Math.min(grey.stdev, 46)) / 90, 1, 1.4);

  const channelSpread =
    Math.max(r.mean, g.mean, b.mean) - Math.min(r.mean, g.mean, b.mean);
  const saturation = clamp(1.05 + (26 - Math.min(channelSpread, 26)) / 120, 1, 1.35);

  // Wyostrzanie tylko dla mało szczegółowych (rozmytych) zdjęć.
  const sharpness = clamp(1.1 - Math.min(grey.stdev, 55) / 70, 0.25, 1);

  return {
    brightness: Number(brightness.toFixed(3)),
    saturation: Number(saturation.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    sharpness: Number(sharpness.toFixed(3)),
    warmth: 0,
    whiteBalance: channelSpread > 6,
    autoLevels: grey.stdev < 62,
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

  if (params.whiteBalance) {
    const { channels } = await sharp(input, { failOn: "none" })
      .rotate()
      .stats();
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
    pipeline = pipeline.linear(
      [1 + warmth * 0.12, 1, 1 - warmth * 0.12],
      [0, 0, 0],
    );
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
