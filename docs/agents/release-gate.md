# Release Gate (TEST-04)

Status: the gate is wired into CI as `.github/workflows/release-gate.yml`
(Phase 135 Plan 03). It runs `npm run release-gate` (`scripts/release-gate.ts`,
Phase 135 Plan 01) plus the TEST-03 latency profile
(`tests/vapi-latency-profile.test.ts`, Phase 135 Plan 02) plus
`npm run workflows:validate`, and it blocks: any failure fails the job, which
fails the check on the pull request or commit.

Read this document before changing `.github/workflows/release-gate.yml` or
`scripts/release-gate.ts` — most of what looks like a gap below is a
deliberate, documented exclusion, not an oversight.

## Why this exists

`.github/workflows/` had fifteen workflows before this one and none of them
ran the test suite. `build-deploy.yml` goes straight from Docker build to
Coolify rollout. TEST-04 requires "build, focused suites, workflow
validation, and UAT checklist pass before enabling [specialist routing]" —
before this phase that was entirely manual and unenforced. This gate is the
enforcement point for the "focused suites" and "workflow validation" parts.
The UAT checklist (`docs/agents/uat-checklist.md`) covers the human-executed
part; Phase 136 owns actually enabling routing.

## What runs, and where

| Trigger | Condition |
|---|---|
| `pull_request` | every PR, unconditionally |
| `push` to `main` or `dev` | only when the diff touches an orchestration-relevant path (see the `paths:` list in the workflow file) |

Every run does, in order:

1. `npm ci`
2. `npm run release-gate` — this is `scripts/release-gate.ts`:
   - runs the `GATE_MEMBERS` test subset (below) via `vitest run`
   - runs `npm run workflows:validate`
   - exits non-zero if any declared member file is missing on disk, any of
     the seven TEST-02 areas has zero members, any test in the subset fails,
     or workflow validation fails
3. `npx vitest run tests/vapi-latency-profile.test.ts` — the TEST-03 p95
   check, run as its own step (see "Why the latency test is a separate step"
   below)

Any non-zero exit in any step fails the job. Nothing in this workflow
"reports and continues."

## The deterministic subset (`GATE_MEMBERS`)

Declared as data in `scripts/release-gate.ts`, not inferred by glob.
`tests/release-gate.test.ts` asserts the declaration is honest: every member
file exists on disk, every one of the seven TEST-02 areas maps to at least
one member, and the subset stays small (bounded at fewer than 20 files) so
nobody quietly replaces it with the full suite.

| File | TEST-02 area(s) proven |
|---|---|
| `tests/agent-partner-edge-authz.test.ts` | Tenant isolation; direct vs. delegated authorization; cross-agent calls |
| `tests/agent-schema-rls-smoke.test.ts` | Tenant isolation |
| `tests/agent-delegation.test.ts` | Direct vs. delegated authorization; cross-agent calls; cycle and depth limits; Xkedule idempotency |
| `tests/agent-handoff-contract.test.ts` | Handoff injection resistance |
| `tests/openrouter-provider-policy.test.ts` | OpenRouter-only generation |
| `tests/idempotency-ingress-key.test.ts` | Xkedule idempotency |
| `tests/vapi-tools-idempotency.test.ts` | Xkedule idempotency |
| `tests/coverage-pins.test.ts` | Cross-cutting — pins the full membership of every safety-critical set (`SIDE_EFFECTING_ACTIONS`, `COMMERCE_WRITE_ACTIONS`, partner-edge denial reasons, the channel enum) so a newly added Action Engine action type cannot silently bypass classification |

### `tests/agent-schema-rls-smoke.test.ts` soft-skips without a DB secret

This member needs a live Postgres connection (`SUPABASE_DB_URL` or
`DATABASE_URL`) to query `pg_class`/`pg_policy` directly — `supabase-js`
cannot reach `pg_catalog`. No such secret is configured for this workflow;
none is invented here per this phase's constraints. Without it, the test
file's own `beforeAll` prints a console warning and the suite runs under
`describe.skip` — it reports as passed-with-zero-assertions, not failed, and
does not block the gate.

The workflow step already forwards `secrets.SUPABASE_DB_URL` and
`secrets.DATABASE_URL` if either exists in this repository's secrets. If
someone adds one later, this member starts asserting the real RLS policy
contract with no workflow-file change required. Until then, "Tenant
isolation" is still proven by `agent-partner-edge-authz.test.ts`, which does
not need a live DB.

## What this gate deliberately does NOT run

### The ~30-file live-database baseline

