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

/**
 * Last-resort fallback list shown in the survey type picker when the
 * `survey_templates` table is unexpectedly empty (e.g. a brand-new org
 * whose trigger seeding failed, or an offline install with no cache yet).
 *
 * Under normal conditions the DB seeds every org with these types on
 * creation (see migration `seed_default_survey_templates`). These rows
 * therefore render as "Coming soon" (no sections) — they are visible
 * evidence that templates are missing, without silently dropping types.
 */
export const FALLBACK_SURVEY_TYPES: SurveyTemplate[] = [
  { id: "walkover", name: "Walkover Survey", survey_type: "walkover", is_active: true, default_fields: { sections: [] } },
  { id: "habitat_mapping", name: "Habitat Mapping", survey_type: "habitat_mapping", is_active: true, default_fields: { sections: [] } },
  { id: "releve_survey", name: "Relevé Survey", survey_type: "releve_survey", is_active: true, default_fields: { sections: [] } },
  { id: "bat_survey", name: "Bat Survey", survey_type: "bat_survey", is_active: true, default_fields: { sections: [] } },
  { id: "bird_survey", name: "Bird Survey", survey_type: "bird_survey", is_active: true, default_fields: { sections: [] } },
  { id: "mammal_survey", name: "Mammal Survey", survey_type: "mammal_survey", is_active: true, default_fields: { sections: [] } },
  { id: "aquatic_survey", name: "Aquatic Survey", survey_type: "aquatic_survey", is_active: true, default_fields: { sections: [] } },
  { id: "botanical_survey", name: "Botanical Survey", survey_type: "botanical_survey", is_active: true, default_fields: { sections: [] } },
  { id: "invertebrate_survey", name: "Invertebrate Survey", survey_type: "invertebrate_survey", is_active: true, default_fields: { sections: [] } },
  { id: "biodiversity_net_gain", name: "Biodiversity Net Gain", survey_type: "biodiversity_net_gain", is_active: true, default_fields: { sections: [] } },
  { id: "other", name: "Other Survey", survey_type: "other", is_active: true, default_fields: { sections: [] } },
];
