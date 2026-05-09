import { useCallback, useEffect, useState } from "react";
import { getCachedTemplates } from "@/lib/database";
import { surveyTypeLabels } from "@/types/survey";

/**
 * Resolves a survey_type slug to a human-readable label.
 *
 * Order of precedence:
 *   1. DB template name (cached_templates.name) — the org admin's
 *      authored label, including custom types whose slug looks like
 *      `custom_<hex>` and would never match the hardcoded map.
 *   2. Hardcoded `surveyTypeLabels` — the canonical built-in types
 *      (walkover, bat_survey, etc.). Acts as a fallback for offline
 *      installs that haven't populated the cache yet.
 *   3. Raw slug — last resort so the UI never shows an empty cell.
 *
 * The cache read is one-shot on mount; refresh would require a
 * manual `refetch()` (not exposed yet — listing screens reload the
 * cache during their own pull-to-refresh paths).
 */
export function useSurveyTypeLabel(): (surveyType: string) => string {
  const [dbLabels, setDbLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    getCachedTemplates()
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of rows) {
          if (row.name) map[row.survey_type] = row.name;
        }
        setDbLabels(map);
      })
      .catch(() => { /* cache miss is non-fatal — fallbacks handle it */ });
    return () => { cancelled = true; };
  }, []);

  return useCallback(
    (surveyType: string): string =>
      dbLabels[surveyType] ?? surveyTypeLabels[surveyType] ?? surveyType,
    [dbLabels],
  );
}