The full `tests/` suite fails 30-32 files / 52-53 tests at `HEAD` for
reasons unrelated to this workstream: live-database dependencies that assume
state this CI environment does not have, and module-resolution gaps.
Membership of that baseline shifts slightly between runs. `npm test` /
`npm run test:watch` is **not** part of this gate and never will be run
wholesale — a gate over the full suite would be permanently red and
therefore ignored, which is worse than a smaller gate people trust. If a
newcomer file fails, check it in isolation before assuming it belongs to the
pre-existing baseline.

### `tests/security-secdef-isolation.test.ts` — now a member (was excluded)

This suite was kept out of the gate while it failed `get_org_member_profiles
refuses to enumerate members of a foreign org` — a real cross-organization data
leak, not flakiness: the function is `SECURITY DEFINER`, joins `auth.users`, and
never checked whether the caller belonged to the organization it was asked about.

Migration `1295` closed it and is applied. The suite is green and is a declared
gate member again, which is the point: a defect that hid for four phases inside a
set of tests everyone treated as pre-existing noise should not be able to hide
there a second time.

The lesson generalises. A stable set of failing tests is not background noise, it
is a place defects live. Audit newcomers to that set rather than assuming.

### 24 write action types with no idempotency classification

Deriving the Action Engine's action types from source finds 48. Eleven are
classified side-effecting (idempotency-guarded), thirteen are deliberate
reads, and 24 writes — spanning email, WhatsApp, ManyChat, Telegram, Google
Contacts, tasks, notes, and the pipeline surface — sit in neither bucket.
Full list and rationale:
`.planning/workstreams/omnichannel-agent-orchestration/FINDINGS-OUTSIDE-SCOPE.md`
item 2.

This gate does **not** classify them — that is deliberately out of scope for
an autonomous run (it changes runtime behavior across eight integration
families) and belongs in a dedicated phase. What this gate **does** enforce:
`tests/coverage-pins.test.ts` derives the action list from
`execute-action.ts` and fails if any action type is in *no* bucket at all —
the 24 sit in an explicit, named `WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket,
so a newly added action cannot slip in unclassified even though these 24
remain unresolved. The gate prevents the set from growing invisibly; it does
not shrink it.

### `npm run build`

Not a step in this workflow, on purpose:

- It needs `NODE_OPTIONS=--max-old-space-size=8192` — an 8 GB heap — and
  takes roughly 10-30 minutes on a loaded machine (measured range in this
  workstream, not a CI-runner benchmark).
- `.github/workflows/build-deploy.yml` already builds the production Docker
  image on every push to `main`. Running `next build` again here would
  duplicate that cost on every PR and push, making this gate slow enough
  that it stops being useful as fast feedback.
- Type errors that `npm run build` would catch are still caught by whatever
  editor/pre-commit type-checking is in use locally; this gate's job is
  behavioral regression and coverage, not a second full build.

If a future gate genuinely needs build-time verification, prefer
`tsc --noEmit` (fast, no bundling) over duplicating the full `next build`.

## Why the latency test is a separate step, not a `GATE_MEMBERS` entry

`tests/vapi-latency-profile.test.ts` asserts a TEST-03 p95 target against a
documented, mocked-boundary profile (`docs/agents/latency-profile.md`), not
one of the seven named TEST-02 areas. `GATE_MEMBERS` in
`scripts/release-gate.ts` is scoped specifically to TEST-02 coverage plus
the cross-cutting `coverage-pins` guard — folding a differently-shaped
latency assertion into that list would blur what
`tests/release-gate.test.ts`'s area-coverage check is actually proving. It
is still run, in the same job, and still blocks: a failure here fails the
workflow exactly like a `GATE_MEMBERS` failure would.

## How to add a suite to the gate

1. Write the test file under `tests/`.
2. Add a `GateMember` entry to `GATE_MEMBERS` in `scripts/release-gate.ts`
   with the `file` path and the `TEST02_AREAS` (or `[]` if cross-cutting)
   it proves.
3. Run `npx vitest run tests/release-gate.test.ts` — it will fail if the
   file doesn't exist, if an area name has a typo, or if the subset grows
   past the sanity bound (20 files); if you hit that bound deliberately,
   raise it there and say why in the commit.
4. Run `npm run release-gate` locally to confirm it still passes end to end.
5. No workflow-file change is required unless the new suite needs a secret
   or environment variable the current job does not already forward — in
   that case, add it explicitly and document the degrade-if-missing behavior
   the way `SUPABASE_DB_URL`/`DATABASE_URL` are documented above.

## Local verification

```bash
npm run release-gate                              # gate subset + workflows:validate
npx vitest run tests/vapi-latency-profile.test.ts  # TEST-03 latency, run separately in CI too
npx vitest run tests/release-gate.test.ts          # proves GATE_MEMBERS itself is honest
```
