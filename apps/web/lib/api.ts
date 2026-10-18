import { WORKSPACE_HEADER } from '@workhub/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  workspaceId?: string;
}

/** Calls the API through the same-origin /api proxy. Throws ApiError on failure. */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.workspaceId) headers[WORKSPACE_HEADER] = options.workspaceId;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fieldErrors: Record<string, string> = {};
    for (const e of data.errors ?? []) fieldErrors[e.path] ??= e.message;
    const message = typeof data.message === 'string' ? data.message : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, message, fieldErrors);
  }
  return data as T;
}
