/**
 * MCP Tool: mcp_simulate_sluice_actuation (Issue #10)
 * Recommends pumping station load-balancing, diversion canal routing,
 * and stormwater sluice gate actuation by spatially referencing Guwahati's drainage infrastructure.
 */
import * as path from 'path';
import * as fs from 'fs';

export interface PumpingStation {
    id: string;
    name: string;
    basin: string;
    lat: number;
    lng: number;
    max_discharge_cusecs: number;
    total_pumps: number;
    sluice_gates: number;
    operational_status: string;
}

export interface SluiceActuationInput {
    drainageBasin?: string; // e.g., 'Bharalu' | 'GS Road' | 'RG Baruah'
    floodZoneLat?: number;
    floodZoneLng?: number;
    waterRiseMmMin: number;
    predictedDepthCm?: number;
    predictedInundationVolumeM3?: number;
}

export interface SluiceActuationOutput {
    selectedStation: {
        id: string;
        name: string;
        basin: string;
        distanceMeters: number;
    };
    recommendedPumpsActive: number;
    totalPumpsAvailable: number;
    sluiceGateAngleDegrees: number;
    actuationCommand: 'FULL_OPEN' | 'PARTIAL_OPEN' | 'HOLD' | 'EMERGENCY_DIVERSION';
    estimatedDrainTimeMinutes: number;
    diversionCanalTarget: string;
    recommendedActions: string[];
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

export async function mcpSimulateSluiceActuation(input: SluiceActuationInput): Promise<SluiceActuationOutput> {
    const stationsPath = path.join(__dirname, '..', 'data', 'pumping_stations.json');
    let stations: PumpingStation[] = [];

    if (fs.existsSync(stationsPath)) {
        try {
            stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
        } catch {
            stations = [];
        }
    }

    // Default target coordinate near Christian Basti / Bharalu if not supplied
    const targetLat = input.floodZoneLat ?? 26.1445;
    const targetLng = input.floodZoneLng ?? 91.7365;

    // Find nearest pumping station
    let nearest = stations[0] || {
        id: "pump-bharalu-01",
        name: "Bharalumukh River Outfall Sluice #1",
        basin: "Bharalu",
        lat: 26.1750,
        lng: 91.7300,
        max_discharge_cusecs: 1200,
        total_pumps: 6,
        sluice_gates: 4,
        operational_status: "ONLINE"
    };

    let minDistance = calculateDistanceMeters(targetLat, targetLng, nearest.lat, nearest.lng);

    for (const station of stations) {
        const d = calculateDistanceMeters(targetLat, targetLng, station.lat, station.lng);
        if (d < minDistance) {
            minDistance = d;
            nearest = station;
        }
    }

    // Determine pump load & sluice angle from water rise rate & depth
    const riseRate = Math.max(0, input.waterRiseMmMin);
    const depth = input.predictedDepthCm ?? 25.0;

    let pumpsActive = 2;
    let gateAngle = 45;
    let command: 'FULL_OPEN' | 'PARTIAL_OPEN' | 'HOLD' | 'EMERGENCY_DIVERSION' = 'PARTIAL_OPEN';

    if (depth >= 30.0 || riseRate >= 4.0) {
        pumpsActive = nearest.total_pumps;
        gateAngle = 90;
        command = 'EMERGENCY_DIVERSION';
    } else if (depth >= 15.0 || riseRate >= 2.0) {
        pumpsActive = Math.min(nearest.total_pumps, 4);
        gateAngle = 70;
        command = 'FULL_OPEN';
    } else {
        pumpsActive = Math.min(nearest.total_pumps, 2);
        gateAngle = 35;
        command = 'PARTIAL_OPEN';
    }

    const drainTime = Math.max(10, Math.round(50 - (pumpsActive * 5) - (gateAngle * 0.2)));

    return {
        selectedStation: {
            id: nearest.id,
            name: nearest.name,
            basin: nearest.basin,
            distanceMeters: minDistance
        },
        recommendedPumpsActive: pumpsActive,
        totalPumpsAvailable: nearest.total_pumps,
        sluiceGateAngleDegrees: gateAngle,
        actuationCommand: command,
        estimatedDrainTimeMinutes: drainTime,
        diversionCanalTarget: `${nearest.basin} Outfall Sluice -> Brahmaputra Deep Channel`,
        recommendedActions: [
            `ACTUATE_SLUICE_GATES [Station: ${nearest.id}, Angle: ${gateAngle}deg]`,
            `ENGAGE_SUBMERSIBLE_PUMPS [Active: ${pumpsActive}/${nearest.total_pumps}]`,
            `OPEN_DIVERSION_CHANNEL [Target: ${nearest.basin} Outfall]`
        ]
    };
}
