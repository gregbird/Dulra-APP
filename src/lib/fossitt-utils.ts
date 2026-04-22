import fossittAll from "@/lib/fossitt-codes.json";

interface FossittEntry {
  code: string;
  name: string;
  level: number;
  parent?: string;
  color?: string;
  annex1?: string;
}

const byCode = new Map<string, FossittEntry>();
for (const entry of fossittAll as FossittEntry[]) {
  byCode.set(entry.code, entry);
}

const FALLBACK_COLOR = "#9CA3AF";

/**
 * Returns the Fossitt habitat code's color (from fossitt-codes.json).
 * Falls back to ancestor codes (PB4 → PB → P) if the exact code isn't found,
 * then to a neutral grey.
 */
export function getFossittColor(code: string | null | undefined): string {
  if (!code) return FALLBACK_COLOR;
  let current: string | undefined = code;
  while (current) {
    const entry = byCode.get(current);
    if (entry?.color) return entry.color;
    current = entry?.parent;
  }
  return FALLBACK_COLOR;
}
