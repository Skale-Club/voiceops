// tests/medusa-context.test.ts
// CTX-01/CTX-02: verifyCommerceContext (anti-IDOR HMAC verify) + writeCommerceContext
// (JSONB pinning) + consumeContextJti (X2 jti replay guard). See
// .planning/research/INTEGRATION-CONTRACT.md §3 and
// .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-01-PLAN.md,
// plus stuscle/docs/INTEGRATION-XPHERE-X2-TOKEN-BINDING.md for the v2 (jti/cnonce) design.

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  verifyCommerceContext,
  writeCommerceContext,
  readCommerceContext,
  consumeContextJti,
  type CommerceClaims,
} from '@/lib/medusa/context'
import { loadPinnedContext } from '@/lib/medusa/pinned-context'
import type { MedusaExecCtx } from '@/lib/medusa/client'

// ---- node:crypto mint helper — stuscle-identical mint (contract §3) --------
// token = base64url(payloadJson) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJson)))
function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function mint(payload: object, secret: string): string {
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  return `${p}.${b64url(createHmac('sha256', secret).update(p).digest())}`
}

const SECRET = 'xph_test_connection_token_abc123'
const ORG = 'org_11111111-1111-1111-1111-111111111111'

function basePayload(overrides: Partial<CommerceClaims> = {}): CommerceClaims {
  const now = Math.floor(Date.now() / 1000)
  return {
    v: 2,
    org: ORG,
    cart: 'cart_01ABC',
    cus: null,
    email: null,
    wishlist_ref: null,
    country_code: 'dk',
    region_id: 'reg_01DK',
    jti: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cnonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    iat: now,
    exp: now + 300,
    ...overrides,
  }
}

