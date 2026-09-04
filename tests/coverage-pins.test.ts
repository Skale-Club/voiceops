// tests/coverage-pins.test.ts
// Phase 135 Plan 01 (TEST-02): coverage pins for safety-critical sets.
//
// Phase 133 tested requiresIdempotency()'s BEHAVIOR thoroughly (see
// tests/agent-delegation.test.ts, tests/idempotency-ingress-key.test.ts,
// tests/vapi-tools-idempotency.test.ts) and never tested WHICH action types
// reach it. xkedule_create_booking, xkedule_cancel_booking and
// xkedule_reschedule_booking were absent from SIDE_EFFECTING_ACTIONS, so
// requiresIdempotency() returned false for them at every call site and a
// Vapi retry of a booking created a SECOND booking -- every Phase 133 test
// passed while that shipped. Fixed in d0a162bf.
//
// This file exists so that class of gap cannot recur. It derives the Action
// Engine's full set of dispatched action types FROM SOURCE (parses the
// `case '...':` labels out of execute-action.ts -- never retypes them, since
// a hand-retyped list would reproduce the exact blindness this test exists
// to prevent) and asserts every one of them is explicitly classified. A
// newly added action type that nobody classifies fails this file until a
// human puts it in a bucket.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SIDE_EFFECTING_ACTIONS,
  COMMERCE_WRITE_ACTIONS,
  requiresIdempotency,
} from '@/lib/agent-runtime/idempotency'

// These pins parse production source as text. Read through this helper, never
// readFileSync directly: on a Windows checkout git materialises files with CRLF,
// and a pattern anchored on a blank line silently stops matching, which takes the
// whole file down with a collection error rather than a useful failure.
// Normalising here keeps the pins about what the source SAYS, not how the
// checkout happens to store it.
function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

const EXECUTE_ACTION_PATH = join(process.cwd(), 'src/lib/action-engine/execute-action.ts')
const RESOLVE_PARTNER_EDGE_PATH = join(process.cwd(), 'src/lib/agent-runtime/resolve-partner-edge.ts')
const DATABASE_TYPES_PATH = join(process.cwd(), 'src/types/database.ts')

// ---------------------------------------------------------------------------
// Derive the Action Engine's dispatched action types FROM SOURCE.
// ---------------------------------------------------------------------------
// Parsing case labels means a NEW action type added to the switch is picked
// up automatically here and fails the classification assertions below until
// a human explicitly places it in one of the three buckets -- it can never
// again just walk past the guard the way the Xkedule mutations did.

function deriveActionEngineTypes(): string[] {
  const src = readSource(EXECUTE_ACTION_PATH)
  return [...src.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1])
}

const ACTION_TYPES_FROM_SOURCE = deriveActionEngineTypes()

describe('coverage-pins: Action Engine action-type derivation', () => {
  it('finds a non-trivial number of case labels in execute-action.ts (regex sanity check)', () => {
    // Guards against the regex silently matching zero/few lines after a
    // refactor (e.g. the switch rewritten as an object map) -- a test that
    // always passes on an empty array would be worse than no test at all.
    expect(ACTION_TYPES_FROM_SOURCE.length).toBeGreaterThanOrEqual(40)
  })

  it('every derived action type is unique (no duplicate case labels)', () => {
    expect(new Set(ACTION_TYPES_FROM_SOURCE).size).toBe(ACTION_TYPES_FROM_SOURCE.length)
  })
})

// ---------------------------------------------------------------------------
// Bucket 1: deliberate reads -- explicitly pinned, never mutate state, must
// stay OUT of SIDE_EFFECTING_ACTIONS so a read never pays for the
// idempotency check (SAFE-02).
// ---------------------------------------------------------------------------

const DELIBERATE_READS = new Set([
  'get_availability',
  'knowledge_base',
  'google_contacts_find',
  'xkedule_get_services',
  'xkedule_check_availability',
  'xkedule_quote',
  'xkedule_lookup_customer',
  'xkedule_business_info',
  'medusa_search_products',
  'medusa_get_product',
  'medusa_get_cart',
  'medusa_wishlist_list',
  'medusa_get_order_status',
])

