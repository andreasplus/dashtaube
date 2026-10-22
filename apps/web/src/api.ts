import type { InboxView, Notification, NotificationStatus, Source } from "@dashtaube/core/notification";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/v1/session")) window.dispatchEvent(new Event("dashtaube:logout"));
    throw new ApiError(response.status, data.error ?? response.statusText);
  }
  return data as T;
}

export interface ListParams {
  view: InboxView;
  source?: string | undefined;
  minPriority?: number | undefined;
  needsInput?: boolean | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
}

export interface Counts {
  inbox: number;
  unread: number;
  needs_input: number;
  snoozed: number;
  done: number;
  archived: number;
  sources: Source[];
}

export interface Patch {
  status?: NotificationStatus;
  snooze_until?: number | null;
}

export const api = {
  session: () => request<{ authenticated: boolean; version: string }>("/v1/session"),
  login: (password: string) =>
    request<{ authenticated: boolean }>("/v1/session", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request("/v1/session", { method: "DELETE" }),

  list(params: ListParams) {
    const query = new URLSearchParams({ view: params.view });
    if (params.source) query.set("source", params.source);
    if (params.minPriority) query.set("min_priority", String(params.minPriority));
    if (params.needsInput !== undefined) query.set("needs_input", String(params.needsInput));
    if (params.q) query.set("q", params.q);
    if (params.cursor) query.set("cursor", params.cursor);
    return request<{ items: Notification[]; next_cursor: string | null }>(`/v1/notifications?${query}`);
  },
  get: (id: string) => request<Notification>(`/v1/notifications/${encodeURIComponent(id)}`),
  patch: (id: string, patch: Patch) =>
    request<{ changed: number }>(`/v1/notifications/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  bulk: (ids: string[], patch: Patch) =>
    request<{ changed: number }>("/v1/notifications/bulk", { method: "POST", body: JSON.stringify({ ids, patch }) }),
  counts: () => request<Counts>("/v1/counts"),

  sources: () => request<{ sources: Source[] }>("/v1/sources"),
  createSource: (body: { name: string; kind: string; icon?: string | null; color?: string | null }) =>
    request<{ id: string; token: string; signing_secret?: string; webhook_url?: string }>("/v1/sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSource: (id: string, body: { name?: string; icon?: string | null; color?: string | null }) =>
    request(`/v1/sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSource: (id: string) => request(`/v1/sources/${id}`, { method: "DELETE" }),
  rotateToken: (id: string) => request<{ token: string }>(`/v1/sources/${id}/token`, { method: "POST" }),
  rotateSecret: (id: string) =>
    request<{ signing_secret: string; webhook_url: string }>(`/v1/sources/${id}/signing-secret`, { method: "POST" }),
  disconnect: (id: string) => request<{ revoked: number }>(`/v1/sources/${id}/disconnect`, { method: "POST" }),
  testSource: (id: string) => request<{ id: string }>(`/v1/sources/${id}/test`, { method: "POST" }),
};
