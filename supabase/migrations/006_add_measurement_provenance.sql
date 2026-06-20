-- Measurement provenance + confidence.
--
-- Records HOW each reading was taken, not just the result, so the dataset can be
-- re-weighted, audited, or quarantined later (e.g. "downweight short tests",
-- "ignore client web-1") without re-collecting it. All columns are nullable so
-- historical rows and any in-flight inserts remain valid.

alter table test_results
  -- Which engine profile ran: 'full' (Cloudflare default) or 'lite' (slow/metered link)
  add column if not exists measurement_profile text,
  -- Total wall-clock duration of the test in milliseconds
  add column if not exists test_duration_ms numeric,
  -- Number of download / upload bandwidth samples collected
  add column if not exists download_sample_count integer,
  add column if not exists upload_sample_count integer,
  -- Coefficient of variation (stddev/mean) of download samples; 0 = perfectly stable
  add column if not exists download_cov numeric,
  -- App build + measurement engine identifiers
  add column if not exists client_version text,
  add column if not exists engine_version text,
  -- Derived 0–1 trust score (sample adequacy + stability). Reflects measurement
  -- QUALITY, not speed — a slow but stable link still scores high, so this never
  -- penalises legitimate slow-connection data (the whole point of the platform).
  add column if not exists confidence numeric;

-- Confidence-aware aggregation is a deliberate follow-up: thresholds/weighting
-- are a product decision, and the existing aggregate_district_isp view + worker
-- live-aggregation keep working unchanged with these columns simply populated.
