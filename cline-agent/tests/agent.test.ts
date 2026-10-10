/**
 * Automated Verification Suite for @cline/sdk Autonomous Agent & MCP Tools (Issue #10)
 * Validates:
 * 1. mcp_solve_dynamic_routing latency (<2s) and GeoJSON compliance
 * 2. mcp_broadcast_sdrf_sos latency (<3s) and nearest unit selection
 * 3. mcp_simulate_sluice_actuation station matching & pump load balancing
 * 4. mcp_dispatch_municipal_ticket escalation & SMS dispatch trigger
 * 5. Sequential execution of all 4 MCP tools on critical flood event (<10s benchmark)
 * 6. NDMA CAP feed alert parsing and route pre-computation
 * 7. Verification of autonomous reasoning logs in agent.log
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { mcpSolveDynamicRouting } from '../tools/mcp_solve_dynamic_routing';
import { mcpBroadcastSdrfSos } from '../tools/mcp_broadcast_sdrf_sos';
import { mcpSimulateSluiceActuation } from '../tools/mcp_simulate_sluice_actuation';
import { mcpDispatchMunicipalTicket } from '../tools/mcp_dispatch_municipal_ticket';
import { runAgentCycle, runNdmaCycle, logAgentAction } from '../agent';
import { parseNdmaCapFeed, precomputeAllEvacuationCorridors } from '../ndma_cap';

async function runTestSuite() {
    console.log('======================================================================');
    console.log('CLINE AUTONOMOUS AGENT & MCP TOOLS AUTOMATED TEST SUITE');
    console.log('======================================================================\n');

    // ------------------------------------------------------------------
    // Test 1: mcp_solve_dynamic_routing Latency & GeoJSON Route
    // ------------------------------------------------------------------
    console.log('[TEST 1] Testing mcp_solve_dynamic_routing (<2s budget)...');
    const t0 = Date.now();
    const route = await mcpSolveDynamicRouting({
        originLat: 26.1448,
        originLng: 91.7365,
        destinationLat: 26.1795,
        destinationLng: 91.7523,
        vehicleClass: 'sedan'
    });
    const routeDuration = Date.now() - t0;

    assert.ok(route.routeGeoJson, 'Route GeoJSON must be present');
    assert.strictEqual((route.routeGeoJson as any).type, 'Feature', 'Route must be a GeoJSON Feature');
    assert.ok(route.distanceMeters > 0, 'Distance must be > 0 meters');
    assert.ok(route.estimatedMinutes > 0, 'Estimated minutes must be > 0');
    assert.ok(routeDuration < 2000, `Routing latency (${routeDuration}ms) exceeded 2000ms SLA`);
    console.log(`  [OK] Dynamic routing completed in ${routeDuration}ms: ${route.distanceMeters}m, ${route.estimatedMinutes}min`);

    // ------------------------------------------------------------------
    // Test 2: mcp_broadcast_sdrf_sos Latency & Nearest Unit Selection
    // ------------------------------------------------------------------
    console.log('\n[TEST 2] Testing mcp_broadcast_sdrf_sos (<3s budget)...');
    const t1 = Date.now();
    const sos = await mcpBroadcastSdrfSos({
        citizenLat: 26.1420,
        citizenLng: 91.7390,
        emergencyMessage: 'Submerged vehicle near ABC Point, need water rescue'
    });
    const sosDuration = Date.now() - t1;

    assert.ok(sos.dispatchedUnit, 'Dispatched unit must be present');
    assert.ok(sos.dispatchedUnit.id, 'Dispatched unit ID must be present');
    assert.ok(sos.dispatchedUnit.contact, 'Dispatched unit contact must be present');
    assert.ok(sos.estimatedEtaMinutes >= 5 && sos.estimatedEtaMinutes <= 45, 'ETA must be realistic (5-45 mins)');
    assert.ok(sosDuration < 3000, `SOS dispatch latency (${sosDuration}ms) exceeded 3000ms SLA`);
    console.log(`  [OK] SOS dispatched to ${sos.dispatchedUnit.name} in ${sosDuration}ms (ETA: ${sos.estimatedEtaMinutes}min)`);

    // ------------------------------------------------------------------
    // Test 3: mcp_simulate_sluice_actuation Station Matching & Pump Balancing
    // ------------------------------------------------------------------
    console.log('\n[TEST 3] Testing mcp_simulate_sluice_actuation...');
    const sluice = await mcpSimulateSluiceActuation({
        drainageBasin: 'GS Road Christian Basti',
        floodZoneLat: 26.1430,
        floodZoneLng: 91.7380,
        waterRiseMmMin: 4.5,
        predictedDepthCm: 35.0
    });

    assert.ok(sluice.selectedStation, 'Selected station must be present');
    assert.ok(sluice.recommendedPumpsActive > 0, 'Pumps active must be > 0');
    assert.strictEqual(sluice.actuationCommand, 'EMERGENCY_DIVERSION', 'Command must be EMERGENCY_DIVERSION for depth >= 30cm');
    assert.strictEqual(sluice.sluiceGateAngleDegrees, 90, 'Gate angle must be 90deg for critical flood');
    console.log(`  [OK] Sluice actuation: station=${sluice.selectedStation.name}, pumps=${sluice.recommendedPumpsActive}/${sluice.totalPumpsAvailable}, angle=${sluice.sluiceGateAngleDegrees}deg`);

    // ------------------------------------------------------------------
    // Test 4: mcp_dispatch_municipal_ticket Escalation & SMS Trigger
    // ------------------------------------------------------------------
    console.log('\n[TEST 4] Testing mcp_dispatch_municipal_ticket...');
    const ticket = await mcpDispatchMunicipalTicket({
        h3HexId: '8c60e58688461ff',
        hazardClass: 'manhole',
        urgency: 3,
        adminNotes: 'Submerged open manhole in Christian Basti - urgent barricading required'
    });

    assert.ok(ticket.ticketId, 'Ticket ID must be generated');
    assert.strictEqual(ticket.status, 'ESCALATED', 'Urgency 3 must escalate status to ESCALATED');
    assert.strictEqual(ticket.smsAlertDispatched, true, 'Urgency 3 must trigger SMS dispatch');
    console.log(`  [OK] Municipal ticket: id=${ticket.ticketId}, status=${ticket.status}, smsDispatched=${ticket.smsAlertDispatched}`);

    // ------------------------------------------------------------------
    // Test 5: Sequential 4-Tool MCP Orchestration on Critical Flood (<10s)
    // ------------------------------------------------------------------
    console.log('\n[TEST 5] Testing autonomous agent cycle with all 4 MCP tools in sequence (<10s benchmark)...');
    const cycleStart = Date.now();
    const cycle = await runAgentCycle(true); // force critical event
    const cycleDuration = Date.now() - cycleStart;

    assert.strictEqual(cycle.criticalEventDetected, true, 'Critical event must be detected');
    assert.strictEqual(cycle.mcpToolsInvoked.length, 4, 'All 4 MCP tools must be invoked');
    assert.deepStrictEqual(
        cycle.mcpToolsInvoked,
        [
            'mcp_simulate_sluice_actuation',
            'mcp_solve_dynamic_routing',
            'mcp_dispatch_municipal_ticket',
            'mcp_broadcast_sdrf_sos'
        ],
        'MCP tools must execute in strict sequence: Sluice -> Routing -> Ticket -> SDRF'
    );
    assert.ok(cycle.toolOutputs?.sluice, 'Sluice output must be recorded');
    assert.ok(cycle.toolOutputs?.routing, 'Routing output must be recorded');
    assert.ok(cycle.toolOutputs?.ticket, 'Ticket output must be recorded');
    assert.ok(cycle.toolOutputs?.sdrf, 'SDRF output must be recorded');
    assert.ok(cycleDuration < 10000, `Total cycle duration (${cycleDuration}ms) exceeded 10s benchmark`);
    console.log(`  [OK] 4-Tool sequential MCP cycle completed in ${cycleDuration}ms (< 10000ms benchmark)`);

    // ------------------------------------------------------------------
    // Test 6: NDMA CAP Feed Parsing & Route Pre-Computation
    // ------------------------------------------------------------------
    console.log('\n[TEST 6] Testing NDMA CAP feed alert parsing & route pre-computation...');
    const mockCapXml = `
    <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>NDMA-CAP-2026-TEST</identifier>
      <info>
        <event>Flood and Heavy Rainfall Warning</event>
        <severity>Severe</severity>
        <area>
          <areaDesc>Kamrup Metropolitan District</areaDesc>
        </area>
      </info>
    </alert>
    `;
    const capAlert = await parseNdmaCapFeed(mockCapXml);
    assert.strictEqual(capAlert.hasActiveAlert, true, 'Kamrup flood CAP alert must be recognized');
    assert.strictEqual(capAlert.severity, 'Severe', 'Severity must be Severe');

    const precompute = await precomputeAllEvacuationCorridors();
    assert.strictEqual(precompute.totalRoutesPrecomputed, 12, 'Must precompute 3 corridors x 4 vehicle classes = 12 routes');
    assert.strictEqual(precompute.vehicleClasses.length, 4, 'Must cover 4 vehicle classes');
    console.log(`  [OK] NDMA Alert triggered precomputation of ${precompute.totalRoutesPrecomputed} routes in ${precompute.precomputeDurationMs}ms`);

    // ------------------------------------------------------------------
    // Test 7: Verify Reasoning Log Integrity in agent.log
    // ------------------------------------------------------------------
    console.log('\n[TEST 7] Verifying agent reasoning log integrity in agent.log...');
    const logPath = path.join(__dirname, '..', 'agent.log');
    assert.ok(fs.existsSync(logPath), 'agent.log must exist');
    const logContent = fs.readFileSync(logPath, 'utf8');
    assert.ok(logContent.includes('[CLINE_AGENT]'), 'agent.log must contain [CLINE_AGENT] tag');
    assert.ok(logContent.includes('INVOKING_MCP_TOOL_1'), 'agent.log must log tool 1 invocation');
    assert.ok(logContent.includes('INVOKING_MCP_TOOL_2'), 'agent.log must log tool 2 invocation');
    assert.ok(logContent.includes('INVOKING_MCP_TOOL_3'), 'agent.log must log tool 3 invocation');
    assert.ok(logContent.includes('INVOKING_MCP_TOOL_4'), 'agent.log must log tool 4 invocation');
    console.log(`  [OK] agent.log verified with autonomous reasoning trace (${logContent.length} bytes)`);

    console.log('\n======================================================================');
    console.log('ALL 7 AUTOMATED UNIT TESTS PASSED WITH 100% SUCCESS');
    console.log('======================================================================');
}

runTestSuite().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
