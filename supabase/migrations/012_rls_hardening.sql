-- Close anon write access that the original policies opened by accident.
--
-- REVIEW BEFORE APPLYING. Drops policies and narrows anon column access;
-- no data is touched. Apply after 011 (it lists 011's columns).
--
-- Policies created without a `TO <role>` clause apply to PUBLIC, i.e. also to
-- the `anon` role whose key ships in the browser. So "service role can insert"
-- (with check (true)) actually let anyone insert speed tests straight through
-- PostgREST, bypassing the worker's validation and rate limits, and the
-- benchmark "updates" policies let anyone rewrite TRAI / M-Lab / Ookla rows.
--
-- The service role bypasses RLS entirely, so the API worker and the ingest
-- scripts (which use SUPABASE_SERVICE_KEY) keep working without these policies.
-- Public SELECT policies are unchanged.
--
-- Left as-is on purpose: feedback's "anyone can submit feedback" insert policy
-- (append-only, no read access).

drop policy if exists "service role can insert" on test_results;

drop policy if exists "service role writes trai" on trai_benchmarks;
drop policy if exists "service role updates trai" on trai_benchmarks;

drop policy if exists "service role writes mlab" on mlab_benchmarks;
drop policy if exists "service role updates mlab" on mlab_benchmarks;

drop policy if exists "service role writes ookla" on ookla_benchmarks;
drop policy if exists "service role updates ookla" on ookla_benchmarks;

-- Hide abuse-control columns from public reads. Table-level SELECT for anon is
-- replaced by a column list that omits ip_hash and client_token_hash (the old
-- ip_hash uses a public fixed salt, so it is reversible). The worker uses the
-- service role and is unaffected.
revoke select on test_results from anon, authenticated;
grant select (
  id, created_at, download_mbps, upload_mbps, latency_ms, jitter_ms,
  loaded_latency_down_ms, loaded_latency_up_ms, packet_loss_pct,
  aim_streaming, aim_gaming, aim_rt_comms, connection_type, effective_type,
  user_agent, isp_name, isp_org, asn, district, taluk, location,
  location_accuracy_m, edge_colo, consent_public, consent_exact_location,
  is_outlier, lat, lng, plan_mbps, source, village, provider_reported,
  provider_reported_name
) on test_results to anon, authenticated;
