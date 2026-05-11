/**
 * REST client for the volunteer endpoints. Same isomorphic-fetch pattern as
 * @shital/giving-sdk so each consumer can plug in auth headers and base URL.
 */

import type { DraftBody, DraftRecord, SubmitResponse, VolunteerForm } from "./types";

export interface ApiConfig {
  baseUrl: string;
  fetch?: typeof fetch;
}

const okJson = async <T>(r: Response): Promise<T> => {
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
};

export function createVolunteerApi(cfg: ApiConfig) {
  const f = cfg.fetch ?? fetch;
  const url = (p: string) => `${cfg.baseUrl.replace(/\/$/, "")}${p}`;

  return {
    /** Final submit — returns the SHITAL-VOL reference number. */
    async submit(form: VolunteerForm, branchId: string): Promise<SubmitResponse> {
      return okJson(
        await f(url("/service/volunteers/register"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, branch_id: branchId }),
        }),
      );
    },

    /** Save the in-progress wizard so the applicant can resume on any device. */
    async saveDraft(body: DraftBody): Promise<{ token: string; expires_at: string }> {
      return okJson(
        await f(url("/service/volunteers/draft"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },

    /** Fetch an in-progress draft by token (from a magic-link email). */
    async loadDraft(token: string): Promise<DraftRecord | null> {
      const r = await f(url(`/service/volunteers/draft/${encodeURIComponent(token)}`));
      if (r.status === 404) return null;
      return okJson(r);
    },

    /** Discard a draft — applicant clearing their form. Idempotent. */
    async deleteDraft(token: string): Promise<void> {
      await f(url(`/service/volunteers/draft/${encodeURIComponent(token)}`), {
        method: "DELETE",
      });
    },

    /** Email the resume link to the applicant. */
    async emailDraftLink(token: string, email: string): Promise<{ ok: true }> {
      return okJson(
        await f(url("/service/volunteers/draft/email-link"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email }),
        }),
      );
    },
  };
}

export type VolunteerApi = ReturnType<typeof createVolunteerApi>;
