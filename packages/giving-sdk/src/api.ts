/**
 * REST client for the giving endpoints. Consumer-supplied `fetch` keeps the
 * SDK isomorphic and lets each app inject auth headers / base URL without
 * the SDK reaching for environment vars.
 */

import type {
  ApproveArgs,
  GivingTier,
  SubscribeArgs,
  SubscribeResponse,
  SubscriptionRecord,
} from "./types";

export interface ApiConfig {
  /** Base URL, e.g. "/api/v1" or "https://admin.shital.org.uk/api/v1". */
  baseUrl: string;
  /** Custom fetch wrapper (auth headers, retries). Defaults to global fetch. */
  fetch?: typeof fetch;
}

const okJson = async <T>(r: Response): Promise<T> => {
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export function createGivingApi(cfg: ApiConfig) {
  const f = cfg.fetch ?? fetch;
  const url = (p: string) => `${cfg.baseUrl.replace(/\/$/, "")}${p}`;

  return {
    /** Public — list active tiers for the picker. */
    async listTiers(): Promise<{ tiers: GivingTier[] }> {
      return okJson(await f(url("/service/giving/tiers")));
    },

    /**
     * Public — register the donor in CRM, create-or-fetch the PayPal billing
     * plan for this tier, return the plan_id so the frontend can open the
     * PayPal popup.
     */
    async subscribe(args: SubscribeArgs): Promise<SubscribeResponse> {
      const body = {
        tier_id: args.tier_id,
        branch_id: args.branch_id,
        donor_first_name: args.donor.firstName.trim(),
        donor_surname: args.donor.surname.trim(),
        donor_email: args.donor.email.trim(),
        donor_phone: args.donor.phone.trim(),
        donor_postcode: args.donor.postcode.trim(),
        donor_address: args.donor.address.trim(),
        ...(args.customAmount != null && { custom_amount: args.customAmount }),
        ...(args.customLabel && { custom_label: args.customLabel }),
      };
      return okJson(
        await f(url("/service/giving/subscribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },

    /** Public — finalise a PayPal-approved subscription server-side. */
    async approve(args: ApproveArgs): Promise<{ success: boolean }> {
      const body = {
        subscription_id: args.subscription_id,
        plan_id: args.plan_id,
        tier_id: args.tier.id,
        amount: args.tier.amount,
        frequency: args.tier.frequency,
        branch_id: args.branch_id,
        donor_first_name: args.donor.firstName.trim(),
        donor_surname: args.donor.surname.trim(),
        donor_email: args.donor.email.trim(),
        donor_phone: args.donor.phone.trim(),
        donor_postcode: args.donor.postcode.trim(),
        donor_address: args.donor.address.trim(),
        gift_aid_declared: args.donor.giftAidDeclared,
        tier_label: args.tier.label,
      };
      return okJson(
        await f(url("/service/giving/subscription/approve"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },

    /** Admin — paginated subscription list. */
    async listSubscriptions(): Promise<{ subscriptions: SubscriptionRecord[] }> {
      return okJson(await f(url("/admin/giving/subscriptions")));
    },

    /** Admin — server-side cancel (calls PayPal REST + updates local row). */
    async cancel(localId: string, reason: string): Promise<{ success: boolean }> {
      return okJson(
        await f(url(`/admin/giving/subscriptions/${localId}/cancel`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
    },

    /** Admin — pause without cancelling. */
    async suspend(localId: string, reason: string): Promise<{ success: boolean }> {
      return okJson(
        await f(url(`/admin/giving/subscriptions/${localId}/suspend`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
    },

    /** Admin — reactivate a previously suspended subscription. */
    async reactivate(localId: string, reason: string): Promise<{ success: boolean }> {
      return okJson(
        await f(url(`/admin/giving/subscriptions/${localId}/reactivate`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
    },
  };
}

export type GivingApi = ReturnType<typeof createGivingApi>;
