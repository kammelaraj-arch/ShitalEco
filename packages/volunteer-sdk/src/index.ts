/**
 * @shital/volunteer-sdk
 *
 * Headless volunteer-registration SDK shared between service portal, kiosk,
 * and admin. Provides types + per-step validation + REST client + draft
 * persistence; UI lives in each consumer.
 *
 * Quick start:
 *
 *     import { createVolunteerApi, useVolunteerDraft, validateStep, WIZARD_STEPS } from '@shital/volunteer-sdk'
 *     const api = createVolunteerApi({ baseUrl: '/api/v1' })
 *     const draft = useVolunteerDraft({ api, branchId })
 *     const errs = validateStep(draft.wizardStep, draft.form)
 */

export * from "./types";
export * from "./validation";
export { createVolunteerApi } from "./api";
export type { ApiConfig, VolunteerApi } from "./api";
export { useVolunteerDraft } from "./hooks/useVolunteerDraft";
export type {
  UseVolunteerDraftArgs,
  UseVolunteerDraftReturn,
} from "./hooks/useVolunteerDraft";
