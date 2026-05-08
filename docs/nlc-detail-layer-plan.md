# NLC reference layer (z ≥ 16) — Mobile implementation plan

**Status**: Phase 1 + 2 implemented (commit `1cdb6f3`). Phase 1 smoke
test resolved by web-team empirical pre-flight (see § 11 v3 changelog).
GeoJSON quantization confirmed vertex-perfect with PBF; canonical colour
palette delivered. Ready for device test then Phase 3.
**Scope**: bring the web's `viewport-habitat-detail.tsx` z ≥ 16 NLC reference
layer to the mobile project map.
**Why**: above z 16 the saved-habitat polygons (server-side simplified at ~5 m
tolerance) show TIN-style triangle artifacts on parcel edges, and the user
loses the surrounding NLC 2018 reference parcels (hedgerows, buildings,
neighbouring fields) that the web app provides for context.

This plan describes the mobile-side implementation. **It deviates from the
web reference in a few places** (called out explicitly below).

---

## 1. Behaviour (zoom-based state machine)

| Camera zoom | Layer rendered                                   | Fetch source                       |
| ----------- | ------------------------------------------------ | ---------------------------------- |
| z < 14      | Nothing                                          | None — "Zoom in to load habitats"  |
| 14 ≤ z < 16 | **Saved habitats** (Supabase)                    | `get_habitats_in_bbox` (current)   |
| z ≥ 16      | **NLC reference parcels** (Esri FeatureServer)   | NLC FeatureServer query            |

**Note on per-zoom tolerance**: Earlier draft proposed a separate tighter
tolerance at z ≥ 17. Web team flagged this as parity drift — web uses a
single `minTolerance: 0.000003` and lets the `clamp(extent * 0.001, …)`
formula do the natural tightening as the viewport narrows. Mobile follows
the same. Single zoom threshold (16) gates the layer swap.

Transitions:
- 16 → 15: NLC layer fades out (immediate unmount), saved habitats fade in
  on next viewport fetch.
- 15 → 16: saved habitats hidden the moment the threshold is crossed; NLC
  fetch fires; user sees just the base tiles for the ~400 ms debounce.
- z ≥ 16 pan/zoom: NLC viewport fetch with bin cache + AbortController.

Critical rule from web ref: **coarse and detail layers never both visible**.
Different tolerances overlap with double-coloured-edge artifacts.

---

## 2. Esri NLC FeatureServer API contract

### Endpoint

```
POST https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/MapGenieNationalLandCover2018ITM/FeatureServer/0/query
Content-Type: application/x-www-form-urlencoded
```

### Parameters

```
f=geojson                              ← see § 3
where=1=1
returnGeometry=true
geometryType=esriGeometryEnvelope
spatialRel=esriSpatialRelIntersects
inSR=4326
outSR=4326
outFields=LEVEL_2_ID,LEVEL_2_VALUE,LEVEL_1_VALUE,AREA
orderByFields=AREA DESC
resultType=tile
cacheHint=true
resultRecordCount=4000
resultOffset=<page>
geometry=<bbox json>
maxAllowableOffset=<serverSimplify>
quantizationParameters=<json>
```

### Tolerance / quantization formulas

Web parity — single minTolerance, extent-based clamp does the work:

```ts
const extent = Math.max(
  bbox.maxLng - bbox.minLng,
  bbox.maxLat - bbox.minLat,
);
const MIN_TOLERANCE = 0.000003;  // ~0.3 m at lat 53° N
const MAX_TOLERANCE = 0.00045;
const serverSimplify = clamp(extent * 0.001, MIN_TOLERANCE, MAX_TOLERANCE);

const quantization = {
  mode: "view",
  originPosition: "upperLeft",
  tolerance: serverSimplify,
  extent: {
    xmin: bbox.minLng,
    ymin: bbox.minLat,
    xmax: bbox.maxLng,
    ymax: bbox.maxLat,
    spatialReference: { wkid: 4326 },
  },
};
```

### Pagination

`resultRecordCount=4000` per page (mobile reduces; see § 4). If the
response signals more data is available, send the next page with
`resultOffset += <page size>`. Hard cap **5 000 / 25 000 features total**
on mobile (web uses 100 000 — divergence justified in § 4).

