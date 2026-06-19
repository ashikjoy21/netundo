-- Function to refresh aggregates (call after inserts or nightly via cron)
create or replace function refresh_aggregates()
returns void
language plpgsql
as $$
begin
  refresh materialized view aggregate_district_isp;
end;
$$;
