/**
 * Donor-detail validation. Mirrors the backend's _build_payer() rules so the
 * frontend can short-circuit obviously-broken submissions before the network
 * hop. Returns a list of human-readable errors (empty = valid).
 */

import type { DonorDetails } from "./types";

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function isValidEmail(email: string): boolean {
  const e = email.trim();
  if (!e || !e.includes("@")) return false;
  const [, domain = ""] = e.split("@", 2);
  return domain.includes(".");
}

export function normalizeUKPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("44") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function isValidUKPhone(raw: string): boolean {
  const digits = normalizeUKPhone(raw);
  return digits.length >= 9 && digits.length <= 11;
}

export function isValidUKPostcode(raw: string): boolean {
  return UK_POSTCODE_RE.test(raw.trim());
}

export function isValidDonor(d: Partial<DonorDetails>): boolean {
  return validateDonor(d).length === 0;
}

export function validateDonor(d: Partial<DonorDetails>): string[] {
  const errs: string[] = [];
  if (!d.firstName?.trim()) errs.push("First name is required");
  if (!d.surname?.trim()) errs.push("Surname is required");
  if (!d.email?.trim() || !isValidEmail(d.email)) errs.push("Valid email is required");
  if (d.phone && !isValidUKPhone(d.phone))
    errs.push("Phone must be a UK mobile (9–11 digits after country code)");
  if (d.postcode && !isValidUKPostcode(d.postcode))
    errs.push("Postcode doesn't look like a UK postcode");
  return errs;
}

/** True iff we have enough info to send a usable address block to PayPal. */
export function hasUsableAddress(d: Partial<DonorDetails>): boolean {
  return !!(d.address?.trim() && d.postcode && isValidUKPostcode(d.postcode));
}
