/**
 * @shital/giving-sdk — domain types.
 *
 * Mirrors backend shapes from /api/v1/service/giving/* and
 * /api/v1/admin/giving/*. Kept narrow on purpose — anything app-specific
 * (UI state, animation, presentation) lives in the consumer.
 */

export type Frequency = "MONTH" | "WEEK" | "YEAR";

export interface GivingTier {
  id: string;
  amount: number;
  label: string;
  description: string;
  frequency: Frequency;
  is_default: boolean;
  display_order: number;
}

/** The donor identity we collect before the PayPal popup opens. */
export interface DonorDetails {
  firstName: string;
  surname: string;
  email: string;
  phone: string;
  postcode: string;
  address: string;
  giftAidDeclared: boolean;
}

export interface SubscribeArgs {
  tier_id: string;
  branch_id: string;
  donor: DonorDetails;
  /** Required when tier_id === 'custom'. */
  customAmount?: number | null;
  /** Optional friendly name for custom amounts. */
  customLabel?: string;
}

export interface SubscribeResponse {
  plan_id: string;
  tier_id: string;
  amount: number;
  frequency: Frequency;
}

export interface ApproveArgs {
  subscription_id: string;
  plan_id: string;
  tier: Pick<GivingTier, "id" | "amount" | "frequency" | "label">;
  branch_id: string;
  donor: DonorDetails;
}

/** Canonical step machine for the donor-facing subscribe flow. */
export type GivingStep = "pick" | "details" | "pay" | "done";

export interface SubscriptionRecord {
  id: string;
  paypal_subscription_id: string;
  amount: number;
  frequency: Frequency;
  status: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
  donor_name: string;
  donor_email: string;
  branch_id: string;
  approved_at: string | null;
  created_at: string;
  last_payment_at: string | null;
  total_payments: number;
  next_billing_date: string | null;
  tier_label?: string;
}