**Phase 1 unknown**: in `f=geojson` mode the location of the "more data"
signal is not yet verified. ArcGIS PBF puts `exceededTransferLimit` at
the root of the response; GeoJSON FeatureCollection may surface it as a
top-level field, or via a custom property bag, or not at all (some
ArcGIS endpoints fall back to client-side detection: `features.length
=== resultRecordCount` ⇒ try the next page). Phase 1 smoke test must
record the exact shape and document it before the parser locks in.

---

## 3. PBF vs GeoJSON — **mobile deviation, web team accepted**

Web uses `f=pbf` with `arcgis-pbf-parser` (~35× smaller payload).

**Mobile v1: GeoJSON (`f=geojson`).**

Web-team accepted this trade-off:
- No new native / JS dependency. Townlands already uses ArcGIS GeoJSON
  successfully in this app.
- Bin cache + per-page record cap means payload per call is bounded
  to a few MB even with GeoJSON.
- Architecture leaves room for a PBF swap; the fetch function returns
  `NlcFeature[]`, the parser is the only thing that changes.

### Critical Phase 1 unknown — quantization with GeoJSON

Web team does **not** have empirical confirmation that
`quantizationParameters` is honoured by this FeatureServer in `f=geojson`
mode. ArcGIS docs say it should be, but neither web nor mobile has
verified.

**Phase 1 smoke test must measure this.** Pull a 1° × 1° bbox at z 16,
diff vertex counts and edge alignment vs. PBF mode (web team can compare
on their side). If GeoJSON returns un-quantized geometry, **PBF moves to
v1.1**, not v2 — triangle artifacts are exactly what this layer exists
to fix.

If PBF is needed, web team confirmed the parser: `arcgis-pbf-parser`
(npm, MIT, ~4 KB minified). Mobile would import the same package.

---

## 4. Mobile-specific caps and tuning

Native `<Polygon>` is dramatically slower per overlay than the web's
WebGL/SVG renderers (see commit `02859c2` for the iOS freeze
post-mortem). The NLC layer reuses the same guards as the saved
habitat layer.

| Knob                       | Web        | Mobile (iOS)         | Mobile (Android)     |
| -------------------------- | ---------- | -------------------- | -------------------- |
| `resultRecordCount` / page | 4 000      | 1 000                | 4 000                |
| Total feature cap          | 100 000    | **5 000**            | 25 000               |
| Per-ring vertex decimation | none       | 32                   | none                 |
| Render cap (output)        | unbounded  | 200                  | 1 000                |
| `tappable`                 | yes        | no (use map onPress) | yes                  |
| Holes                      | yes        | no                   | yes                  |
| Bin cache size             | 30 FIFO    | 30 FIFO              | 30 FIFO              |
| Bin size                   | 0.005°     | 0.005°               | 0.005°               |
| Pan debounce               | 400 ms     | 400 ms               | 400 ms               |

Bin cache and debounce are full parity with web (corrected from earlier
draft which mis-stated web defaults). The iOS column is the conservative
starting point — we loosen via profiling once perf is verified on a real
device with a heavy project.

---

## 5. Module layout

### New files

```
src/lib/nlc.ts                  ← fetch, parse, cache, types
src/lib/nlc-colors.ts           ← LEVEL_2_ID → fill colour mapping
docs/nlc-detail-layer-plan.md   ← this file
```

### Modified files

```
src/screens/project-map-screen.tsx
  - layer mode state machine (NONE / HABITATS / NLC)
  - z ≥ 16 → fetch NLC via debounced effect
  - render NLC polygons with cap + viewport filter + decimation
  - hide saved habitats when NLC active
  - banner copy (zoom-out → "Zoom in to load habitats" stays for the
    z < 14 case; new copy for the saved/NLC handoff is unnecessary
    because the swap is instant on threshold cross)
```

`src/lib/map-layers.ts` and `map-layers-control.tsx` are **not** touched
in v1 — NLC isn't surfaced as a separate user-facing toggle. It's a
transparent zoom-driven swap of the Habitats layer's content.

