# Voice + Text UAT Checklist (TEST-04)

Written for a human who has not read this codebase. Every item below states a
**precondition** (what must already be true before you start), an **exact
action** (what to click, say, or send), and an **observable expected result**
(what you should see, hear, or find — never "verify it works").

Do not skip the **Gate** column. It tells you whether an item is safe to run
today or belongs to the Phase 136 human gate.

## Gate legend

| Tag | Meaning |
|---|---|
| **NOW** | Runnable today in the dashboard. No live phone call, no real WhatsApp/ManyChat message, no production tenant traffic. |
| **PROD** | Needs a real, already-bound Vapi phone assistant or a real, already-connected WhatsApp/ManyChat number for some organization. Not blocked by missing code — this is normal production usage of features that already ship — but it does require someone with access to a live client (or an internal test) number. |
| **PHASE-136** | Blocked until Phase 136 Plan 01 wires the Phase 134 routing switch (`resolveChannelRoutingMode` / `invokeAgentWithChannelRouting` in `src/lib/agent-runtime/invocation-gateway.ts`) into a real ingress route, **and** an organization's channel is flipped from `legacy` to `specialist` in `agent_channel_routing_modes`. As of Phase 135, no production code path calls that switch at all — every real webhook (Vapi tools, ManyChat) still invokes an agent directly, so items in this bucket cannot be executed yet regardless of who has production access. |

**Counts:** 12 items total — 3 **NOW**, 3 **PROD**, 6 **PHASE-136**.

---

## Section A — Delegation and denial (mechanism, channel-agnostic — runnable today)

These use the existing agent-to-agent delegation and partner-authorization
mechanism (Phase 38 / Phase 132), which ships and runs today independent of
the Phase 134/136 routing switch. Exercise them safely through the
Playground, which never touches real phone numbers or real conversations.

### UAT-01 — Delegated action succeeds — **NOW**

**Precondition:** You are logged into the Xphere dashboard for an
organization that has at least one agent configured with a partner
delegation edge to a specialist agent (ask an admin which agent/org has
one, or use a known test org). You know one request that agent is
configured to hand off (e.g., "check availability for tomorrow" when a
scheduling specialist is wired up).

**Action:** Go to **Agents → [the entry agent] →** the "Test Your Bot" panel
on the right side of the agent's page. Leave channel set to any text
channel (e.g. Web Widget). Type the request that should trigger a handoff
and send it.

**Expected result:** A small pill-shaped badge appears in the middle of the
conversation announcing the delegation (violet badge with a pulsing dot
while in progress, solid once done) before the final answer appears. The
final answer reflects the specialist's response (e.g., an actual
availability answer), not a generic "I can't help with that."

### UAT-02 — Denied action fails safely — text — **NOW**

**Precondition:** Same dashboard access as UAT-01. You know (or can ask an
admin for) a request that names a partner/specialist the current agent is
**not** authorized to call — e.g., a specialist that belongs to a different
organization, or one not wired as a partner of this agent.

**Action:** In the same "Test Your Bot" panel, ask for the disallowed
action by name (e.g., "delegate this to the [other org]'s billing agent").

**Expected result:** An inline tool-call card appears with a red **"denied"**
badge next to the tool/partner name. The conversation does not crash, does
not hang, and the assistant's visible reply is a normal, in-character
message (e.g., an apology or a redirect) — never a raw error, a stack
trace, or an empty response.

### UAT-03 — Trace is followable end to end — **NOW**

**Precondition:** You have just completed UAT-01 or UAT-02 (or any other
recent conversation with this agent), OR you know of any real recent
conversation for an agent you have dashboard access to.

**Action:** Go to **Agents → [the agent] → Invocations**. Find the most
recent row (top of the list; sort by time descending is the default). Click
that row.

**Expected result:** A detail drawer opens showing the delegation tree for
that single invocation — the original request, which specialist (if any)
was invoked, which tool(s) were called, and the final status. Every step in
the tree is visibly connected to the same invocation you clicked; there
should be no gap where a delegated call's outcome is missing or
unattributed.

