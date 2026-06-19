'use client';

import { useState, useEffect } from 'react';
import { Smartphone, Wifi, Cable, Loader2, LocateFixed } from 'lucide-react';
import { DISTRICT_LATLNG } from '@/lib/utils';

export type ConnectionType = 'mobile' | 'wifi' | 'wired';

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracyM?: number;
}

interface Props {
  onConfirm: (district: string, connectionType: ConnectionType, coords: GeoCoords) => void;
}

const CONN_META: Record<ConnectionType, { label: string; Icon: typeof Wifi }> = {
  mobile: { label: 'Mobile', Icon: Smartphone },
  wifi: { label: 'Wi-Fi', Icon: Wifi },
  wired: { label: 'Wired', Icon: Cable },
};

export function DistrictPicker({ onConfirm }: Props) {
  const [district, setDistrict] = useState('');
  const [connType, setConnType] = useState<ConnectionType | ''>('wifi');
  const [detectedConnType, setDetectedConnType] = useState<ConnectionType | null>(null);
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'timeout' | 'unavailable' | 'unsupported'>('idle');

  // Browser support is partial: Chrome Android can expose cellular/ethernet/wifi,
  // while Safari/iOS usually hides the physical connection type.
  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; type?: string };
    };
    const conn = nav.connection;
    const detected = detectConnectionType(conn?.type);
    if (detected) {
      setDetectedConnType(detected);
      setConnType(detected);
    }
  }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGeoState('unsupported');
      return;
    }
    setGeoState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy),
        });
        setDistrict(inferDistrict(pos.coords.latitude, pos.coords.longitude));
        setGeoState('idle');
      },
      (error) => {
        setCoords(null);
        setDistrict('');
        if (error.code === error.PERMISSION_DENIED) setGeoState('denied');
        else if (error.code === error.TIMEOUT) setGeoState('timeout');
        else setGeoState('unavailable');
      },
      // Approximate location is enough to infer district and is much more reliable
      // on phones than forcing GPS/high-accuracy mode.
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 },
    );
  };

  const ready = district !== '' && coords !== null && connType !== '';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5 w-full max-w-md mx-auto">
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Confirm your test context</h2>
        <p className="text-sm text-gray-500">
          We use browser location to place your result in the right Kerala district automatically.
        </p>
      </div>

      <button
        type="button"
        onClick={requestLocation}
        className={`w-full flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
          coords ? 'border-cf-orange bg-cf-orange/5' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            coords ? 'bg-cf-orange text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {geoState === 'locating' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <LocateFixed className="w-4 h-4" strokeWidth={2.5} />
          )}
        </span>
        <span className="text-sm">
          <span className="font-semibold text-gray-800">
            {coords ? `Detected ${district}` : 'Use my current location'}
          </span>
          <span className="block text-xs text-gray-500 mt-1 leading-5">
            {locationMessage(geoState, coords)}
          </span>
        </span>
      </button>

      {/* Connection type */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label className="block text-sm font-medium text-gray-700">How are you connected?</label>
          {detectedConnType && (
            <span className="text-xs font-medium text-green-600">Auto-detected</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(CONN_META) as ConnectionType[]).map((type) => {
            const { label, Icon } = CONN_META[type];
            const active = connType === type;
            return (
              <button
                key={type}
                onClick={() => setConnType(type)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  active
                    ? 'border-cf-orange bg-cf-orange text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={2} />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Browsers do not always reveal Wi-Fi vs mobile. Wi-Fi is selected by default; change it if you are on mobile data or wired internet.
        </p>
      </div>

      <button
        onClick={() => ready && onConfirm(district, connType, coords)}
        disabled={!ready}
        className="w-full py-3 rounded-lg bg-cf-orange text-white font-semibold text-sm transition-all hover:bg-cf-orange-dark disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Speed Test
      </button>

      <p className="text-xs text-gray-400 text-center">
        Location is required for public map quality. Coordinates are rounded to roughly 110 m before storage.
      </p>
    </div>
  );
}

function locationMessage(geoState: 'idle' | 'locating' | 'denied' | 'timeout' | 'unavailable' | 'unsupported', coords: GeoCoords | null): string {
  if (geoState === 'locating') return 'Getting approximate location from your phone...';
  if (geoState === 'denied') return 'Location permission is blocked. Allow location for this site in browser settings and try again.';
  if (geoState === 'timeout') return 'Location timed out. Turn on phone location/GPS and try again.';
  if (geoState === 'unavailable') return 'Your phone could not provide location right now. Check location services and try again.';
  if (geoState === 'unsupported') return 'This browser does not support location access.';
  if (coords) return `Detected with about ${coords.accuracyM ?? '?'} m accuracy. Stored rounded for privacy.`;
  return 'Your browser will ask for permission. We infer district from your coordinates.';
}

function detectConnectionType(type?: string): ConnectionType | null {
  if (type === 'cellular') return 'mobile';
  if (type === 'ethernet') return 'wired';
  if (type === 'wifi') return 'wifi';
  return null;
}

function inferDistrict(lat: number, lng: number): string {
  return Object.entries(DISTRICT_LATLNG)
    .map(([district, [districtLng, districtLat]]) => ({
      district,
      distance: haversineKm(lat, lng, districtLat, districtLng),
    }))
    .sort((a, b) => a.distance - b.distance)[0].district;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(a));
}
