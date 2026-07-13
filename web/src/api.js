function normalizeApiUrl(value) {
  const fallback = 'http://127.0.0.1:8000/api/v1'
  return String(value || fallback).replace(
    /^http:\/\/localhost(?::|\/)/,
    (match) => match.replace('localhost', '127.0.0.1'),
  )
}

const baseUrl = normalizeApiUrl(import.meta.env.VITE_API_URL)

export class ApiConnectionError extends Error {
  constructor() {
    super('API 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.')
    this.name = 'ApiConnectionError'
  }
}

export function isApiConnectionError(error) {
  return error?.name === 'ApiConnectionError'
}

export async function api(path, options = {}) {
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  } catch {
    throw new ApiConnectionError()
  }
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || '요청을 처리하지 못했습니다.')
  return data
}
