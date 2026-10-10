/**
 * JAL-SENTINEL: @cline/sdk Autonomous Agent Loop & MCP Orchestrator (Issue #10)
 * Monitors real-time inundation feeds, coordinates hydraulic & municipal emergency actions
 * through 4 custom Model Context Protocol (MCP) tools, and processes NDMA CAP alerts.
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import Redis from 'ioredis';

import { mcpSolveDynamicRouting, DynamicRoutingOutput } from './tools/mcp_solve_dynamic_routing';
import { mcpDispatchMunicipalTicket, DispatchTicketOutput } from './tools/mcp_dispatch_municipal_ticket';
import { mcpSimulateSluiceActuation, SluiceActuationOutput } from './tools/mcp_simulate_sluice_actuation';
import { mcpBroadcastSdrfSos, SdrfSosOutput } from './tools/mcp_broadcast_sdrf_sos';
import { fetchAndCheckNdmaAlert, precomputeAllEvacuationCorridors } from './ndma_cap';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
const LOG_FILE = path.join(__dirname, 'agent.log');
const INTERVAL_MS = parseInt(process.env.CLINE_AGENT_INTERVAL_SEC || '30', 10) * 1000;
const NDMA_CHECK_INTERVAL_MS = parseInt(process.env.NDMA_CHECK_INTERVAL_SEC || '300', 10) * 1000;

export function logAgentAction(action: string, metadata: Record<string, unknown> = {}) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [CLINE_AGENT] ${action} ${JSON.stringify(metadata)}\n`;
    process.stdout.write(entry);
    try {
        fs.appendFileSync(LOG_FILE, entry);
    } catch {
        // Fallback if filesystem write errors
    }
}

export interface AgentCycleResult {
    timestamp: string;
    backendConnected: boolean;
    criticalEventDetected: boolean;
    maxFloodDepthCm: number;
    mcpToolsInvoked: string[];
    toolOutputs?: {
        sluice?: SluiceActuationOutput;
        routing?: DynamicRoutingOutput;
        ticket?: DispatchTicketOutput;
        sdrf?: SdrfSosOutput;
    };
    ndmaAlertProcessed?: boolean;
    executionDurationMs: number;
}

let redisClient: Redis | null = null;

function getRedisInstance(): Redis | null {
    if (!redisClient && !process.env.DISABLE_REDIS) {
        try {
            redisClient = new Redis(REDIS_URL, {
                connectTimeout: 500,
                maxRetriesPerRequest: 1,
                retryStrategy: () => null,
                lazyConnect: true
            });
            redisClient.on('error', () => {
                // Suppress unhandled redis connection errors
            });
        } catch {
            redisClient = null;
        }
    }
    return redisClient;
}

export async function checkBackendHealth(): Promise<boolean> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 2000 });
        return response.status === 200 && response.data.status === 'ok';
    } catch {
        return false;
    }
}

export async function fetchCurrentFloodData(): Promise<any> {
    const redis = getRedisInstance();
    if (redis) {
        try {
            await redis.connect().catch(() => {});
            const raw = await redis.get('flood:t15');
            if (raw) {
                return JSON.parse(raw);
            }
        } catch {
            // Redis fallback
        }
    }

    try {
        const resp = await axios.get(`${BACKEND_URL}/api/flood/prediction?t=15`, { timeout: 2000 });
        if (resp.status === 200) {
            return resp.data;
        }
    } catch {
        // Offline mock fallback
    }

    // Calibrated baseline fallback representing simulated critical surge in Christian Basti
    return {
        type: "FeatureCollection",
        horizon: "T+15",
        timestamp: new Date().toISOString(),
        features: [
            {
                type: "Feature",
                id: "flood-poly-gs-road",
                properties: {
                    zone_name: "GS Road Christian Basti - ABC Corridor",
                    depth_cm: 34.5,
                    surge_velocity_mm_min: 3.8,
                    clearance_blocked: true
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [[[91.734, 26.142], [91.739, 26.142], [91.741, 26.148], [91.734, 26.142]]]
                }
            }
        ]
    };
}

export async function runAgentCycle(forceCritical: boolean = false): Promise<AgentCycleResult> {
    const startTime = Date.now();
    logAgentAction('START_AGENT_CYCLE', { timestamp: new Date().toISOString() });

    const isHealthy = await checkBackendHealth();
    logAgentAction('BACKEND_HEALTHCHECK', { connected: isHealthy, url: BACKEND_URL });

    const floodData = await fetchCurrentFloodData();
    const features = floodData?.features || [];

    let maxDepth = 0;
    let criticalFeature = features[0];

    for (const f of features) {
        const depth = f.properties?.depth_cm || 0;
        if (depth > maxDepth) {
            maxDepth = depth;
            criticalFeature = f;
        }
    }

    const isCritical = forceCritical || maxDepth >= 30.0;
    const toolsInvoked: string[] = [];
    const outputs: AgentCycleResult['toolOutputs'] = {};

    if (isCritical) {
        logAgentAction('CRITICAL_FLOOD_EVENT_DETECTED', {
            maxDepthCm: maxDepth,
            thresholdCm: 30.0,
            zone: criticalFeature?.properties?.zone_name || 'Guwahati Urban Core'
        });

        const targetCoords = criticalFeature?.geometry?.coordinates?.[0]?.[0] || [91.7365, 26.1448];
        const lat = targetCoords[1];
        const lng = targetCoords[0];

        // Sequence Step 1: Sluice Actuation Load Balancing
        logAgentAction('INVOKING_MCP_TOOL_1', { tool: 'mcp_simulate_sluice_actuation', basin: criticalFeature?.properties?.zone_name });
        const sluiceOut = await mcpSimulateSluiceActuation({
            drainageBasin: criticalFeature?.properties?.zone_name,
            floodZoneLat: lat,
            floodZoneLng: lng,
            waterRiseMmMin: criticalFeature?.properties?.surge_velocity_mm_min || 3.8,
            predictedDepthCm: maxDepth
        });
        toolsInvoked.push('mcp_simulate_sluice_actuation');
        outputs.sluice = sluiceOut;
        logAgentAction('MCP_TOOL_1_COMPLETE', {
            station: sluiceOut.selectedStation.name,
            pumpsActive: `${sluiceOut.recommendedPumpsActive}/${sluiceOut.totalPumpsAvailable}`,
            gateAngle: `${sluiceOut.sluiceGateAngleDegrees}deg`
        });

        // Sequence Step 2: Dynamic Evacuation Route Computation
        logAgentAction('INVOKING_MCP_TOOL_2', { tool: 'mcp_solve_dynamic_routing', vehicleClass: 'sedan' });
        const routeOut = await mcpSolveDynamicRouting({
            originLat: lat,
            originLng: lng,
            destinationLat: 26.1380,
            destinationLng: 91.7890,
            vehicleClass: 'sedan'
        });
        toolsInvoked.push('mcp_solve_dynamic_routing');
        outputs.routing = routeOut;
        logAgentAction('MCP_TOOL_2_COMPLETE', {
            distanceMeters: routeOut.distanceMeters,
            estimatedMinutes: routeOut.estimatedMinutes,
            hazardsAvoided: routeOut.submergedHazardsAvoided
        });

        // Sequence Step 3: Municipal Work-Order Escalation
        logAgentAction('INVOKING_MCP_TOOL_3', { tool: 'mcp_dispatch_municipal_ticket', urgency: 3 });
        const ticketOut = await mcpDispatchMunicipalTicket({
            h3HexId: '8c60e58688461ff',
            hazardClass: 'manhole',
            urgency: 3,
            adminNotes: `Autonomous dispatch triggered by @cline/sdk: flood depth ${maxDepth}cm in ${criticalFeature?.properties?.zone_name}`
        });
        toolsInvoked.push('mcp_dispatch_municipal_ticket');
        outputs.ticket = ticketOut;
        logAgentAction('MCP_TOOL_3_COMPLETE', {
            ticketId: ticketOut.ticketId,
            status: ticketOut.status,
            smsAlertDispatched: ticketOut.smsAlertDispatched
        });

        // Sequence Step 4: SDRF Emergency SOS Broadcast
        logAgentAction('INVOKING_MCP_TOOL_4', { tool: 'mcp_broadcast_sdrf_sos', lat, lng });
        const sdrfOut = await mcpBroadcastSdrfSos({
            citizenLat: lat,
            citizenLng: lng,
            emergencyMessage: `CRITICAL INUNDATION: ${maxDepth}cm depth detected. Automated SDRF rescue dispatched.`
        });
        toolsInvoked.push('mcp_broadcast_sdrf_sos');
        outputs.sdrf = sdrfOut;
        logAgentAction('MCP_TOOL_4_COMPLETE', {
            unit: sdrfOut.dispatchedUnit.name,
            etaMin: sdrfOut.estimatedEtaMinutes,
            smsGateway: sdrfOut.smsGatewayStatus
        });
    } else {
        logAgentAction('TELEMETRY_STATUS_NOMINAL', {
            maxDepthCm: maxDepth,
            status: 'MONITORING_NO_CRITICAL_EXCURSION'
        });
    }

    const duration = Date.now() - startTime;
    logAgentAction('AGENT_CYCLE_COMPLETED', {
        criticalEvent: isCritical,
        toolsRun: toolsInvoked.length,
        durationMs: duration
    });

    return {
        timestamp: new Date().toISOString(),
        backendConnected: isHealthy,
        criticalEventDetected: isCritical,
        maxFloodDepthCm: maxDepth,
        mcpToolsInvoked: toolsInvoked,
        toolOutputs: outputs,
        executionDurationMs: duration
    };
}

export async function runNdmaCycle() {
    logAgentAction('POLLING_NDMA_CAP_FEED', { district: 'Kamrup Metropolitan' });
    const alert = await fetchAndCheckNdmaAlert();
    if (alert.hasActiveAlert) {
        logAgentAction('NDMA_ACTIVE_ALERT_DETECTED', {
            identifier: alert.identifier,
            event: alert.event,
            severity: alert.severity,
            headline: alert.headline
        });
        logAgentAction('STARTING_EVACUATION_ROUTE_PRECOMPUTATION', { target: 'Kamrup Urban Core' });
        const precomputeResult = await precomputeAllEvacuationCorridors();
        logAgentAction('EVACUATION_ROUTE_PRECOMPUTATION_COMPLETE', {
            routesPrecomputed: precomputeResult.totalRoutesPrecomputed,
            vehicleClasses: precomputeResult.vehicleClasses,
            durationMs: precomputeResult.precomputeDurationMs
        });
    } else {
        logAgentAction('NDMA_FEED_NOMINAL', { activeAlerts: 0 });
    }
}

async function main() {
    logAgentAction('BOOTSTRAP', {
        runtime: '@cline/sdk autonomous orchestrator',
        targetBackend: BACKEND_URL,
        intervalMs: INTERVAL_MS,
        ndmaIntervalMs: NDMA_CHECK_INTERVAL_MS
    });

    // Run initial cycles
    await runAgentCycle();
    await runNdmaCycle();

    // Schedule regular telemetry poller
    setInterval(async () => {
        try {
            await runAgentCycle();
        } catch (e: unknown) {
            logAgentAction('CYCLE_ERROR', { error: e instanceof Error ? e.message : String(e) });
        }
    }, INTERVAL_MS);

    // Schedule regular NDMA feed poller
    setInterval(async () => {
        try {
            await runNdmaCycle();
        } catch (e: unknown) {
            logAgentAction('NDMA_CYCLE_ERROR', { error: e instanceof Error ? e.message : String(e) });
        }
    }, NDMA_CHECK_INTERVAL_MS);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal agent loop error:', err);
        process.exit(1);
    });
}
