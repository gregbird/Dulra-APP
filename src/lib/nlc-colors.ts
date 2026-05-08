/**
 * NLC LEVEL_2_VALUE → fill colour mapping.
 *
 * Canonical Esri "native" palette ported from the web repo's
 * `lib/external-apis/osi.ts` (NLC_NATIVE_LEVEL2_COLORS), itself sourced
 * from Tailte Éireann FeatureServer's own
 * `drawingInfo.uniqueValueInfos` payload.
 *
 * **Important — keyed by LEVEL_2_VALUE (human-readable name), not
 * LEVEL_2_ID.** Web team flagged this during the Phase 1 pre-flight: the
 * FeatureServer returns inconsistent case across LEVEL_1_VALUE and
 * sometimes across LEVEL_2_VALUE too, so the caller MUST pass the
 * server-returned string verbatim — no normalisation, no lower-casing.
 *
 * Codes that don't appear in this map render with `NLC_FALLBACK_COLOR`.
 * Surveyors will see grey for any unknown code, which is correct
 * fallback behaviour — the Habitats list still surfaces the
 * LEVEL_2_VALUE text.
 */

export const NLC_FALLBACK_COLOR = "#9ca3af";

/**
 * Canonical native palette, 35 entries. Keep in sync with web's
 * NLC_NATIVE_LEVEL2_COLORS — both repos source from the same
 * FeatureServer drawingInfo so any change must land in both places.
 */
export const NLC_LEVEL2_COLORS: Record<string, string> = {
  "Amenity Grassland": "#a2f14f",
  "Artificial Waterbodies": "#004da8",
  "Bare Peat": "#846044",
  "Bare Soil and Disturbed Ground": "#4a2d00",
  "Blanket Bog": "#a87000",
  Bracken: "#f4c7da",
  "Broadleaved Forest and Woodland": "#6bad00",
  Buildings: "#ff2d35",
  "Burnt Areas": "#e6a700",
  "Coastal Sediments": "#f9f382",
  "Coniferous Forest": "#265000",
  "Cultivated Land": "#ffffac",
  "Cutover Bog": "#d49676",
  "Dry Grassland": "#def3cc",
  "Dry Heath": "#c190d0",
  "Exposed Rock and Sediments": "#819498",
  Fens: "#cdf57a",
  Hedgerows: "#81516b",
  "Improved Grassland": "#7ccc59",
  "Lakes and Ponds": "#0099ff",
  "Marine Water": "#bdf2ff",
  "Mixed Forest": "#507c00",
  Mudflats: "#d0c29e",
  "Other Artificial Surfaces": "#dcdcdc",
  "Raised Bog": "#732600",
  "Rivers and Streams": "#73b2ff",
  "Salt Marsh": "#afb400",
  "Sand Dunes": "#ecff2e",
  Scrub: "#a0d023",
  Swamp: "#cdaa66",
  "Transitional Forest": "#7a8f21",
  "Transitional Waterbodies": "#73dfff",
  Treelines: "#e8e762",
  Ways: "#808a8c",
  "Wet Grassland": "#38a800",
  "Wet Heath": "#7d00a2",
};

/**
 * Heritage Council Level-1 fallback palette. NOT used in v1 — kept
 * here so the Phase 4 palette toggle has both options ready.
 *
 * **Case sensitivity warning**: the FeatureServer returns LEVEL_1_VALUE
 * with inconsistent case (e.g. "GRASSLAND, SALTMARSH and SWAMP" — note
 * lowercase "and"). Match exactly as returned; do not normalise.
 */
export const NLC_LEVEL1_COLORS: Record<string, string> = {
  "ARTIFICIAL SURFACES": "#DC2626",
  "CULTIVATED LAND": "#808080",
  "FOREST, WOODLAND AND SCRUB": "#228B22",
  "GRASSLAND, SALTMARSH and SWAMP": "#FFD700",
  PEATLAND: "#9B59B6",
  "HEATH and BRACKEN": "#8B4513",
  WATERBODIES: "#87CEEB",
  "EXPOSED SURFACES": "#DC2626",
};

/**
 * Resolve a Level-2 fill colour. Caller passes the server-returned
 * `LEVEL_2_VALUE` string verbatim — no normalisation. Unknown values
 * fall through to NLC_FALLBACK_COLOR.
 */
export function nlcColorFor(level2Value: string | null | undefined): string {
  if (!level2Value) return NLC_FALLBACK_COLOR;
  return NLC_LEVEL2_COLORS[level2Value] ?? NLC_FALLBACK_COLOR;
}
