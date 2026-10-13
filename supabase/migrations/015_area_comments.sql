-- Community comments / short reviews per provider on area pages
-- ("stable for 2 years", "drops every evening").
--
-- Additive only. Service role only (RLS on, no policies); the API worker
-- moderates (profanity / links / phone numbers) before calling these functions.
--
-- Moderation without an admin UI:
--   hide:    update area_comments set hidden = true where id = '…';
--   unhide:  update area_comments set hidden = false where id = '…';
--   review:  select * from area_comments where report_count > 0 order by report_count desc;
-- Comments are auto-hidden after 3 "report comment" flags from distinct people.

create table area_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  district text not null,
  taluk text not null,
  village text,
  brand_key text not null,
  provider_name text,
  kind text not null check (kind in ('broadband', 'mobile')),
  body text not null check (char_length(body) between 3 and 280),
  ip_hash text not null,
  client_token_hash text not null,
  hidden boolean not null default false,
  report_count integer not null default 0
);

create index idx_area_comments_area_created
  on area_comments (district, taluk, created_at desc)
  where not hidden;
create index idx_area_comments_token_created
  on area_comments (client_token_hash, created_at desc);
create index idx_area_comments_ip_created
  on area_comments (ip_hash, created_at desc);
create index idx_area_comments_reported
  on area_comments (report_count desc)
  where report_count > 0;

-- One flag per person per comment.
create table area_comment_reports (
  comment_id uuid not null references area_comments(id) on delete cascade,
  client_token_hash text not null,
  ip_hash text not null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (comment_id, client_token_hash)
);

alter table area_comments enable row level security;
alter table area_comment_reports enable row level security;
-- No policies: service role only.

-- Insert a comment with rate limits (per person and, more loosely, per IP).
create or replace function submit_area_comment(
  p_district text,
  p_taluk text,
  p_village text,
  p_brand_key text,
  p_provider_name text,
  p_kind text,
  p_body text,
  p_ip_hash text,
  p_token_hash text,
  p_token_limit_per_hour integer default 3,
  p_ip_limit_per_hour integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select count(*) from public.area_comments
      where client_token_hash = p_token_hash and created_at >= now() - interval '1 hour')
      >= p_token_limit_per_hour
     or (select count(*) from public.area_comments
      where ip_hash = p_ip_hash and created_at >= now() - interval '1 hour')
      >= p_ip_limit_per_hour then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into public.area_comments (
    district, taluk, village, brand_key, provider_name, kind, body, ip_hash, client_token_hash
  ) values (
    p_district, p_taluk, p_village, p_brand_key, p_provider_name, p_kind, p_body, p_ip_hash, p_token_hash
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Flag a comment. Idempotent per person; auto-hides at p_hide_at flags.
create or replace function report_area_comment(
  p_comment_id uuid,
  p_token_hash text,
  p_ip_hash text,
  p_reason text,
  p_hide_at integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_count integer;
begin
  if not exists (select 1 from public.area_comments where id = p_comment_id) then
    return jsonb_build_object('error', 'not_found');
  end if;

  insert into public.area_comment_reports (comment_id, client_token_hash, ip_hash, reason)
  values (p_comment_id, p_token_hash, p_ip_hash, p_reason)
  on conflict (comment_id, client_token_hash) do nothing;
  get diagnostics v_inserted = row_count;

  update public.area_comments c
     set report_count = (select count(*) from public.area_comment_reports r where r.comment_id = c.id),
         hidden = c.hidden or (select count(*) from public.area_comment_reports r where r.comment_id = c.id) >= p_hide_at
   where c.id = p_comment_id
  returning report_count into v_count;

  return jsonb_build_object('reported', true, 'duplicate', v_inserted = 0, 'report_count', v_count);
end;
$$;

revoke execute on function submit_area_comment(text, text, text, text, text, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function report_area_comment(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function submit_area_comment(text, text, text, text, text, text, text, text, text, integer, integer) to service_role;
grant execute on function report_area_comment(uuid, text, text, text, integer) to service_role;