### `lib/nlc.ts` shape

```ts
export interface NlcBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface NlcFeature {
  id: string;                   // server feature id
  level1Value: string | null;   // e.g. "Grassland, saltmarsh and swamp"
  level2Id: string | null;      // e.g. "GA1" — used for colouring + labels
  level2Value: string | null;   // human-readable
  area: number | null;          // m²
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

/** Tile-style paged fetch with abort + dedup. Returns *all* pages
 *  concatenated up to the platform cap. */
export async function fetchNlcInBbox(
  bbox: NlcBbox,
  options?: {
    signal?: AbortSignal; // caller's cancel
  },
): Promise<{ features: NlcFeature[]; truncated: boolean }>;

/** In-memory bin cache: key = bin coords (0.005° grid),
 *  value = features that intersect that bin. FIFO, 30 entries. */
export function getNlcBinCache(): Map<string, NlcFeature[]>;
export function clearNlcBinCache(): void;
```

`approximateZoom` is reused from `lib/townlands.ts` — no new copy.

---

## 6. Map screen integration

### Layer mode state machine

```ts
type LayerMode = "none" | "habitats" | "nlc";

const layerMode: LayerMode = useMemo(() => {
  if (effectiveZoom == null) return "none";
  if (effectiveZoom < MIN_HABITAT_RENDER_ZOOM) return "none";       // 14
  if (effectiveZoom < MIN_NLC_RENDER_ZOOM) return "habitats";       // 16
  return "nlc";
}, [effectiveZoom]);
```

### Saved-habitat hiding

`visibleHabitats` memo from commit `02859c2` already gates on zoom. Add:
```ts
if (layerMode !== "habitats") return [];
```

### NLC fetch driver

Mirrors `fetchHabitatsInBbox` flow:
- `pendingViewportBbox` from `handleRegionChangeComplete` (already wired)
- Effect with debounce 400 ms
- Bin cache lookup before issuing fetch
- Abort previous in-flight on bbox change
- `latestKeyRef` to drop stale resolutions
- Only runs when `layerMode === "nlc"`

### Render

`nlcPolygonElements` memo, structured exactly like `habitatPolygonElements`:
- per-piece bbox cache (ref-based, lazy build, persists session)
- viewport AABB filter
- output cap (`MAX_NLC_POLYGONS_IOS = 200` / `MAX_NLC_POLYGONS_ANDROID = 1000`)
- vertex decimation (`MAX_NLC_VERTICES_PER_RING_IOS = 32`)
- mounted via the existing `polygonMountBudget` (unified pacing — same
  budget that drives habitats and designated, so we don't get layered
  bridge contention)

### Tap handling

iOS: `tappable={false}` to avoid native hit-test cost. Use MapView's
`onPress` and JS-side bbox-then-point-in-polygon hit test against the
visible NLC piece cache. Open a small sheet showing `level2Value`,
`level2Id`, area in ha. **Note**: this is a mobile-specific UX
improvement — web doesn't have a tap detail layer for NLC. Web team
confirmed mobile sheet content (level2Value / level2Id / area in ha)
matches what their popup would show if it existed.

Android: `tappable={true}` (cheaper there).

---

## 7. Labels — deferred to z ≥ 17

Web shows the `LEVEL_2_ID` code on each polygon at every zoom from 16.
Mobile ships **without labels in v1**. Labels become a Phase 3 task,
gated on z ≥ 17.

Web-team rationale: at z ≥ 17 viewports are narrow enough that ~5
visible LEVEL_2_IDs at most exist at any time. Marker bridge cost is
negligible. At z 16 with potentially dozens of distinct codes visible,
Marker overhead would re-introduce the freeze we just fixed.

When implemented (Phase 3):
- Max 15 labels at once
- Sorted by polygon area, deduped by `level2Id` (only largest polygon
  per code gets a label — web's anti-duplicate rule)
- Centroid `<Marker>` with text view
- Only at z ≥ 17

---

## 8. Phased rollout

### Phase 1 — Foundation (~1.5 h)

- [ ] `lib/nlc.ts` skeleton: types, bbox helpers, `fetchNlcInBbox`
      (GeoJSON path), bin cache, AbortController, latestKey guard
- [ ] `lib/nlc-colors.ts`: LEVEL_2_ID → fill colour map ported from
      web's `NLC_NATIVE_LEVEL2_COLORS` (default palette per web team —
      Heritage Council palette is too coarse at high zoom)
