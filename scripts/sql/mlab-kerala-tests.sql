-- M-Lab individual NDT tests for Kerala, with location — for netundo's map.
--
-- Run in the BigQuery console (https://console.cloud.google.com/bigquery) under
-- ANY free GCP project. M-Lab data is public; the query is billed to your project
-- but stays well within the 1 TB/month free tier (the date partition + Geo filter
-- keep the scan small). Then: "Save results → JSON (local file)" and hand the
-- file to scripts/ingest-mlab-tests.mjs.
--
-- Capped at 15,000 most-recent Kerala tests so the console one-click JSON export
-- works (it caps at ~16k rows) — plenty of map points. Remove/raise LIMIT only if
-- you export via GCS instead.
--
-- NDT measures single-stream throughput (different from netundo's Cloudflare
-- multi-stream) — these land in test_results as source='mlab', shown only as
-- labelled map points, never in netundo's aggregates.

SELECT
  date,
  a.MeanThroughputMbps      AS download_mbps,
  a.MinRTT                  AS latency_ms,
  client.Geo.Latitude       AS lat,
  client.Geo.Longitude      AS lng,
  client.Geo.City           AS city,
  client.Network.ASName     AS isp_name,
  client.Network.ASNumber   AS asn
FROM `measurement-lab.ndt.unified_downloads`
WHERE client.Geo.CountryCode = 'IN'
  AND client.Geo.Subdivision1ISOName = 'IN-KL'   -- Kerala
  AND client.Geo.Latitude IS NOT NULL
  AND client.Geo.Longitude IS NOT NULL
  AND a.MeanThroughputMbps > 0
ORDER BY date DESC
LIMIT 15000;
