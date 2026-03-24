export interface Survey {
  id: string;
  project_id: string;
  survey_type: string;
  surveyor_id: string | null;
  survey_date: string;
  start_time: string | null;
  end_time: string | null;
  status: "planned" | "in_progress" | "completed" | "approved";
  sync_status: "pending" | "synced" | "failed";
  notes: string | null;
  created_at: string;
  updated_at: string;
  surveyor_name?: string;
}

export const surveyTypeLabels: Record<string, string> = {
  releve_survey: "Relevé Survey",
  bat_survey: "Bat Survey",
  habitat: "Habitat Survey",
  habitat_mapping: "Habitat Mapping",
  bird: "Bird Survey",
  mammal: "Mammal Survey",
  walkover: "Walkover Survey",
  multi_disciplinary: "Multi-disciplinary",
};

export const surveyStatusLabels: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
};
