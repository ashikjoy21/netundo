'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  /** [lng, lat] of the client (you). */
  client?: [number, number] | null;
  /** [lng, lat] of the Cloudflare edge serving the measurement. */
  server?: [number, number] | null;
  clientLabel?: string;
  serverLabel?: string;
}

const CF_ORANGE = '#f6821f';
const CLIENT_RED = '#e3342f';

/**
 * Server-location map, modelled on Cloudflare's speed test (which uses MapLibre
 * GL). Renders a light vector basemap with a marker at the client and the serving
 * edge, plus a dashed line between them. Uses OpenFreeMap's free, key-less
 * "positron" style so there's no API token to manage.
 */
export default function ServerLocationMap({ client, server, clientLabel, serverLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: client ?? server ?? [76.3, 9.98],
      zoom: 5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      const pts: [number, number][] = [];

      if (server) {
        new maplibregl.Marker({ color: CF_ORANGE })
          .setLngLat(server)
          .setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText(serverLabel ?? 'Server'))
          .addTo(map);
        pts.push(server);
      }

      if (client) {
        new maplibregl.Marker({ color: CLIENT_RED })
          .setLngLat(client)
          .setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText(clientLabel ?? 'You'))
          .addTo(map);
        pts.push(client);
      }

      if (client && server) {
        map.addSource('link', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [server, client] },
          },
        });
        map.addLayer({
          id: 'link',
          type: 'line',
          source: 'link',
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': CF_ORANGE, 'line-width': 2, 'line-dasharray': [2, 1.5] },
        });
      }

      if (pts.length === 2) {
        const bounds = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, { padding: 50, maxZoom: 7, duration: 0 });
      } else if (pts.length === 1) {
        map.setCenter(pts[0]);
        map.setZoom(6);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [client, server, clientLabel, serverLabel]);

  return <div ref={containerRef} className="h-full w-full rounded-lg overflow-hidden" />;
}
