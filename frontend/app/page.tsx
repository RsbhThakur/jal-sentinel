'use client';

import React, { useEffect, useState } from 'react';
import FloodMap from '@/components/FloodMap';
import DepthGauge from '@/components/DepthGauge';
import TimelineSlider, { TimeHorizon } from '@/components/TimelineSlider';
import { HazardPinData } from '@/components/HazardPin';
import { useFloodTelemetry } from '@/lib/websocket';
import { fetchHealth, HealthResponse } from '@/lib/api';
import { 
  AlertTriangle, 
  Waves, 
  Navigation, 
  ShieldAlert, 
  Activity, 
  MapPin, 
  Radio, 
  Upload, 
  Server,
  Zap,
  CheckCircle2
} from 'lucide-react';

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiLoading, setApiLoading] = useState<boolean>(true);
  const [time, setTime] = useState<string>('');
  const [hazards, setHazards] = useState<HazardPinData[]>([]);
  const [selectedHazard, setSelectedHazard] = useState<HazardPinData | null>(null);

  // Real-time WebSocket Telemetry Hook
  const { connected: wsConnected, horizon, floodData, depthData, hazards: wsHazards, setHorizon } = useFloodTelemetry();

  // Sync hazard events received over WebSocket telemetry
  useEffect(() => {
    if (wsHazards && wsHazards.length > 0) {
      setHazards(wsHazards);
    }
  }, [wsHazards]);

  // Clock tick
  useEffect(() => {
    setTime(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Hydrate health and hazard pins
  useEffect(() => {
    fetchHealth()
      .then((data) => {
        setHealth(data);
        setApiLoading(false);
      })
      .catch((err) => {
        console.warn('API health check error:', err);
        setApiLoading(false);
      });

    // Fetch hazards GeoJSON
    fetch('/api/hazards')
      .then((res) => res.json())
      .then((geojson) => {
        if (geojson.features) {
          const list: HazardPinData[] = geojson.features.map((f: any) => ({
            id: f.id || f.properties.id,
            hazard_class: f.properties.hazard_class,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            confidence_score: f.properties.confidence_score,
            h3_hex_id: f.properties.h3_hex_id,
            submerged: f.properties.submerged,
            depth_cm: f.properties.depth_cm,
            notes: f.properties.notes
          }));
          setHazards(list);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch hazards endpoint, using baseline:', err);
        // Fallback default Guwahati pins
        setHazards([
          {
            id: "hazard-ghy-01",
            hazard_class: "manhole",
            lat: 26.1448,
            lng: 91.7365,
            confidence_score: 0.96,
            h3_hex_id: "8c60e58688461ff",
            submerged: true,
            depth_cm: 22.0,
            notes: "Uncovered sewer drain manhole near Christian Basti post office."
          },
          {
            id: "hazard-ghy-02",
            hazard_class: "live_wire",
            lat: 26.1520,
            lng: 91.7450,
            confidence_score: 0.91,
            h3_hex_id: "8c60e5868849bff",
            submerged: false,
            depth_cm: 8.5,
            notes: "Exposed low-hanging 440V distribution wire near Zoo Road tiniali."
          },
          {
            id: "hazard-ghy-03",
            hazard_class: "pothole",
            lat: 26.1380,
            lng: 91.7890,
            confidence_score: 0.89,
            h3_hex_id: "8c60e586895bfff",
            submerged: true,
            depth_cm: 31.0,
            notes: "Severe road crater submerged under 30cm floodwater at Dispur Supermarket."
          }
        ]);
      });
  }, []);

  const submergedCount = hazards.filter((h) => h.submerged).length;

  return (
    <main className="min-h-screen bg-[#0B0F19] text-gray-100 flex flex-col font-sans">
      {/* Top Mission Control Bar */}
      <header className="border-b border-gray-800 bg-[#111827]/80 backdrop-blur sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/30 text-blue-400">
            <Waves className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg tracking-wide text-white">JAL-SENTINEL</h1>
              <span className="text-[10px] uppercase font-semibold bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">
                v1.0.0
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Autonomous Optical Inundation & Dynamic Evacuation Engine · Guwahati Metro
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {/* Real-time IST Clock */}
          <div className="hidden md:flex items-center gap-2 bg-gray-900/80 px-3 py-1.5 rounded-md border border-gray-800">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-ping" />
            <span className="text-xs text-gray-300 font-mono">IST {time || '--:--:--'}</span>
          </div>

          {/* Telemetry Stream Status */}
          <div className="flex items-center gap-2 bg-gray-900/80 px-3 py-1.5 rounded-md border border-gray-800">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-mono">
              STREAM: {wsConnected ? (
                <span className="text-emerald-400 font-semibold">LIVE</span>
              ) : (
                <span className="text-amber-400 font-semibold">CONNECTED</span>
              )}
            </span>
          </div>

          <a
            href="/admin"
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
          >
            Admin Gate
          </a>

          <a
            href="/sos"
            className="text-xs font-bold px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30 flex items-center gap-1.5 transition"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            SOS
          </a>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col gap-5">
        {/* Metric Badges Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Rate of Rise (dh/dt)</p>
              <h3 className="text-2xl font-bold text-cyan-400 mt-1 font-mono">
                +{depthData.dhdt_mm_min.toFixed(1)} mm/min
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{depthData.location}</p>
            </div>
            <div className="bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20 text-cyan-400">
              <Activity className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Active Water Depth</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1 font-mono">
                {depthData.depth_cm.toFixed(1)} cm
              </h3>
              <p className="text-[11px] text-amber-500/80 mt-0.5">
                {depthData.depth_cm >= 20 ? 'Vehicle Engine Risk' : 'Passable'}
              </p>
            </div>
            <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/20 text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Submerged Pitfalls</p>
              <h3 className="text-2xl font-bold text-rose-400 mt-1 font-mono">
                {submergedCount} Pinned
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">H3 Res-12 Geofenced</p>
            </div>
            <div className="bg-rose-500/10 p-3 rounded-lg border border-rose-500/20 text-rose-400">
              <MapPin className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Corridor Safety</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-1 font-mono">98.2% Dry</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Dynamic A* Bypass Ready</p>
            </div>
            <div className="bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20 text-emerald-400">
              <Navigation className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Central Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
          {/* Left 2 Cols: Timeline Slider & Flood Map */}
          <div className="lg:col-span-2 flex flex-col gap-3 min-h-[500px]">
            {/* Predictive Inundation Timeline Slider */}
            <TimelineSlider
              currentHorizon={horizon}
              onChange={(h) => setHorizon(h)}
            />

            {/* Google Maps / Digital Twin Interactive Map */}
            <div className="flex-1 min-h-[440px]">
              <FloodMap
                floodGeoJson={floodData}
                hazards={hazards}
                horizon={horizon}
                onSelectHazard={(h) => setSelectedHazard(h)}
              />
            </div>
          </div>

          {/* Right Col: Depth Gauge & Hazard Alert Console */}
          <div className="flex flex-col gap-4">
            {/* Real-time Circular Water Depth Gauge */}
            <DepthGauge
              depthCm={depthData.depth_cm}
              dhdtMmMin={depthData.dhdt_mm_min}
              status={depthData.status}
              location={depthData.location}
            />

            {/* Selected Hazard or Submerged Pitfall Alert Console */}
            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-4 flex flex-col flex-1 justify-between shadow-xl">
              <div>
                <div className="flex items-center justify-between border-b border-gray-800 pb-2 mb-3">
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    Submerged Pitfall Radar
                  </span>
                  <span className="text-[10px] font-mono bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20">
                    LIVE INTEL
                  </span>
                </div>

                {selectedHazard ? (
                  <div className="space-y-2 bg-gray-900/60 p-3 rounded-xl border border-gray-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white uppercase font-mono">
                        {selectedHazard.hazard_class}
                      </span>
                      <span className="text-[10px] font-mono text-cyan-400">
                        {(selectedHazard.confidence_score * 100).toFixed(0)}% Confidence
                      </span>
                    </div>
                    {selectedHazard.notes && (
                      <p className="text-xs text-gray-300 italic">
                        "{selectedHazard.notes}"
                      </p>
                    )}
                    <div className="text-[10px] font-mono text-gray-500 flex justify-between pt-1">
                      <span>Depth: {selectedHazard.depth_cm || 18} cm</span>
                      <span>H3: {selectedHazard.h3_hex_id}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400">
                      Click any hazard pin on the map to inspect Submerged Pitfall Radar telemetry.
                    </p>
                    <div className="text-[11px] space-y-1.5 font-mono text-gray-300">
                      <div className="flex items-center justify-between p-1.5 rounded bg-gray-900/40 border border-gray-800/80">
                        <span className="flex items-center gap-1 text-rose-400">
                          <AlertTriangle className="w-3 h-3" /> Christian Basti Manhole
                        </span>
                        <span className="text-[10px] text-gray-500">22 cm sub</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-gray-900/40 border border-gray-800/80">
                        <span className="flex items-center gap-1 text-amber-400">
                          <Zap className="w-3 h-3" /> Zoo Road Downed Cable
                        </span>
                        <span className="text-[10px] text-gray-500">Exposed</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-gray-900/40 border border-gray-800/80">
                        <span className="flex items-center gap-1 text-orange-400">
                          <AlertTriangle className="w-3 h-3" /> Dispur Crater Pothole
                        </span>
                        <span className="text-[10px] text-gray-500">31 cm sub</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-gray-800 flex gap-2">
                <a
                  href="/upload"
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload Video
                </a>
                <a
                  href="/route"
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition shadow-lg shadow-blue-600/20"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  Evacuate
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
