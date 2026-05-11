/**
 * Per-step validation. Each step's validator returns an array of human-
 * readable errors for the fields visible on that step — empty array means
 * "you may proceed". Mirrors the in-place validator that used to live in
 * apps/service/src/pages/VolunteerRegistrationPage.tsx so the kiosk wizard
 * can reuse it.
 */

import type { VolunteerForm } from "./types";

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const required = (label: string, val: string): string | null =>
  val.trim() ? null : `${label} is required`;

const validEmail = (val: string): boolean => {
  const v = val.trim();
  if (!v || !v.includes("@")) return false;
  const domain = v.split("@")[1];
  return !!domain && domain.includes(".");
};

function validateAbout(f: VolunteerForm): string[] {
  const errs: string[] = [];
  const r = (label: string, val: string) => {
    const e = required(label, val);
    if (e) errs.push(e);
  };
  r("First name(s)", f.first_names);
  r("Last name", f.last_name);
  r("Address", f.address);
  r("Postcode", f.postcode);
  r("Mobile", f.mobile);
  if (!validEmail(f.email)) errs.push("Valid email is required");
  if (f.postcode && !UK_POSTCODE_RE.test(f.postcode))
    errs.push("Postcode doesn't look like a UK postcode");
  if (!f.age_range) errs.push("Age range is required");
  return errs;
}

function validateWhere(f: VolunteerForm): string[] {
  return f.preferred_branches.length ? [] : ["Pick at least one branch (or 'Online / remote')"];
}

function validateBackground(f: VolunteerForm): string[] {
  const errs: string[] = [];
  if (!f.ec_full_name.trim()) errs.push("Emergency contact name is required");
  if (!f.ec_mobile.trim() && !f.ec_phone.trim())
    errs.push("Emergency contact phone or mobile is required");
  if (f.has_health_restrictions && !f.health_notes.trim())
    errs.push("Please describe your health restrictions");
  if (f.has_criminal_record && !f.criminal_record_details.trim())
    errs.push("Please describe the convictions/cautions");
  return errs;
}

function validateReferences(f: VolunteerForm): string[] {
  const errs: string[] = [];
  if (!f.ref1_first_names.trim() || !f.ref1_last_name.trim())
    errs.push("Reference 1 name is required");
  if (!validEmail(f.ref1_email)) errs.push("Reference 1 email is required");
  if (!f.ref2_first_names.trim() || !f.ref2_last_name.trim())
    errs.push("Reference 2 name is required");
  if (!validEmail(f.ref2_email)) errs.push("Reference 2 email is required");
  return errs;
}

function validateSkills(f: VolunteerForm): string[] {
  // Skills + availability are optional — anyone can volunteer without
  // committing to a slot up front, trustees triage in admin.
  return f.availability.days.length || f.availability.notes.trim()
    ? []
    : ["Tell us at least which days you can usually help"];
}

function validateReview(f: VolunteerForm): string[] {
  const errs: string[] = [];
  if (!f.declaration_agreed) errs.push("You must agree to the volunteer declaration");
  if (!f.confidentiality_agreed) errs.push("You must agree to the confidentiality undertaking");
  return errs;
}

const STEP_VALIDATORS: Array<(f: VolunteerForm) => string[]> = [
  validateAbout,
  validateWhere,
  validateBackground,
  validateReferences,
  validateSkills,
  validateReview,
];

/** Validate the fields visible on the given 0-indexed wizard step. */
export function validateStep(step: number, form: VolunteerForm): string[] {
  return STEP_VALIDATORS[step]?.(form) ?? [];
}

/** Validate the entire form — used at final submit. */
export function validateAll(form: VolunteerForm): string[] {
  return STEP_VALIDATORS.flatMap(v => v(form));
}
