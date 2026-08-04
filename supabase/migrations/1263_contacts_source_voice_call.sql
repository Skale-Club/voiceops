-- 1263: allow 'voice_call' as a contact source.
--
-- contacts.source enumerated every inbound channel except the phone — the one
-- the platform is built around. A contact captured by a Vapi assistant during a
-- live call had nowhere honest to land, and `contact.created` workflows had no
-- way to tell a call-captured lead from a form fill (the workflow contact scope
-- exposes `source`, not tags).
--
-- Consumed by the `contact_create` action node
-- (src/lib/action-engine/executors/create-crm-contact.ts).

alter table public.contacts drop constraint if exists contacts_source_check;

alter table public.contacts add constraint contacts_source_check
  check (source = any (array[
    'manual'::text,
    'whatsapp'::text,
    'sms'::text,
    'instagram'::text,
    'facebook'::text,
    'messenger'::text,
    'csv_import'::text,
    'ghl_sync'::text,
    'api'::text,
    'voice_call'::text
  ]));
