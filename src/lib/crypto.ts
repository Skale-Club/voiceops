// src/lib/crypto.ts
// AES-256-GCM credential encryption — Edge Runtime safe (Web Crypto API only)
// NEVER import from 'node:crypto' — throws in Edge Runtime

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret || secret.length !== 64) {
    throw new Error('ENCRYPTION_SECRET must be a 64-character hex string (32 bytes)')
  }
  // Decode 64-char hex string to 32 bytes manually — never use Buffer (Node.js only)
  const keyBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16)
  }
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,          // not extractable
    ['encrypt', 'decrypt']
  )
}

function uint8ToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))  // 96-bit IV per AES-GCM spec
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded)
  const ivB64 = uint8ToBase64(iv)
  const ctB64 = uint8ToBase64(new Uint8Array(ciphertext))
  return `${ivB64}:${ctB64}`
}

export async function decrypt(stored: string): Promise<string> {
  const key = await getKey()
  const colonIdx = stored.indexOf(':')
  if (colonIdx === -1) throw new Error('Invalid encrypted format — expected iv:ciphertext')
  const iv = base64ToUint8(stored.slice(0, colonIdx))
  const ciphertext = base64ToUint8(stored.slice(colonIdx + 1))
  const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

export function maskApiKey(apiKey: string): string {
  // Returns '••••••••{last4}' — never exposes the full key
  if (apiKey.length <= 4) return '••••••••'
  return `••••••••${apiKey.slice(-4)}`
}
