-- Enable PostGIS for geospatial queries
create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- Individual test results
create table test_results (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now() not null,

  -- Core measurements (bps converted from engine output)
  download_mbps numeric,
  upload_mbps numeric,
  latency_ms numeric,
  jitter_ms numeric,
  loaded_latency_down_ms numeric,
  loaded_latency_up_ms numeric,
  packet_loss_pct numeric,

  -- AIM quality scores
  aim_streaming text,
  aim_gaming text,
  aim_rt_comms text,

  -- Connection context
  connection_type text check (connection_type in ('mobile', 'wifi', 'wired')),
  effective_type text,
  user_agent text,

  -- Network/ISP
  isp_name text,
  isp_org text,
  asn integer,

  -- Kerala location
  district text not null,
  taluk text,
  location geography(POINT),
  location_accuracy_m integer,

  -- Edge server
  edge_colo text,

  -- Privacy
  ip_hash text,
  consent_public boolean default false,
  consent_exact_location boolean default false,

  -- Quality flags
  is_outlier boolean default false
);

-- Indexes for common query patterns
create index idx_test_results_district on test_results(district);
create index idx_test_results_isp on test_results(isp_name);
create index idx_test_results_district_isp on test_results(district, isp_name);
create index idx_test_results_created_at on test_results(created_at);
create index idx_test_results_connection_type on test_results(connection_type);
create index idx_test_results_location on test_results using gist(location);

-- RLS: only public results are readable by anon
alter table test_results enable row level security;

create policy "public results are viewable" on test_results
  for select using (consent_public = true and is_outlier = false);

create policy "service role can insert" on test_results
  for insert with check (true);

-- Materialized view for district/ISP aggregates
create materialized view aggregate_district_isp as
select
  district,
  isp_name,
  connection_type,
  date_trunc('week', created_at)::date as period,
  count(*) as sample_count,
  percentile_cont(0.5) within group (order by download_mbps) as p50_download_mbps,
  percentile_cont(0.9) within group (order by download_mbps) as p90_download_mbps,
  percentile_cont(0.5) within group (order by upload_mbps) as p50_upload_mbps,
  percentile_cont(0.9) within group (order by upload_mbps) as p90_upload_mbps,
  percentile_cont(0.5) within group (order by latency_ms) as p50_latency_ms,
  percentile_cont(0.5) within group (order by jitter_ms) as p50_jitter_ms
from test_results
where is_outlier = false
group by district, isp_name, connection_type, date_trunc('week', created_at)::date;

create index idx_agg_district on aggregate_district_isp(district);
create index idx_agg_isp on aggregate_district_isp(isp_name);
