'use client';

import { useState, useEffect } from 'react';

const KERALA_DISTRICTS = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha', 'Kottayam',
  'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad', 'Malappuram',
  'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod',
] as const;

export type ConnectionType = 'mobile' | 'wifi' | 'wired';

interface Props {
  onConfirm: (district: string, connectionType: ConnectionType) => void;
}

export function DistrictPicker({ onConfirm }: Props) {
  const [district, setDistrict] = useState('');
  const [connType, setConnType] = useState<ConnectionType>('wifi');

  // Attempt to detect connection type from NetworkInformation API (Android/Chrome only)
  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; type?: string };
    };
    const conn = nav.connection;
    if (conn?.type === 'cellular') setConnType('mobile');
    else if (conn?.type === 'ethernet') setConnType('wired');
  }, []);

  const ready = district !== '';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 w-full max-w-md mx-auto">
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
          {(['mobile', 'wifi', 'wired'] as ConnectionType[]).map((type) => (
            <button
              key={type}
              onClick={() => setConnType(type)}
              className={`py-2.5 rounded-lg border text-sm font-medium transition-all ${
                connType === type
                  ? 'border-cf-orange bg-cf-orange text-white'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {type === 'mobile' ? '📱 Mobile' : type === 'wifi' ? '📶 Wi-Fi' : '🔌 Wired'}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => ready && onConfirm(district, connType)}
        disabled={!ready}
        className="w-full py-3 rounded-lg bg-cf-orange text-white font-semibold text-sm transition-all hover:bg-cf-orange-dark disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Speed Test
      </button>

      <p className="text-xs text-gray-400 text-center">
        We never store your exact location. Only district-level data is recorded.
      </p>
    </div>
  );
}
