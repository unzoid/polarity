-- A profile's PIN and viewing limit (docs/supabase-storage.md, profiles). Both on the profile's row, so every
-- device of the account asks for the same PIN and applies the same limit, offline too from its cached copy.
--
-- pin_hash: never the PIN; `pbkdf2-sha256$<iterations>$<salt>$<hash>` (src/lib/account/pin.ts), the
--   parameters kept with it so they can be raised later. Null: no PIN.
-- viewing_limit: the highest age a title may be rated for. Null: none on the profile (its Browsing setting,
--   synced with its settings, applies as before).
-- viewing_hide_unrated: titles without a rating hidden too, with a limit.
--
-- Additive: apps without this feature never select or write these columns; the row-level security of
-- `profiles` ("own profiles": only the account's own rows) is unchanged.

alter table public.profiles
  add column pin_hash text,
  add column viewing_limit smallint,
  add column viewing_hide_unrated boolean not null default false;

alter table public.profiles
  add constraint profiles_pin_hash_format check (
    pin_hash is null
    or (char_length(pin_hash) <= 400 and pin_hash ~ '^[a-z0-9-]{1,32}\$[0-9]{1,9}\$[A-Za-z0-9_-]{1,128}\$[A-Za-z0-9_-]{1,255}$')
  ),
  add constraint profiles_viewing_limit_range check (viewing_limit is null or viewing_limit between 1 and 21);
