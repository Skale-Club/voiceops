---
type: findings
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Findings Outside This Workstream's Scope

Three defects surfaced while building the Phase 135 release gate and applying its
migrations. None is caused by this workstream, and none is covered by its 32 requirements.
All are recorded here rather than fixed silently or dropped.

---

## 1. Cross-organization leak in `get_org_member_profiles` — FIXED AND APPLIED (2026-09-04)

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

**Status: applied 2026-09-04**, on the user's explicit instruction, via `npx supabase db push`
together with 1290-1294. `tests/security-secdef-isolation.test.ts` is green (4/4) and has been
returned to `GATE_MEMBERS` in `scripts/release-gate.ts`.

**The first attempt failed, and the failure was load-bearing.** Postgres rejected it with
42P13, "cannot change return type of existing function". The deployed function returns an
`avatar_url` column and resolves `phone` as
`NULLIF(TRIM(COALESCE(raw_user_meta_data->>'phone', au.phone)), '')`; migration 1037 in this
repository has neither. Production had drifted from the repo — see finding 3 below. Because
the first version of 1295 was transcribed from 1037, it would have dropped `avatar_url`, and
`src/app/(dashboard)/members/actions.ts` consumes that field. Postgres caught what review did
not. The applied version is the live definition with the membership predicate added and
nothing else changed.

**Lesson for this workstream:** the "pre-existing baseline" framing was load-bearing and
partly wrong. A stable set of failing tests is a place real defects hide. The suite is now a
gate member precisely so this cannot regress unnoticed a second time.

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

---

## 3. The repository's migration history had drifted from production — NOT RECONCILED

`get_org_member_profiles` is defined in `supabase/migrations/091_member_profiles_fn.sql` and
`1037_member_profiles_fn.sql`, and in no other migration — a `grep` over the whole directory
confirms it. Yet the deployed function differs from 1037: it returns an extra `avatar_url`
column and resolves `phone` through the user's metadata before falling back to `auth.users`.

Someone changed that function in production without leaving a migration in this repository.
That is precisely what `CLAUDE.md` warns the Supabase MCP `apply_migration` tool and the
dashboard SQL editor cause, and it means a fresh `supabase db reset` would not have
reproduced production.

Migration 1295 repairs this one function by transcribing the live body, so the repo and the
database now agree on it. **Nothing else was audited.** Other objects may have drifted the
same way and would only surface the way this one did — when a migration collides with them.

**Recommended:** a one-time reconciliation pass comparing the live schema against what the
migration directory reproduces, before the next schema change lands on a drifted object.
