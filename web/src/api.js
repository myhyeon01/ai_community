function edgeApiUrl() {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  return supabaseUrl ? `${supabaseUrl}/functions/v1/kmu-api/api/v1` : ''
}

const baseUrl = edgeApiUrl()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export class ApiConnectionError extends Error {
  constructor(requestUrl, cause) {
    super(`Supabase Edge API에 연결할 수 없습니다. 요청 URL: ${requestUrl}. Edge Function 배포와 환경변수를 확인해 주세요.`)
    this.name = 'ApiConnectionError'
    this.cause = cause
  }
}

export function isApiConnectionError(error) { return error?.name === 'ApiConnectionError' }

export async function api(path, options = {}) {
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
  if (publishableKey) headers.apikey = publishableKey
  if (token) headers.Authorization = `Bearer ${token}`
  if (!baseUrl) throw new Error('VITE_SUPABASE_URL 환경변수가 없습니다.')
  const requestUrl = `${baseUrl}/${path.replace(/^\//, '')}`
  let response
  try { response = await fetch(requestUrl, { ...options, headers }) }
  catch (error) { if (error?.name === 'AbortError') throw error; throw new ApiConnectionError(requestUrl, error) }
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `API 요청에 실패했습니다. (${response.status} ${response.statusText}, ${requestUrl})`)
  return data
}
