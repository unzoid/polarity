-- Friends on by default (#428): a profile that never turned Friends on or off
-- gets it on the first time the app asks, through friend_default_on(). A
-- profile that turned it off keeps it off. Profiles from before this
-- migration count as having chosen: they keep what they have.
--
-- New friend_settings rows show friends that the profile is online and let
-- them join its watch party, but not what it watches.

alter table public.friend_settings alter column show_watching set default false;

-- Profiles that have had Friends turned on or off, by the app's default or by hand.
create table public.friend_chosen (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);
alter table public.friend_chosen enable row level security;

insert into public.friend_chosen (profile_id) select id from public.profiles;

create or replace function public.friend_on(p uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c text;
begin
  perform public.friend_own(p);
  insert into public.friend_chosen (profile_id) values (p) on conflict do nothing;
  select code into c from public.friend_settings where profile_id = p;
  while c is null loop
    begin
      insert into public.friend_settings(profile_id, code) values (p, public.friend_new_code()) returning code into c;
    exception when unique_violation then
      -- The profile got one meanwhile, or the new code is taken: read again, or try another.
      select code into c from public.friend_settings where profile_id = p;
    end;
  end loop;
  return c;
end $$;

create or replace function public.friend_off(p uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.friend_own(p);
  insert into public.friend_chosen (profile_id) values (p) on conflict do nothing;
  delete from public.friend_settings where profile_id = p;
end $$;

-- Friends on, if the profile never had it turned on or off. Returns the code
-- when it turned on, null when the profile had chosen already.
create function public.friend_default_on(p uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  fresh uuid;
begin
  perform public.friend_own(p);
  insert into public.friend_chosen (profile_id) values (p) on conflict do nothing returning profile_id into fresh;
  if fresh is null then
    return null;
  end if;
  return public.friend_on(p);
end $$;

revoke all on function public.friend_default_on(uuid) from public, anon;
grant execute on function public.friend_default_on(uuid) to authenticated;
