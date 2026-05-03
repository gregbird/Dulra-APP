import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/lib/network";
import {
  cacheTemplate,
  cacheProject,
  cacheSurvey,
  cacheHabitat,
  cacheTargetNote,
  cacheProjectSite,
  cacheProfile,
  clearCachedData,
  getDatabase,
} from "@/lib/database";
import { buildFormDataFromReleve } from "@/lib/releve-save";
import { fetchProjectBoundary } from "@/lib/project-boundary";

/**
 * Sequential batches of `concurrency` boundary fetches. Each call writes
 * its own cache row on success. Errors swallow — one bad project doesn't
 * stop the rest. Used as a side-effect during cacheAllData so going
 * offline immediately after login still leaves every project's map
 * working.
 */
async function warmProjectBoundaries(projectIds: string[], concurrency = 8): Promise<void> {
  for (let i = 0; i < projectIds.length; i += concurrency) {
    const batch = projectIds.slice(i, i + concurrency);
    await Promise.allSettled(batch.map((id) => fetchProjectBoundary(id)));
  }
}

export async function cacheAllData(): Promise<boolean> {
  const { isOnline } = useNetworkStore.getState();
  if (!isOnline) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const isAdminOrPM = profile?.role === "admin" || profile?.role === "project_manager";

    let projectIds: string[] | null = null;

    if (!isAdminOrPM) {
      const [{ data: memberships }, { data: createdProjects }] = await Promise.all([
        supabase
          .from("project_members")
          .select("project_id")
          .eq("user_id", user.id),
        supabase
          .from("projects")
          .select("id")
          .eq("created_by", user.id),
      ]);

      const memberIds = memberships?.map((m) => m.project_id) ?? [];
      const createdIds = createdProjects?.map((p) => p.id) ?? [];
      projectIds = [...new Set([...memberIds, ...createdIds])];

      if (projectIds.length === 0) {
        await clearCachedData();
        return true;
      }
    }

    let projectQuery = supabase.from("projects").select("id, name, site_code, status, health_status, county, updated_at").order("updated_at", { ascending: false });
    let surveyQuery = supabase.from("surveys").select("id, project_id, survey_type, survey_date, status, weather, form_data, notes, site_id");
    let habitatQuery = supabase.from("habitat_polygons").select("id, project_id, fossitt_code, fossitt_name, area_hectares, condition, notes, eu_annex_code, survey_method, evaluation, listed_species, threats, photos, site_id");
    let targetNoteQuery = supabase.from("target_notes").select("id, project_id, category, title, description, priority, is_verified, photos, location, site_id");
    let releveQuery = supabase.from("releve_surveys").select("*");
    let sitesQuery = supabase.from("project_sites").select("id, project_id, site_code, site_name, sort_order, county").order("sort_order");

    if (projectIds) {
      projectQuery = projectQuery.in("id", projectIds);
      surveyQuery = surveyQuery.in("project_id", projectIds);
      habitatQuery = habitatQuery.in("project_id", projectIds);
      targetNoteQuery = targetNoteQuery.in("project_id", projectIds);
      releveQuery = releveQuery.in("project_id", projectIds);
      sitesQuery = sitesQuery.in("project_id", projectIds);
    }

    let profilesQuery = supabase
      .from("profiles")
      .select("id, full_name, role");

    if (projectIds && projectIds.length > 0) {
      const { data: members } = await supabase
        .from("project_members")
        .select("user_id")
        .in("project_id", projectIds);
      const memberUserIds = Array.from(new Set([
        ...(members?.map((m) => m.user_id) ?? []),
        user.id,
      ]));
      if (memberUserIds.length > 0) {
        profilesQuery = profilesQuery.in("id", memberUserIds);
      }
    }

    const results = await Promise.allSettled([
      supabase.from("survey_templates").select("name, survey_type, default_fields").eq("is_active", true),
      projectQuery,
      surveyQuery,
      habitatQuery,
      targetNoteQuery,
      releveQuery,
      sitesQuery,
      profilesQuery,
    ]);

    const templates = results[0].status === "fulfilled" ? results[0].value.data : null;
    const projects = results[1].status === "fulfilled" ? results[1].value.data : null;
    const surveys = results[2].status === "fulfilled" ? results[2].value.data : null;
    const habitats = results[3].status === "fulfilled" ? results[3].value.data : null;
    const targetNotes = results[4].status === "fulfilled" ? results[4].value.data : null;
    const releves = results[5].status === "fulfilled" ? results[5].value.data : null;
    const sites = results[6].status === "fulfilled" ? results[6].value.data : null;
    const profiles = results[7].status === "fulfilled" ? results[7].value.data : null;

    const releveMap = new Map<string, Record<string, unknown>>();
    if (releves) {
      for (const r of releves) {
        releveMap.set(r.survey_id as string, r as Record<string, unknown>);
      }
    }

    if (templates || projects || surveys || habitats || targetNotes || sites) await clearCachedData();

    const database = await getDatabase();
    await database.withTransactionAsync(async () => {
      if (templates && templates.length > 0) {
        for (const t of templates) {
          await cacheTemplate({ surveyType: t.survey_type, name: t.name, defaultFields: t.default_fields ?? {} });
        }
      }
      if (projects && projects.length > 0) {
        for (const p of projects) {
          await cacheProject({ id: p.id, name: p.name, siteCode: p.site_code, status: p.status, healthStatus: p.health_status, county: p.county, updatedAt: p.updated_at });
        }
      }
      if (surveys && surveys.length > 0) {
        for (const s of surveys) {
          let formData = s.form_data as Record<string, unknown> | null;
          if (s.survey_type === "releve_survey") {
            const releve = releveMap.get(s.id);
            if (releve) {
              formData = buildFormDataFromReleve(releve, formData);
            }
          }
          await cacheSurvey({
            id: s.id, projectId: s.project_id, surveyType: s.survey_type,
            surveyDate: s.survey_date, status: s.status,
            weather: s.weather as Record<string, unknown> | null,
            formData,
            notes: s.notes,
            siteId: s.site_id as string | null,
          });
        }
      }
      if (habitats && habitats.length > 0) {
        for (const h of habitats) {
          await cacheHabitat({
            id: h.id, projectId: h.project_id, fossittCode: h.fossitt_code, fossittName: h.fossitt_name,
            areaHectares: h.area_hectares, condition: h.condition, notes: h.notes, euAnnexCode: h.eu_annex_code,
            surveyMethod: h.survey_method, evaluation: h.evaluation,
            listedSpecies: h.listed_species as string[] | null, threats: h.threats as string[] | null, photos: h.photos as string[] | null,
            siteId: h.site_id as string | null,
          });
        }
      }
      if (targetNotes && targetNotes.length > 0) {
        for (const n of targetNotes) {
          const loc = n.location as { coordinates?: number[] } | null;
          const locationText = loc?.coordinates ? `POINT(${loc.coordinates[0]} ${loc.coordinates[1]})` : null;
          await cacheTargetNote({
            id: n.id, projectId: n.project_id, category: n.category, title: n.title,
            description: n.description, priority: n.priority, isVerified: n.is_verified,
            locationText, photos: n.photos as string[] | null,
            siteId: n.site_id as string | null,
          });
        }
      }
      if (sites && sites.length > 0) {
        for (const site of sites) {
          await cacheProjectSite({
            id: site.id, projectId: site.project_id, siteCode: site.site_code,
            siteName: site.site_name, sortOrder: site.sort_order, county: site.county,
          });
        }
      }
      if (profiles && profiles.length > 0) {
        for (const p of profiles) {
          await cacheProfile({ id: p.id, fullName: p.full_name, role: p.role });
        }
      }
    });

    // Warm the project boundary cache so the map screens work the moment
    // a user goes offline after login. Runs after the main transaction so
    // a slow batch doesn't hold the UI's loading state on the metadata —
    // the screens already render from cached_projects rows; boundary cache
    // simply unlocks the map viewport without a network round-trip.
    if (projects && projects.length > 0) {
      const projectIdList = projects.map((p) => p.id as string);
      await warmProjectBoundaries(projectIdList);
    }

    return surveys != null;
  } catch {
    return false;
  }
}
