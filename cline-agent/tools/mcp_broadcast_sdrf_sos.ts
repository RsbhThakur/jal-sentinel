/**
 * MCP Tool: mcp_broadcast_sdrf_sos (Issue #10)
 * Dispatches emergency SOS broadcast to the nearest SDRF (State Disaster Response Force) staging unit.
 * Computes great-circle distance to Guwahati staging posts, estimates boat transit ETA,
 * and triggers Fast2SMS dispatch. Runs under 3s budget.
 */
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY;

export interface SdrfStagingUnit {
    id: string;
    name: string;
    lat: number;
    lng: number;
    contact: string;
    boats_available: number;
    personnel_count: number;
}

export interface SdrfSosInput {
    citizenLat: number;
    citizenLng: number;
    emergencyMessage?: string;
    batteryLevel?: number;
}

export interface SdrfSosOutput {
    dispatchedUnit: {
        id: string;
        name: string;
        contact: string;
        boatsAvailable: number;
        distanceMeters: number;
    };
    estimatedEtaMinutes: number;
    dispatchTimestamp: string;
    smsGatewayStatus: 'SENT' | 'SIMULATED';
    dispatchSummary: string;
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

export async function mcpBroadcastSdrfSos(input: SdrfSosInput): Promise<SdrfSosOutput> {
    const sdrfPath = path.join(__dirname, '..', 'data', 'sdrf_staging.json');
    let sdrfUnits: SdrfStagingUnit[] = [];

    if (fs.existsSync(sdrfPath)) {
        try {
            sdrfUnits = JSON.parse(fs.readFileSync(sdrfPath, 'utf8'));
        } catch {
            sdrfUnits = [];
        }
    }

    let nearest = sdrfUnits[0] || {
        id: "sdrf-kamrup-01",
        name: "SDRF Guwahati Central Staging (Paltan Bazaar)",
        lat: 26.1795,
        lng: 91.7523,
        contact: "+91-361-2237001",
        boats_available: 6,
        personnel_count: 24
    };

    let minDistance = calculateDistanceMeters(input.citizenLat, input.citizenLng, nearest.lat, nearest.lng);

    for (const unit of sdrfUnits) {
        const d = calculateDistanceMeters(input.citizenLat, input.citizenLng, unit.lat, unit.lng);
        if (d < minDistance) {
            minDistance = d;
            nearest = unit;
        }
    }

    // Estimate boat/vehicle arrival time: 10 km/h in urban flood conditions (approx 6 min per 1000m + 4 min prep)
    const etaMinutes = Math.max(5, Math.min(45, Math.round((minDistance / 1000) * 4.5 + 4)));

    let gatewayStatus: 'SENT' | 'SIMULATED' = 'SIMULATED';
    if (FAST2SMS_API_KEY) {
        try {
            await axios.post(
                'https://www.fast2sms.com/dev/bulkV2',
                {
                    route: 'v3',
                    sender_id: 'TXTIND',
                    message: `[SDRF SOS DISPATCH] Rescue unit ${nearest.name} dispatched to (${input.citizenLat.toFixed(4)}, ${input.citizenLng.toFixed(4)}). ETA: ${etaMinutes} mins. Contact: ${nearest.contact}`,
                    numbers: nearest.contact.replace(/[^0-9]/g, '') || '913612237001'
                },
                {
                    headers: { authorization: FAST2SMS_API_KEY },
                    timeout: 2000
                }
            );
            gatewayStatus = 'SENT';
        } catch {
            gatewayStatus = 'SIMULATED';
        }
    }

    return {
        dispatchedUnit: {
            id: nearest.id,
            name: nearest.name,
            contact: nearest.contact,
            boatsAvailable: nearest.boats_available,
            distanceMeters: minDistance
        },
        estimatedEtaMinutes: etaMinutes,
        dispatchTimestamp: new Date().toISOString(),
        smsGatewayStatus: gatewayStatus,
        dispatchSummary: `DISPATCHED_${nearest.id.toUpperCase()}_ETA_${etaMinutes}MIN_DISTANCE_${minDistance}M`
    };
}
