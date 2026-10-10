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
  routeGeoJson?: any | null;
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

// High-tech dark style for Google Maps basemap matching JAL-SENTINEL dark aesthetic
const darkGoogleMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#38bdf8" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#94a3b8" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#334155" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#cbd5e1" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#1e3a8a" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#60a5fa" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#1e293b" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#082f49" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#38bdf8" }],
  },
];

export default function FloodMap({
  floodGeoJson,
  hazards = [],
  horizon = 'T+15',
  onSelectHazard,
  routeGeoJson
}: FloodMapProps) {
  const googleMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const routePolylineRef = useRef<any>(null);
  const activeInfoWindowRef = useRef<any>(null);

  const [googleMapsLoaded, setGoogleMapsLoaded] = useState<boolean>(false);
  const [mapMode, setMapMode] = useState<'dark' | 'satellite'>('dark');
  const [zoomLevel, setZoomLevel] = useState<number>(14);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [hoveredPolygon, setHoveredPolygon] = useState<FloodPolygonFeature | null>(null);

  const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  // Toggle between high-contrast dark vector grid and real Google satellite imagery
  const toggleMapMode = (mode: 'dark' | 'satellite') => {
    setMapMode(mode);
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    if (mode === 'satellite') {
      map.setMapTypeId(window.google.maps.MapTypeId.HYBRID);
      map.setOptions({ styles: [] });
    } else {
      map.setMapTypeId(window.google.maps.MapTypeId.ROADMAP);
      map.setOptions({ styles: darkGoogleMapStyles });
    }
  };

  // 1. Load Google Maps Script
  useEffect(() => {
    if (!googleApiKey || googleApiKey.includes('MOCK')) {
      return;
    }

    if (typeof window !== 'undefined' && window.google?.maps) {
      setGoogleMapsLoaded(true);
      return;
    }

    // Check if script element already exists
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setGoogleMapsLoaded(true));
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

  // 2. Initialize Real Google Map Instance
  useEffect(() => {
    if (!googleMapsLoaded || !googleMapRef.current || !window.google?.maps) return;

    if (!mapInstanceRef.current) {
      const map = new window.google.maps.Map(googleMapRef.current, {
        center: { lat: GUWAHATI_LAT, lng: GUWAHATI_LNG },
        zoom: zoomLevel,
        styles: darkGoogleMapStyles,
        disableDefaultUI: true, // Disables clashing default controls (white Map/Satellite box, pegman, etc.)
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      map.addListener('zoom_changed', () => {
        setZoomLevel(map.getZoom() || 14);
      });

      mapInstanceRef.current = map;
    }
  }, [googleMapsLoaded]);

  // 3. Filter hazards
  const filteredHazards = useMemo(() => {
    if (activeFilter === 'all') return hazards;
    if (activeFilter === 'submerged') return hazards.filter((h) => h.submerged);
    return hazards.filter((h) => h.hazard_class === activeFilter);
  }, [hazards, activeFilter]);

  // 4. Update Google Maps Polygons when floodGeoJson changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous polygons
    polygonsRef.current.forEach((p) => p.setMap(null));
    polygonsRef.current = [];

    if (!floodGeoJson?.features) return;

    floodGeoJson.features.forEach((feature) => {
      const coords = feature.geometry.coordinates[0];
      if (!coords || !coords.length) return;

      const path = coords.map(([lng, lat]) => ({ lat, lng }));
      const depth = feature.properties.depth_cm;
      const color = getChoroplethColor(depth);

      const polygon = new window.google.maps.Polygon({
        paths: path,
        strokeColor: color.stroke,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: color.fill,
        fillOpacity: color.opacity,
        map,
        zIndex: 10,
      });

      polygon.addListener('mouseover', () => {
        setHoveredPolygon(feature);
        polygon.setOptions({ strokeColor: '#FFFFFF', strokeWeight: 3 });
      });

      polygon.addListener('mouseout', () => {
        setHoveredPolygon(null);
        polygon.setOptions({ strokeColor: color.stroke, strokeWeight: 2 });
      });

      polygonsRef.current.push(polygon);
    });
  }, [floodGeoJson, googleMapsLoaded]);

  // 5. Update Google Maps Route Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    if (routePolylineRef.current) {
      routePolylineRef.current.setMap(null);
      routePolylineRef.current = null;
    }

    if (routeGeoJson?.geometry?.coordinates) {
      const path = routeGeoJson.geometry.coordinates.map(([lng, lat]: [number, number]) => ({
        lat,
        lng,
      }));

      const polyline = new window.google.maps.Polyline({
        path,
        strokeColor: '#00E5FF',
        strokeOpacity: 0.95,
        strokeWeight: 5,
        map,
        zIndex: 25,
      });

      routePolylineRef.current = polyline;
    }
  }, [routeGeoJson, googleMapsLoaded]);

  // 6. Update Google Maps Markers for Hazard Pins
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    filteredHazards.forEach((hazard) => {
      const isSub = Boolean(hazard.submerged);
      const pinColor = isSub ? '#EF4444' : hazard.hazard_class === 'live_wire' ? '#F59E0B' : '#F97316';

      const marker = new window.google.maps.Marker({
        position: { lat: hazard.lat, lng: hazard.lng },
        map,
        title: `${hazard.hazard_class.toUpperCase()} ${isSub ? '(SUBMERGED)' : ''}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          fillColor: pinColor,
          fillOpacity: 1.0,
          strokeColor: '#FFFFFF',
          strokeWeight: 2.5,
          scale: isSub ? 10 : 8,
        },
        zIndex: 30,
      });

      const infoContent = `
        <div style="color: #0f172a; font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; min-width: 180px;">
          <div style="font-weight: 700; color: ${pinColor}; font-size: 13px; text-transform: uppercase;">
            ${hazard.hazard_class.replace('_', ' ')} ${isSub ? '⚠️ SUBMERGED' : ''}
          </div>
          <div style="margin-top: 4px; font-size: 11px; color: #475569; line-height: 1.4;">
            Confidence: <b>${(hazard.confidence_score * 100).toFixed(0)}%</b><br/>
            ${hazard.depth_cm !== undefined ? `Depth: <b>${hazard.depth_cm} cm</b><br/>` : ''}
            H3: <code style="font-size: 10px; background: #e2e8f0; padding: 1px 3px; border-radius: 2px;">${hazard.h3_hex_id}</code>
          </div>
          ${hazard.notes ? `<div style="margin-top: 5px; font-style: italic; color: #334155; font-size: 11px;">"${hazard.notes}"</div>` : ''}
        </div>
      `;

      const infoWindow = new window.google.maps.InfoWindow({
        content: infoContent,
      });

      marker.addListener('click', () => {
        activeInfoWindowRef.current?.close();
        infoWindow.open(map, marker);
        activeInfoWindowRef.current = infoWindow;
        onSelectHazard?.(hazard);
      });

      markersRef.current.push(marker);
    });
  }, [filteredHazards, googleMapsLoaded, onSelectHazard]);

  // Synchronize external zoom triggers
  const handleZoom = (delta: number) => {
    const newZoom = Math.min(18, Math.max(10, zoomLevel + delta));
    setZoomLevel(newZoom);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setZoom(newZoom);
    }
  };

  // Fallback SVG projector coordinates (used only when Google Maps is not loaded)
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
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none gap-2">
        {/* Layer & Mode Indicator + Satellite Toggle */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 bg-[#111827]/90 backdrop-blur border border-gray-800 px-3 py-1.5 rounded-lg shadow-lg">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-gray-200">Digital Twin Flood Radar</span>
            <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
              {googleMapsLoaded ? 'GOOGLE MAPS JS API' : 'OFFICIAL HYDRAULIC GIS'}
            </span>
          </div>

          {googleMapsLoaded && (
            <div className="flex items-center bg-[#111827]/90 backdrop-blur border border-gray-800 p-0.5 rounded-lg shadow-lg">
              <button
                onClick={() => toggleMapMode('dark')}
                className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition ${
                  mapMode === 'dark'
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                }`}
              >
                Dark Grid
              </button>
              <button
                onClick={() => toggleMapMode('satellite')}
                className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition ${
                  mapMode === 'satellite'
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                }`}
              >
                Satellite
              </button>
            </div>
          )}
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

      {/* Zoom Controls */}
      <div className="absolute bottom-9 right-3 z-30 flex flex-col gap-1 pointer-events-auto">
        <button 
          onClick={() => handleZoom(1)}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 shadow transition"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button 
          onClick={() => handleZoom(-1)}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 shadow transition"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Primary Visual Surface: Real Google Map Mount */}
      <div className="relative flex-1 w-full h-full overflow-hidden select-none bg-[#090D16]">
        {/* Real Google Maps DIV */}
        <div 
          ref={googleMapRef}
          className={`w-full h-full absolute inset-0 ${googleMapsLoaded ? 'block' : 'hidden'}`}
        />

        {/* Resilient Fallback SVG Canvas (Rendered only when Google Maps is not loaded) */}
        {!googleMapsLoaded && (
          <div className="w-full h-full relative">
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

              {/* Bharalu River Curve */}
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

            {/* Dynamic Inundation Polygons Overlay for Fallback */}
            <svg className="w-full h-full absolute inset-0 pointer-events-auto" viewBox="0 0 100 100" preserveAspectRatio="none">
              {floodGeoJson?.features?.map((poly) => {
                const depth = poly.properties.depth_cm;
                const style = getChoroplethColor(depth);
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

              {/* Fallback A* Evacuation Route Polyline */}
              {routeGeoJson?.geometry?.coordinates && (
                <polyline
                  points={routeGeoJson.geometry.coordinates
                    .map(([lng, lat]: [number, number]) => {
                      const p = projectCoordinates(lat, lng);
                      return `${p.x},${p.y}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="3 1.5"
                  className="filter drop-shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse"
                />
              )}
            </svg>

            {/* Fallback Hazard Pins Overlay */}
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
          </div>
        )}

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
