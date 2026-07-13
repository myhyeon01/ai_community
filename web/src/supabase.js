import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) console.warn('VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 web/.env에 설정하세요.')

export const supabase = createClient(url || 'https://example.supabase.co', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
