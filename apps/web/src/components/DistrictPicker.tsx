'use client';

import { useState, useEffect } from 'react';
import { Smartphone, Wifi, Cable, MapPin, Loader2 } from 'lucide-react';

const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram',
  'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
] as const;

export type ConnectionType = 'mobile' | 'wifi' | 'wired';

export interface GeoCoords {
  lat: number;
  lng: number;
  accuracyM?: number;
}

interface Props {
  onConfirm: (district: string, connectionType: ConnectionType, coords: GeoCoords | null) => void;
}

const CONN_META: Record<ConnectionType, { label: string; Icon: typeof Wifi }> = {
  mobile: { label: 'Mobile', Icon: Smartphone },
  wifi: { label: 'Wi-Fi', Icon: Wifi },
  wired: { label: 'Wired', Icon: Cable },
};

export function DistrictPicker({ onConfirm }: Props) {
  const [district, setDistrict] = useState('');
  const [connType, setConnType] = useState<ConnectionType>('wifi');
  const [shareLocation, setShareLocation] = useState(false);
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied'>('idle');

  // Detect connection type from NetworkInformation API (Android/Chrome only)
  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; type?: string };
    };
    const conn = nav.connection;
    if (conn?.type === 'cellular') setConnType('mobile');
    else if (conn?.type === 'ethernet') setConnType('wired');
  }, []);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGeoState('denied');
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
        setShareLocation(true);
        setGeoState('idle');
      },
      () => {
        setShareLocation(false);
        setCoords(null);
        setGeoState('denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const toggleShareLocation = () => {
    if (shareLocation) {
      setShareLocation(false);
      setCoords(null);
      setGeoState('idle');
    } else {
      requestLocation();
    }
  };

  const ready = district !== '';

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5 w-full max-w-md mx-auto">
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Where are you in Kerala?</h2>
        <p className="text-sm text-gray-500">Your result helps map real network quality across Kerala.</p>
      </div>

      {/* District */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">District</label>
        <select
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cf-orange/50 focus:border-cf-orange"
        >
          <option value="">Select your district</option>
          {KERALA_DISTRICTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Connection type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">How are you connected?</label>
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
      </div>

      {/* Location opt-in */}
      <button
        type="button"
        onClick={toggleShareLocation}
        className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
          shareLocation ? 'border-cf-orange bg-cf-orange/5' : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
            shareLocation ? 'border-cf-orange bg-cf-orange text-white' : 'border-gray-300 text-transparent'
          }`}
        >
          {geoState === 'locating' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-cf-orange" />
          ) : (
            <MapPin className="w-3 h-3" strokeWidth={3} />
          )}
        </span>
        <span className="text-sm">
          <span className="font-medium text-gray-800">Pin my result on the live map</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            {geoState === 'denied'
              ? 'Location permission was blocked — your result will stay district-only.'
              : coords
              ? `Sharing approximate location (~${coords.accuracyM ?? '?'} m). Stored rounded for privacy.`
              : 'Optional. Shares an approximate spot so others can see speeds near you.'}
          </span>
        </span>
      </button>

      <button
        onClick={() => ready && onConfirm(district, connType, shareLocation ? coords : null)}
        disabled={!ready}
        className="w-full py-3 rounded-lg bg-cf-orange text-white font-semibold text-sm transition-all hover:bg-cf-orange-dark disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Speed Test
      </button>

      <p className="text-xs text-gray-400 text-center">
        Exact location is never stored unless you opt in above. By default only district-level data is recorded.
      </p>
    </div>
  );
}
