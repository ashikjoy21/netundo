-- Approximate lat/lng columns for the live map.
--
-- Stored only when the user opts into sharing location (consent_exact_location),
-- and rounded to ~110 m (3 decimals) in the worker before insert for privacy. We
-- keep the PostGIS `location` geography for spatial queries; these plain numeric
-- columns let PostgREST return points to the map without a PostGIS extraction.

alter table test_results add column if not exists lat numeric;
alter table test_results add column if not exists lng numeric;

-- Partial index: the map only ever queries rows that have a location.
create index if not exists idx_test_results_latlng
  on test_results (created_at desc)
  where lat is not null and consent_public = true and is_outlier = false;
