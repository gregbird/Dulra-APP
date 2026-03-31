export interface Project {
  id: string;
  name: string;
  site_code: string | null;
  status: "draft" | "active" | "completed" | "archived";
  health_status: "on_track" | "at_risk" | "overdue";
  county: string | null;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: "lead" | "surveyor" | "analyst" | "reviewer" | "viewer" | "member";
  assigned_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "assessor" | "project_manager" | "ecologist" | "junior" | "third_party" | "client";
  organization_id: string;
}
