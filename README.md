# netundo

**Is the net down near you? / നെറ്റ് ഉണ്ടോ?** netundo ([netundo.com](https://netundo.com)) is an
open-source (MIT), crowdsourced internet outage and speed-test site for Kerala.

- **Net illa? Report it:** anyone can report that their provider is down, very slow or keeps
  dropping, with no login. When enough neighbours report the same provider in the same taluk,
  the area page shows a **Likely outage** that can be shared on WhatsApp.
- **Right now:** every district, taluk and village page shows live reports from the last hour,
  along with any status updates posted by the operator.
- **Speed test:** uses Cloudflare's speed-test engine. Results build public rankings by
  **provider brand**, always split into **home broadband** and **mobile data**.
- **Community:** short per-provider comments ("stable for 2 years", "drops every evening").

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 App Router, **static export** (`output: 'export'`) deployed to Cloudflare Pages. Area pages are prerendered at build time; live data (Right now, outages, charts) is fetched on the client. |
| `apps/web/functions` | Cloudflare **Pages Functions**. Only `/status/*` (outage share pages with Open Graph tags) runs server-side. |
| `workers/api` | Cloudflare Worker for the public API (`api.netundo.com`), with a 5-minute cron that closes stale outages. |
| `workers/speedtest` | Optional self-hosted measurement endpoints. |
| `workers/rebuild` | A cron that triggers a nightly Pages rebuild so static pages re-bake the latest aggregates. |
| `packages/types` | Shared TypeScript: **provider/ASN brand mapping**, moderation, place lists, outage wording. |
| `supabase/migrations` | Postgres schema (Supabase). |
| `scripts` | Ingest jobs (TRAI, M-Lab, Ookla), boundary simplification, OG images, operator tokens. |

## Local development

```bash
pnpm install
pnpm test          # Vitest: providers, moderation, outage logic, prose, share pages
pnpm type-check
pnpm --filter @netundo/web dev                          # http://localhost:3000
pnpm --filter @netundo/worker-api dev                   # wrangler dev for the API
```

Set `NEXT_PUBLIC_API_WORKER_URL` to point the web app at an API. Without it, pages build with
empty data, show their fallback states and are marked `noindex`.

## Configuration

### Web build (`apps/web`, read at build time)

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_WORKER_URL` | (none) | API base URL, e.g. `https://api.netundo.com` |
| `NEXT_PUBLIC_SITE_URL` | `https://netundo.com` | Canonical origin for sitemap, canonicals and share links |
| `NETUNDO_INDEX_MIN_TESTS` | `5` | Taluk and village pages with fewer tests get `noindex` and are left out of the sitemap |
| `NETUNDO_FAQ_MIN_TESTS` | `5` | Below this many tests of a kind, FAQs and intros never name a "fastest provider" |
| `NETUNDO_FAQ_HEDGE_BELOW` | `30` | Below this, the fastest-provider copy says "Based on early data from N tests…" |
| `NEXT_PUBLIC_RANK_MIN_TESTS` | `10` | Networks with fewer tests appear under **Early data** (low-confidence badge) instead of being ranked |

The Pages Function reads `NETUNDO_API_URL` (default `https://api.netundo.com`), set as a Pages
environment variable.

### API worker (`workers/api/wrangler.toml` and secrets)

| Name | Type | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | var | (none) | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | **secret** | (none) | `wrangler secret put SUPABASE_SERVICE_KEY` |
| `IP_HASH_SALT` | **secret** | (dev fallback) | A long random string. It keys the HMACs of IPs (rotated daily) and client tokens used for dedupe and rate limits. **Required in production.** |
| `OUTAGE_MIN_REPORTS` | var | `3` | Distinct reporters needed for a **Likely outage**… |
| `OUTAGE_WINDOW_MIN` | var | `30` | …within this many minutes. An outage clears once no reports arrive for this long. |
| `RIGHT_NOW_WINDOW_MIN` | var | `60` | How far back the Right now section counts reports |

"Distinct reporters" counts distinct anonymous browser tokens, with at most 2 per IP. One
person can't fake an outage alone, but neighbours sharing a mobile carrier IP (CGNAT) still count.

## Provider brands

Rankings group tests by **brand**, not raw ASN names like "Airtel UNOC, CP-05, Sector 8…". The
mapping lives in [`packages/types/src/providers.ts`](packages/types/src/providers.ts). To add a
brand or ASN, edit that file and open a PR. It is applied when data is read, so old tests are
relabelled too.

- After a speed test, users answer **"Who's your provider?"** (Kerala brands, *Local cable
  operator* with a name, or *Other*). The self-reported brand is preferred. The ASN is kept to
  validate it, and an answer that contradicts a known ASN is overridden.
- Local cable operators that reach the internet through an upstream (Sify, RailTel, Kerala Vision
  / KCCL) appear as their own entries, such as `lco:sree-cable`.
- VPN, hosting and foreign networks (Cloudflare WARP, iCloud Private Relay, cloud providers) are
  left out of rankings.
- Wi-Fi on a mobile-only network (a phone hotspot) counts as **mobile data**, not home broadband.

## Outage reports, operators and comments

| Endpoint | Purpose |
|---|---|
| `POST /v1/reports` | Submit an outage report (area, provider, kind, status, optional comment, client token) |
| `GET /v1/status?district=&taluk=` | Right now data for an area |
| `GET /v1/outages/active` | All live likely outages across Kerala (homepage) |
| `GET /v1/locate?lat=&lng=` | Point → district/taluk. Coordinates are rounded to ~1 km and never stored. |
| `POST/GET /v1/comments`, `POST /v1/comments/:id/report` | Community comments |
| `POST/PATCH/GET /v1/operator/updates` | **Operator status updates.** Bearer-token auth, see [`docs/operator-api.md`](docs/operator-api.md) |
| `/status/{district}/{taluk}/{brand}[?kind=mobile]` | Shareable outage page with dynamic Open Graph tags for WhatsApp previews |

**Privacy:** reports store only the area the user picked, never coordinates. IPs and browser
tokens are stored only as keyed hashes.

**Operator tokens:** `node scripts/create-operator-token.mjs --name "…" --brand <key> [--districts A,B]`.
The token is printed once. To revoke one, run `update operators set active = false where …`.

**Moderating comments** (there's no admin UI yet; use the Supabase SQL editor):

```sql
-- Most-flagged comments first
select id, district, taluk, provider_name, brand_key, body, report_count, hidden
from area_comments where report_count > 0 order by report_count desc;

update area_comments set hidden = true  where id = '…';   -- hide
update area_comments set hidden = false where id = '…';   -- restore
update outage_reports set hidden = true where id = '…';   -- hide an abusive outage report
```

Comments are auto-hidden after 3 flags from different people. Comments, report comments and
operator messages are filtered for profanity (English, Manglish, Malayalam), links and phone
numbers. The word lists are in `packages/types/src/moderation.ts`.

**History:** `outage_events` records each likely outage (start, end, area, provider, kind, report
count, peak reporters, main village). It's stored now so a per-area reliability score can be
computed later.

## Database migrations

Apply them in order (Supabase SQL editor or `supabase db push`). Everything from 011 onward is
additive **except 012**.

| # | File | Notes |
|---|---|---|
| 001–010 | initial schema, aggregates, benchmarks, feedback | existing |
| 011 | `provider_village.sql` | `test_results.village`, self-reported provider, client token hash. **Apply before deploying the API.** |
| 012 | `rls_hardening.sql` | **Review first.** Drops the insert/update policies that let the public anon key write to `test_results` and the benchmark tables. No data is touched. |
| 013 | `outages.sql` | Outage reports and events, `submit_outage_report()`, `close_stale_outage_events()` |
| 014 | `operator_updates.sql` | Operators, updates, update areas |
| 015 | `area_comments.sql` | Comments and flags, `submit_area_comment()`, `report_area_comment()` |

## Deploying

1. Apply the migrations (above).
2. API: `cd workers/api && wrangler secret put IP_HASH_SALT`, then `pnpm deploy:api`.
3. Web: `pnpm deploy:web`. This runs `wrangler pages deploy out` from `apps/web`, which also
   uploads `apps/web/functions`. In the Pages project settings, set a compatibility date (the
   function was tested with `2024-12-01`) and, optionally, `NETUNDO_API_URL`.

The static build has about 1,750 pages (one per district, taluk and village).

## Data sources

netundo's own tests come from Cloudflare's speed-test engine. Third-party baselines are kept in
separate tables and always labelled as such: TRAI MySpeed (data.gov.in, NDSAP), M-Lab (CC0) and
Speedtest® by Ookla® Open Data (CC BY-NC-SA 4.0, non-commercial).

## License

MIT, see [LICENSE](LICENSE).
