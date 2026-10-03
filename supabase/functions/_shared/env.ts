// Settings for the Edge Functions, read from the function secrets (Supabase dashboard → Edge
// Functions → Secrets). Nothing secret lives in git.

import { createClient } from 'npm:@supabase/supabase-js@2'

import type { ChannelConfig } from './channels.ts'

export function env(name: string) {
  const value = Deno.env.get(name)?.trim()
  return value ? value : undefined
}

/** A client with the service role: only the definer RPCs it calls decide what it may do. */
export function serviceClient() {
  const url = env('SUPABASE_URL')
  let key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!key) {
    // Projects on the new API keys expose them as JSON: {"default": "sb_secret_..."}.
    try {
      key = JSON.parse(env('SUPABASE_SECRET_KEYS') ?? '{}').default
    } catch {
      key = undefined
    }
  }
  if (!url || !key) throw new Error('SUPABASE_URL and a service role key must be set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function channelConfig(): ChannelConfig {
  return {
    siteUrl: env('SITE_URL') ?? 'https://frontend-pi-lime-66.vercel.app',
    timeZone: env('ALERT_TIME_ZONE') ?? 'Asia/Kolkata',
    resendApiKey: env('RESEND_API_KEY'),
    emailFrom: env('EMAIL_FROM') ?? "Women's Safety <onboarding@resend.dev>",
    telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  }
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
