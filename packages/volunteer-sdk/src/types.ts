/**
 * @shital/volunteer-sdk — domain types.
 *
 * Mirrors backend shapes from /api/v1/service/volunteers/* and
 * /api/v1/admin/volunteers/*.
 */

export interface VolunteerForm {
  title: string;
  first_names: string;
  last_name: string;
  address: string;
  postcode: string;
  uprn: string;
  mobile: string;
  phone: string;
  email: string;
  age_range: string;

  // Emergency contact
  ec_title: string;
  ec_full_name: string;
  ec_email: string;
  ec_mobile: string;
  ec_phone: string;
  ec_address: string;
  ec_postcode: string;
  ec_uprn: string;

  // Health + safeguarding
  has_health_restrictions: boolean;
  health_notes: string;
  has_criminal_record: boolean;
  criminal_record_details: string;

  // References
  ref1_title: string;
  ref1_first_names: string;
  ref1_last_name: string;
  ref1_address: string;
  ref1_postcode: string;
  ref1_uprn: string;
  ref1_mobile: string;
  ref1_phone: string;
  ref1_email: string;
  ref2_title: string;
  ref2_first_names: string;
  ref2_last_name: string;
  ref2_address: string;
  ref2_postcode: string;
  ref2_uprn: string;
  ref2_mobile: string;
  ref2_phone: string;
  ref2_email: string;

  // Skills + availability
  skills: Record<string, string[]>;
  skills_other_text: string;
  availability: { days: string[]; times: string[]; notes: string };
  availability_pattern: string;

  // Consent
  declaration_agreed: boolean;
  confidentiality_agreed: boolean;
  marketing_consent: boolean;

  preferred_branches: string[];
}

export const EMPTY_VOLUNTEER_FORM: VolunteerForm = {
  title: "",
  first_names: "",
  last_name: "",
  address: "",
  postcode: "",
  uprn: "",
  mobile: "",
  phone: "",
  email: "",
  age_range: "",
  ec_title: "",
  ec_full_name: "",
  ec_email: "",
  ec_mobile: "",
  ec_phone: "",
  ec_address: "",
  ec_postcode: "",
  ec_uprn: "",
  has_health_restrictions: false,
  health_notes: "",
  has_criminal_record: false,
  criminal_record_details: "",
  ref1_title: "",
  ref1_first_names: "",
  ref1_last_name: "",
  ref1_address: "",
  ref1_postcode: "",
  ref1_uprn: "",
  ref1_mobile: "",
  ref1_phone: "",
  ref1_email: "",
  ref2_title: "",
  ref2_first_names: "",
  ref2_last_name: "",
  ref2_address: "",
  ref2_postcode: "",
  ref2_uprn: "",
  ref2_mobile: "",
  ref2_phone: "",
  ref2_email: "",
  skills: {},
  skills_other_text: "",
  availability: { days: [], times: [], notes: "" },
  availability_pattern: "",
  declaration_agreed: false,
  confidentiality_agreed: false,
  marketing_consent: false,
  preferred_branches: [],
};

export interface WizardStepDef {
  /** Stable id for analytics + draft restore. */
  key: string;
  /** Human-readable header. */
  title: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { key: "about", title: "About you" },
  { key: "where", title: "Where to help" },
  { key: "background", title: "Health & background" },
  { key: "references", title: "References" },
  { key: "skills", title: "Skills & schedule" },
  { key: "review", title: "Review & submit" },
];

export interface DraftBody {
  token: string;
  branch_id: string;
  payload: Partial<VolunteerForm> & { __wizardStep?: number };
}

export interface DraftRecord {
  token: string;
  payload: Partial<VolunteerForm> & { __wizardStep?: number };
  expires_at: string;
}

export interface SubmitResponse {
  reference_number: string;
}
