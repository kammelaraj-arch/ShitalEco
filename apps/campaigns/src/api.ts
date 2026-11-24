// Thin fetch wrapper that carries the auth token and surfaces non-200
// responses as thrown Errors with the server's own message when it has one.
//
// Lives alongside the admin app — same backend, same JWT, same cookie
// domain (`.shital.org.uk`) so a logged-in admin can hop between
// admin.shital.org.uk and campaigns.shital.org.uk without a second login
// in the future (Phase 1c wires SSO; for now we re-auth once here).

import { useAuth } from './store'

const API = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${API}${path}`, { ...init, headers })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const body = await r.json()
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* body wasn't JSON */ }
    throw new HttpError(r.status, msg)
  }
  if (r.status === 204) return undefined as unknown as T
  return r.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    req<{ access_token: string; user: { email: string; role: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  sendTest: (body: {
    contact_id: string
    template_key?: string
    subject?: string
    html?: string
    text?: string
    variables?: Record<string, unknown>
  }) => req<{ sent: boolean; skipped?: boolean; reason?: string; prefs_url?: string; sent_email_id?: string }>(
    '/marketing/send-test', { method: 'POST', body: JSON.stringify(body) },
  ),

  // Saved audience segments
  listSegments: () => req<{ items: Array<{ id: string; name: string; description: string; entry_count: number; updated_at: string }> }>(
    '/marketing/segments',
  ),
  createSegment: (body: { name: string; description?: string }) =>
    req<{ ok: true; id: string }>('/marketing/segments', { method: 'POST', body: JSON.stringify(body) }),
  getSegment: (id: string) =>
    req<{ segment: { id: string; name: string; description: string }; entries: Array<{ id: string; kind: string; params: Record<string, unknown>; created_at: string }> }>(
      `/marketing/segments/${id}`,
    ),
  deleteSegment: (id: string) =>
    req<{ ok: true }>(`/marketing/segments/${id}`, { method: 'DELETE' }),
  addSegmentEntry: (segId: string, body: { kind: string; params: Record<string, unknown> }) =>
    req<{ ok: true; id: string }>(`/marketing/segments/${segId}/entries`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  deleteSegmentEntry: (segId: string, entryId: string) =>
    req<{ ok: true }>(`/marketing/segments/${segId}/entries/${entryId}`, { method: 'DELETE' }),
  previewSegment: (segId: string) =>
    req<{ total: number; per_entry: Array<{ entry_id: string; kind: string; count: number }> }>(
      `/marketing/segments/${segId}/preview-count`, { method: 'POST' },
    ),

  // Marketing templates
  listTemplates: () => req<{ items: Array<{ id: string; name: string; subject: string; category: 'newsletter' | 'appeal' | 'event' | 'welcome' | 'thank-you' | 'general'; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; variables: string[]; updated_at: string }> }>(
    '/marketing/templates',
  ),
  createTemplate: (body: { name: string; subject?: string; html_body?: string; text_body?: string; category?: string }) =>
    req<{ ok: true; id: string; variables: string[] }>('/marketing/templates', {
      method: 'POST', body: JSON.stringify(body),
    }),
  getTemplate: (id: string) =>
    req<{ template: { id: string; name: string; subject: string; html_body: string; text_body: string; variables: string[]; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; category: 'newsletter' | 'appeal' | 'event' | 'welcome' | 'thank-you' | 'general'; updated_at: string } }>(
      `/marketing/templates/${id}`,
    ),
  updateTemplate: (id: string, body: {
    name?: string; subject?: string; html_body?: string; text_body?: string; category?: string; status?: string
  }) => req<{ ok: true }>(`/marketing/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  archiveTemplate: (id: string) =>
    req<{ ok: true }>(`/marketing/templates/${id}`, { method: 'DELETE' }),
  previewTemplate: (id: string, variables: Record<string, unknown>) =>
    req<{ subject: string; html_body: string; text_body: string; declared_variables: string[] }>(
      `/marketing/templates/${id}/preview`, { method: 'POST', body: JSON.stringify({ variables }) },
    ),

  // Marketing campaigns
  listCampaigns: () => req<{ items: Array<{
    id: string; name: string; status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
    scheduled_at: string | null; sent_at: string | null;
    stats: Record<string, unknown>; updated_at: string;
    segment_name: string | null; template_name: string | null;
  }> }>('/marketing/campaigns'),
  createCampaign: (body: { name: string; segment_id?: string | null; template_id?: string | null; scheduled_at?: string | null }) =>
    req<{ ok: true; id: string }>('/marketing/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  getCampaign: (id: string) =>
    req<{ campaign: {
      id: string; name: string; segment_id: string | null; template_id: string | null;
      variables: Record<string, string>; scheduled_at: string | null;
      status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
      stats: { attempted?: number; sent?: number; skipped_opted_out?: number; failed?: number; failed_detail?: Array<{ email: string; reason: string }> };
      segment_name: string | null; template_name: string | null;
      subject: string | null; html_body: string | null;
    } }>(`/marketing/campaigns/${id}`),
  updateCampaign: (id: string, body: Record<string, unknown>) =>
    req<{ ok: true }>(`/marketing/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  cancelCampaign: (id: string) =>
    req<{ ok: true }>(`/marketing/campaigns/${id}`, { method: 'DELETE' }),
  previewCampaignCount: (id: string) =>
    req<{ total_unique: number }>(`/marketing/campaigns/${id}/preview-count`, { method: 'POST' }),
  sendCampaignNow: (id: string) =>
    req<{ ok: true; stats: Record<string, unknown> }>(`/marketing/campaigns/${id}/send-now`, { method: 'POST' }),
  scheduleCampaign: (id: string, scheduled_at: string) =>
    req<{ ok: true; scheduled_at: string }>(`/marketing/campaigns/${id}/schedule`, {
      method: 'POST', body: JSON.stringify({ scheduled_at }),
    }),
  unscheduleCampaign: (id: string) =>
    req<{ ok: true }>(`/marketing/campaigns/${id}/unschedule`, { method: 'POST' }),
  campaignTracking: (id: string) =>
    req<{
      opens: number; clicks: number; unique_opens: number; unique_clicks: number;
      top_links: Array<{ url: string; clicks: number; unique_clicks: number }>
    }>(`/marketing/campaigns/${id}/tracking`),
}
