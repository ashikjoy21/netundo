-- User feedback submissions from the public /feedback page.
--
-- Lightweight, append-only table for bug reports, feature requests, data
-- corrections and general comments. Kept entirely separate from test_results;
-- it never feeds aggregates or rankings. Email is optional and only used to
-- follow up on a report.

create table feedback (
  id uuid primary key default uuid_generate_v4(),
  category text not null check (category in ('bug', 'feature', 'data', 'general')),
  message text not null,
  email text,                                 -- optional, for follow-up only
  district text,                              -- optional context
  page_url text,                              -- where the user was when submitting
  user_agent text,
  ip_hash text,                               -- SHA-256(ip + salt), for abuse triage only
  created_at timestamptz default now() not null
);

create index idx_feedback_created_at on feedback(created_at desc);
create index idx_feedback_category on feedback(category);

-- Public can submit (insert); nobody reads via the anon/public role. Reads are
-- service-role only (RLS denies select to everyone else).
alter table feedback enable row level security;

create policy "anyone can submit feedback" on feedback
  for insert with check (true);