// ---------------------------------------------------------------------------
// Bucket 2: SIDE_EFFECTING_ACTIONS -- pinned production set. Full membership
// is asserted as an EXACT match (not a subset check), so removing an entry
// from the production Set shows up as a visible test failure here, not a
// silent shrink.
// ---------------------------------------------------------------------------

const EXPECTED_SIDE_EFFECTING = [
  'create_appointment',
  'send_sms',
  'create_contact',
  'custom_webhook',
  'medusa_add_to_cart',
  'medusa_update_cart_item',
  'medusa_wishlist_add',
  'medusa_wishlist_remove',
  'xkedule_create_booking',
  'xkedule_cancel_booking',
  'xkedule_reschedule_booking',
]

// ---------------------------------------------------------------------------
// Bucket 3: writes the Action Engine dispatches that are NEITHER a deliberate
// read NOR wrapped by the idempotency guard today.
//
// FINDING (135-01): this bucket exists because it is non-empty, and that is
// the point of pinning it explicitly instead of leaving it implicit.
// requiresIdempotency() is applied generically at the call site
// (src/app/api/vapi/tools/route.ts, src/lib/agent-runtime/run-agent.ts)
// regardless of action type -- there is no structural reason a channel retry
// (a Vapi tool-call redelivery, a ManyChat/webhook redelivery) could not
// reach executeAction() for any of these exactly the way it reached
// xkedule_create_booking before d0a162bf. Widening SIDE_EFFECTING_ACTIONS to
// cover them is a src/ change and is out of scope for 135-01 (scope is
// tests/scripts/package.json only) -- this bucket turns the gap into an
// explicit, visible, reviewed list instead of a silent one, and is reported
// as a finding for a follow-up hardening phase.
//
// Do NOT grow this list silently: a newly added mutating action type must be
// classified into DELIBERATE_READS, SIDE_EFFECTING_ACTIONS (production,
// requires a src/ change), or here with a reason -- or the coverage
// assertion below fails.
// ---------------------------------------------------------------------------

const WRITES_PENDING_IDEMPOTENCY_REVIEW = new Set([
  'google_contacts_create',
  'google_contacts_update',
  'google_contacts_delete',
  'manychat_set_field',
  'manychat_add_tag',
  'manychat_trigger_flow',
  'manychat_send_message',
  'send_whatsapp_message',
  'send_whatsapp_template',
  'send_whatsapp_mention_all',
  'send_telegram_notification',
  'pipeline_move_opportunity',
  'pipeline_update_opportunity',
  'pipeline_mark_won',
  'pipeline_mark_lost',
  'pipeline_add_note',
  'pipeline_assign_user',
  'pipeline_create_opportunity',
  'create_task',
  'create_note',
  'send_email',
  'send_tenant_email',
  'send_platform_email',
  'send_zernio_dm',
])

describe('coverage-pins: SIDE_EFFECTING_ACTIONS full membership (SAFE-01/SAFE-02)', () => {
  it('matches the pinned list exactly -- no more, no less', () => {
    expect([...SIDE_EFFECTING_ACTIONS].sort()).toEqual([...EXPECTED_SIDE_EFFECTING].sort())
  })

  it('every pinned side-effecting action (except the conditional custom_webhook) requires idempotency', () => {
    for (const actionType of EXPECTED_SIDE_EFFECTING) {
      if (actionType === 'custom_webhook') continue // method-conditional; covered in agent-delegation.test.ts
      expect(requiresIdempotency(actionType), `${actionType} should require idempotency`).toBe(true)
    }
  })

  it('includes the three Xkedule booking mutations -- the exact regression this file guards', () => {
    expect(SIDE_EFFECTING_ACTIONS.has('xkedule_create_booking')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('xkedule_cancel_booking')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('xkedule_reschedule_booking')).toBe(true)
    expect(requiresIdempotency('xkedule_create_booking')).toBe(true)
    expect(requiresIdempotency('xkedule_cancel_booking')).toBe(true)
    expect(requiresIdempotency('xkedule_reschedule_booking')).toBe(true)
  })
})

