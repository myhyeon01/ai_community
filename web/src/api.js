const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'

export async function api(path, options = {}) {
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const headers = { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || '요청을 처리하지 못했습니다.')
  return data
}
