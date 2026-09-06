# Voice call fixtures

Each file here is one real Vapi call, saved by `npm run call:last` (or
`npx tsx --env-file=.env.local scripts/call-last.ts <callId>`), stripped down
to what a replay test needs and nothing that shouldn't leave the call record:

```json
{
  "id": "01a074b8-8bb1-7000-856f-c287f3eba138",
  "assistantId": "99518fa7-09f1-4c76-b7c8-58cd8a92105c",
  "startedAt": "2026-09-06T03:17:26.771Z",
  "endedAt": "2026-09-06T03:20:44.116Z",
  "endedReason": "customer-ended-call",
  "customer": { "number": "+15088018190" },
  "messages": [ /* Vapi's own artifact.messages shape, in order */ ]
}
```

**What is deliberately left out:** `recordingUrl`, `stereoRecordingUrl`,
`presigned*Url`, `pcapUrl`, `logUrl` — every field that points at Vapi's
HIPAA-bucket recording or logs. A fixture is meant to be read, diffed and
committed; a signed URL expires anyway (see
`artifact.presignedUrlsExpiresAt` on the raw call) and has no business living
in git regardless. `cost`/`costBreakdown` are also left out — they vary call
to call and add nothing a replay test asserts on.

**What `messages` looks like:** the flat, chronological array Vapi calls
`artifact.messages` (identical to the call's own top-level `messages`).
Every entry carries `secondsFromStart`; the roles that matter for a replay
are:

| `role` | Carries |
|---|---|
| `user` | `message` — what the caller said (as transcribed) |
| `bot` | `message` — what the assistant said |
| `tool_calls` | `toolCalls[]`, each `{ id, function: { name, arguments } }` |
| `tool_call_result` | `name`, `result`, `toolCallId` |
| `system` | the rendered system prompt (present once, at the start) |

## Using a fixture

- **Manual read:** `npm run call:last <callId>` re-prints the full report
  (timeline, latency, tool timings, refusals, lint) for any call, saved or
  not — the fixture file itself is just the frozen `messages` array, not a
  report.
- **A future replay test** (`tests/voice-call-replay.test.ts`, planned in
  VOICE-CALL-4-PLAN.md item L) loads one of these fixtures and re-runs the
  guard logic (`callerChoseTime`, `checkVoiceBookingConfirmation`,
  `assertBookingOwnedByCaller`, …) turn by turn against the exact messages a
  real call produced, so a regression in a guard shows up against a call
  that actually happened — not a hand-written scenario that might not
  reproduce the shape of a real transcript.

## Adding a fixture

Run `npm run call:last` right after a real call (or pass its id explicitly)
— it fetches the call from Vapi, prints the report, and writes
`tests/fixtures/calls/<id>.json` unless you pass `--no-save`. Nothing here is
synthetic: every fixture is a call that actually happened against the live
tenant. Do not hand-edit a saved fixture's `messages` — if a call needs a
trimmed-down version for a fast unit test, copy it to a new file with a name
that says so (e.g. `<id>-trimmed.json`) rather than editing the original.

## Real bookings referenced by these calls

Some fixtures' tool calls and results mention real Xkedule booking ids in
this tenant's data (for example `#471`, a real appointment used across the
rehearsal matrix's known-caller scenarios). A fixture is a frozen read; it is
never replayed against the live provider — the replay test above runs
against the same provider-boundary mock the rehearsal matrix uses. Never
change that when writing a replay test.
