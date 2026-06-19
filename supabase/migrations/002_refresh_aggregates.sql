-- Function to refresh aggregates (call nightly via cron)
create or replace function refresh_aggregates()
returns void
language plpgsql
as $$
begin
  refresh materialized view concurrently aggregate_district_isp;
end;
$$;
