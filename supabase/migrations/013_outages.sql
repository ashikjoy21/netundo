-- Outage reporting ("Net illa? Report it") + outage event history.
--
-- Additive only. Written to by the API worker (service role) through
-- submit_outage_report(); never readable or writable with the anon key.
--
-- Privacy: no coordinates are stored — only the area the user picked (or that
-- /v1/locate resolved). ip_hash / client_token_hash are HMACs keyed with the
-- worker's IP_HASH_SALT secret (the IP key rotates daily); see
-- workers/api/src/privacy.ts.

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

create table outage_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Refreshed when the same person re-reports; window counts use this.
  last_seen_at timestamptz not null default now(),

  district text not null,
  taluk text not null,
  village text,

  -- Brand slug (providers.ts), or 'lco:<name>' / 'other:<name>'.
  brand_key text not null,
  -- Display name for lco/other entries (as typed by the reporter).
  provider_name text,
  kind text not null check (kind in ('broadband', 'mobile')),
  status text not null check (status in ('down', 'slow', 'dropping')),
  comment text check (comment is null or char_length(comment) <= 140),

  -- Network the report was sent from (often NOT the affected one: people
  -- report a broadband outage over mobile data). Kept for later validation.
  asn integer,

  ip_hash text not null,
  client_token_hash text not null,
  hidden boolean not null default false
);

create index idx_outage_reports_area_seen
  on outage_reports (district, taluk, last_seen_at desc);
create index idx_outage_reports_seen
  on outage_reports (last_seen_at desc);
create index idx_outage_reports_token_created
  on outage_reports (client_token_hash, created_at desc);
create index idx_outage_reports_ip_created
  on outage_reports (ip_hash, created_at desc);

alter table outage_reports enable row level security;
-- No policies: only the service role (API worker) can read or write.

-- ---------------------------------------------------------------------------
-- Events (history for future reliability scores)
-- ---------------------------------------------------------------------------

create table outage_events (
  id uuid primary key default gen_random_uuid(),
  district text not null,
  taluk text not null,
  brand_key text not null,
  provider_name text,
  kind text not null check (kind in ('broadband', 'mobile')),
  started_at timestamptz not null default now(),
  last_report_at timestamptz not null default now(),
  -- Null while the outage is active; set by close_stale_outage_events().
  ended_at timestamptz,
  -- Reports received during the event (deduped per person).
  report_count integer not null default 0,
  -- Highest number of distinct reporters seen inside one detection window.
  peak_reporters integer not null default 0,
  -- Village named by most reports, used in headlines ("down in Kakkanad").
  top_village text
);

-- At most one open event per taluk + provider + kind.
create unique index uniq_outage_events_open
  on outage_events (district, taluk, brand_key, kind)
  where ended_at is null;
create index idx_outage_events_open_recent
  on outage_events (last_report_at desc)
  where ended_at is null;
create index idx_outage_events_area_started
  on outage_events (district, taluk, started_at desc);

alter table outage_events enable row level security;
-- No policies: service role only.

-- ---------------------------------------------------------------------------
-- submit_outage_report: rate-limit, dedupe, count, open/extend event —
-- atomically, in one call from the worker.
-- ---------------------------------------------------------------------------

