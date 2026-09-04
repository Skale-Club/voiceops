---
type: findings
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Findings Outside This Workstream's Scope

Two defects surfaced while building the Phase 135 release gate. Neither is caused by this
workstream, and neither is covered by its 32 requirements. Both are recorded here rather
than fixed silently or dropped.

---

## 1. Cross-organization leak in `get_org_member_profiles` — FIX AUTHORED, NOT APPLIED

**Severity: high.** Any authenticated user could read any organization's full member list,
including each member's email and phone.

`public.get_org_member_profiles(p_org_id, p_page, p_per_page)` is `SECURITY DEFINER` so it
can join `auth.users`, which authenticated users cannot query directly. Its only predicate
was `om.organization_id = p_org_id`. It never checked whether the caller belongs to that
organization, and `SECURITY DEFINER` bypasses RLS — so passing an arbitrary organization id
returned that organization's members.

This breaks the platform's core multi-tenant invariant, and it is the exact property the
`agent-partner-edge-authz` work in Phase 132 was hardening at the agent layer.

**How it surfaced.** `tests/security-secdef-isolation.test.ts` has been failing
deterministically on the case `get_org_member_profiles refuses to enumerate members of a
foreign org` — it sat inside the 30-file "pre-existing baseline" this workstream had been
carrying since Phase 132, treated as environmental noise. It was not noise. The test was
correct and the function was wrong. The three sibling SECDEF functions in the same suite
(`get_current_org_id`, `get_user_org_ids`, `get_tag_usage`) all isolate correctly; this one
was the outlier.

**Fix.** `supabase/migrations/1295_fix_member_profiles_cross_org_leak.sql` adds a caller
membership check. A non-member receives an empty result rather than an error, which the
existing UI already handles and which avoids leaking whether an organization id exists.

**Status: authored, NOT applied.** The test runs against the live database and stays red
until someone runs `npx supabase db push`. Applying it is a production action and is on the
human gate list along with migrations 1290-1294.

**Lesson for this workstream:** the "pre-existing baseline" framing was load-bearing and
partly wrong. A stable set of failing tests is a place real defects hide. The Phase 135
release gate deliberately does not include this suite while it is red — that exclusion must
be removed once 1295 is applied.

---

## 2. Twenty-four write actions are not classified as side-effecting — NOT FIXED

`requiresIdempotency()` decides whether the guard runs by asking whether an action type is
in `SIDE_EFFECTING_ACTIONS`. Deriving the Action Engine's action types from source found 48
of them. Eleven are classified side-effecting, thirteen are deliberate reads, and **twenty-four
are writes that are in neither bucket**:

`google_contacts_create`, `google_contacts_update`, `google_contacts_delete`,
`manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`,
`send_whatsapp_message`, `send_whatsapp_template`, `send_whatsapp_mention_all`,
`send_telegram_notification`, `pipeline_move_opportunity`, `pipeline_update_opportunity`,
`pipeline_mark_won`, `pipeline_mark_lost`, `pipeline_add_note`, `pipeline_assign_user`,
`pipeline_create_opportunity`, `create_task`, `create_note`, `send_email`,
`send_tenant_email`, `send_platform_email`, `send_zernio_dm`.

Every one is structurally exposed to the same double-execution-on-retry bug the Xkedule
booking mutations had (`d0a162bf`). `send_sms` is classified; `send_whatsapp_message` is
not, which is hard to read as anything but an oversight.

**Why it was not fixed here.** Adding twenty-four action types to the guard changes
behavior across email, WhatsApp, ManyChat, Telegram, Google Contacts, tasks, notes and the
whole pipeline surface — well outside this workstream, and outside what a late autonomous
run should widen into unreviewed. The guard also fails closed on a lookup error, so
misclassifying an action that legitimately repeats would suppress real work.

**What protects against recurrence in the meantime.** `tests/coverage-pins.test.ts` derives
the action list from `execute-action.ts` and fails on any type that is in no bucket, so a
newly added action cannot slip in unclassified. The twenty-four sit in an explicit
`WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket — visible, named, and pinned, rather than
invisible.

**Recommended next step:** classify them in a dedicated phase, one integration family at a
time, checking for each whether a repeat is a bug or a legitimate re-send.
