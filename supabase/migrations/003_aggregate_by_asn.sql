-- Regroup the district/ISP aggregate by ASN instead of isp_name.
--
-- Why: an ISP's text name (isp_name, from Cloudflare's asOrganization) can drift
-- over time — the same provider may be relabelled — which fragments aggregates.
-- The ASN is the stable, canonical identifier for a network, so we group by it and
-- keep only a *representative* display name (the most common name seen for that
-- ASN) via mode().

-- Recreating with the same name keeps refresh_aggregates() (migration 002) valid.
-- Dropping the materialized view also drops its dependent indexes.
drop materialized view if exists aggregate_district_isp;

create materialized view aggregate_district_isp as
select
  district,
  asn,
  -- Representative display name for this ASN (most frequently seen).
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
group by district, asn, connection_type, date_trunc('week', created_at)::date;

create index idx_agg_district on aggregate_district_isp(district);
create index idx_agg_asn on aggregate_district_isp(asn);
create index idx_agg_isp on aggregate_district_isp(isp_name);
