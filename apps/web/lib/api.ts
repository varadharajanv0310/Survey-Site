export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

/**
 * `credentials: 'include'` on every call — sessions are httpOnly cookies set
 * by the API, not tokens held in JavaScript, so the browser has to be told to
 * send them cross-origin.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  const text = await response.text()
  const body = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new ApiError(body.error ?? `request failed (${response.status})`, response.status, body.code)
  }
  return body as T
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) })

/** Points are integers; render them with separators so 26743 reads as 26,743. */
export const formatPoints = (points: number) => points.toLocaleString('en-US')

/** Amounts arrive as integer minor units. Never do currency math in floats. */
export const formatMoney = (minor: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100)

export const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const formatDateTime = (value: string | Date) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
