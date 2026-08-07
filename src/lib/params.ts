export type EnhanceParams = {
  /** 1 = bez zmian, >1 rozjaśnia */
  brightness: number;
  /** 1 = bez zmian, >1 mocniejsze kolory */
  saturation: number;
  /** 1 = bez zmian, >1 większy kontrast (obrót wokół tonu środkowego) */
  contrast: number;
  /** 0 = bez wyostrzania, ~1 rozsądne maksimum */
  sharpness: number;
  /** -1 (zimne) .. 1 (ciepłe) */
  warmth: number;
  /** wyrównanie balansu bieli na podstawie średnich kanałów */
  whiteBalance: boolean;
  /** rozciągnięcie histogramu (auto-poziomy) */
  autoLevels: boolean;
};

export const DEFAULT_PARAMS: EnhanceParams = {
  brightness: 1.08,
  saturation: 1.12,
  contrast: 1.08,
  sharpness: 0.6,
  warmth: 0,
  whiteBalance: true,
  autoLevels: true,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function parseParams(raw: unknown): EnhanceParams {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PARAMS;
  const source = raw as Record<string, unknown>;
  const num = (key: keyof EnhanceParams, fallback: number) => {
    const value = Number(source[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    brightness: num("brightness", DEFAULT_PARAMS.brightness),
    saturation: num("saturation", DEFAULT_PARAMS.saturation),
    contrast: num("contrast", DEFAULT_PARAMS.contrast),
    sharpness: num("sharpness", DEFAULT_PARAMS.sharpness),
    warmth: num("warmth", DEFAULT_PARAMS.warmth),
    whiteBalance:
      typeof source.whiteBalance === "boolean"
        ? source.whiteBalance
        : source.whiteBalance === "true",
    autoLevels:
      typeof source.autoLevels === "boolean"
        ? source.autoLevels
        : source.autoLevels === "true",
  };
}
