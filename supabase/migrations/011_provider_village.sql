-- Self-reported provider + village on speed tests.
--
-- Additive only. Apply BEFORE deploying the API worker version that writes these
-- columns.
--
--   village                 village/locality the user picked (keralaPlaces.ts
--                           canonical name). Previously collected but dropped.
--   provider_reported       brand slug from packages/types/src/providers.ts,
--                           or 'lco' / 'other'. Answer to "Who's your provider?".
--   provider_reported_name  free-text name for 'lco' / 'other' (max 60 chars).
--   client_token_hash       SHA-256 of a random per-browser token. Lets the same
--                           browser attach its provider answer after the test
--                           (PATCH /v1/results/:id/provider) without a login.
--
-- The ASN (asn, isp_org) is still stored and is used to validate the answer.

alter table test_results add column if not exists village text;
alter table test_results add column if not exists provider_reported text;
alter table test_results add column if not exists provider_reported_name text;
alter table test_results add column if not exists client_token_hash text;

alter table test_results drop constraint if exists test_results_provider_reported_name_len;
alter table test_results add constraint test_results_provider_reported_name_len
  check (provider_reported_name is null or char_length(provider_reported_name) <= 60);

create index if not exists idx_test_results_district_taluk
  on test_results (district, taluk);
