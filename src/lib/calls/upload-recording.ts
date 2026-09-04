// src/lib/calls/upload-recording.ts
// Downloads a Twilio recording and uploads it to Hetzner Object Storage (S3-
// compatible). Falls back to returning the Twilio URL when Hetzner credentials
// are missing in dev | keeps the recording link usable without storage setup.
//
// Env vars expected (set in production only):
//   HETZNER_S3_ENDPOINT       | e.g. https://fsn1.your-objectstorage.com
//   HETZNER_S3_REGION         | e.g. fsn1
//   HETZNER_S3_ACCESS_KEY     | Hetzner access key
//   HETZNER_S3_SECRET_KEY     | Hetzner secret key
//   HETZNER_S3_BUCKET         | bucket name (e.g. operator-recordings)
//   HETZNER_S3_PUBLIC_BASE_URL | optional public CDN base URL prepended to keys
//
// Storage layout: `recordings/<org_id>/<call_sid>/<recording_sid>.<ext>`

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export interface UploadRecordingParams {
  orgId: string
  callSid: string
  recordingSid: string
  recordingUrl: string  // Twilio recording URL (without .mp3 | see appendExt)
  recordingDuration?: number
  twilioAccountSid: string
  twilioAuthToken: string
}

export interface UploadRecordingResult {
  storedUrl: string
  uploaded: boolean
  /** Surfaced to callers so they can persist it for analytics; passes through Twilio when nothing else. */
  contentType: string
}

function hasHetznerConfig(): boolean {
  return Boolean(
    process.env.HETZNER_S3_ENDPOINT &&
    process.env.HETZNER_S3_ACCESS_KEY &&
    process.env.HETZNER_S3_SECRET_KEY &&
    process.env.HETZNER_S3_BUCKET,
  )
}

let cachedClient: S3Client | null = null
function getS3(): S3Client {
  if (cachedClient) return cachedClient
  cachedClient = new S3Client({
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
  return cachedClient
}

/**
 * Fetch the recording audio (mp3 by default) using Twilio basic-auth, then PUT
 * it to Hetzner. Returns the resulting object URL. In dev (no Hetzner config),
 * returns the original Twilio URL so the player still works for the developer.
 */
export async function uploadRecordingToHetzner(
  params: UploadRecordingParams,
): Promise<UploadRecordingResult> {
  const mp3Url = appendMp3(params.recordingUrl)

  if (!hasHetznerConfig()) {
    // Dev path | surface Twilio's URL directly. NB: Twilio recordings require
    // basic auth, so this is only usable for quick local checks.
    console.warn('[upload-recording] HETZNER_S3_* env not set | returning Twilio URL as fallback')
    return { storedUrl: mp3Url, uploaded: false, contentType: 'audio/mpeg' }
  }

  // 1. Download the audio from Twilio (HTTP basic auth)
  const basicAuth = `Basic ${btoa(`${params.twilioAccountSid}:${params.twilioAuthToken}`)}`
  const res = await fetch(mp3Url, {
    method: 'GET',
    headers: { Authorization: basicAuth },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Recording fetch failed ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const contentType = res.headers.get('content-type') ?? 'audio/mpeg'
  const audio = new Uint8Array(await res.arrayBuffer())

  // 2. Upload to Hetzner
  const key = `recordings/${params.orgId}/${params.callSid}/${params.recordingSid}.mp3`
  const bucket = process.env.HETZNER_S3_BUCKET!

  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: audio,
      ContentType: contentType,
      // Recordings are private by default | surface them through a signed URL or
      // a tenant-aware proxy. We deliberately do NOT set ACL: public-read.
    }),
  )

  // 3. Build the canonical URL
  const publicBase = process.env.HETZNER_S3_PUBLIC_BASE_URL
  const storedUrl = publicBase
    ? `${publicBase.replace(/\/$/, '')}/${key}`
    : `${process.env.HETZNER_S3_ENDPOINT!.replace(/\/$/, '')}/${bucket}/${key}`

  return { storedUrl, uploaded: true, contentType }
}

function appendMp3(url: string): string {
  if (url.endsWith('.mp3') || url.endsWith('.wav')) return url
  return `${url}.mp3`
}
