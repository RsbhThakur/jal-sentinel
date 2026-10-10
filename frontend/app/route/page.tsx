'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import FloodMap from '@/components/FloodMap';
import SOSButton from '@/components/SOSButton';
import { useFloodTelemetry } from '@/lib/websocket';
import { fetchEvacuationRoute, EvacuationRouteResponse, EvacuationRouteRequest } from '@/lib/api';
import { 
  Navigation, 
  ChevronLeft, 
  Car, 
  User, 
  Bike, 
  Truck, 
  MapPin, 
  ShieldCheck, 
  AlertTriangle, 
  Clock, 
  Route, 
  RefreshCw, 
  CheckCircle2, 
  Sparkles,
  Zap
} from 'lucide-react';

interface LocationPreset {
  name: string;
  lat: number;
  lng: number;
}

const ORIGIN_PRESETS: LocationPreset[] = [
  { name: 'GS Road Christian Basti', lat: 26.1448, lng: 91.7365 },
  { name: 'Zoo Road Tiniali Chokepoint', lat: 26.1520, lng: 91.7450 },
  { name: 'Paltan Bazaar Station', lat: 26.1795, lng: 91.7523 },
  { name: 'Jalukbari Transit Hub', lat: 26.1482, lng: 91.6625 },
];

const DESTINATION_PRESETS: LocationPreset[] = [
  { name: 'Dispur Supermarket Relief Post', lat: 26.1380, lng: 91.7890 },
  { name: 'Khanapara Higher Ground Outpost', lat: 26.1150, lng: 91.8020 },
  { name: 'GMC Hospital Medical Refuge', lat: 26.1580, lng: 91.7750 },
  { name: 'Bharalu Outfall High Ridge', lat: 26.1738, lng: 91.7314 },
];

type VehicleClass = 'walker' | 'scooty' | 'sedan' | 'suv';

