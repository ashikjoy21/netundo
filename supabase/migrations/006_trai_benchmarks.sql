-- TRAI MySpeed official benchmark layer.
--
-- Source: TRAI MySpeed crowdsourced mobile data speeds, published monthly on
-- India's Open Government Data platform (data.gov.in) under the NDSAP policy
-- (commercial use permitted with attribution).
--
-- THIS IS A THIRD-PARTY REFERENCE ONLY. It is deliberately kept in its own table
-- and must NEVER be joined into `test_results` or `aggregate_district_isp`:
--   * Methodology differs (TRAI's own servers/algorithm, not Cloudflare endpoints).
--   * Granularity is the LSA circle (= whole Kerala), not district/taluk/village.
--   * Coverage is mobile only (3G/4G/5G), in Kbps.
-- Blending it into our own aggregates would corrupt the locality numbers and the
-- credibility that is the whole point of the platform. Display it as a clearly
-- labelled "official baseline", separate from netundo-measured data.

create table trai_benchmarks (
  id uuid primary key default uuid_generate_v4(),
  period date not null,                       -- 1st of the dataset month (e.g. 2026-05-01)
  lsa text not null default 'Kerala',         -- TRAI Local Service Area / circle
  operator text not null,                     -- canonicalised: 'Jio','Airtel','Vi','BSNL'
  technology text not null check (technology in ('3G', '4G', '5G')),
  direction text not null check (direction in ('download', 'upload')),
  avg_mbps numeric not null,                  -- mean speed, converted from Kbps (/1000)
  sample_count integer,                       -- # of TRAI samples behind the average
  source text not null default 'TRAI MySpeed (data.gov.in, NDSAP)',
  ingested_at timestamptz default now() not null,

  -- Makes the monthly ingest idempotent: re-running upserts rather than duplicates.
  unique (period, lsa, operator, technology, direction)
);

create index idx_trai_period on trai_benchmarks(period);
create index idx_trai_operator on trai_benchmarks(operator);

-- Public read; only the service role writes (the ingest script).
alter table trai_benchmarks enable row level security;

create policy "trai benchmarks are public" on trai_benchmarks
  for select using (true);

create policy "service role writes trai" on trai_benchmarks
  for insert with check (true);

create policy "service role updates trai" on trai_benchmarks
  for update using (true) with check (true);
