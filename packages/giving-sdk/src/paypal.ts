/**
 * PayPal payload builders for subscription createOrder/createSubscription.
 *
 * The two PayPal Subscriptions paths (subscriber + payer) silently drop the
 * entire block if any required sub-field is malformed. These helpers enforce
 * the rules so prefill on PayPal Live actually lands — see the same logic
 * applied server-side in backend/src/shital/api/routers/paypal.py.
 */

import type { DonorDetails } from "./types";
import { isValidEmail, isValidUKPostcode, normalizeUKPhone } from "./validation";

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export interface PayPalAddressBlock {
  address_line_1: string;
  address_line_2?: string;
  admin_area_2?: string;
  postal_code: string;
  country_code: "GB";
}

export interface PayPalSubscriber {
  name?: { given_name: string; surname: string };
  email_address?: string;
  shipping_address?: {
    name?: { full_name: string };
    address: PayPalAddressBlock;
  };
}

export interface PayPalPayer {
  name?: { given_name: string; surname: string };
  email_address?: string;
  phone?: { phone_type: "MOBILE"; phone_number: { national_number: string } };
  address?: PayPalAddressBlock;
}

/**
 * Parse a comma-delimited UK address string + postcode into PayPal's address
 * shape. Returns null when the result would be missing required fields —
 * caller should then omit the entire address block rather than ship a fragment.
 */
export function buildAddressBlock(
  address: string,
  postcode: string,
): PayPalAddressBlock | null {
  const parts = address
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
  const nonPc = parts.filter(p => !UK_POSTCODE_RE.test(p));
  const line1 = nonPc[0];
  if (!line1) return null;
  if (!postcode.trim() || !isValidUKPostcode(postcode)) return null;

  const block: PayPalAddressBlock = {
    address_line_1: line1,
    postal_code: postcode.trim().toUpperCase(),
    country_code: "GB",
  };
  if (nonPc.length >= 3) {
    const l2 = nonPc[1];
    const city = nonPc[nonPc.length - 1];
    if (l2) block.address_line_2 = l2;
    if (city) block.admin_area_2 = city;
  } else if (nonPc.length === 2) {
    const city = nonPc[1];
    if (city) block.admin_area_2 = city;
  }
  return block;
}

export function buildSubscriber(d: DonorDetails): PayPalSubscriber {
  const out: PayPalSubscriber = {};
  const given = d.firstName.trim();
  const family = d.surname.trim();
  if (given && family) out.name = { given_name: given, surname: family };

  const email = d.email.trim();
  if (email && isValidEmail(email)) out.email_address = email;

  const addr = buildAddressBlock(d.address, d.postcode);
  if (addr) {
    out.shipping_address = {
      ...(given && family ? { name: { full_name: `${given} ${family}` } } : {}),
      address: addr,
    };
  }
  return out;
}

export function buildPayer(d: DonorDetails): PayPalPayer {
  const out: PayPalPayer = {};
  const given = d.firstName.trim();
  const family = d.surname.trim();
  if (given && family) out.name = { given_name: given, surname: family };

  const email = d.email.trim();
  if (email && isValidEmail(email)) out.email_address = email;

  const digits = normalizeUKPhone(d.phone);
  if (digits.length >= 9 && digits.length <= 11) {
    out.phone = { phone_type: "MOBILE", phone_number: { national_number: digits } };
  }

  const addr = buildAddressBlock(d.address, d.postcode);
  if (addr) out.address = addr;

  return out;
}

/**
 * shipping_preference for application_context. Must be NO_SHIPPING when we
 * don't have a usable address, otherwise PayPal returns 422
 * SHIPPING_ADDRESS_INVALID.
 */
export function shippingPreference(d: DonorDetails): "SET_PROVIDED_ADDRESS" | "NO_SHIPPING" {
  return buildAddressBlock(d.address, d.postcode) ? "SET_PROVIDED_ADDRESS" : "NO_SHIPPING";
}