describe('coverage-pins: DELIBERATE_READS never pay for the idempotency guard', () => {
  it('no deliberate read is in SIDE_EFFECTING_ACTIONS or requires idempotency', () => {
    for (const actionType of DELIBERATE_READS) {
      expect(SIDE_EFFECTING_ACTIONS.has(actionType), `${actionType} must not be side-effecting`).toBe(false)
      expect(requiresIdempotency(actionType), `${actionType} must not require idempotency`).toBe(false)
    }
  })
})

describe('coverage-pins: every Action Engine action type is explicitly classified', () => {
  it('the three buckets are pairwise disjoint', () => {
    for (const t of DELIBERATE_READS) {
      expect(EXPECTED_SIDE_EFFECTING.includes(t), `${t} is in both DELIBERATE_READS and SIDE_EFFECTING`).toBe(false)
      expect(WRITES_PENDING_IDEMPOTENCY_REVIEW.has(t), `${t} is in both DELIBERATE_READS and WRITES_PENDING_IDEMPOTENCY_REVIEW`).toBe(false)
    }
    for (const t of WRITES_PENDING_IDEMPOTENCY_REVIEW) {
      expect(EXPECTED_SIDE_EFFECTING.includes(t), `${t} is in both WRITES_PENDING_IDEMPOTENCY_REVIEW and SIDE_EFFECTING`).toBe(false)
    }
  })

  it('every action type derived from execute-action.ts source is in exactly one bucket', () => {
    const unclassified: string[] = []
    const multiplyClassified: string[] = []

    for (const actionType of ACTION_TYPES_FROM_SOURCE) {
      const inReads = DELIBERATE_READS.has(actionType)
      const inSideEffecting = EXPECTED_SIDE_EFFECTING.includes(actionType)
      const inPending = WRITES_PENDING_IDEMPOTENCY_REVIEW.has(actionType)
      const memberships = [inReads, inSideEffecting, inPending].filter(Boolean).length

      if (memberships === 0) unclassified.push(actionType)
      if (memberships > 1) multiplyClassified.push(actionType)
    }

    // A newly added action_type case in execute-action.ts that nobody has
    // classified yet fails HERE, by design -- this is the exact protection
    // the Xkedule booking mutations lacked through Phase 133.
    expect(
      unclassified,
      `Unclassified action type(s) -- add each to DELIBERATE_READS, SIDE_EFFECTING_ACTIONS, or WRITES_PENDING_IDEMPOTENCY_REVIEW: ${unclassified.join(', ')}`
    ).toEqual([])
    expect(
      multiplyClassified,
      `Action type(s) classified in more than one bucket: ${multiplyClassified.join(', ')}`
    ).toEqual([])
  })

  it('no pinned bucket contains an action type that no longer exists in source (stale-pin detection)', () => {
    const sourceSet = new Set(ACTION_TYPES_FROM_SOURCE)
    const stale: string[] = []
    for (const t of DELIBERATE_READS) if (!sourceSet.has(t)) stale.push(t)
    for (const t of EXPECTED_SIDE_EFFECTING) if (!sourceSet.has(t)) stale.push(t)
    for (const t of WRITES_PENDING_IDEMPOTENCY_REVIEW) if (!sourceSet.has(t)) stale.push(t)
    expect(stale, `Pinned action type(s) no longer dispatched by execute-action.ts: ${stale.join(', ')}`).toEqual([])
  })
})