---

## Section B — Production mechanism checks (need a real channel, not blocked by Phase 136)

These exercise features that already run in production for any organization
with the relevant channel connected — no specialist-routing switch involved.
They need a live phone call or a live WhatsApp/ManyChat conversation, so mark
them for whoever holds production access to a real (or dedicated test)
number.

### UAT-04 — Denied action fails safely — voice — **PROD**

**Precondition:** A real organization has a Vapi assistant already bound to
a live phone number (this document does not create one — Phase 135
explicitly does not bind or activate any assistant). You know a request
that names an action the bound agent is not authorized to perform.

**Action:** Call the bound number. Ask for the disallowed action by name,
the same way a real caller might phrase it.

**Expected result:** The assistant responds with a natural spoken apology
or redirect — never dead air, a hang-up, or a robotic "error" recitation —
and the call continues (you can still ask something else, or say goodbye
normally). Afterwards, find this call's invocation in **Agents → [the
agent] → Invocations** and confirm its status reflects a denial, not a
crash (`error` with no denial reason, or a missing row, is a failure of
this item).

### UAT-05 — Duplicate/retry does not double-book — voice — **PROD**

**Precondition:** A real organization has a Vapi assistant bound to a live
number, with Xkedule booking configured, and access to that organization's
Xkedule/calendar view to confirm booking counts. Ideally use a disposable
test time slot you can safely book and then delete.

**Action:** Call the bound number and complete one booking request for a
specific date/time (e.g., "book me for 2pm Thursday"). Immediately after
the assistant confirms it, hang up and call back within a minute, and ask
it to "confirm my booking for 2pm Thursday" (framed as a check, not a new
request) — or, if you have the technical means to capture and replay the
exact `tool-calls` webhook payload Vapi sent to
`https://xphere.app/api/vapi/tools`, replay that exact payload once more.

**Expected result:** Exactly one booking exists for that date/time in the
organization's Xkedule calendar afterward — not two. If you replayed the
raw webhook payload, the second response should look like a normal
successful tool result (not an error), because the guard returns the
original recorded result rather than re-executing — but the calendar must
still show only one booking.

### UAT-06 — Duplicate/retry does not double-book — text — **PROD**

**Precondition:** A real organization has a ManyChat/WhatsApp integration
connected to an agent with Xkedule booking configured, and you (or someone
you're paired with) can capture and replay the exact inbound webhook
payload to `https://xphere.app/api/manychat/webhook`.

**Action:** Send a booking request over WhatsApp to the connected number
and let it complete normally. Then replay the identical captured webhook
payload (same event id / message id) once more.

**Expected result:** Exactly one booking exists afterward. The replayed
request does not create a second calendar entry, and it does not surface a
visibly different or contradictory confirmation message to the same
conversation.

---

## Section C — Specialist routing switch (blocked until Phase 136 Plan 01)

**None of the six items in this section can be executed yet.** As of Phase
135, `agent_channel_routing_modes` exists as a table and
`resolveChannelRoutingMode()` / `invokeAgentWithChannelRouting()` exist as
code (`src/lib/agent-runtime/routing-mode.ts`,
`src/lib/agent-runtime/invocation-gateway.ts`), but **no live route calls
them** — `/api/vapi/tools`, `/api/manychat/webhook`, and every other real
ingress path still resolve their agent directly, the same way they did
before Phase 132. Flipping a row in `agent_channel_routing_modes` today
changes nothing observable, because nothing reads that row outside tests.
Phase 136 Plan 01 is what wires a real route to consult it; only after that
ships (and after a human explicitly enables `specialist` mode for a
canary organization — itself a separate human gate) do these items become
meaningful.

They are listed now, in full, so Phase 136's human gate has an
already-reviewed checklist to execute rather than needing to invent one
under time pressure.

### UAT-07 — Explicit-intent request routes directly to a specialist — voice — **PHASE-136**

**Precondition (once unblocked):** A canary organization has `voice` set to
`specialist` in `agent_channel_routing_modes`, has an active specialist
agent whose `allowed_channels` includes `voice`, and the Vapi assistant's
function/tool configuration names that specialist's slug as a trusted
explicit intent.

**Action:** Call the bound number and make a request that maps directly to
the specialist's configured intent (e.g., "I'd like to check availability"
when `availability_specialist` is wired to that exact function name).

