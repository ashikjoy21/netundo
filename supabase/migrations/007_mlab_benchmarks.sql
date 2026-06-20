-- M-Lab (Measurement Lab) independent benchmark layer.
--
-- Source: M-Lab NDT aggregated statistics, published per locality at
-- statistics.measurementlab.net under a CC0 public-domain dedication
-- (commercial reuse permitted, no attribution required — we credit it anyway).
--
-- THIRD-PARTY REFERENCE ONLY — like trai_benchmarks, this lives in its own table
-- and must NEVER be joined into `test_results` or `aggregate_district_isp`:
--   * Methodology differs (single-stream NDT vs our Cloudflare multi-stream).
--   * Geolocation is IP-based (~town/city accuracy), not GPS.
-- Shown as "Independent measurements (M-Lab)" next to netundo's own numbers.
--
-- Geo model: M-Lab has no district aggregate, only town localities. A district
-- row uses the same-named principal city; a taluk row uses an exact name match, a
-- curated transliteration alias, or the taluk's main town (hq_town fallback).

create table mlab_benchmarks (
  id uuid primary key default uuid_generate_v4(),
  geo_level text not null check (geo_level in ('district', 'taluk')),
  district text not null,
  taluk text,                                 -- null for district-level rows
  mlab_locality text not null,                -- the actual M-Lab town used
  match_type text not null check (match_type in ('exact', 'alias', 'hq_town')),
  period date not null,                        -- representative year (YYYY-01-01)
  download_mbps numeric,                        -- sample-weighted mean of daily medians
  upload_mbps numeric,
  latency_ms numeric,
  sample_count integer,
  source text not null default 'M-Lab (measurementlab.net, CC0)',
  ingested_at timestamptz default now() not null,

  -- One current row per place; makes re-ingest idempotent. NULLS NOT DISTINCT so
  -- district rows (taluk IS NULL) collide and upsert instead of duplicating.
  unique nulls not distinct (geo_level, district, taluk)
);

create index idx_mlab_district on mlab_benchmarks(district);
create index idx_mlab_taluk on mlab_benchmarks(district, taluk);

alter table mlab_benchmarks enable row level security;

create policy "mlab benchmarks are public" on mlab_benchmarks
  for select using (true);

create policy "service role writes mlab" on mlab_benchmarks
  for insert with check (true);

create policy "service role updates mlab" on mlab_benchmarks
  for update using (true) with check (true);