describe('CTX-01: verifyCommerceContext', () => {
  it('valid: returns claims deep-equal to a payload minted with the node:crypto helper', async () => {
    const payload = basePayload()
    const token = mint(payload, SECRET)
    const result = await verifyCommerceContext(token, SECRET, ORG)
    expect(result).toEqual(payload)
  })

  it('cross-repo vector: verifies a committed literal v2 token minted stuscle-identically', async () => {
    // Byte-verified cross-repo vector — DO NOT alter these literals. Minted with
    // node:crypto createHmac('sha256', VECTOR_SECRET).update(base64urlPayload).digest(),
    // key = raw UTF-8 bytes of VECTOR_SECRET (no hex decode). v2 payload (adds
    // jti/cnonce vs. the old v1 vector) — see 133-01-PLAN.md for the v1 lineage
    // and the X2 design doc for the v2 bump.
    const VECTOR_SECRET = 'xph_test_connection_token_abc123'
    const VECTOR_TOKEN =
      'eyJ2IjoyLCJvcmciOiJvcmdfMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiY2FydCI6ImNhcnRfMDFBQkMiLCJjdXMiOm51bGwsImVtYWlsIjpudWxsLCJ3aXNobGlzdF9yZWYiOm51bGwsImNvdW50cnlfY29kZSI6ImRrIiwicmVnaW9uX2lkIjoicmVnXzAxREsiLCJqdGkiOiJhYWFhYWFhYS1hYWFhLTRhYWEtOGFhYS1hYWFhYWFhYWFhYWEiLCJjbm9uY2UiOiJiYmJiYmJiYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJiYmJiYmIiLCJpYXQiOjE3NTAwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMH0.4MEohdC1fXvKveQ5ZNAtKt3czv0S9HEVRsz-L2sAvmo'
    const VECTOR_ORG = 'org_11111111-1111-1111-1111-111111111111'

    const result = await verifyCommerceContext(VECTOR_TOKEN, VECTOR_SECRET, VECTOR_ORG)

    expect(result).toEqual({
      v: 2,
      org: VECTOR_ORG,
      cart: 'cart_01ABC',
      cus: null,
      email: null,
      wishlist_ref: null,
      country_code: 'dk',
      region_id: 'reg_01DK',
      jti: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cnonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      iat: 1750000000,
      exp: 4102444800,
    })
  })

  it('expired: exp in the past (unix seconds) returns null', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = mint(basePayload({ exp: now - 10 }), SECRET)
    expect(await verifyCommerceContext(token, SECRET, ORG)).toBeNull()
  })

  it('bad sig: a tampered signature returns null', async () => {
    const token = mint(basePayload(), SECRET)
    const [payloadB64, sigB64] = token.split('.')
    // Tamper the FIRST sig char, not the last: the last base64url char of a
    // 32-byte HMAC carries only 4 meaningful bits (the other 2 are discarded
    // padding), so an 'A'↔'B' last-char flip decodes to identical bytes ~6% of
    // the time and the "tampered" sig still verifies. The first char encodes the
    // top 6 bits of byte 0 (all meaningful), so flipping it always changes the
    // decoded signature — deterministically failing verification.
    const firstChar = sigB64.at(0)
    const flipped = firstChar === 'A' ? 'B' : 'A'
    const tampered = `${payloadB64}.${flipped}${sigB64.slice(1)}`
    expect(tampered).not.toBe(token)
    expect(await verifyCommerceContext(tampered, SECRET, ORG)).toBeNull()
  })

  it('wrong org: claims.org !== expectedOrg returns null (cross-org replay barrier)', async () => {
    const token = mint(basePayload({ org: 'org_A' }), SECRET)
    expect(await verifyCommerceContext(token, SECRET, 'org_B')).toBeNull()
  })

  it('malformed: never throws for any invalid shape, always returns null', async () => {
    await expect(verifyCommerceContext('no-dot-here', SECRET, ORG)).resolves.toBeNull()
    await expect(verifyCommerceContext('', SECRET, ORG)).resolves.toBeNull()

    // non-base64 payload — signature can't match either way, fails safely
    const valid = mint(basePayload(), SECRET)
    const [, validSig] = valid.split('.')
    await expect(verifyCommerceContext(`not@@base64$$.${validSig}`, SECRET, ORG)).resolves.toBeNull()

    // valid base64url payload that decodes to non-JSON content
    const nonJsonPayload = b64url(Buffer.from('not-json-at-all'))
    const nonJsonSig = b64url(createHmac('sha256', SECRET).update(nonJsonPayload).digest())
    await expect(verifyCommerceContext(`${nonJsonPayload}.${nonJsonSig}`, SECRET, ORG)).resolves.toBeNull()

    // v !== 2
    const v3Token = mint(basePayload({ v: 3 }), SECRET)
    await expect(verifyCommerceContext(v3Token, SECRET, ORG)).resolves.toBeNull()
  })

  it('null-tolerant: a guest token (cart/cus/email/wishlist_ref/region_id all null) verifies fine', async () => {
    const payload = basePayload({ cart: null, cus: null, email: null, wishlist_ref: null, region_id: null })
    const token = mint(payload, SECRET)
    expect(await verifyCommerceContext(token, SECRET, ORG)).toEqual(payload)
  })

  it('v1 token: rejected deliberately (no transition window, X2 design doc) — (d)', async () => {
    // A "v1-shaped" payload — no jti/cnonce claims, v:1 — mirroring what a
    // pre-bump token looked like. Contract §3 v2 rejects it outright.
    const v1Payload = {
      v: 1,
      org: ORG,
      cart: 'cart_01ABC',
      cus: null,
      email: null,
      wishlist_ref: null,
      country_code: 'dk',
      region_id: 'reg_01DK',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    }
    const token = mint(v1Payload, SECRET)
    expect(await verifyCommerceContext(token, SECRET, ORG)).toBeNull()
  })
})

