// src/app/api/recording/upload/route.ts
// Receives a browser-captured call recording (MediaRecorder output) and stores
// it in Hetzner Object Storage, then updates call_logs.recording_url.
//
// POST multipart/form-data
//   audio    | audio Blob (audio/webm, audio/mp4, audio/ogg)
//   callSid  | Twilio CallSid to match the call_logs row

import { after } from 'next/server'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'

function hasHetznerConfig(): boolean {
  return Boolean(
    process.env.HETZNER_S3_ENDPOINT &&
    process.env.HETZNER_S3_ACCESS_KEY &&
    process.env.HETZNER_S3_SECRET_KEY &&
    process.env.HETZNER_S3_BUCKET,
  )
}

let s3: S3Client | null = null
function getS3(): S3Client {
  if (s3) return s3
  s3 = new S3Client({
    endpoint: process.env.HETZNER_S3_ENDPOINT!,
    region: process.env.HETZNER_S3_REGION ?? 'auto',
    credentials: {
      accessKeyId: process.env.HETZNER_S3_ACCESS_KEY!,
      secretAccessKey: process.env.HETZNER_S3_SECRET_KEY!,
    },
    forcePathStyle: true,
    // A stuck request must fail, never hang. The SDK ships with no request
    // timeout and a 50-socket pool, so one socket that is never released stays
    // checked out for the life of the process; enough of them and every later
    // call queues behind them with nothing to break the wait.
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      httpsAgent: { maxSockets: 200 },
    },
  })
  return s3
}

export async function POST(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const audioEntry = formData.get('audio')
  const callSid = formData.get('callSid')

  if (!audioEntry || !(audioEntry instanceof Blob)) {
    return Response.json({ error: 'Missing audio blob' }, { status: 400 })
  }
  if (!callSid || typeof callSid !== 'string') {
    return Response.json({ error: 'Missing callSid' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  // Verify the call belongs to this org
  const admin = createServiceRoleClient()
  const { data: callLog } = await admin
    .from('call_logs')
    .select('id, org_id, recording_url')
    .eq('call_sid', callSid)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!callLog) {
    return Response.json({ error: 'Call not found' }, { status: 404 })
  }

  const audioBuffer = new Uint8Array(await audioEntry.arrayBuffer())
  const contentType = audioEntry.type || 'audio/webm'
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm'

  if (!hasHetznerConfig()) {
    // Dev mode | skip upload, return placeholder
    return Response.json({ ok: true, url: null, uploaded: false })
  }

  after(async () => {
    try {
      const key = `recordings/${orgId}/${callSid}/browser_recording.${ext}`
      const bucket = process.env.HETZNER_S3_BUCKET!

      await getS3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: audioBuffer,
          ContentType: contentType,
        }),
      )

      const publicBase = process.env.HETZNER_S3_PUBLIC_BASE_URL
      const url = publicBase
        ? `${publicBase.replace(/\/$/, '')}/${key}`
        : `${process.env.HETZNER_S3_ENDPOINT!.replace(/\/$/, '')}/${bucket}/${key}`

      await admin
        .from('call_logs')
        .update({ recording_url: url })
        .eq('id', callLog.id)
    } catch (err) {
      console.error('[recording/upload] upload error:', err)
    }
  })

  return Response.json({ ok: true })
}
