export type EnhanceParams = {
  /** 1 = bez zmian, >1 rozjaśnia całe zdjęcie */
  brightness: number;
  /** 0..1 — wyciąganie cieni bez przepalania jasnych partii */
  shadows: number;
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

/** Mnożnik siły korekty dla trybu automatycznego. */
export const STRENGTHS = {
  light: { label: "Delikatnie", factor: 0.6 },
  standard: { label: "Standard", factor: 1 },
  strong: { label: "Mocno", factor: 1.5 },
} as const;

export type StrengthKey = keyof typeof STRENGTHS;

export const DEFAULT_PARAMS: EnhanceParams = {
  brightness: 1.12,
  shadows: 0.3,
  saturation: 1.12,
  contrast: 1.06,
  sharpness: 0.5,
  warmth: 0,
  whiteBalance: true,
  autoLevels: true,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function parseStrength(raw: unknown): StrengthKey {
  return typeof raw === "string" && raw in STRENGTHS
    ? (raw as StrengthKey)
    : "standard";
}

export function parseParams(raw: unknown): EnhanceParams {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PARAMS;
  const source = raw as Record<string, unknown>;
  const num = (key: keyof EnhanceParams, fallback: number) => {
    const value = Number(source[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const bool = (key: keyof EnhanceParams) =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : source[key] === "true";
  return {
    brightness: num("brightness", DEFAULT_PARAMS.brightness),
    shadows: num("shadows", DEFAULT_PARAMS.shadows),
    saturation: num("saturation", DEFAULT_PARAMS.saturation),
    contrast: num("contrast", DEFAULT_PARAMS.contrast),
    sharpness: num("sharpness", DEFAULT_PARAMS.sharpness),
    warmth: num("warmth", DEFAULT_PARAMS.warmth),
    whiteBalance: bool("whiteBalance"),
    autoLevels: bool("autoLevels"),
  };
}
