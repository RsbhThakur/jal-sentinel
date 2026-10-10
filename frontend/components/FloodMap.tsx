'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import HazardPin, { HazardPinData } from './HazardPin';
import { FloodGeoJson, FloodPolygonFeature } from '@/lib/websocket';
import { 
  Layers, 
  Eye, 
  MapPin, 
  Navigation, 
  Compass, 
  ZoomIn, 
  ZoomOut,
  Maximize2
} from 'lucide-react';

declare global {
  interface Window {
    google?: any;
  }
}

interface FloodMapProps {
  floodGeoJson?: FloodGeoJson | null;
  hazards?: HazardPinData[];
  horizon?: 'T+0' | 'T+15' | 'T+30' | 'T+60';
  onSelectHazard?: (hazard: HazardPinData) => void;
}

// Guwahati Center Coordinates
const GUWAHATI_LAT = 26.1445;
const GUWAHATI_LNG = 91.7362;

// Choropleth Color Derivation based on Manning depth
export function getChoroplethColor(depthCm: number): { fill: string; stroke: string; opacity: number } {
  if (depthCm >= 30) {
    return { fill: '#EF4444', stroke: '#DC2626', opacity: 0.70 }; // Red
  } else if (depthCm >= 10) {
    return { fill: '#FB923C', stroke: '#F97316', opacity: 0.55 }; // Orange
  } else {
    return { fill: '#FACC15', stroke: '#EAB308', opacity: 0.40 }; // Yellow
  }
}

