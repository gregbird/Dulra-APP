export const SOIL_STABILITY_OPTIONS = [
  { label: "Firm", value: "Firm" },
  { label: "Soft", value: "Soft" },
  { label: "Waterlogged", value: "Waterlogged" },
  { label: "Unstable", value: "Unstable" },
];

export const ASPECT_OPTIONS = [
  { label: "N", value: "N" },
  { label: "NE", value: "NE" },
  { label: "E", value: "E" },
  { label: "SE", value: "SE" },
  { label: "S", value: "S" },
  { label: "SW", value: "SW" },
  { label: "W", value: "W" },
  { label: "NW", value: "NW" },
  { label: "Flat", value: "Flat" },
];

export const DOMIN_SCALE = [
  { label: "1 — Single occurrence, < 4%", value: "1" },
  { label: "2 — Few occurrences, < 4%", value: "2" },
  { label: "3 — Many occurrences, < 4%", value: "3" },
  { label: "4 — 4–10% cover", value: "4" },
  { label: "5 — 11–25% cover", value: "5" },
  { label: "6 — 26–33% cover", value: "6" },
  { label: "7 — 34–50% cover", value: "7" },
  { label: "8 — 51–75% cover", value: "8" },
  { label: "9 — 76–90% cover", value: "9" },
  { label: "10 — 91–100% cover", value: "10" },
];

/* ── Form section definitions ───────────────────────────────── */

export interface SelectOption {
  label: string;
  value: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "habitat";
  unit?: string;
  placeholder?: string;
  required?: boolean;
  options?: SelectOption[];
}

export interface SectionDef {
  id: string;
  title: string;
  fields: FieldDef[];
}

export const RELEVE_SECTIONS: SectionDef[] = [
  {
    id: "basic",
    title: "Basic Information",
    fields: [
      { key: "releve_code", label: "Relev\u00E9 Code", type: "text", required: true },
      { key: "recorder", label: "Recorder", type: "text", required: true },
      { key: "site_name", label: "Site Name", type: "text" },
      { key: "releve_area_sqm", label: "Relev\u00E9 Area", type: "number", unit: "m\u00B2" },
    ],
  },
  {
    id: "location",
    title: "Location",
    fields: [
      { key: "survey_x_coord", label: "X Coordinate (Lat)", type: "number" },
      { key: "survey_y_coord", label: "Y Coordinate (Lng)", type: "number" },
      { key: "accuracy_m", label: "Accuracy", type: "number", unit: "m" },
    ],
  },
  {
    id: "habitat",
    title: "Habitat & Soil",
    fields: [
      { key: "habitat_type", label: "Habitat Type (Fossitt)", type: "habitat" },
      { key: "soil_type", label: "Soil Type", type: "text", placeholder: "e.g. Peat, Clay, Loam" },
      { key: "soil_stability", label: "Soil Stability", type: "select", options: SOIL_STABILITY_OPTIONS },
      { key: "aspect", label: "Aspect", type: "select", options: ASPECT_OPTIONS },
      { key: "slope_degrees", label: "Slope", type: "number", unit: "\u00B0" },
    ],
  },
  {
    id: "heights",
    title: "Vegetation Heights",
    fields: [
      { key: "max_height_trees_m", label: "Max Height Trees", type: "number", unit: "m" },
      { key: "max_height_shrubs_cm", label: "Max Height Shrubs", type: "number", unit: "cm" },
      { key: "max_height_bryophytes_cm", label: "Max Height Bryophytes", type: "number", unit: "cm" },
      { key: "max_height_graminea_cm", label: "Max Height Graminea", type: "number", unit: "cm" },
      { key: "max_height_forbs_cm", label: "Max Height Forbs", type: "number", unit: "cm" },
      { key: "median_height_graminea_cm", label: "Median Height Graminea", type: "number", unit: "cm" },
      { key: "median_height_forbs_cm", label: "Median Height Forbs", type: "number", unit: "cm" },
    ],
  },
  {
    id: "cover",
    title: "Cover Percentages",
    fields: [
      { key: "total_vegetation_cover_pct", label: "Total Vegetation", type: "number", unit: "%" },
      { key: "cover_graminea_pct", label: "Graminea", type: "number", unit: "%" },
      { key: "cover_forbs_pct", label: "Forbs", type: "number", unit: "%" },
      { key: "cover_mosses_liverworts_pct", label: "Mosses / Liverworts", type: "number", unit: "%" },
      { key: "cover_trees_pct", label: "Trees", type: "number", unit: "%" },
      { key: "cover_shrubs_pct", label: "Shrubs", type: "number", unit: "%" },
      { key: "cover_litter_pct", label: "Litter", type: "number", unit: "%" },
      { key: "cover_bare_soil_pct", label: "Bare Soil", type: "number", unit: "%" },
      { key: "cover_bare_rock_pct", label: "Bare Rock", type: "number", unit: "%" },
      { key: "cover_open_water_pct", label: "Open Water", type: "number", unit: "%" },
    ],
  },
  {
    id: "observations",
    title: "Observations",
    fields: [
      { key: "other_species_proximity", label: "Other Species Proximity", type: "text" },
      { key: "fauna_observations", label: "Fauna Observations", type: "text" },
      { key: "releve_comment", label: "Comments", type: "text" },
    ],
  },
];

export const COMMON_FLORA: { latin: string; english: string }[] = [
  { latin: "Agrostis capillaris", english: "Common Bent" },
  { latin: "Anthoxanthum odoratum", english: "Sweet Vernal-grass" },
  { latin: "Calluna vulgaris", english: "Heather" },
  { latin: "Cynosurus cristatus", english: "Crested Dog's-tail" },
  { latin: "Dactylis glomerata", english: "Cock's-foot" },
  { latin: "Digitalis purpurea", english: "Foxglove" },
  { latin: "Erica tetralix", english: "Cross-leaved Heath" },
  { latin: "Festuca ovina", english: "Sheep's-fescue" },
  { latin: "Festuca rubra", english: "Red Fescue" },
  { latin: "Galium verum", english: "Lady's Bedstraw" },
  { latin: "Holcus lanatus", english: "Yorkshire-fog" },
  { latin: "Juncus effusus", english: "Soft-rush" },
  { latin: "Lolium perenne", english: "Perennial Ryegrass" },
  { latin: "Lotus corniculatus", english: "Bird's-foot-trefoil" },
  { latin: "Molinia caerulea", english: "Purple Moor-grass" },
  { latin: "Nardus stricta", english: "Mat-grass" },
  { latin: "Plantago lanceolata", english: "Ribwort Plantain" },
  { latin: "Potentilla erecta", english: "Tormentil" },
  { latin: "Ranunculus acris", english: "Meadow Buttercup" },
  { latin: "Rumex acetosa", english: "Common Sorrel" },
  { latin: "Trifolium pratense", english: "Red Clover" },
  { latin: "Trifolium repens", english: "White Clover" },
  { latin: "Ulex europaeus", english: "Gorse" },
];
