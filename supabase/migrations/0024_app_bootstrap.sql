-- ===========================================================================
-- 0024_app_bootstrap.sql
--
-- One round trip for the app shell, instead of two - on every page.
-- ===========================================================================
--
-- WHY THIS EXISTS
--
-- 0023 took the dashboard from five round trips to one. This is the same idea
-- applied to the layout, and it is worth more, because the layout renders on
-- EVERY page rather than on one.
--
-- The shell needed two answers before it could draw:
--
--   1. who is asking - a profiles SELECT, behind React's cache() so it is
--      asked once per render rather than three times
--   2. whether they have submitted the day being chased - which drives both
--      the nag banner and the badge on the Today tab
--
-- Two questions, two trips, ~330ms each on this deployment because the app is
-- in US East and the database is in Singapore. Asked together they cost one.
--
-- The nag date is passed in rather than computed here. It is a Singapore
-- business date that shifts to YESTERDAY between midnight and 6am, that rule
-- already lives in lib/nag.ts, and having two implementations of it would mean
-- the banner and the notification could disagree about which day they are
-- talking about.
--
-- SECURITY
--
-- SECURITY INVOKER, stated rather than implied. It reads auth.uid() and takes
-- no user id, so it cannot be pointed at another person's row, and Row Level
-- Security on profiles and daily_submissions applies exactly as it does to the
-- two queries this replaces.
-- ===========================================================================

create or replace function public.app_bootstrap(p_nag_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(

    -- Null when there is no session, and also when a signed-in user somehow
    -- has no profile row. The application treats both the same way - send
    -- them to the login screen - because in neither case can it establish who
    -- they are or what they may see.
    'profile', (
      select to_jsonb(p)
      from public.profiles p
      where p.id = auth.uid()
    ),

    -- Just the status. The banner asks one question of this row - "is it
    -- submitted?" - and shipping the whole submission to answer it would mean
    -- sending every figure on the page's most sensitive row to render a
    -- banner.
    'nag_status', (
      select d.status
      from public.daily_submissions d
      where d.user_id = auth.uid()
        and d.business_date = p_nag_date
    )
  );
$$;

comment on function public.app_bootstrap(date) is
  'The app shell in one round trip: who is signed in, and whether they have submitted the day being chased. SECURITY INVOKER - RLS still decides.';

revoke all on function public.app_bootstrap(date) from public, anon;
grant execute on function public.app_bootstrap(date) to authenticated;