// ---- CTX-02: writeCommerceContext / consumeContextJti / readCommerceContext -----
// writeCommerceContext delegates to the medusa_write_commerce_context SECURITY
// DEFINER RPC (migration 1284, X2 hardening — supersedes 1283's 8-arg version)
// and consumeContextJti delegates to medusa_consume_context_jti (migration
// 1284, new). This stub simulates BOTH RPCs' semantics against in-memory
// fixtures (a `memory` object for the pin, a Set for the jti ledger), so the
// JS wrapper's calling contract and return-shape semantics are exercised
// without a real Postgres instance.
function buildSupabase(row: { memory: Record<string, unknown> | null } | null) {
  let memory: Record<string, unknown> | null = row ? (row.memory ?? null) : null
  const exists = row !== null
  const consumedJti = new Set<string>()

  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === 'medusa_consume_context_jti') {
      const key = `${params.p_org_id}:${params.p_jti}`
      if (consumedJti.has(key)) return { data: false, error: null }
      consumedJti.add(key)
      return { data: true, error: null }
    }

    if (name === 'medusa_write_commerce_context') {
      if (!exists) return { data: null, error: null }

      const base = (memory ?? {}) as Record<string, unknown>
      const commerce = ((base.commerce as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
      const oldCart = typeof commerce.cart === 'string' ? commerce.cart : undefined
      const existingCnonce = typeof commerce.cnonce === 'string' ? commerce.cnonce : undefined

      // cnonce binding (X2): first pin (no existing cnonce) always accepted;
      // a later re-pin must match the recorded cnonce or the merge aborts —
      // no write — and the RPC reports {rejected:true}.
      if (existingCnonce !== undefined && existingCnonce !== params.p_cnonce) {
        return { data: { rejected: true }, error: null }
      }

      const nextCommerce = {
        ...commerce,
        cart: params.p_cart,
        cus: params.p_cus,
        email: params.p_email,
        wishlist_ref: params.p_wishlist_ref,
        country_code: params.p_country_code,
        region_id: params.p_region_id,
        cnonce: existingCnonce ?? params.p_cnonce,
        verified_at: new Date().toISOString(),
      }
      memory = { ...base, commerce: nextCommerce }

      const repinnedFrom = oldCart && oldCart !== params.p_cart ? oldCart : undefined
      return { data: repinnedFrom ? { repinnedFrom } : null, error: null }
    }

    throw new Error(`unexpected rpc: ${name}`)
  })

  const maybeSingle = vi.fn().mockImplementation(async () => ({ data: exists ? { memory } : null, error: null }))
  const eq = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const chain = { select, eq, maybeSingle }
  const from = vi.fn().mockReturnValue(chain)
  return {
    supabase: { from, rpc } as unknown as SupabaseClient,
    from,
    eq,
    maybeSingle,
    rpc,
    getMemory: () => memory,
  }
}

const PIN_CLAIMS: CommerceClaims = basePayload({
  cart: 'cart_1',
  cus: 'cus_9',
  region_id: 'reg_1',
  country_code: 'dk',
  email: null,
  wishlist_ref: null,
  cnonce: 'cnonce_A',
})

