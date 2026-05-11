/**
 * Headless state machine for the donor-facing giving flow.
 *
 *   pick → details → pay → done
 *
 * Owns step state, donor state, selected tier, derived plan_id. Returns
 * handlers; the consumer renders whatever UI they want (kiosk has big tap
 * tiles; service has scroll-friendly form; admin could have a dense desk
 * variant). The hook is intentionally non-prescriptive about UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GivingApi } from "../api";
import type { DonorDetails, GivingStep, GivingTier } from "../types";
import { isValidDonor } from "../validation";

export interface UseGivingFlowArgs {
  api: GivingApi;
  branchId: string;
  /** Optional initial donor (eg. prefilled from CRM lookup). */
  initialDonor?: Partial<DonorDetails>;
}

export interface UseGivingFlowReturn {
  step: GivingStep;
  setStep: (s: GivingStep) => void;
  tiers: GivingTier[];
  loadingTiers: boolean;
  selected: GivingTier | null;
  setSelected: (t: GivingTier | null) => void;
  donor: DonorDetails;
  updateDonor: (patch: Partial<DonorDetails>) => void;
  detailsValid: boolean;
  planId: string;
  /** Server-side subscribe — returns plan_id ready for the PayPal popup. */
  startPayment: () => Promise<void>;
  /** Called from PayPal onApprove — finalises and moves to 'done'. */
  finalize: (paypalSubscriptionId: string) => Promise<void>;
  error: string;
  setError: (e: string) => void;
  reset: () => void;
}

const EMPTY_DONOR: DonorDetails = {
  firstName: "",
  surname: "",
  email: "",
  phone: "",
  postcode: "",
  address: "",
  giftAidDeclared: false,
};

export function useGivingFlow(args: UseGivingFlowArgs): UseGivingFlowReturn {
  const { api, branchId, initialDonor } = args;

  const [step, setStep] = useState<GivingStep>("pick");
  const [tiers, setTiers] = useState<GivingTier[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(true);
  const [selected, setSelected] = useState<GivingTier | null>(null);
  const [donor, setDonor] = useState<DonorDetails>({ ...EMPTY_DONOR, ...initialDonor });
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState("");

  // PayPal's onApprove is registered on the Buttons SDK at render time. If
  // finalize's identity changes between render and approve, the SDK fires a
  // stale closure. Mirror current state through a ref so finalize stays
  // identity-stable — same fix as PR #77 for PaymentPage.
  const stateRef = useRef({ selected, planId, branchId, donor });
  useEffect(() => {
    stateRef.current = { selected, planId, branchId, donor };
  });

  useEffect(() => {
    let cancelled = false;
    api
      .listTiers()
      .then(({ tiers }) => {
        if (cancelled) return;
        setTiers(tiers);
        setSelected(prev => prev ?? tiers.find(t => t.is_default) ?? tiers[0] ?? null);
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : "Could not load tiers"))
      .finally(() => !cancelled && setLoadingTiers(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const updateDonor = useCallback((patch: Partial<DonorDetails>) => {
    setDonor(prev => ({ ...prev, ...patch }));
  }, []);

  const detailsValid = useMemo(() => isValidDonor(donor), [donor]);

  const startPayment = useCallback(async () => {
    if (!selected) return;
    setError("");
    try {
      const isCustom = selected.id === "custom";
      const res = await api.subscribe({
        tier_id: selected.id,
        branch_id: branchId,
        donor,
        customAmount: isCustom ? selected.amount : null,
        customLabel: isCustom ? selected.label : "",
      });
      setPlanId(res.plan_id);
      setStep("pay");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set up subscription. Please try again.");
    }
  }, [api, branchId, donor, selected]);

  const finalize = useCallback(
    async (subscriptionId: string) => {
      const s = stateRef.current;
      if (!subscriptionId || !s.selected || !s.planId) return;
      await api
        .approve({
          subscription_id: subscriptionId,
          plan_id: s.planId,
          tier: s.selected,
          branch_id: s.branchId,
          donor: s.donor,
        })
        .catch(() => {
          /* swallow — subscription is recorded on PayPal regardless */
        });
      setStep("done");
    },
    [api],
  );

  const reset = useCallback(() => {
    setStep("pick");
    setDonor({ ...EMPTY_DONOR, ...initialDonor });
    setPlanId("");
    setError("");
  }, [initialDonor]);

  return {
    step,
    setStep,
    tiers,
    loadingTiers,
    selected,
    setSelected,
    donor,
    updateDonor,
    detailsValid,
    planId,
    startPayment,
    finalize,
    error,
    setError,
    reset,
  };
}
