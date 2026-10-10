'use client';

import React, { useEffect, useState } from 'react';
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
  Server
} from 'lucide-react';

export default function HomePage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    setTime(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }));
    }, 1000);

    fetchHealth()
      .then((data) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('Backend not currently reachable via proxy:', err);
        setLoading(false);
      });

    return () => clearInterval(timer);
  }, []);

  return (
    <main className="min-h-screen bg-[#0B0F19] text-gray-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-gray-800 bg-[#111827]/80 backdrop-blur sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
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
              Autonomous Optical Inundation & Dynamic Corridor Engine · Guwahati Focus
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="hidden md:flex items-center gap-2 bg-gray-900/80 px-3 py-1.5 rounded-md border border-gray-800">
            <Radio className="w-4 h-4 text-emerald-400 animate-ping" />
            <span className="text-xs text-gray-300 font-mono">IST {time || '--:--:--'}</span>
          </div>

          <div className="flex items-center gap-2 bg-gray-900/80 px-3 py-1.5 rounded-md border border-gray-800">
            <Server className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-mono">
              API: {loading ? 'Checking...' : health?.status === 'ok' ? (
                <span className="text-emerald-400 font-semibold">ONLINE</span>
              ) : (
                <span className="text-amber-400 font-semibold">STANDALONE</span>
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

      {/* Main Content Layout */}
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col gap-6">
        {/* Metric Badges Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Rate of Rise (dh/dt)</p>
              <h3 className="text-2xl font-bold text-cyan-400 mt-1 font-mono">+2.4 mm/min</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Bharalu Canal Culvert #4</p>
            </div>
            <div className="bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20 text-cyan-400">
              <Activity className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Predicted Surge (T+30)</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1 font-mono">18.5 cm</h3>
              <p className="text-[11px] text-amber-500/80 mt-0.5">Sedan Clearance Alert</p>
            </div>
            <div className="bg-amber-500/10 p-3 rounded-lg border border-amber-500/20 text-amber-400">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-[#111827] border border-gray-800 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-gray-400 font-medium">Submerged Pitfalls</p>
              <h3 className="text-2xl font-bold text-rose-400 mt-1 font-mono">12 Pinned</h3>
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
          {/* Left 2 Cols: Google Maps Digital Twin Container */}
          <div className="lg:col-span-2 bg-[#111827] border border-gray-800 rounded-2xl flex flex-col overflow-hidden min-h-[460px]">
            <div className="border-b border-gray-800 px-5 py-3.5 flex items-center justify-between bg-gray-900/40">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-gray-200">
                  Guwahati Metropolitan Digital Twin (Google Maps Overlay)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Timeline:</span>
                <div className="flex gap-1 text-[11px] font-mono">
                  <button className="px-2 py-0.5 rounded bg-blue-600 text-white font-medium">T+0</button>
                  <button className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">T+15</button>
                  <button className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">T+30</button>
                  <button className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">T+60</button>
                </div>
              </div>
            </div>

            {/* Map Placeholder View */}
            <div className="flex-1 relative flex items-center justify-center bg-gradient-to-br from-[#0c1322] to-[#070b14] p-8 text-center">
              <div className="max-w-md">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-4">
                  <Waves className="w-8 h-8 animate-bounce" />
                </div>
                <h3 className="text-base font-semibold text-white">Google Maps Digital Twin Ready</h3>
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                  Basemap scaffolding initialized for GS Road, Zoo Road, and Bharalu Drainage Basin.
                  GeoJSON flood layers, pitfall radar markers, and dynamic corridor rendering configured for Sprint 1 (Issue #2).
                </p>
                <div className="mt-5 inline-flex items-center gap-2 text-xs font-mono bg-gray-900/80 px-3 py-1.5 rounded-md border border-gray-800 text-gray-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Lat: 26.1445° N · Lng: 91.7362° E · Zoom: 14x
                </div>
              </div>
            </div>
          </div>

          {/* Right Col: Optical Telemetry & Action Panel */}
          <div className="flex flex-col gap-6">
            {/* Edge Vision Simulation Card */}
            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-gray-200">Gauge-Free Waterline Feed</h3>
                </div>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded font-mono">
                  LIVE CV
                </span>
              </div>

              <div className="aspect-video bg-black rounded-lg border border-gray-800 relative overflow-hidden flex items-center justify-center text-center p-4">
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/30 to-transparent pointer-events-none"></div>
                <div>
                  <p className="text-xs text-cyan-300 font-mono font-medium">CAM-04 · Christian Basti Junction</p>
                  <p className="text-[11px] text-gray-400 mt-1">Homography Matrix H⁻¹ Synchronized</p>
                  <div className="mt-3 text-xs bg-gray-900/90 border border-gray-700/60 rounded px-2.5 py-1 font-mono text-gray-200">
                    Depth: <span className="text-cyan-400 font-bold">14.2 cm</span> · Rise: <span className="text-amber-400 font-bold">+2.4 mm/min</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
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
                  Find Safe Route
                </a>
              </div>
            </div>

            {/* Architecture Integration Status */}
            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 flex flex-col justify-between flex-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Sprint 0 Architecture Readiness</h3>
                <ul className="text-xs text-gray-400 space-y-2.5">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span><strong>Next.js 14 App Router:</strong> Scaffolding & Tailwind Ready</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span><strong>FastAPI Python 3.11:</strong> SQLAlchemy Models & Tests Passing</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span><strong>PostgreSQL & H3 Ledger:</strong> Res-12 Geofencing Verified</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span><strong>@cline/sdk Agent Loop:</strong> 4 MCP Tool Contracts Initialized</span>
                  </li>
                </ul>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-800/80 text-[11px] text-gray-500">
                Cline AI Builders Hackathon 2026 · IIT Guwahati
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
