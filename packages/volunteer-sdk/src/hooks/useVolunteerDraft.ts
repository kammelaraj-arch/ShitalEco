/**
 * Volunteer draft persistence — local + remote.
 *
 * Local: localStorage so the form survives a tab close.
 * Remote: the API endpoint so the applicant can resume on a different device
 *         after we email them the magic link.
 *
 * Auto-saves on form change (debounced) to both sinks. Loads on mount from
 * the remote token if one is provided (typically via #draft=TOKEN hash in
 * the resume URL); otherwise from localStorage.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { VolunteerApi } from "../api";
import type { VolunteerForm } from "../types";
import { EMPTY_VOLUNTEER_FORM } from "../types";

const STORAGE_KEY = "shital_volunteer_draft_v1";
const SAVE_DEBOUNCE_MS = 800;

interface LocalDraft {
  form: VolunteerForm;
  wizardStep: number;
  token: string | null;
  savedAt: string;
}

export interface UseVolunteerDraftArgs {
  api: VolunteerApi;
  branchId: string;
  /** Token from the resume-link URL (eg. window.location.hash #draft=...). */
  resumeToken?: string;
  /** Called after a remote draft loads — for analytics / banner display. */
  onRemoteResume?: (token: string) => void;
}

export interface UseVolunteerDraftReturn {
  form: VolunteerForm;
  wizardStep: number;
  draftToken: string | null;
  hasDraft: boolean;
  /** Patch the form. Auto-saves shortly after. */
  updateForm: (patch: Partial<VolunteerForm>) => void;
  setForm: (f: VolunteerForm) => void;
  setWizardStep: (n: number) => void;
  /** Force an immediate remote save (eg. before showing the email-link UI). */
  saveRemoteNow: () => Promise<string | null>;
  /** Wipe local + remote. Called after a successful final submit. */
  clear: () => Promise<void>;
}

export function useVolunteerDraft(args: UseVolunteerDraftArgs): UseVolunteerDraftReturn {
  const { api, branchId, resumeToken, onRemoteResume } = args;

  const [form, setFormState] = useState<VolunteerForm>(EMPTY_VOLUNTEER_FORM);
  const [wizardStep, setWizardStep] = useState(0);
  const [draftToken, setDraftToken] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteSave = useRef<string>("");

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Remote takes precedence — magic-link URLs override local state.
      if (resumeToken) {
        try {
          const d = await api.loadDraft(resumeToken);
          if (cancelled) return;
          if (d) {
            const { __wizardStep, ...rest } = d.payload;
            setFormState({ ...EMPTY_VOLUNTEER_FORM, ...rest });
            if (typeof __wizardStep === "number") setWizardStep(__wizardStep);
            setDraftToken(d.token);
            setHasDraft(true);
            onRemoteResume?.(d.token);
            return;
          }
        } catch {
          /* fall through to localStorage */
        }
      }
      // Fallback: localStorage.
      if (typeof window === "undefined") return;
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<LocalDraft>;
        if (cancelled) return;
        if (parsed.form) setFormState({ ...EMPTY_VOLUNTEER_FORM, ...parsed.form });
        if (typeof parsed.wizardStep === "number") setWizardStep(parsed.wizardStep);
        if (parsed.token) setDraftToken(parsed.token);
        setHasDraft(true);
      } catch {
        /* corrupted draft — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, resumeToken, onRemoteResume]);

  // ── Debounced local save on every form/step change ────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: LocalDraft = {
      form,
      wizardStep,
      token: draftToken,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [form, wizardStep, draftToken]);

  // ── Debounced remote save ────────────────────────────────────────────────
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveRemote(form, wizardStep);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, wizardStep]);

  const saveRemote = useCallback(
    async (f: VolunteerForm, step: number): Promise<string | null> => {
      // Skip if nothing meaningful is filled (avoid churning empty drafts
      // for users who just bounce off the landing step).
      const sig = JSON.stringify({ f, step });
      if (sig === lastRemoteSave.current) return draftToken;
      if (!f.first_names.trim() && !f.email.trim() && step === 0) return draftToken;

      const token = draftToken ?? generateToken();
      try {
        const r = await api.saveDraft({
          token,
          branch_id: branchId,
          payload: { ...f, __wizardStep: step },
        });
        lastRemoteSave.current = sig;
        if (!draftToken) setDraftToken(r.token);
        return r.token;
      } catch {
        return draftToken;
      }
    },
    [api, branchId, draftToken],
  );

  const saveRemoteNow = useCallback(
    () => saveRemote(form, wizardStep),
    [saveRemote, form, wizardStep],
  );

  const updateForm = useCallback((patch: Partial<VolunteerForm>) => {
    setFormState(prev => ({ ...prev, ...patch }));
  }, []);

  const setForm = useCallback((f: VolunteerForm) => setFormState(f), []);

  const clear = useCallback(async () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    if (draftToken) {
      try {
        await api.deleteDraft(draftToken);
      } catch {
        /* ignore */
      }
    }
    setFormState(EMPTY_VOLUNTEER_FORM);
    setWizardStep(0);
    setDraftToken(null);
    setHasDraft(false);
  }, [api, draftToken]);

  return {
    form,
    wizardStep,
    draftToken,
    hasDraft,
    updateForm,
    setForm,
    setWizardStep,
    saveRemoteNow,
    clear,
  };
}

function generateToken(): string {
  // 32-hex draft tokens — same shape as the backend would generate.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  // Fallback for older environments (kiosk Electron may have an old runtime).
  let s = "";
  for (let i = 0; i < 32; i += 1) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
