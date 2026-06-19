# netundo Landing Page — Design Spec

Date: 2026-06-19

## Goal
Replace the bare home page (just the speed-test widget) with a Cloudflare-hero-inspired
landing page: an orange-gradient hero with a "Test My Speed" CTA, a live interactive map
of ISP speeds at real GPS points across Kerala, plus trust/stat sections. Design taste
matches the existing (light, Cloudflare-style) test page. Premium icons via Lucide.

## Decisions (locked with user)
- **Hero look:** vivid orange-gradient panel + white CTA, then light content below.
- **Map data:** exact GPS pins per test (opt-in), colored by download speed.
- **Scope:** new landing at `/`; speed test moves to `/test`; `/kerala` kept.
- **Icons:** `lucide-react`.

## Routing
- `/` → `LandingPage` (new)
- `/test` → existing `SpeedTest`
- `/kerala` → existing (links updated to `/test`)
- Header nav: logo · Test Speed (`/test`) · Kerala Map (`/kerala`) · About

## Components (apps/web/src/components/landing/)
- `Hero.tsx` — orange gradient + glow, headline, subtext, white "Test My Speed" pill
  (→`/test`), ghost "Explore the map" (scrolls to map), live counter from aggregate.
- `SpeedMap.tsx` — MapLibre (positron) showing pins from `GET /v1/points`, colored by
  download speed (red <20 / amber 20–50 / green >50). Geolocation "Use my location"
  centers on user. Color legend + connection-type filter chips. Empty state.
- `TrustStrip.tsx` — 3 Lucide cards: Accurate / Local / Private.
- `StatsSection.tsx` — district speed cards (top) + Top ISPs leaderboard (by ASN), from
  `GET /v1/aggregate`.
- `CtaBand.tsx` — closing orange CTA.

## Data plumbing
- Migration `004_add_latlng.sql`: add `lat numeric`, `lng numeric` to `test_results`.
- Worker `POST /v1/results`: when `consent.shareExactLocation` and lat/lng present, store
  lat/lng **rounded to 3 decimals (~110 m)** for privacy, alongside the PostGIS point.
- Worker `GET /v1/points`: public, non-outlier rows with `lat` not null →
  `{lat,lng,download_mbps,upload_mbps,latency_ms,isp_name,district,connection_type}`,
  recent first, limit 500.

## Test-flow opt-in
- `DistrictPicker` gains a toggle: "📍 Pin my result on the live Kerala map (shares
  approximate location)", default **off**. When on, request `navigator.geolocation`;
  pass lat/lng + `shareExactLocation: true` to `submitResult`.

## Privacy
- Exact GPS is opt-in; default remains district-only. Stored lat/lng rounded ~110 m.
  Only `consent_public` rows are exposed via `/v1/points`.

## Out of scope
- Real-time pin updates, clustering, per-ISP map overlays — later if needed.