**Expected result:** The response comes from the specialist directly —
confirm afterward in **Agents → Invocations** that the invocation's agent
is the specialist, not the organization's entry/orchestrator agent, and
that there is no intermediate orchestrator-decision step in the trace for
this turn (no orchestrator model call precedes the specialist's own turn).

### UAT-08 — Explicit-intent request routes directly to a specialist — text — **PHASE-136**

**Precondition (once unblocked):** Same as UAT-07, but for the `whatsapp`
(or `manychat`) channel and its own routing-mode row.

**Action:** Send a WhatsApp message matching the specialist's configured
explicit intent.

**Expected result:** Same as UAT-07 — the responding agent (checked in
Invocations) is the specialist directly, no orchestrator hop recorded for
that turn.

### UAT-09 — Ambiguous request falls back to the entry orchestrator — voice — **PHASE-136**

**Precondition (once unblocked):** Same canary setup as UAT-07.

**Action:** Call the bound number and make a vague, non-specific request
that does not match any configured specialist intent (e.g., "I need some
help with something").

**Expected result:** The organization's entry/orchestrator agent handles the
turn (confirm in Invocations — the responding agent is the entry agent, not
a specialist), and the caller still gets a coherent, helpful response, not
a dead end.

### UAT-10 — Ambiguous request falls back to the entry orchestrator — text — **PHASE-136**

**Precondition (once unblocked):** Same as UAT-09, for the text channel.

**Action:** Send an equivalently vague WhatsApp message.

**Expected result:** Same as UAT-09 for the text channel.

### UAT-11 — Voice and text reach the same specialist definition — **PHASE-136**

**Precondition (once unblocked):** One specialist agent's `allowed_channels`
includes both `voice` and `whatsapp` (or `manychat`) for the canary
organization, and both channels are set to `specialist` mode.

**Action:** Using the same explicit-intent phrasing adapted naturally to
each medium, ask the same question once by phone and once by WhatsApp
(e.g., "what times are open Thursday?").

**Expected result:** Both conversations are handled by the exact same
specialist agent record (same agent id, confirmed via Invocations for each
channel's turn) and give consistent, non-contradictory answers to the same
underlying question (e.g., both list the same open slots, allowing for the
few minutes between the two calls).

### UAT-12 — Rollback drill: flip a channel to specialist routing, then back — **PHASE-136**

**Precondition (once unblocked):** A canary organization's channel is
currently `legacy`, with at least one specialist configured and allowed on
that channel.

**Action:**
1. Flip the channel's row in `agent_channel_routing_modes` from `legacy` to
   `specialist`.
2. Repeat UAT-07 or UAT-08 (whichever channel you flipped) and confirm the
   specialist now answers directly, per that item's expected result.
3. Flip the row back to `legacy`.
4. Repeat the same request once more.

**Expected result:** After step 4, the entry/orchestrator agent answers
again exactly as it did before step 1 (confirm in Invocations) — the switch
is purely which code path runs next, never a change to any agent,
partner-edge, prompt, or workflow configuration. Confirm nothing was
destroyed: the specialist agent record, its partner edges, and its prompt
history are unchanged and still present after flipping back (check **Agents
→ [specialist] → Settings** and **Prompt History** show the same values as
before step 1). This drill is non-destructive by construction per
`routing-mode.ts`'s own documented contract — this item exists to prove
that in practice, not just in code comments.

**Why this is listed but not runnable now:** flipping the row today has no
observable effect at all, because no live route reads it yet (see the
Section C preamble). Running this drill before Phase 136 Plan 01 ships would
only prove the row can be updated in the database — not that rollback is
safe — so it is deliberately deferred rather than performed against a
switch nothing consults.
