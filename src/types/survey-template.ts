export interface TemplateFieldOption {
  label: string;
  value: string;
}

export interface TemplateField {
  id: string;
  key: string;
  type: "text" | "number" | "select" | "textarea";
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: TemplateFieldOption[];
  min?: number;
  max?: number;
  unit?: string;
}

export interface TemplateSection {
  id: string;
  title: string;
  description?: string;
  enabled: boolean;
  fields: TemplateField[];
}

export interface SurveyTemplate {
  id: string;
  name: string;
  survey_type: string;
  is_active: boolean;
  default_fields: {
    sections: TemplateSection[];
    methodologyGuidance?: string;
    requiredEquipment?: string[];
  };
}

export type FormData = Record<string, Record<string, string | number | null>>;
