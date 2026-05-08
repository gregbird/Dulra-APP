/**
 * NLC LEVEL_2_ID → fill colour mapping.
 *
 * **Provisional palette** — to be replaced with the canonical
 * `NLC_NATIVE_LEVEL2_COLORS` map from the web repo's
 * `lib/external-apis/osi.ts`. Web team to share the exact RGB values
 * during Phase 1 review so we maintain visual parity. Until then this
 * approximates Heritage Council / NLC 2018 native scheme conventions
 * (greens for grassland/woodland, browns for peat/heath, blues for
 * water, reds/oranges for built-up, greys for bare ground).
 *
 * Codes that don't appear in this map render with `NLC_FALLBACK_COLOR`.
 * Surveyors will see grey for any unmapped code, which is correct
 * behaviour — the Habitats list still surfaces the LEVEL_2_VALUE text.
 */

export const NLC_FALLBACK_COLOR = "#9ca3af";

export const NLC_LEVEL2_COLORS: Record<string, string> = {
  // Forest, woodland and scrub
  WL1: "#2f6f3a",
  WL2: "#3a8146",
  WL3: "#4a9758",
  WL4: "#5fad6c",
  WL5: "#75c082",
  WS1: "#6b8e3a",
  WS2: "#7ea34a",
  WS3: "#92b85c",

  // Grassland, saltmarsh and swamp
  GA1: "#b6d472",
  GA2: "#a3c95e",
  GS1: "#90be4c",
  GS2: "#7fb43c",
  GM1: "#6fa92e",
  CW1: "#a3b370",
  CM1: "#8fa05a",

  // Heath and bog
  HH1: "#7c5e9a",
  HH2: "#8e6fab",
  HH3: "#9f80bc",
  HD1: "#6f527d",
  PB1: "#5a4233",
  PB2: "#6e533f",
  PB3: "#82644b",
  PB4: "#967558",

  // Freshwater
  FW1: "#3a82d6",
  FW2: "#5294e0",
  FL1: "#1f6cc4",
  FL2: "#3580d2",
  FP1: "#4f8fdd",
  FS1: "#669be3",

  // Coastal / marine
  CC1: "#d8c98a",
  CC2: "#cdbb78",
  CB1: "#bba968",
  CS1: "#e6d9a2",
  MR1: "#1851a8",

  // Exposed rock and disturbed ground
  ER1: "#9b9b9b",
  ER2: "#aeaeae",
  ER3: "#c2c2c2",
  ED1: "#86796b",
  ED2: "#9a8b7c",

  // Cultivated and built land
  CL1: "#e5b86a",
  CL2: "#d6a955",
  BL1: "#d36b4e",
  BL2: "#c25840",
  BL3: "#a84432",
};

export function nlcColorFor(level2Id: string | null | undefined): string {
  if (!level2Id) return NLC_FALLBACK_COLOR;
  return NLC_LEVEL2_COLORS[level2Id] ?? NLC_FALLBACK_COLOR;
}