- [ ] **Smoke test (critical)**: hit FeatureServer with a known Irish
      bbox at z 16, verify three things:
      1. Response parses to `NlcFeature[]` cleanly (field mapping)
      2. Quantization params produce snapped vertex output (no
         triangle artifacts on parcel boundaries)
      3. Pagination signal — where does `exceededTransferLimit` land
         in the GeoJSON response, or do we fall back to length-based
         detection?
      Web team has offered to dump a PBF response for the same bbox so
      we can diff vertex counts and edge alignment. Coordinate the
      bbox before running this — a small site (~500 m × 500 m) is
      enough to surface either issue.

**Exit criteria**:
- `fetchNlcInBbox(testBbox)` returns features, types compile clean
- Quantization verification passes — if not, **escalate to PBF v1.1**

### Phase 2 — Map screen integration (~2 h)

- [ ] Layer mode state machine
- [ ] NLC fetch effect (debounced 400 ms, bin-cached, abortable)
- [ ] `nlcPolygonElements` memo with cap + viewport filter + decimation
- [ ] Mount via `polygonMountBudget`
- [ ] Saved-habitat hiding when mode === "nlc"

**Exit criteria**: zooming past 16 swaps layers, polygons mount
progressively, no JS-thread freeze on a heavy project (verified with
the same project that produced the 30 s freeze pre-`02859c2`).

### Phase 3 — Visuals (~1.5 h)

- [ ] Colour mapping wired in render
- [ ] Tap → JS-side hit test → small detail sheet
- [ ] Labels for `LEVEL_2_ID` at z ≥ 17 only

**Exit criteria**: visual parity with web at z 16-18 except the
deviations in § 3 / § 7.

### Phase 4 — Optional optimisations (later)

- [ ] PBF parser swap (`arcgis-pbf-parser`) — promoted to v1.1 if
      Phase 1 quantization smoke test fails
