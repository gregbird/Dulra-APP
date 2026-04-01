export interface HabitatPolygon {
  id: string;
  project_id: string;
  fossitt_code: string | null;
  fossitt_name: string | null;
  area_hectares: number | null;
  condition: string | null;
  notes: string | null;
  eu_annex_code: string | null;
  survey_method: string | null;
  evaluation: string | null;
  listed_species: string[] | null;
  threats: string[] | null;
  photos: string[] | null;
  site_id?: string | null;
}

export interface TargetNote {
  id: string;
  project_id: string;
  category: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  is_verified: boolean;
  location_text?: string | null;
  photos: string[] | null;
  site_id?: string | null;
}

export const conditionColors: Record<string, { label: string; color: string }> = {
  excellent: { label: "Excellent", color: "#059669" },
  good: { label: "Good", color: "#16A34A" },
  moderate: { label: "Moderate", color: "#D97706" },
  poor: { label: "Poor", color: "#DC2626" },
  bad: { label: "Bad", color: "#7C2D12" },
};

export const categoryLabels: Record<string, { label: string; color: string }> = {
  fauna: { label: "Fauna", color: "#2563EB" },
  flora: { label: "Flora", color: "#16A34A" },
  habitat: { label: "Habitat", color: "#059669" },
  check_feature: { label: "Check Feature", color: "#9333EA" },
  access_point: { label: "Access Point", color: "#D97706" },
};