create or replace function submit_outage_report(
  p_district text,
  p_taluk text,
  p_village text,
  p_brand_key text,
  p_provider_name text,
  p_kind text,
  p_status text,
  p_comment text,
  p_asn integer,
  p_ip_hash text,
  p_token_hash text,
  p_min_reports integer default 3,
  p_window_min integer default 30,
  p_token_limit_per_hour integer default 5,
  p_ip_limit_per_hour integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(mins => p_window_min);
  v_report_id uuid;
  v_deduped boolean := false;
  v_reporters integer;
  v_event_id uuid;
  v_event_started timestamptz;
begin
  -- Serialise reports for the same taluk + provider + kind so two concurrent
  -- reports can't both miss (or both open) the event.
  perform pg_advisory_xact_lock(
    hashtextextended(p_district || '|' || p_taluk || '|' || p_brand_key || '|' || p_kind, 0)
  );

  -- Dedupe: the same person re-reporting the same thing within the window
  -- refreshes their report instead of adding one.
  select id into v_report_id
  from public.outage_reports
  where district = p_district
    and taluk = p_taluk
    and brand_key = p_brand_key
    and kind = p_kind
    and client_token_hash = p_token_hash
    and last_seen_at >= now() - v_window
  order by last_seen_at desc
  limit 1;

  if v_report_id is not null then
    update public.outage_reports
       set last_seen_at = now(),
           status = p_status,
           village = coalesce(p_village, village),
           comment = coalesce(p_comment, comment)
     where id = v_report_id;
    v_deduped := true;
  else
    -- Rate limits. Per token is the real per-person limit; the per-IP cap is
    -- looser because mobile carriers put many people behind one IP (CGNAT).
    if (select count(*) from public.outage_reports
        where client_token_hash = p_token_hash and created_at >= now() - interval '1 hour')
        >= p_token_limit_per_hour
       or (select count(*) from public.outage_reports
        where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour')
        >= p_ip_limit_per_hour then
      return jsonb_build_object('error', 'rate_limited');
    end if;

    insert into public.outage_reports (
      district, taluk, village, brand_key, provider_name, kind, status,
      comment, asn, ip_hash, client_token_hash
    ) values (
      p_district, p_taluk, p_village, p_brand_key, p_provider_name, p_kind, p_status,
      p_comment, p_asn, p_ip_hash, p_token_hash
    )
    returning id into v_report_id;
  end if;

  -- Distinct reporters in the window: distinct client tokens, counting at most
  -- two per IP so one person clearing storage can't fake an outage alone, while
  -- a CGNAT IP shared by real neighbours still counts more than once.
  select coalesce(sum(least(per_ip, 2)), 0)::integer into v_reporters
  from (
    select count(distinct client_token_hash) as per_ip
    from public.outage_reports
    where district = p_district
      and taluk = p_taluk
      and brand_key = p_brand_key
      and kind = p_kind
      and not hidden
      and last_seen_at >= now() - v_window
    group by ip_hash
  ) s;

  select id, started_at into v_event_id, v_event_started
  from public.outage_events
  where district = p_district and taluk = p_taluk
    and brand_key = p_brand_key and kind = p_kind
    and ended_at is null;

  -- Open a new event at the threshold, and extend an open one only while the
  -- threshold is still met — one person re-reporting can't keep it alive.
  if v_event_id is null and v_reporters >= p_min_reports then
    insert into public.outage_events (district, taluk, brand_key, provider_name, kind, started_at, last_report_at)
    values (
      p_district, p_taluk, p_brand_key, p_provider_name, p_kind,
      (select min(created_at) from public.outage_reports
        where district = p_district and taluk = p_taluk and brand_key = p_brand_key
          and kind = p_kind and not hidden and last_seen_at >= now() - v_window),
      now()
    )
    returning id, started_at into v_event_id, v_event_started;
  end if;

  if v_event_id is not null and v_reporters >= p_min_reports then
    update public.outage_events e
       set last_report_at = now(),
           peak_reporters = greatest(e.peak_reporters, v_reporters),
           report_count = (
             select count(*) from public.outage_reports r
             where r.district = p_district and r.taluk = p_taluk
               and r.brand_key = p_brand_key and r.kind = p_kind
               and not r.hidden and r.last_seen_at >= v_event_started
           ),
           top_village = (
             select r.village from public.outage_reports r
             where r.district = p_district and r.taluk = p_taluk
               and r.brand_key = p_brand_key and r.kind = p_kind
               and not r.hidden and r.village is not null
               and r.last_seen_at >= v_event_started
             group by r.village
             order by count(*) desc, max(r.last_seen_at) desc
             limit 1
           )
     where e.id = v_event_id;
  end if;

  return jsonb_build_object(
    'report_id', v_report_id,
    'deduped', v_deduped,
    'reporters', v_reporters,
    'likely_outage', v_event_id is not null,
    'event_id', v_event_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- close_stale_outage_events: called by the API worker's cron. An outage is
-- over once no reports have arrived for one detection window.
-- ---------------------------------------------------------------------------

create or replace function close_stale_outage_events(p_window_min integer default 30)
returns integer
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.outage_events
       set ended_at = last_report_at
     where ended_at is null
       and last_report_at < now() - make_interval(mins => p_window_min)
    returning 1
  )
  select count(*)::integer from closed;
$$;

-- Only the service role may call these (PostgREST exposes functions to anon
-- by default).
revoke execute on function submit_outage_report(text, text, text, text, text, text, text, text, integer, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke execute on function close_stale_outage_events(integer) from public, anon, authenticated;
grant execute on function submit_outage_report(text, text, text, text, text, text, text, text, integer, text, text, integer, integer, integer, integer) to service_role;
grant execute on function close_stale_outage_events(integer) to service_role;
