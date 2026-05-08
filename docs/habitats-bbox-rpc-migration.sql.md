# Habitats — `get_habitats_in_bbox` RPC migration

**Apply via Supabase dashboard SQL editor.** Mobile repo has no migrations dir;
this RPC is consumed by the viewport-based loading flow on the project map and
the Habitats list. The existing `get_project_habitats` stays for the explicit
"Show all" escape hatch on the list screen.

## Why

`get_project_habitats(p_project_id, p_site_id)` returns every polygon for a
project — for cadastral-import outliers that's 600-1000+ rows. Mobile cannot
mount that many native `<Polygon>` overlays without freezing iOS / overheating
the device. The new RPC pushes the spatial filter to PostGIS (uses the existing
`habitat_polygons_boundary_idx` GIST index) and lets the client request only
what fits the current viewport (or the initial site-boundary + 100 m buffer).

## Migration

```sql
create or replace function public.get_habitats_in_bbox(
  p_project_id uuid,
  p_site_id    uuid default null,
  p_min_lng    double precision default null,
  p_min_lat    double precision default null,
  p_max_lng    double precision default null,
  p_max_lat    double precision default null,
  p_limit      int default 500
)
returns table (
  id uuid,
  project_id uuid,
  site_id uuid,
  survey_id uuid,
  fossitt_code text,
  fossitt_name text,
  area_hectares double precision,
  condition text,
  evaluation text,
  eu_annex_code text,
  survey_method text,
  notes text,
  listed_species text[],
  threats text[],
  photos text[],
  include_in_report boolean,
  boundary jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker  -- RLS via project_members applies
set search_path = public
as $$
  select
    h.id, h.project_id, h.site_id, h.survey_id,
    h.fossitt_code, h.fossitt_name, h.area_hectares,
    h.condition, h.evaluation, h.eu_annex_code,
    h.survey_method, h.notes,
    h.listed_species, h.threats, h.photos,
    h.include_in_report,
    case
      when h.boundary is null then null
      else st_asgeojson(
             st_simplifypreservetopology(
               st_collectionextract(st_makevalid(h.boundary), 3),
               0.00005
             ),
             5
           )::jsonb
    end as boundary,
    h.created_at, h.updated_at
  from public.habitat_polygons h
  where h.project_id = p_project_id
    and (p_site_id is null or h.site_id = p_site_id)
    and h.boundary is not null
    and (
      p_min_lng is null or
      st_intersects(
        h.boundary,
        st_setsrid(st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat), 4326)
      )
    )
  order by h.area_hectares desc nulls last
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

grant execute on function public.get_habitats_in_bbox(
  uuid, uuid, double precision, double precision, double precision, double precision, int
) to authenticated;
```

## Notes

- `security invoker` keeps the existing `project_members` RLS in place — the
  same callers that can read `habitat_polygons` directly can call this RPC.
- `st_intersects` is short-circuited when no bbox is provided (all four `p_min*`
  / `p_max*` are null) — defensive only; mobile always sends a bbox.
- `st_simplifypreservetopology` at ~5 m tolerance (0.00005°) matches what the
  legacy `get_project_habitats` already does, so client geometry handling is
  identical between the two RPCs.
- `order by area_hectares desc` makes the per-call cap (`p_limit`) prefer the
  visually dominant polygons when more than 500 intersect the bbox.
- Hard ceiling of 1000 inside the function so a misbehaving client can't
  request unbounded result sets.

## Smoke test

```sql
-- pick any project_id from public.projects
select count(*) from public.get_habitats_in_bbox(
  '<project-uuid>'::uuid,
  null,
  -10.5, 51.4, -5.4, 55.5,  -- Ireland-wide bbox
  500
);

-- narrow bbox should return fewer rows
select count(*) from public.get_habitats_in_bbox(
  '<project-uuid>'::uuid,
  null,
  -7.0, 53.0, -6.9, 53.1,
  500
);
```

## Rollback

```sql
drop function if exists public.get_habitats_in_bbox(
  uuid, uuid, double precision, double precision, double precision, double precision, int
);
```
