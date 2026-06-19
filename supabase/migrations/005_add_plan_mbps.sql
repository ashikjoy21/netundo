-- Advertised plan speed (Mbps) the user says they pay for.
-- Enables "are you getting what you pay for?" comparisons over time.
alter table test_results
  add column if not exists plan_mbps numeric;