describe('coverage-pins: COMMERCE_WRITE_ACTIONS full membership (CRT-02)', () => {
  it('matches the pinned list exactly -- cart writes only, wishlist deliberately excluded', () => {
    expect([...COMMERCE_WRITE_ACTIONS].sort()).toEqual(['medusa_add_to_cart', 'medusa_update_cart_item'])
  })

  it('wishlist writes are side-effecting for idempotency purposes but NOT commerce-write-capped', () => {
    // Phase 135 (WSL-02): wishlist mutations must pay the idempotency guard
    // (a retry must not double-add/double-remove) but stay OUT of the
    // cart-only 3/turn + 25/conversation guardrail caps.
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_add')).toBe(true)
    expect(SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_remove')).toBe(true)
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_wishlist_add')).toBe(false)
    expect(COMMERCE_WRITE_ACTIONS.has('medusa_wishlist_remove')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Partner-edge denial reasons (AUTHZ-01/02/03) -- PartnerEdgeDenialReason is
// a TypeScript type with no runtime representation to import, so it is
// derived by parsing the union out of resolve-partner-edge.ts source, then
// pinned. Parsed rather than retyped for the same anti-drift reason as the
// action types above: a reason added to the union without a matching test
// update is exactly the kind of change this file exists to catch.
// ---------------------------------------------------------------------------

function derivePartnerEdgeDenialReasons(): string[] {
  const src = readSource(RESOLVE_PARTNER_EDGE_PATH)
  const unionMatch = src.match(/export type PartnerEdgeDenialReason =\s*([\s\S]*?)\n\nexport type/)
  if (!unionMatch) {
    throw new Error(
      'Could not locate the PartnerEdgeDenialReason union in resolve-partner-edge.ts -- has it moved or been renamed?'
    )
  }
  return [...unionMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const PARTNER_EDGE_DENIAL_REASONS = derivePartnerEdgeDenialReasons()

const EXPECTED_PARTNER_EDGE_DENIAL_REASONS = [
  'invalid_request',
  'edge_not_found',
  'cross_organization',
  'source_inactive',
  'target_inactive',
  'channel_not_allowed',
  'depth_exceeded',
  'call_count_exceeded',
  'malformed_policy',
]

describe('coverage-pins: PartnerEdgeDenialReason full membership (AUTHZ-01/AUTHZ-02/AUTHZ-03)', () => {
  it('derives at least the expected number of reasons from source (regex sanity check)', () => {
    expect(PARTNER_EDGE_DENIAL_REASONS.length).toBeGreaterThanOrEqual(9)
  })

  it('matches the pinned list exactly -- no more, no less', () => {
    expect([...PARTNER_EDGE_DENIAL_REASONS].sort()).toEqual([...EXPECTED_PARTNER_EDGE_DENIAL_REASONS].sort())
  })
})

// ---------------------------------------------------------------------------
// Channel enum (agent_channel DB enum, re-exported as AgentChannel) -- the
// same set gates resolvePartnerEdge()'s channel policy and every per-channel
// DND check in execute-action.ts. Derived from the generated database.ts
// type alias rather than retyped.
// ---------------------------------------------------------------------------

function deriveAgentChannels(): string[] {
  const src = readSource(DATABASE_TYPES_PATH)
  const lineMatch = src.match(/export type AgentChannel = ((?:'[a-z_]+'(?: \| )?)+)/)
  if (!lineMatch) {
    throw new Error('Could not locate the AgentChannel type alias in database.ts -- has it moved or been renamed?')
  }
  return [...lineMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const AGENT_CHANNELS = deriveAgentChannels()

const EXPECTED_AGENT_CHANNELS = [
  'web_widget',
  'whatsapp',
  'messenger',
  'instagram',
  'manychat',
  'telegram',
  'sms',
  'zernio',
  'voice',
  'workflow',
]

describe('coverage-pins: AgentChannel full membership', () => {
  it('derives at least the expected number of channels from source (regex sanity check)', () => {
    expect(AGENT_CHANNELS.length).toBeGreaterThanOrEqual(10)
  })

  it('matches the pinned list exactly -- no more, no less', () => {
    expect([...AGENT_CHANNELS].sort()).toEqual([...EXPECTED_AGENT_CHANNELS].sort())
  })
})
