export interface Project {
  id: string;
  name: string;
  site_code: string | null;
  status: "active" | "completed";
  health_status: "on_track" | "at_risk" | "overdue" | null;
  county: string | null;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: "admin" | "project_manager" | "ecologist" | "junior" | "third_party" | "client";
  assigned_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "project_manager" | "ecologist" | "junior" | "third_party" | "client";
  organization_id: string;
}
