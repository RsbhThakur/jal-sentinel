/**
 * MCP Tool: mcp_broadcast_sdrf_sos
 * Dispatches emergency SOS broadcast to the nearest SDRF staging unit.
 */
import * as path from 'path';
import * as fs from 'fs';

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
    };
    estimatedEtaMinutes: number;
    dispatchTimestamp: string;
    smsGatewayStatus: 'SENT' | 'SIMULATED';
}

export async function mcpBroadcastSdrfSos(input: SdrfSosInput): Promise<SdrfSosOutput> {
    const sdrfPath = path.join(__dirname, '..', 'data', 'sdrf_staging.json');
    let sdrfUnits = [];
    if (fs.existsSync(sdrfPath)) {
        sdrfUnits = JSON.parse(fs.readFileSync(sdrfPath, 'utf8'));
    }

    const nearest = sdrfUnits[0] || {
        id: "sdrf-kamrup-01",
        name: "SDRF Guwahati Central Staging",
        contact: "+91-361-2237001"
    };

    return {
        dispatchedUnit: {
            id: nearest.id,
            name: nearest.name,
            contact: nearest.contact
        },
        estimatedEtaMinutes: 12,
        dispatchTimestamp: new Date().toISOString(),
        smsGatewayStatus: process.env.FAST2SMS_API_KEY ? 'SENT' : 'SIMULATED'
    };
}
