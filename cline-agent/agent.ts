import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const LOG_FILE = path.join(__dirname, 'agent.log');
const INTERVAL_MS = parseInt(process.env.CLINE_AGENT_INTERVAL_SEC || '30', 10) * 1000;

function logAgentAction(action: string, metadata: Record<string, unknown> = {}) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [CLINE_AGENT] ${action} ${JSON.stringify(metadata)}\n`;
    process.stdout.write(entry);
    fs.appendFileSync(LOG_FILE, entry);
}

interface AgentTelemetryStatus {
    backendConnected: boolean;
    activeAlerts: number;
    recommendedActions: string[];
}

export async function checkBackendHealth(): Promise<boolean> {
    try {
        const response = await axios.get(`${BACKEND_URL}/api/health`, { timeout: 4000 });
        return response.status === 200 && response.data.status === 'ok';
    } catch (err: unknown) {
        logAgentAction('HEALTHCHECK_WARNING', { error: err instanceof Error ? err.message : String(err) });
        return false;
    }
}

export async function runAgentCycle(): Promise<AgentTelemetryStatus> {
    logAgentAction('START_AGENT_CYCLE', { timestamp: new Date().toISOString() });
    
    const isHealthy = await checkBackendHealth();
    const status: AgentTelemetryStatus = {
        backendConnected: isHealthy,
        activeAlerts: 0,
        recommendedActions: []
    };

    if (!isHealthy) {
        logAgentAction('WAITING_FOR_BACKEND', { target: BACKEND_URL });
        return status;
    }

    logAgentAction('TELEMETRY_MONITOR_TICK', {
        status: 'MONITORING_GAUGE_FREE_OPTICAL_FEED',
        backend: BACKEND_URL
    });

    return status;
}

async function main() {
    logAgentAction('BOOTSTRAP', {
        runtime: '@cline/sdk autonomous orchestrator',
        targetBackend: BACKEND_URL,
        intervalMs: INTERVAL_MS
    });

    await runAgentCycle();

    setInterval(async () => {
        try {
            await runAgentCycle();
        } catch (e: unknown) {
            logAgentAction('CYCLE_ERROR', { error: e instanceof Error ? e.message : String(e) });
        }
    }, INTERVAL_MS);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal agent loop error:', err);
        process.exit(1);
    });
}
