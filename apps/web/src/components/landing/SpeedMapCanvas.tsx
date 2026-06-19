'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface SpeedPoint {
  lat: number;
  lng: number;
  download_mbps: number | null;
  upload_mbps: number | null;
  latency_ms: number | null;
  isp_name: string | null;
  district: string | null;
  connection_type: string | null;
}

interface Props {
  points: SpeedPoint[];
  /** [lng, lat] to fly to when the user shares their location. */
  flyTo?: [number, number] | null;
}

// Kerala bounding box-ish center
const KERALA_CENTER: [number, number] = [76.3, 10.4];

function toFeatureCollection(points: SpeedPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {
          download: p.download_mbps ?? 0,
          upload: p.upload_mbps ?? 0,
          latency: p.latency_ms ?? 0,
          isp: p.isp_name ?? 'Unknown ISP',
          district: p.district ?? '',
          conn: p.connection_type ?? '',
        },
      })),
  };
}

export default function SpeedMapCanvas({ points, flyTo }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: KERALA_CENTER,
      zoom: 6.3,
      attributionControl: false,
      dragRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource('points', { type: 'geojson', data: toFeatureCollection(points) });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 11, 9],
          'circle-color': [
            'step',
            ['get', 'download'],
            '#ef4444', // < 20
            20, '#f59e0b', // 20–50
            50, '#22c55e', // > 50
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, offset: 12 });
      map.on('mouseenter', 'points', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'points', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
      map.on('click', 'points', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string | number>;
        const coords = (f.geometry as { coordinates: [number, number] }).coordinates;
        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font:12px/1.4 Inter,sans-serif;min-width:150px">
              <div style="font-weight:600;color:#111">${p.isp}</div>
              <div style="color:#6b7280;margin-bottom:4px">${p.district}${p.conn ? ` · ${p.conn}` : ''}</div>
              <div>↓ <b>${Number(p.download).toFixed(1)}</b> · ↑ <b>${Number(p.upload).toFixed(1)}</b> Mbps</div>
              <div style="color:#6b7280">${Number(p.latency).toFixed(0)} ms latency</div>
            </div>`,
          )
          .addTo(map);
      });

      loadedRef.current = true;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update points when they change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource('points') as maplibregl.GeoJSONSource | undefined;
    src?.setData(toFeatureCollection(points));
  }, [points]);

  // Fly to the user's location when shared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: flyTo, zoom: 10, duration: 1200 });
    new maplibregl.Marker({ color: '#3b82f6' }).setLngLat(flyTo).addTo(map);
  }, [flyTo]);

  return <div ref={containerRef} className="h-full w-full" />;
}
