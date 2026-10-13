-- Close anon write access that the original policies opened by accident.
--
-- REVIEW BEFORE APPLYING. Drops policies only; no data is touched.
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
