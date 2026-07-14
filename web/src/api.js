function normalizeApiUrl(value) {
  const fallback = 'http://127.0.0.1:8000/api/v1'
  return String(value || fallback).replace(
    /^http:\/\/localhost(?::|\/)/,
    (match) => match.replace('localhost', '127.0.0.1'),
  )
}

const baseUrl = normalizeApiUrl(import.meta.env.VITE_API_URL)

export class ApiConnectionError extends Error {
  constructor(requestUrl, cause) {
    super(`API 서버에 연결할 수 없습니다. 요청 URL: ${requestUrl}. 백엔드가 실행 중인지 확인해 주세요.`)
    this.name = 'ApiConnectionError'
    this.cause = cause
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
  const requestUrl = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  let response
  try {
    response = await fetch(requestUrl, { ...options, headers })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiConnectionError(requestUrl, error)
  }
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `API 요청에 실패했습니다. (${response.status} ${response.statusText}, ${requestUrl})`)
  return data
}
