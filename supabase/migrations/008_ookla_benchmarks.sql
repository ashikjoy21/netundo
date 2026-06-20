-- Speedtest® by Ookla® Open Data benchmark layer.
--
-- Source: Ookla Open Data 610m (zoom-16) performance tiles, quarterly, fixed +
-- mobile, licensed CC BY-NC-SA 4.0. Usable because netundo is a NON-COMMERCIAL
-- project. If netundo ever monetises, this data must be removed.
--
-- THIRD-PARTY REFERENCE ONLY — own table, NEVER joined into test_results /
-- aggregate_district_isp. Share-alike (SA) is satisfied by keeping Ookla-derived
-- data isolated here and published under CC BY-NC-SA, so it does not relicense
-- netundo's own dataset. Attribution: "Speedtest® by Ookla®".
--
-- Tiles are mapped to districts/taluks by point-in-polygon (geoBoundaries IND
-- ADM3, CC BY 4.0). District rows roll up the taluks within them.

create table ookla_benchmarks (
  id uuid primary key default uuid_generate_v4(),
  geo_level text not null check (geo_level in ('district', 'taluk')),
  district text not null,
  taluk text,                                  -- null for district rows
  conn_type text not null check (conn_type in ('fixed', 'mobile')),
  period text not null,                         -- e.g. '2025-Q3'
  download_mbps numeric,
  upload_mbps numeric,
  latency_ms numeric,
  tests integer,
  devices integer,
  tile_count integer,
  source text not null default 'Speedtest® by Ookla® Open Data (CC BY-NC-SA 4.0)',
  ingested_at timestamptz default now() not null,

  -- One current row per place+type; NULLS NOT DISTINCT so district rows
  -- (taluk IS NULL) upsert instead of duplicating.
  unique nulls not distinct (geo_level, district, taluk, conn_type)
);

create index idx_ookla_district on ookla_benchmarks(district);
create index idx_ookla_taluk on ookla_benchmarks(district, taluk);

alter table ookla_benchmarks enable row level security;

create policy "ookla benchmarks are public" on ookla_benchmarks
  for select using (true);

create policy "service role writes ookla" on ookla_benchmarks
  for insert with check (true);

create policy "service role updates ookla" on ookla_benchmarks
  for update using (true) with check (true);
