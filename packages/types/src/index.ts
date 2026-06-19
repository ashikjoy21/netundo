// Shared TypeScript types for the netundo Kerala speed test platform.
// Used by frontend apps and backend workers.

// ---------------------------------------------------------------------------
// Kerala geography
// ---------------------------------------------------------------------------

export type KeralaDistrict =
  | 'Thiruvananthapuram'
  | 'Kollam'
  | 'Pathanamthitta'
  | 'Alappuzha'
  | 'Kottayam'
  | 'Idukki'
  | 'Ernakulam'
  | 'Thrissur'
  | 'Palakkad'
  | 'Malappuram'
  | 'Kozhikode'
  | 'Wayanad'
  | 'Kannur'
  | 'Kasaragod';

export const KERALA_DISTRICTS: KeralaDistrict[] = [
  'Thiruvananthapuram',
  'Kollam',
  'Pathanamthitta',
  'Alappuzha',
  'Kottayam',
  'Idukki',
  'Ernakulam',
  'Thrissur',
  'Palakkad',
  'Malappuram',
  'Kozhikode',
  'Wayanad',
  'Kannur',
  'Kasaragod',
];

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type ConnectionType = 'mobile' | 'wifi' | 'wired';

// ---------------------------------------------------------------------------
// API payload shapes
// ---------------------------------------------------------------------------

export interface TestResultPayload {
  summary: {
    /** Bits per second */
    download?: number;
    /** Bits per second */
    upload?: number;
    /** Milliseconds */
    latency?: number;
    /** Milliseconds */
    jitter?: number;
    /** Milliseconds — loaded latency during download */
    downLoadedLatency?: number;
    /** Milliseconds — loaded latency during upload */
    upLoadedLatency?: number;
    /** Fraction 0–1 */
    packetLoss?: number;
  };
  /** AIM quality scores keyed by category (streaming, gaming, rtc, …) */
  scores?: Record<string, { points: number; classificationName: string }>;
  client: {
    connectionType: ConnectionType;
    /** navigator.connection.effectiveType */
    effectiveType?: string;
    userAgent: string;
  };
  location: {
    district: KeralaDistrict;
    taluk?: string;
    /** WGS-84 latitude */
    lat?: number;
    /** WGS-84 longitude */
    lng?: number;
    /** GPS accuracy radius in metres */
    accuracyM?: number;
  };
  consent: {
    sharePublicly: boolean;
    shareExactLocation: boolean;
  };
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface TestResultResponse extends TestResultPayload {
  id: string;
  created_at: string;
  isp_name: string | null;
  asn: number | null;
  edge_colo: string | null;
}

export interface AggregateResult {
  district: KeralaDistrict;
  isp_name: string;
  connection_type: ConnectionType;
  /** ISO date string of the week-start */
  period: string;
  sample_count: number;
  p50_download_mbps: number;
  p90_download_mbps: number;
  p50_upload_mbps: number;
  p90_upload_mbps: number;
  p50_latency_ms: number;
  p50_jitter_ms: number;
}

// ---------------------------------------------------------------------------
// ISP lookup table (ASN → friendly name)
// ---------------------------------------------------------------------------

export const KNOWN_KERALA_ISPS: Record<number, string> = {
  55836: 'Reliance Jio',
  9498: 'Airtel',
  45609: 'BSNL',
  17813: 'Vi (Vodafone Idea)',
  135217: 'Peak Air',
  24560: 'Bharti Airtel',
  38266: 'BSNL Mobile',
};