export default function FloodMap({
  floodGeoJson,
  hazards = [],
  horizon = 'T+15',
  onSelectHazard
}: FloodMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(14);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [hoveredPolygon, setHoveredPolygon] = useState<FloodPolygonFeature | null>(null);

  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  // Check if Google Maps Script is already loaded or load dynamically
  useEffect(() => {
    if (!googleApiKey || googleApiKey.includes('MOCK')) {
      // Use resilient digital twin radar fallback
      return;
    }

    if (typeof window !== 'undefined' && (window as any).google && (window as any).google.maps) {
      setGoogleMapsLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleMapsLoaded(true);
    script.onerror = () => {
      console.warn('Google Maps script failed to load. Falling back to local Digital Twin layer.');
    };
    document.head.appendChild(script);
  }, [googleApiKey]);

  // Filter hazards
  const filteredHazards = useMemo(() => {
    if (activeFilter === 'all') return hazards;
    if (activeFilter === 'submerged') return hazards.filter((h) => h.submerged);
    return hazards.filter((h) => h.hazard_class === activeFilter);
  }, [hazards, activeFilter]);

  // Bounding box mapping for SVG Digital Twin radar projection
  // Lat: 26.1300 to 26.1650, Lng: 91.7100 to 91.7900
  const projectCoordinates = (lat: number, lng: number) => {
    const minLat = 26.1300;
    const maxLat = 26.1650;
    const minLng = 91.7150;
    const maxLng = 91.7850;

    const x = ((lng - minLng) / (maxLng - minLng)) * 100;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 100;
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) };
  };

  return (
    <div className="relative w-full h-full min-h-[480px] bg-[#0A0E17] rounded-2xl overflow-hidden flex flex-col border border-gray-800 shadow-2xl">
      {/* Top Map Controls Bar */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Layer & Mode Indicator */}
        <div className="flex items-center gap-2 pointer-events-auto bg-[#111827]/90 backdrop-blur border border-gray-800 px-3 py-1.5 rounded-lg shadow-lg">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-gray-200">Digital Twin Flood Radar</span>
          <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
            {googleMapsLoaded ? 'GOOGLE MAPS JS API' : 'OFFICIAL HYDRAULIC GIS'}
          </span>
        </div>

        {/* Hazard Class Filters */}
        <div className="hidden sm:flex items-center gap-1 bg-[#111827]/90 backdrop-blur border border-gray-800 p-1 rounded-lg pointer-events-auto shadow-lg">
          {['all', 'submerged', 'manhole', 'live_wire', 'pothole'].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition ${
                activeFilter === cat
                  ? 'bg-blue-600 text-white font-bold'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
              }`}
            >
              {cat === 'all' ? 'All Pins' : cat === 'submerged' ? '⚠️ Submerged' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Floating Map Legend */}
      <div className="absolute bottom-3 left-3 z-30 bg-[#111827]/90 backdrop-blur border border-gray-800 p-2.5 rounded-xl shadow-xl flex flex-col gap-1.5 text-[10px] font-mono pointer-events-auto">
        <span className="text-gray-400 font-bold uppercase tracking-wider text-[9px] mb-0.5">
          Inundation Depth Choropleth
        </span>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-2.5 rounded-sm bg-yellow-400/70 border border-yellow-500"></span>
          <span className="text-gray-300">0 – 10 cm (Yellow)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-2.5 rounded-sm bg-orange-500/70 border border-orange-600"></span>
          <span className="text-gray-300">10 – 30 cm (Orange: Engine Risk)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-2.5 rounded-sm bg-red-600/80 border border-red-500"></span>
          <span className="text-gray-300">&gt; 30 cm (Red: Corridor Blocked)</span>
        </div>
      </div>

      {/* Zoom and Navigation Controls */}
      <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-1 pointer-events-auto">
        <button 
          onClick={() => setZoomLevel((z) => Math.min(z + 1, 18))}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 shadow transition"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button 
          onClick={() => setZoomLevel((z) => Math.max(z - 1, 10))}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 shadow transition"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Interactive Map Visual Surface */}
      <div 
        ref={mapContainerRef}
        className="relative flex-1 w-full h-full overflow-hidden select-none bg-[#090D16]"
      >
        {/* SVG Basemap Grid Lines & Guwahati Arterial Roads */}
        <svg className="w-full h-full absolute inset-0 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#172033" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Brahmaputra River Upper Boundary */}
          <path
            d="M 0,12 Q 25,6 50,14 T 100,10 L 100,0 L 0,0 Z"
            fill="#0F243A"
            stroke="#1E3A5F"
            strokeWidth="0.8"
          />

          {/* Bharalu River / Drainage Basin Curve */}
          <path
            d="M 28,14 Q 35,40 45,55 T 60,85"
            fill="none"
            stroke="#0284C7"
            strokeWidth="1.6"
            strokeDasharray="2,1"
          />

          {/* GS Road Arterial Corridor */}
          <path
            d="M 22,78 L 48,56 L 72,42 L 95,35"
            fill="none"
            stroke="#334155"
            strokeWidth="2.2"
          />

          {/* RG Baruah (Zoo) Road Corridor */}
          <path
            d="M 48,56 L 56,32 L 80,24"
            fill="none"
            stroke="#334155"
            strokeWidth="1.8"
          />
        </svg>

        {/* Dynamic Inundation Polygons Overlay */}
        <svg className="w-full h-full absolute inset-0 pointer-events-auto" viewBox="0 0 100 100" preserveAspectRatio="none">
          {floodGeoJson?.features?.map((poly) => {
            const depth = poly.properties.depth_cm;
            const style = getChoroplethColor(depth);
            
            // Map coordinates to SVG polygon points
            const pointsString = poly.geometry.coordinates[0]
              .map(([lng, lat]) => {
                const p = projectCoordinates(lat, lng);
                return `${p.x},${p.y}`;
              })
              .join(' ');

            return (
              <polygon
                key={poly.id}
                points={pointsString}
                fill={style.fill}
                fillOpacity={style.opacity}
                stroke={style.stroke}
                strokeWidth="0.8"
                className="cursor-pointer transition-all duration-700 hover:stroke-white hover:stroke-[1.2]"
                onMouseEnter={() => setHoveredPolygon(poly)}
                onMouseLeave={() => setHoveredPolygon(null)}
              />
            );
          })}
        </svg>

        {/* Hazard Pins & Submerged Pitfall Radar Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          {filteredHazards.map((hazard) => {
            const pos = projectCoordinates(hazard.lat, hazard.lng);
            return (
              <div
                key={hazard.id}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: 'translate(-50%, -100%)'
                }}
                className="absolute pointer-events-auto z-40"
              >
                <HazardPin
                  hazard={hazard}
                  onClick={(h) => onSelectHazard?.(h)}
                />
              </div>
            );
          })}
        </div>

        {/* Hovered Inundation Polygon Tooltip */}
        {hoveredPolygon && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-[#111827]/95 border border-cyan-500/40 rounded-xl px-4 py-2.5 shadow-2xl backdrop-blur text-center pointer-events-none">
            <p className="text-xs font-bold text-white">
              {hoveredPolygon.properties.zone_name}
            </p>
            <div className="flex items-center justify-center gap-3 mt-1 text-[11px] font-mono">
              <span className="text-cyan-400 font-bold">
                Depth: {hoveredPolygon.properties.depth_cm} cm
              </span>
              <span className="text-amber-400">
                Surge: +{hoveredPolygon.properties.surge_velocity_mm_min} mm/min
              </span>
              <span className={hoveredPolygon.properties.clearance_blocked ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                {hoveredPolygon.properties.clearance_blocked ? 'ROAD BLOCKED' : 'PASSABLE'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
