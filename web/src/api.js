const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

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
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`API 서버에 연결할 수 없습니다. 요청 URL: ${requestUrl}. FastAPI가 실행 중인지 확인해주세요. (${reason})`, { cause: error })
  }
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `API 요청에 실패했습니다. (${response.status} ${response.statusText}, ${requestUrl})`)
  return data
}
