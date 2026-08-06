-- 1266_contact_imports_bucket.sql
--
-- Creates the `contact-imports` bucket that src/lib/import/storage-supabase.ts
-- has always written to but which was never provisioned. Without it, the very
-- first CSV import fails at createSignedUploadUrl with "Bucket not found".
-- contact_imports currently has 0 rows, so nobody has hit it yet.
--
-- Path contract (enforced by SupabaseImportStorage.getSignedUploadUrl):
--   {org_id}/{import_id}/{filename}
-- so storage.foldername(name)[1] is the owning org.
--
-- Private bucket: import files are raw contact lists (names, emails, phones).
-- They must never be world-readable the way avatars/chat-media are.

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'contact-imports',
  'contact-imports',
  false,
  52428800  -- 50 MiB; the import pipeline is specced for files up to 50 MB / 200k rows
)
on conflict (id) do nothing;

-- Deliberately no allowed_mime_types filter. createSignedUploadUrl cannot know
-- the content type up front, and browsers label .csv inconsistently
-- (text/csv, application/vnd.ms-excel, application/octet-stream). A strict list
-- would reject valid uploads with a confusing error; the parse worker already
-- validates the contents.

-- Org members read their own org's import files (streamFile / download).
drop policy if exists contact_imports_read_own_org on storage.objects;
create policy contact_imports_read_own_org
  on storage.objects for select
  using (
    bucket_id = 'contact-imports'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from org_members
      where user_id = (select auth.uid())
    )
  );

-- Org members upload into their own org's prefix only.
drop policy if exists contact_imports_insert_own_org on storage.objects;
create policy contact_imports_insert_own_org
  on storage.objects for insert
  with check (
    bucket_id = 'contact-imports'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from org_members
      where user_id = (select auth.uid())
    )
  );

-- Signed uploads resume/overwrite the same key, so UPDATE is required too.
drop policy if exists contact_imports_update_own_org on storage.objects;
create policy contact_imports_update_own_org
  on storage.objects for update
  using (
    bucket_id = 'contact-imports'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from org_members
      where user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'contact-imports'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from org_members
      where user_id = (select auth.uid())
    )
  );

-- Cleanup of an org's own import files.
drop policy if exists contact_imports_delete_own_org on storage.objects;
create policy contact_imports_delete_own_org
  on storage.objects for delete
  using (
    bucket_id = 'contact-imports'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from org_members
      where user_id = (select auth.uid())
    )
  );
