-- Operator status updates ("We're fixing a fibre cut in Kakkanad, back by 9pm").
--
-- Additive only. Written by operators through the authenticated API
-- (POST/PATCH /v1/operator/updates, see docs/operator-api.md), shown in the
-- "Right now" section, clearly marked as coming from the operator. Designed to
-- be fed later by LNO360's OLT monitoring and operator tools.
--
-- Service role only (RLS on, no policies): the worker reads and writes.

create table operators (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,                       -- shown publicly, e.g. "Kerala Vision NOC"
  -- Provider this operator speaks for: brand slug or 'lco:<name>' key, the same
  -- keys outage reports use (packages/types/src/providers.ts).
  brand_key text not null,
  -- SHA-256 (hex) of the API token. The token itself is shown once at creation.
  token_hash text not null unique,
  -- Districts this operator may post about; null = anywhere in Kerala.
  allowed_districts text[],
  active boolean not null default true,
  contact text                              -- internal only, never exposed
);

create table operator_updates (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id) on delete cascade,
  brand_key text not null,
  -- null = affects both home broadband and mobile.
  kind text check (kind is null or kind in ('broadband', 'mobile')),
  status text not null check (status in ('investigating', 'fixing', 'restored')),
  message text not null check (char_length(message) between 3 and 500),
  eta timestamptz,                          -- estimated restore time
  -- Caller-supplied id (e.g. an LNO360 incident id) for idempotent retries.
  external_ref text check (external_ref is null or char_length(external_ref) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz                   -- set when status becomes 'restored'
);

create unique index uniq_operator_updates_external_ref
  on operator_updates (operator_id, external_ref)
  where external_ref is not null;
create index idx_operator_updates_operator_updated
  on operator_updates (operator_id, updated_at desc);
create index idx_operator_updates_updated
  on operator_updates (updated_at desc);

create table operator_update_areas (
  id bigint generated always as identity primary key,
  update_id uuid not null references operator_updates(id) on delete cascade,
  district text not null,
  taluk text,                               -- null = the whole district
  unique nulls not distinct (update_id, district, taluk)
);

create index idx_operator_update_areas_place
  on operator_update_areas (district, taluk);
create index idx_operator_update_areas_update
  on operator_update_areas (update_id);

alter table operators enable row level security;
alter table operator_updates enable row level security;
alter table operator_update_areas enable row level security;
-- No policies: service role only.
