-- Add a provenance column to test_results so we can store INDEPENDENT tests from
-- M-Lab (CC0) alongside netundo's own, clearly tagged, without ever letting them
-- skew netundo's real numbers.
--
-- source = 'netundo' (default, our own crowdsourced Cloudflare-engine tests)
--        | 'mlab'    (M-Lab NDT individual tests, single-stream, IP-geolocated)
--
-- Real aggregates (aggregate_district_isp + the live /v1/aggregate query) are
-- filtered to source='netundo'. M-Lab tests surface only as labelled map points
-- and an independent-test count — never blended into netundo methodology.

alter table test_results
  add column if not exists source text not null default 'netundo'
  check (source in ('netundo', 'mlab'));

create index if not exists idx_test_results_source on test_results(source);

-- Keep the materialized aggregate pure: netundo-measured tests only.
drop materialized view if exists aggregate_district_isp;

create materialized view aggregate_district_isp as
select
  district,
  asn,
  mode() within group (order by isp_name) as isp_name,
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
  and source = 'netundo'
group by district, asn, connection_type, date_trunc('week', created_at)::date;

create index idx_agg_district on aggregate_district_isp(district);
create index idx_agg_asn on aggregate_district_isp(asn);
create index idx_agg_isp on aggregate_district_isp(isp_name);