- [ ] Persist bin cache to SQLite for offline z ≥ 16 viewing of areas
      the surveyor has been (not in v1; web doesn't do this either)
- [ ] Optional Heritage-Council-vs-native palette toggle (web has
      both; we ship native by default and add the toggle later if
      surveyors ask)
- [ ] Re-evaluate caps based on real-device profiling

---

## 9. Web-team Q&A — locked-in answers

1. **PBF or GeoJSON for v1?** ✅ **GeoJSON v1**, PBF v2 (or v1.1 if
   Phase 1 smoke test fails on quantization).
2. **Quantization with `f=geojson`?** ❓ **Untested**. Phase 1 smoke
   test is the gate. If GeoJSON returns un-quantized geometry, PBF
   moves to v1.1.
3. **Colour palette default?** ✅ **Native** (`NLC_NATIVE_LEVEL2_COLORS`).
   Heritage Council palette uses a single colour per broad category —
   too coarse for high-zoom inspection. Toggle deferred to Phase 4.
4. **Labels?** ✅ **Defer to z ≥ 17** (Phase 3). At z 16 the LEVEL_2_ID
   density would re-introduce Marker bridge cost issues.
5. **Tap UX?** ✅ Mobile-specific small sheet (`level2Value`,
   `level2Id`, area in ha). Web doesn't have a popup for NLC; the
   mobile sheet is an improvement, not a parity issue.
6. **Offline tile caching (SQLite)?** ❌ **No** in v1. Bin cache is
   in-memory only, session-lifetime. Web doesn't persist either.
   SQLite persistence is a separate feature with its own plan.
7. **z 16 vs z 15 mobile threshold?** ❓ **Device test required**.
   Web tested at 1920×1080; phone screen real-estate may make z 16
   feel too high-altitude. If real-device test shows the saved layer
   still readable past 16, drop to z 15. Default for v1: 16.
8. **Per-call cap (5 k iOS / 25 k Android vs web 100 k)?** ✅ Accept
   as written. Web's 100 k assumes WebGL/SVG renderer; mobile native
   `<Polygon>` is bound by very different cost. AREA DESC ordering
   means truncation drops the visually least-important parcels first.

---

## 10. Risk register

| Risk                                                                  | Mitigation                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| iOS native polygon mount freeze (already burned)                      | Reuse polygonMountBudget pacing + caps + decimation patterns from commit `02859c2`                        |
| Triangle artifacts persist (quantization not honoured by `f=geojson`) | Phase 1 smoke test gates this; PBF promoted to v1.1 if smoke test fails (not v2)                          |
| User toggles down to z 15 mid-fetch                                   | AbortController on every fetch start; latestKey guard on resolution                                       |
| Bin cache memory growth                                               | FIFO 30 entries; rough heap budget = 30 × 1 000 features × ~1 KB = 30 MB worst case (acceptable)          |
| Network cost on cellular                                              | Bin cache absorbs small pans; user opts in by zooming past 16                                             |
| FeatureServer rate limiting                                           | One in-flight request at a time (AbortController) + 400 ms debounce keeps RPS under 3                     |
| Service downtime                                                      | Layer fails silently — user still sees saved habitats at z 14-16 and base tiles at z ≥ 16                 |

---

## 11. Changelog

- **v3** — empirical pre-flight by web team (Phase 1 unknowns resolved):
  - **Quantization parity confirmed.** Web ran the same Maynooth
    bbox (lng -6.5944 → -6.5869, lat 53.3795 → 53.3840, ~500 m × 500 m)
    in both `f=geojson` and `f=pbf` with identical
    `quantizationParameters`. Result: 508 features, 689 rings, 21,178
    vertices — byte-identical between the two formats. PBF v1.1
    escalation **off the table**; mobile ships GeoJSON.
  - **Payload ratio observed**: PBF 80 KB vs GeoJSON 880 KB on this
    bbox (≈11×, not the 35× from the original spec). Density
    dependent, but enough to confirm GeoJSON is bounded for v1.
  - **Z 16 threshold confirmed for mobile.** Reasoning is
    meters-per-pixel, not screen px. At lat 53° N, z 16 = ~1.44 m/px;
    a 5 m building reads as ~3.5 px (visible). Dropping to z 15
    halves m/px so the same building falls below 2 px. Plan § 9 Q7
    answered: **stay at 16**.
  - **`exceededTransferLimit` location**: under `properties` in
    GeoJSON mode, top-level in PBF mode. Already covered by
    `lib/nlc.ts` reading both locations + `features.length` fallback.
  - **`NLC_NATIVE_LEVEL2_COLORS` canonical map delivered** (35
    entries). Keyed by `LEVEL_2_VALUE` (human-readable name), **not**
    `LEVEL_2_ID`. Server returns inconsistent case across some values;
    callers must match verbatim, no normalisation. Implemented in
    `src/lib/nlc-colors.ts`.
  - **Heritage Council Level-1 palette** also provided for the Phase 4
    toggle. Stored alongside the native map.
- **v2.1** — pre-Phase-1 polish:
  - § 2: flagged the GeoJSON pagination-signal unknown alongside the
    quantization unknown. Smoke test now covers both.
  - § 8 Phase 1: explicit step list for the smoke test, plus
    coordination note for the web-team PBF dump offer.
- **v2** — web-team review applied:
  - § 4: corrected web debounce (400 ms, was 300 ms) and bin cache size
    (30 FIFO, was "unspecified"). Both are now full parity, not mobile
    tightening.
  - § 1, § 2: removed the z ≥ 17 separate tolerance tier. Web uses
    a single `minTolerance: 0.000003` and lets the clamp formula
    tighten naturally. Mobile follows.
  - § 3: phrased the GeoJSON quantization unknown clearly. PBF
    promoted from v2 to v1.1 if Phase 1 smoke test fails.
  - § 9: locked in answers to all 8 open questions from web team.
- **v1** — initial draft.

---

## Sign-off

Web team review: **complete**. Ready for Phase 1 implementation.