describe('CTX-02: writeCommerceContext pinning', () => {
  it('merge preserves: keeps existing memory keys and pins the verbatim claim names', async () => {
    const { supabase, rpc, getMemory } = buildSupabase({ memory: { existingKey: 1 } })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', PIN_CLAIMS, PIN_CLAIMS.cnonce)

    expect(result).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(1)
    const memory = getMemory() as Record<string, unknown>
    expect(memory.existingKey).toBe(1)
    const commerce = memory.commerce as Record<string, unknown>
    expect(commerce.cart).toBe('cart_1')
    expect(commerce.cus).toBe('cus_9')
    expect(commerce.cnonce).toBe('cnonce_A')
    expect(commerce).not.toHaveProperty('cart_id')
    expect(commerce).not.toHaveProperty('customer_id')
    expect(typeof commerce.verified_at).toBe('string')
    expect(new Date(commerce.verified_at as string).toString()).not.toBe('Invalid Date')
    const rpcArgs = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(rpcArgs.p_conversation_id).toBe('conv-1')
    expect(rpcArgs.p_org_id).toBe('org-1')
    expect(rpcArgs.p_cnonce).toBe('cnonce_A')
  })

  it('repin: a different pinned cart is overwritten and repinnedFrom is reported (same cnonce)', async () => {
    const { supabase, getMemory } = buildSupabase({ memory: { commerce: { cart: 'cart_OLD', cnonce: 'cnonce_A' } } })
    const newClaims = basePayload({ cart: 'cart_NEW', cnonce: 'cnonce_A' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', newClaims, newClaims.cnonce)

    expect(result).toEqual({ repinnedFrom: 'cart_OLD' })
    const memory = getMemory() as Record<string, unknown>
    expect((memory.commerce as Record<string, unknown>).cart).toBe('cart_NEW')
  })

  it('repin: the same cart returns null (no repin reported)', async () => {
    const { supabase } = buildSupabase({ memory: { commerce: { cart: 'cart_SAME', cnonce: 'cnonce_A' } } })
    const sameClaims = basePayload({ cart: 'cart_SAME', cnonce: 'cnonce_A' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', sameClaims, sameClaims.cnonce)

    expect(result).toBeNull()
  })

  it('(c) matching cnonce re-pin (legit post-checkout cart rotation) → accepted', async () => {
    const { supabase, getMemory } = buildSupabase({ memory: { commerce: { cart: 'cart_OLD', cnonce: 'cnonce_A' } } })
    const rotated = basePayload({ cart: 'cart_ROTATED', cnonce: 'cnonce_A' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', rotated, rotated.cnonce)

    expect(result).toEqual({ repinnedFrom: 'cart_OLD' })
    const commerce = (getMemory() as Record<string, unknown>).commerce as Record<string, unknown>
    expect(commerce.cart).toBe('cart_ROTATED')
    expect(commerce.cnonce).toBe('cnonce_A')
  })

  it('(b) cnonce mismatch on re-pin → {rejected:true}, prior pin intact', async () => {
    const { supabase, getMemory } = buildSupabase({
      memory: { commerce: { cart: 'cart_VICTIM', cus: 'cus_victim', cnonce: 'cnonce_VICTIM' } },
    })
    const attackerClaims = basePayload({ cart: 'cart_ATTACKER', cus: 'cus_attacker', cnonce: 'cnonce_ATTACKER' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', attackerClaims, attackerClaims.cnonce)

    expect(result).toEqual({ rejected: true })
    // Prior pin is left COMPLETELY untouched — not even verified_at bumped.
    const commerce = (getMemory() as Record<string, unknown>).commerce as Record<string, unknown>
    expect(commerce).toEqual({ cart: 'cart_VICTIM', cus: 'cus_victim', cnonce: 'cnonce_VICTIM' })
  })

  it('first pin (no existing cnonce) always accepted regardless of cnonce value', async () => {
    const { supabase, getMemory } = buildSupabase({ memory: {} })
    const firstPin = basePayload({ cart: 'cart_FIRST', cnonce: 'any-cnonce-value' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', firstPin, firstPin.cnonce)

    expect(result).toBeNull()
    const commerce = (getMemory() as Record<string, unknown>).commerce as Record<string, unknown>
    expect(commerce.cart).toBe('cart_FIRST')
    expect(commerce.cnonce).toBe('any-cnonce-value')
  })

  it('read-back: the pinned cart is reachable through the shipped loadPinnedContext reader', async () => {
    const { supabase, getMemory } = buildSupabase({ memory: { existingKey: 1 } })
    await writeCommerceContext(supabase, 'conv-1', 'org-1', PIN_CLAIMS, PIN_CLAIMS.cnonce)
    const writtenMemory = getMemory() as Record<string, unknown>

    const freshMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { session_key: null, memory: writtenMemory }, error: null })
    const freshChain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: freshMaybeSingle }
    const freshSupabase = { from: vi.fn().mockReturnValue(freshChain) } as unknown as MedusaExecCtx['supabase']

    const { commerce } = await loadPinnedContext({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      supabase: freshSupabase,
    })

    expect(commerce.cart).toBe('cart_1')
  })

  it('readCommerceContext delegates to loadPinnedContext (no divergent second reader)', async () => {
    const freshMaybeSingle = vi.fn().mockResolvedValue({
      data: { session_key: null, memory: { commerce: { cart: 'cart_1' } } },
      error: null,
    })
    const freshChain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: freshMaybeSingle }
    const freshSupabase = { from: vi.fn().mockReturnValue(freshChain) } as unknown as MedusaExecCtx['supabase']

    const commerce = await readCommerceContext({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      supabase: freshSupabase,
    })

    expect(commerce.cart).toBe('cart_1')
  })
})

describe('CTX-02b: consumeContextJti (X2 one-time-use jti)', () => {
  it('accepts a fresh (org_id, jti) pair', async () => {
    const { supabase } = buildSupabase({ memory: {} })
    const ok = await consumeContextJti(supabase, 'org-1', 'jti-fresh')
    expect(ok).toBe(true)
  })

  it('(a) same jti reused → consume returns false → caller must skip the pin', async () => {
    const { supabase, rpc } = buildSupabase({ memory: { commerce: { cart: 'cart_1' } } })

    const first = await consumeContextJti(supabase, 'org-1', 'jti-reused')
    const second = await consumeContextJti(supabase, 'org-1', 'jti-reused')

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('the same jti is independent per org (no cross-org false positive)', async () => {
    const { supabase } = buildSupabase({ memory: {} })
    const orgA = await consumeContextJti(supabase, 'org-A', 'jti-shared')
    const orgB = await consumeContextJti(supabase, 'org-B', 'jti-shared')
    expect(orgA).toBe(true)
    expect(orgB).toBe(true)
  })

  it('fail-closed: an RPC error returns false (never pin on an unconfirmed jti)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const supabase = { rpc } as unknown as SupabaseClient
    const ok = await consumeContextJti(supabase, 'org-1', 'jti-x')
    expect(ok).toBe(false)
  })
})
