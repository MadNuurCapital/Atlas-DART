-- ---------------------------------------------------------------------------
-- 0012 - Insurer seed list.
--
-- Singapore life, health, investment and general insurers. Consultants can add
-- anything missing themselves (D19); this is only a sensible starting point so
-- the dropdown is not empty on day one.
--
-- Renames are why this is data and not a CHECK constraint: AXA Singapore became
-- HSBC Life, Aviva Singapore became Singlife. An admin can rename a row here
-- without a migration, and every existing case follows automatically because
-- cases reference the insurer by id.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

insert into public.insurers (name)
values
  -- Life, health and investment
  ('AIA Singapore'),
  ('Prudential Singapore'),
  ('Great Eastern Life'),
  ('Manulife Singapore'),
  ('Income Insurance'),
  ('Singlife'),
  ('HSBC Life Singapore'),
  ('China Taiping Singapore'),
  ('Tokio Marine Life Singapore'),
  ('Etiqa Insurance Singapore'),
  ('FWD Singapore'),
  ('Sun Life Singapore'),
  ('Transamerica Life Bermuda'),
  ('Zurich Life Singapore'),
  ('Raffles Health Insurance'),
  -- General insurance
  ('MSIG Singapore'),
  ('Allianz Singapore'),
  ('Chubb Singapore'),
  ('QBE Singapore'),
  ('Liberty Singapore'),
  ('Sompo Singapore'),
  ('Ergo Singapore')
on conflict do nothing;
