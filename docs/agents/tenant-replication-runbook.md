# Tenant replication runbook — voice + chat booking, from a template

How to stand up the phone-and-chat booking system for a **new client** from the Cuts &
Culture reference tenant, using only the product. No SQL, no scripts. Each step names
where it happens, what it produces, and how to check it.

Proven 2026-09-05: the capture → install pipeline ran on the real database into a scratch
organization and produced the full mesh with prompts naming the new tenant
(`FINDINGS-OUTSIDE-SCOPE.md` item 11).

## What a template carries, and what it never does

A template carries **behaviour**: the agents, their prompts (as templates with
`{{business_name}}` / `{{business_location}}` tokens), the delegation graph and its grants,
the tool workflows, channel defaults, pipelines. A tenant supplies its **facts**: name,
address, hours, prices, staff, calendar — all read live from its own Xkedule connection or its
Company Info.

A template never carries: integration credentials, phone numbers, Vapi assistants, or a
routing-mode switch. Installing never turns live traffic on.

## Step 0 — Create the organization

`Organizations → New`. Name it as the customer will hear it spoken: the name is read aloud
by the phone robot (`Thank you for calling <name>. Which service would you like to book
today?`), so avoid legal suffixes and symbols the voice would read out.

## Step 1 — Company Info: business type and where appointments happen

`Settings → Company Info`.

- **Business type** seeds the booking modality.
- **Service location mode** is the authority:
  - `on_premises` — customers come to the business (barbershop, clinic). The robot never
    asks for an address; the `customerAddress` field is removed from `book_appointment`.
  - `at_customer` — the business travels (cleaning, mobile groomer, technician). The address
    is collected after the price is accepted and before availability; the field is required.
  - `either` — one narrowing question decides.
- Address, timezone, currency: used when Xkedule is not connected yet, and for invoicing.

The engine renders this into every prompt on every channel. Do not write "ask" or "never
ask" for an address into any prompt.

## Step 2 — Connect Xkedule

`Integrations → Xkedule`: tenant base URL and API key. This is the source of truth for
services, prices, staff, hours, policy and the calendar. Everything the robot says about
the business comes from here through the eight tool workflows.

Check: `Workflows` → run `business_info` and `list_services` from the tool page; both must
return real data.

## Step 3 — Install the template

`Settings → Organization Templates`:

1. On the **reference** organization (Cuts & Culture): **Capture** with all asset groups —
   at minimum `workflows` and `agents`. Captured prompts keep their tokens; captured
   grants bind by workflow `tool_name`, agents by `slug`, so they install across tenants.
2. Switch to the **new** organization and **Install** that template.

What you get (verify on `Agents` and `Workflows`):

| Asset | Expected |
|---|---|
| Agents | 7: entry orchestrator, five specialists, voice receptionist — each with an active prompt |
| Partner edges | 8, with delegated grants; only the Booking specialist can write to the calendar |
| Workflows | 8 tool workflows, installed **as drafts** |
| Channel defaults | `web_widget` → entry orchestrator, `voice` → voice receptionist |
| Routing modes | none — both channels stay on legacy until you flip them |

Re-running the install changes nothing (it is idempotent). Installing again after editing
the reference tenant is how you ship prompt improvements to every client.

## Step 4 — Activate the workflows

`Workflows`: activate the eight imported tools. Until they are active neither channel can
call them. Their `credential_ref` binds to this organization's Xkedule connection.

## Step 5 — The web widget (chat)

Nothing to configure: the widget token is created with the organization, and
`web_widget`'s default agent is the entry orchestrator. Embed the widget on the client's
site (`Settings → Widget`).

Check: ask the widget where the business is and what it offers. The answer must name the
**new** business and come from its Xkedule data. No `{{` anywhere.

Latency note: a cold availability question through the mesh can take ~30s (the calendar
lookup is 8–14s cold). See `FINDINGS-OUTSIDE-SCOPE.md` item 9 for the levers.

## Step 6 — The phone robot (voice)

1. In Vapi, create an assistant for the client (any prompt; it will be replaced) and attach
   the client's phone number to it.
2. `Assistants` in Xphere → sync (inbound) so the assistant appears → map it to this
   organization. The mapping is how a call resolves to a tenant; tool arguments can never
   override it.
3. On the assistant row: **Push config** (kebab menu → confirm in the dialog). This writes,
   from Xphere:
   - the system prompt: the voice receptionist's prompt with the tenant's facts and the
     service-location rule rendered in;
   - the eight function schemas, already transformed for the modality;
   - per-tool spoken lines ("Let me look at the book for you, one moment.") — an assistant
     that already has tuned lines keeps them;
   - per-tool routing (`https://xphere.app/api/vapi/tools` + secret, 30s timeout) — carried
     over from the assistant, and the push **refuses** if any tool would be left unrouted;
   - the fixed opening line, spoken instantly on pickup:
     `Thank you for calling <name>. Which service would you like to book today?`
   - the assistant-level server (`https://xphere.app/api/vapi/calls`, same secret, 20s), so
     status updates and the end-of-call report reach Xphere. The `in-progress` status update
     carries the caller's number before anyone has spoken, and Xphere starts the customer
     lookup right then — the robot's first reply is not waiting on the provider.
4. Repeat the push whenever the prompt, the modality or the tool set changes. Nothing on the
   Vapi side is edited by hand anymore.

Check: call the number. Instant greeting; first reply greets a returning caller by name;
service → price confirmed → day → three times offered → name/phone confirmed → read-back →
booked. Then `Calls` in Xphere shows the transcript.

## Step 7 — Routing modes (optional, per channel)

`Agents → Channel routing`. `legacy` (default) has Vapi call the tools directly — the right
setting for voice today: one inference per turn, no delegation hops on a live call.
`specialist` sends a channel through the mesh. The widget runs the mesh; voice stays legacy.
Flipping is reversible and non-destructive; see `canary-activation-runbook.md` for the
step-by-step with an abort per stage.

## Conventions that keep the next install clean

- Never put a business name, address or phone number into a prompt. Use
  `{{business_name}}` / `{{business_location}}`; the runtime renders them on every channel.
- Never hardcode the address rule; the engine renders `{{service_location_block}}`.
- Tool descriptions describe the tool, not the tenant.
- Only the Booking specialist holds calendar write grants. A voice or entry agent delegates
  writes through an edge.
- Deactivate agents you retire; a template captures only active ones.

## Where things are

| Concern | Place |
|---|---|
| Capture / install | `src/lib/org-templates/{snapshot,install,prompt-template}.ts` |
| Prompt token rendering at runtime | `src/lib/agent-runtime/resolve-agent.ts` |
| Modality rule and schema transform | `src/lib/agent-runtime/service-location-{prompt,schema}.ts` |
| Vapi push | `src/lib/vapi/{render-assistant-config,sync-assistant-config}.ts` |
| Voice tool route | `src/app/api/vapi/tools/route.ts` (30s in-process cache of per-call resolutions, per-stage timings) |
| Reference voice prompt (template) | `.planning/workstreams/omnichannel-agent-orchestration/canary/vapi-receptionist-prompt.md` |
| Reference mesh graph | `.planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json` |
