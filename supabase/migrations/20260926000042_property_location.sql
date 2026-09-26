-- ============================================================================
-- Migration 0042: structured property location
-- ============================================================================
-- Purpose:
--   Add country, state, and city columns to properties. Together with the
--   existing free-text `address` column, this gives structured location data
--   for filtering, reporting, and address verification (later).
--
-- Design:
--   country   — ISO 3166-1 alpha-2, uppercase. Permissive CHECK (format only)
--               so future markets are a data insert, not a migration.
--               Default 'NG' for Nigerian first market.
--   state     — CHECK against the 36 Nigerian states + FCT. Strict for now
--               because data quality in state names matters for filtering
--               and future address verification. When we go international,
--               add a states lookup table and drop this CHECK.
--   city      — free text. Nigerian city/LGA naming is inconsistent
--               (Ikeja vs Ikeja LGA vs Ikeja, Lagos). No canonical list.
--
-- All columns nullable. Existing test/prod rows are not affected. New rows
-- from the setup wizard and the property edit page will populate them.
-- ============================================================================

alter table public.properties
  add column country text
    check (country is null or (length(country) = 2 and country = upper(country))),
  add column state text
    check (state is null or state in (
      'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue',
      'Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT',
      'Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi',
      'Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
      'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'
    )),
  add column city text;

comment on column public.properties.country is
  'ISO 3166-1 alpha-2. Uppercase. Default NG for first market.';

comment on column public.properties.state is
  'Nigerian state or FCT. Strict list — international expansion adds a states lookup table.';

comment on column public.properties.city is
  'Free-text city or LGA. Naming varies, no canonical list.';

-- Country defaults to NG on new inserts unless otherwise specified.
alter table public.properties
  alter column country set default 'NG';