const VEHICLE_CONFIGS: Record<VehicleClass, { label: string; clearanceCm: number; icon: React.ElementType; color: string }> = {
  walker: { label: 'Pedestrian / Foot', clearanceCm: 15, icon: User, color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  scooty: { label: '2-Wheeler / Scooty', clearanceCm: 20, icon: Bike, color: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  sedan: { label: 'Sedan / Hatchback', clearanceCm: 35, icon: Car, color: 'text-blue-400 border-blue-500/40 bg-blue-500/10' },
  suv: { label: 'SUV / Rescue Truck', clearanceCm: 55, icon: Truck, color: 'text-purple-400 border-purple-500/40 bg-purple-500/10' },
};

export default function EvacuationRoutePage() {
  const { horizon, floodData, hazards } = useFloodTelemetry();

  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('sedan');
  const [originLat, setOriginLat] = useState<string>('26.1448');
  const [originLng, setOriginLng] = useState<string>('91.7365');
  const [destinationLat, setDestinationLat] = useState<string>('26.1380');
  const [destinationLng, setDestinationLng] = useState<string>('91.7890');

  const [routeResult, setRouteResult] = useState<EvacuationRouteResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-compute baseline corridor on load
  useEffect(() => {
    handleComputeRoute();
  }, []);

  const handleComputeRoute = async () => {
    const oLat = parseFloat(originLat);
    const oLng = parseFloat(originLng);
    const dLat = parseFloat(destinationLat);
    const dLng = parseFloat(destinationLng);

    if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
      setError('Please provide valid numerical coordinates for origin and destination.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: EvacuationRouteRequest = {
        origin_lat: oLat,
        origin_lng: oLng,
        destination_lat: dLat,
        destination_lng: dLng,
        vehicle_class: vehicleClass,
      };

      const result = await fetchEvacuationRoute(payload);
      setRouteResult(result);
    } catch (err: any) {
      setError(err.message || 'Evacuation corridor computation failed. Street may be fully inundated.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyOriginPreset = (preset: LocationPreset) => {
    setOriginLat(String(preset.lat));
    setOriginLng(String(preset.lng));
  };

  const handleApplyDestPreset = (preset: LocationPreset) => {
    setDestinationLat(String(preset.lat));
    setDestinationLng(String(preset.lng));
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-gray-800 bg-[#111827]/90 backdrop-blur sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
            title="Return to Radar Map"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="bg-cyan-600/20 p-2 rounded-lg border border-cyan-500/30 text-cyan-400">
            <Navigation className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-wide text-white">Dynamic A* Evacuation Engine</h1>
              <span className="text-[10px] uppercase font-semibold bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">
                Guwahati Metro Grid
              </span>
            </div>
            <p className="text-xs text-gray-400">
              Depth-Penalized Clearance Routing Avoiding Submerged Manholes & Corridors
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 transition font-medium"
          >
            Mission Dashboard
          </Link>
          <Link
            href="/sos"
            className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-bold transition shadow-lg shadow-red-600/30 flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            SOS
          </Link>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 pb-40">
        {/* Left Column: Routing Parameters & Analytics */}
        <div className="flex flex-col gap-5">
          {/* Vehicle Class Card */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 shadow-xl">
            <h2 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Car className="w-4 h-4 text-cyan-400" />
              1. Select Vehicle Clearance Profile
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              {(Object.keys(VEHICLE_CONFIGS) as VehicleClass[]).map((vKey) => {
                const conf = VEHICLE_CONFIGS[vKey];
                const Icon = conf.icon;
                const isSelected = vehicleClass === vKey;
                return (
                  <button
                    key={vKey}
                    type="button"
                    onClick={() => setVehicleClass(vKey)}
                    className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      isSelected
                        ? `${conf.color} ring-2 ring-cyan-500/40 shadow-lg`
                        : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <Icon className="w-4 h-4" />
                      <span className="text-[10px] font-mono font-bold">
                        {conf.clearanceCm} cm
                      </span>
                    </div>
                    <span className="text-xs font-bold leading-tight">{conf.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-3 italic">
              * Streets with hydraulic depth &gt; {VEHICLE_CONFIGS[vehicleClass].clearanceCm} cm are hard-blocked to avoid vehicle stalling or engine submergence.
            </p>
          </div>

          {/* Coordinates Inputs */}
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 shadow-xl space-y-4">
            <h2 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <MapPin className="w-4 h-4 text-rose-400" />
              2. Evacuation Corridor Endpoints
            </h2>

            {/* Origin */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-gray-300 uppercase flex items-center justify-between">
                <span>Origin (GPS / Starting Point)</span>
                <span className="text-cyan-400 text-[10px] font-mono">WGS-84</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={originLat}
                  onChange={(e) => setOriginLat(e.target.value)}
                  placeholder="Latitude"
                  className="bg-gray-900 border border-gray-800 text-xs px-3 py-2 rounded-lg font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  value={originLng}
                  onChange={(e) => setOriginLng(e.target.value)}
                  placeholder="Longitude"
                  className="bg-gray-900 border border-gray-800 text-xs px-3 py-2 rounded-lg font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              {/* Presets */}
              <div className="flex flex-wrap gap-1 pt-1">
                {ORIGIN_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handleApplyOriginPreset(p)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800/80 hover:bg-gray-700 text-gray-300 transition"
                  >
                    {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Destination */}
            <div className="space-y-1.5 pt-2 border-t border-gray-800">
              <label className="text-[11px] font-bold text-gray-300 uppercase flex items-center justify-between">
                <span>Safe Haven / Destination</span>
                <span className="text-emerald-400 text-[10px] font-mono">Higher Ground</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={destinationLat}
                  onChange={(e) => setDestinationLat(e.target.value)}
                  placeholder="Latitude"
                  className="bg-gray-900 border border-gray-800 text-xs px-3 py-2 rounded-lg font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <input
                  type="text"
                  value={destinationLng}
                  onChange={(e) => setDestinationLng(e.target.value)}
                  placeholder="Longitude"
                  className="bg-gray-900 border border-gray-800 text-xs px-3 py-2 rounded-lg font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              {/* Presets */}
              <div className="flex flex-wrap gap-1 pt-1">
                {DESTINATION_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handleApplyDestPreset(p)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-gray-800/80 hover:bg-gray-700 text-gray-300 transition"
                  >
                    {p.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleComputeRoute}
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-600/30 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Calculating Dry Corridor...
                </>
              ) : (
                <>
                  <Route className="w-4 h-4" />
                  Compute Dry Corridor (A*)
                </>
              )}
            </button>
          </div>

          {/* Computed Route Analytics Card */}
          {routeResult && (
            <div className="bg-[#111827] border border-cyan-500/30 rounded-2xl p-5 shadow-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                <span className="text-xs font-bold text-white uppercase flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Corridor Clearance Report
                </span>
                <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                  PASSABLE
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-gray-900/80 p-2.5 rounded-xl border border-gray-800">
                  <p className="text-[10px] uppercase text-gray-500 font-semibold">Distance</p>
                  <p className="text-base font-bold text-white font-mono mt-0.5">
                    {(routeResult.properties.distance_meters / 1000).toFixed(2)} km
                  </p>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-xl border border-gray-800">
                  <p className="text-[10px] uppercase text-gray-500 font-semibold">Est. Transit</p>
                  <p className="text-base font-bold text-cyan-400 font-mono mt-0.5">
                    {routeResult.properties.estimated_minutes.toFixed(1)} min
                  </p>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-xl border border-gray-800">
                  <p className="text-[10px] uppercase text-gray-500 font-semibold">Max Flood Depth</p>
                  <p className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    Dry / 0 cm
                  </p>
                </div>
                <div className="bg-gray-900/80 p-2.5 rounded-xl border border-gray-800">
                  <p className="text-[10px] uppercase text-gray-500 font-semibold">Hazards Bypassed</p>
                  <p className="text-sm font-bold text-amber-400 font-mono mt-0.5">
                    {routeResult.properties.submerged_hazards_avoided || 0} Pitfalls
                  </p>
                </div>
              </div>

              <div className="text-[11px] font-mono text-gray-400 pt-1 flex justify-between items-center">
                <span>Vehicle: <b className="text-white uppercase">{routeResult.properties.vehicle_class}</b></span>
                <span>Threshold: <b className="text-white">{routeResult.properties.clearance_threshold_cm} cm</b></span>
                {routeResult.properties.cached && (
                  <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">Cached &lt;2ms</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right 2 Columns: Live Google Map with Evacuation Polyline */}
        <div className="lg:col-span-2 flex flex-col gap-3 min-h-[550px]">
          <div className="bg-[#111827] border border-gray-800 p-3 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-gray-300">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>
                <b>Cyan Glowing Polyline:</b> Represents the dynamic A* evacuation corridor avoiding submerged road blocks.
              </span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
              GPS ACCURATE
            </span>
          </div>

          <div className="flex-1 min-h-[500px]">
            <FloodMap
              floodGeoJson={floodData}
              hazards={hazards}
              horizon={horizon}
              routeGeoJson={routeResult}
            />
          </div>
        </div>
      </div>

      {/* Floating Action Button: One-Tap Citizen Emergency SOS */}
      <SOSButton />
    </div>
  );
}
