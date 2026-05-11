/**
 * @shital/giving-sdk
 *
 * Headless monthly-giving SDK shared between the service portal, kiosk, and
 * admin. Pure logic: types, validation, PayPal payload builders, REST client,
 * state-machine hooks. Each consumer renders its own UI.
 *
 * Quick start (consumer):
 *
 *     import { createGivingApi, useGivingFlow, buildSubscriber } from '@shital/giving-sdk'
 *     const api = createGivingApi({ baseUrl: '/api/v1' })
 *     const flow = useGivingFlow({ api, branchId })
 *     // …render flow.step, flow.tiers, etc.
 */

export * from "./types";
export * from "./validation";
export * from "./paypal";
export { createGivingApi } from "./api";
export type { ApiConfig, GivingApi } from "./api";
export { useGivingFlow } from "./hooks/useGivingFlow";
export type { UseGivingFlowArgs, UseGivingFlowReturn } from "./hooks/useGivingFlow";
