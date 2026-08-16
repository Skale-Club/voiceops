// src/app/api/calls/[id]/recording/route.ts
// Authenticated, org-scoped audio proxy for call recordings.
//
// Why this exists: Twilio recording media (api.twilio.com/.../Recordings/RE….mp3)
// requires HTTP Basic Auth. When Hetzner object storage isn't configured we store
// the raw Twilio URL in call_logs.recording_url, so the browser player can't fetch
// it directly (401 Unauthorized). This route streams the audio server-side with the
// org's Twilio credentials.
//
// Everything else — Vapi-hosted AI-call recordings, and Twilio recordings already
// copied to our own object storage — is streamed too rather than redirected. The
// player (components/calls/call-waveform-player.tsx) runs WaveSurfer on the
// WebAudio backend, which fetches the URL and decodes it, so a cross-origin
// redirect only works if the upstream host sends CORS headers. Streaming keeps the
// response same-origin and makes playback independent of whoever hosts the file.
//
// Access is gated by the authenticated Supabase client: the unified_calls lookup is
// RLS-scoped, so a user can only ever proxy recordings belonging to their org.

import { getUser, createClient } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'

export const runtime = 'nodejs'

function isTwilioMediaUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('api.twilio.com')
  } catch {
    return false
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params

  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // RLS-scoped: only returns the row if it belongs to the user's org.
  const supabase = await createClient()
  const { data: call } = await supabase
    .from('unified_calls')
    .select('recording_url, org_id')
    .eq('id', id)
    .maybeSingle()

  if (!call?.recording_url) {
    return new Response('Recording not found', { status: 404 })
  }

  const fromTwilio = isTwilioMediaUrl(call.recording_url)

  // Only Twilio needs credentials — Vapi recording URLs and our own storage URLs
  // are fetched anonymously.
  let authHeader: string | null = null
  if (fromTwilio) {
    const creds = await resolveTwilioCredentialsForOrg(call.org_id)
    if (!creds) {
      return new Response('Twilio credentials unavailable', { status: 502 })
    }
    authHeader = `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`
  }

  // Twilio's resource URL returns JSON unless an extension is appended; other
  // hosts already point at the media file, so leave those untouched.
  const mediaUrl =
    fromTwilio && !/\.(mp3|wav)$/.test(call.recording_url)
      ? `${call.recording_url}.mp3`
      : call.recording_url

  const range = request.headers.get('range')

  let upstream: Response
  try {
    upstream = await fetch(mediaUrl, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...(range ? { Range: range } : {}),
      },
      cache: 'no-store',
    })
  } catch {
    return new Response('Failed to fetch recording', { status: 502 })
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Failed to fetch recording', { status: 502 })
  }

  // Stream the audio straight through, preserving range/seek headers.
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=3600')
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  return new Response(upstream.body, { status: upstream.status, headers })
}
