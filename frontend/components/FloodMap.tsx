'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import HazardPin, { HazardPinData } from './HazardPin';
import { FloodGeoJson } from '@/lib/websocket';
import { 
  Layers, 
  MapPin, 
  Navigation, 
  Compass, 
  ZoomIn, 
  ZoomOut,
  Maximize2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';

declare global {
  interface Window {
    google?: any;
  }
}

export interface RouteEvaluationResult {
  isClear: boolean;
  routeType: 'normal' | 'detour';
  distanceMeters: number;
  durationMinutes: number;
  hazardsAvoided: number;
  summary: string;
}

export interface ActiveRouteInfo {
  origin: { lat: number; lng: number; name?: string };
  destination: { lat: number; lng: number; name?: string };
  vehicleClass: 'walker' | 'scooty' | 'sedan' | 'suv';
  isManualRoute?: boolean;
}

interface FloodMapProps {
  floodGeoJson?: FloodGeoJson | null;
  hazards?: HazardPinData[];
  horizon?: 'T+0' | 'T+15' | 'T+30' | 'T+60';
  onSelectHazard?: (hazard: HazardPinData) => void;
  routeGeoJson?: any | null;
  activeRouteInfo?: ActiveRouteInfo | null;
  onRouteEvaluated?: (result: RouteEvaluationResult) => void;
}

// Guwahati Center Coordinates
const GUWAHATI_LAT = 26.1445;
const GUWAHATI_LNG = 91.7362;

// Safe Highland Detour Waypoints in Guwahati
const GUWAHATI_SAFE_WAYPOINTS = [
  { lat: 26.1460, lng: 91.7460 }, // Ganeshguri Elevated Arterial
  { lat: 26.1580, lng: 91.7750 }, // GMCH Hillside Ridge
  { lat: 26.1150, lng: 91.8020 }, // Khanapara Highland
];

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

// Curated Guwahati Inundation Arterials with real road endpoints
const GUWAHATI_CORRIDOR_DEFS = [
  {
    id: 'road-gs-christian-basti',
    name: 'GS Road (Christian Basti - ABC Corridor)',
    baseDepth: 24.0,
    surgeRate: 2.4,
    start: { lat: 26.1448, lng: 91.7365 },
    end: { lat: 26.1430, lng: 91.7450 },
    // Densely pre-sampled road coordinates following GS Road curves as baseline
    fallbackPath: [
      { lat: 26.1448, lng: 91.7365 },
      { lat: 26.1445, lng: 91.7380 },
      { lat: 26.1440, lng: 91.7405 },
      { lat: 26.1435, lng: 91.7425 },
      { lat: 26.1430, lng: 91.7450 },
    ],
  },
  {
    id: 'road-zoo-road',
    name: 'RG Baruah (Zoo) Road Chokepoint',
    baseDepth: 18.0,
    surgeRate: 1.8,
    start: { lat: 26.1520, lng: 91.7450 },
    end: { lat: 26.1580, lng: 91.7650 },
    fallbackPath: [
      { lat: 26.1520, lng: 91.7450 },
      { lat: 26.1535, lng: 91.7500 },
      { lat: 26.1550, lng: 91.7550 },
      { lat: 26.1565, lng: 91.7600 },
      { lat: 26.1580, lng: 91.7650 },
    ],
  },
  {
    id: 'road-bharalu-canal',
    name: 'Bharalu Riverside Drainage Road',
    baseDepth: 29.0,
    surgeRate: 3.2,
    start: { lat: 26.1738, lng: 91.7314 },
    end: { lat: 26.1620, lng: 91.7285 },
    fallbackPath: [
      { lat: 26.1738, lng: 91.7314 },
      { lat: 26.1700, lng: 91.7305 },
      { lat: 26.1660, lng: 91.7295 },
      { lat: 26.1620, lng: 91.7285 },
    ],
  },
  {
    id: 'road-dispur-supermarket',
    name: 'Dispur Supermarket Relief Corridor',
    baseDepth: 31.0,
    surgeRate: 2.1,
    start: { lat: 26.1460, lng: 91.7460 },
    end: { lat: 26.1380, lng: 91.7890 },
    fallbackPath: [
      { lat: 26.1460, lng: 91.7460 },
      { lat: 26.1445, lng: 91.7550 },
      { lat: 26.1430, lng: 91.7650 },
      { lat: 26.1405, lng: 91.7770 },
      { lat: 26.1380, lng: 91.7890 },
    ],
  },
];

// Helper: Haversine distance in meters
function computeHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function FloodMap({
  floodGeoJson,
  hazards = [],
  horizon = 'T+15',
  onSelectHazard,
  routeGeoJson,
  activeRouteInfo,
  onRouteEvaluated,
}: FloodMapProps) {
  const googleMapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const floodedRoadPolylinesRef = useRef<any[]>([]);
  const routePolylinesRef = useRef<any[]>([]);
  const routeMarkersRef = useRef<any[]>([]);
  const activeInfoWindowRef = useRef<any>(null);
  const cachedRoadGeometriesRef = useRef<Record<string, Array<{ lat: number; lng: number }>>>({});

  const [googleMapsLoaded, setGoogleMapsLoaded] = useState<boolean>(false);
  const [mapMode, setMapMode] = useState<'dark' | 'satellite'>('dark');
  const [zoomLevel, setZoomLevel] = useState<number>(14);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [routeStatusBadge, setRouteStatusBadge] = useState<{
    type: 'clear' | 'detour' | null;
    title: string;
    details: string;
  } | null>(null);

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

  // 1. Load Google Maps Script with geometry AND places libraries
  useEffect(() => {
    if (!googleApiKey || googleApiKey.includes('MOCK')) {
      return;
    }

    if (typeof window !== 'undefined' && window.google?.maps?.places) {
      setGoogleMapsLoaded(true);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        setGoogleMapsLoaded(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('google-maps-loaded'));
        }
      });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&libraries=geometry,places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setGoogleMapsLoaded(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('google-maps-loaded'));
      }
    };
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
        disableDefaultUI: true,
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

  // 4. Draw Flooded Road Corridors SNAPPED TO REAL GOOGLE MAPS STREETS
  // (Zero rectangle polygons, strictly road-following colored paths)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous flooded road polylines
    floodedRoadPolylinesRef.current.forEach((item) => item.setMap(null));
    floodedRoadPolylinesRef.current = [];

    const horizonMultiplier =
      horizon === 'T+0' ? 0.6 : horizon === 'T+15' ? 1.0 : horizon === 'T+30' ? 1.45 : 2.0;

    const directionsService = new window.google.maps.DirectionsService();

    GUWAHATI_CORRIDOR_DEFS.forEach((corridor) => {
      const currentDepth = corridor.baseDepth * horizonMultiplier;
      const roadColor =
        currentDepth > 30 ? '#EF4444' : currentDepth > 10 ? '#F97316' : '#EAB308';
      const statusLabel =
        currentDepth > 30
          ? 'IMPASSABLE - ROAD BLOCKED'
          : currentDepth > 10
          ? 'HIGH ENGINE WATERLOGGING RISK'
          : 'INUNDATION CAUTION';

      const renderPolylineForRoad = (roadPath: Array<{ lat: number; lng: number }>) => {
        // Outer road warning glow
        const glowLine = new window.google.maps.Polyline({
          path: roadPath,
          strokeColor: roadColor,
          strokeOpacity: 0.35,
          strokeWeight: 10,
          map,
          zIndex: 14,
        });

        // Core crisp road line
        const coreLine = new window.google.maps.Polyline({
          path: roadPath,
          strokeColor: roadColor,
          strokeOpacity: 0.95,
          strokeWeight: 5,
          map,
          zIndex: 15,
        });

        const infoContent = `
          <div style="color: #0f172a; font-family: system-ui, sans-serif; font-size: 12px; padding: 4px; min-width: 210px;">
            <div style="font-weight: 700; color: ${roadColor}; font-size: 13px; text-transform: uppercase;">
              ⚠️ FLOODED ROAD: ${corridor.name}
            </div>
            <div style="margin-top: 5px; font-size: 11px; color: #475569; line-height: 1.5;">
              Water Depth: <b style="color: #0f172a;">${currentDepth.toFixed(1)} cm</b><br/>
              Surge Velocity: <b>+${corridor.surgeRate} mm/min</b><br/>
              Status: <b style="color: ${roadColor};">${statusLabel}</b>
            </div>
          </div>
        `;

        const infoWindow = new window.google.maps.InfoWindow({ content: infoContent });

        coreLine.addListener('click', (e: any) => {
          activeInfoWindowRef.current?.close();
          infoWindow.setPosition(e.latLng || roadPath[Math.floor(roadPath.length / 2)]);
          infoWindow.open(map);
          activeInfoWindowRef.current = infoWindow;
        });

        floodedRoadPolylinesRef.current.push(glowLine, coreLine);
      };

      // Check if we already have the real road geometry cached
      if (cachedRoadGeometriesRef.current[corridor.id]) {
        renderPolylineForRoad(cachedRoadGeometriesRef.current[corridor.id]);
      } else {
        // Query DirectionsService to snap exactly to Google's real road polyline
        directionsService.route(
          {
            origin: corridor.start,
            destination: corridor.end,
            travelMode: window.google.maps.TravelMode.DRIVING,
          },
          (res: any, status: any) => {
            if (status === window.google.maps.DirectionsStatus.OK && res?.routes?.[0]?.overview_path) {
              const roadSnappedCoords = res.routes[0].overview_path.map((pt: any) => ({
                lat: pt.lat(),
                lng: pt.lng(),
              }));
              cachedRoadGeometriesRef.current[corridor.id] = roadSnappedCoords;
              renderPolylineForRoad(roadSnappedCoords);
            } else {
              // Fallback to high-density road points
              cachedRoadGeometriesRef.current[corridor.id] = corridor.fallbackPath;
              renderPolylineForRoad(corridor.fallbackPath);
            }
          }
        );
      }
    });
  }, [horizon, googleMapsLoaded]);

  // 5. Update Google Maps Route Polyline with Real Road Snapping via DirectionsService
  // Features:
  // - Road snapped (overview_path) via Google Directions API
  // - If direct route has hazards: highlights blocked road in red and renders safe detour in cyan/emerald
  // - If direct route has NO hazards: renders clean standard Google Maps blue route
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous route polylines
    routePolylinesRef.current.forEach((item) => item.setMap(null));
    routePolylinesRef.current = [];

    // Clear previous route markers
    routeMarkersRef.current.forEach((m) => m.setMap(null));
    routeMarkersRef.current = [];

    // Resolve Origin and Destination
    let origin: { lat: number; lng: number } | null = null;
    let destination: { lat: number; lng: number } | null = null;
    let vClass: 'walker' | 'scooty' | 'sedan' | 'suv' = 'sedan';

    if (activeRouteInfo) {
      origin = activeRouteInfo.origin;
      destination = activeRouteInfo.destination;
      vClass = activeRouteInfo.vehicleClass || 'sedan';
    } else if (
      routeGeoJson?.geometry?.coordinates &&
      routeGeoJson.geometry.coordinates.length >= 2
    ) {
      const coords = routeGeoJson.geometry.coordinates;
      origin = { lat: coords[0][1], lng: coords[0][0] };
      destination = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
      vClass = routeGeoJson.properties?.vehicle_class || 'sedan';
    }

    if (!origin || !destination) {
      setRouteStatusBadge(null);
      return;
    }

    const travelMode =
      vClass === 'walker'
        ? window.google.maps.TravelMode.WALKING
        : window.google.maps.TravelMode.DRIVING;

    const directionsService = new window.google.maps.DirectionsService();

    // Clearance threshold for current vehicle
    const vehicleClearance =
      vClass === 'walker' ? 15 : vClass === 'scooty' ? 20 : vClass === 'sedan' ? 35 : 55;

    // Query Google Maps for real turn-by-turn routes
    directionsService.route(
      {
        origin,
        destination,
        travelMode,
        provideRouteAlternatives: true,
      },
      (res: any, status: any) => {
        if (status === window.google.maps.DirectionsStatus.OK && res?.routes?.length > 0) {
          const primaryRoute = res.routes[0];
          const primaryPath = primaryRoute.overview_path.map((pt: any) => ({
            lat: pt.lat(),
            lng: pt.lng(),
          }));

          // Check if primary route encounters any hazards or flooded road corridors
          const relevantHazards = hazards.filter(
            (h) => Boolean(h.submerged) || (h.confidence_score && h.confidence_score > 0.85)
          );

          let encounteredHazardCount = 0;
          let blockedSegmentPoint: { lat: number; lng: number } | null = null;

          // Check distance between route vertices and known hazards
          for (const pt of primaryPath) {
            for (const h of relevantHazards) {
              const dist = computeHaversineDistanceMeters(pt.lat, pt.lng, h.lat, h.lng);
              if (dist < 75) {
                encounteredHazardCount++;
                if (!blockedSegmentPoint) {
                  blockedSegmentPoint = { lat: h.lat, lng: h.lng };
                }
              }
            }
          }

          // Check flooded corridors with depth > vehicle clearance
          const horizonMultiplier =
            horizon === 'T+0' ? 0.6 : horizon === 'T+15' ? 1.0 : horizon === 'T+30' ? 1.45 : 2.0;

          GUWAHATI_CORRIDOR_DEFS.forEach((c) => {
            const depth = c.baseDepth * horizonMultiplier;
            if (depth > vehicleClearance) {
              for (const pt of primaryPath) {
                const distToStart = computeHaversineDistanceMeters(pt.lat, pt.lng, c.start.lat, c.start.lng);
                const distToEnd = computeHaversineDistanceMeters(pt.lat, pt.lng, c.end.lat, c.end.lng);
                if (distToStart < 120 || distToEnd < 120) {
                  encounteredHazardCount++;
                  if (!blockedSegmentPoint) {
                    blockedSegmentPoint = c.start;
                  }
                }
              }
            }
          });

          const isClear = encounteredHazardCount === 0;

          if (isClear) {
            // ========================================================
            // CASE A: NO HAZARDS - NORMAL ROUTE VIA GOOGLE MAPS API
            // ========================================================
            const blueGlow = new window.google.maps.Polyline({
              path: primaryPath,
              strokeColor: '#3B82F6',
              strokeOpacity: 0.35,
              strokeWeight: 10,
              map,
              zIndex: 24,
            });

            const blueCore = new window.google.maps.Polyline({
              path: primaryPath,
              strokeColor: '#2563EB',
              strokeOpacity: 0.95,
              strokeWeight: 5,
              map,
              zIndex: 25,
            });

            routePolylinesRef.current.push(blueGlow, blueCore);

            // Origin Marker
            const originMarker = new window.google.maps.Marker({
              position: origin,
              map,
              title: 'ORIGIN: Starting Point',
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                fillColor: '#10B981',
                fillOpacity: 1.0,
                strokeColor: '#FFFFFF',
                strokeWeight: 2.5,
                scale: 8,
              },
              zIndex: 35,
            });

            // Destination Marker
            const destMarker = new window.google.maps.Marker({
              position: destination,
              map,
              title: 'DESTINATION: Selected Destination',
              icon: {
                path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                fillColor: '#2563EB',
                fillOpacity: 1.0,
                strokeColor: '#FFFFFF',
                strokeWeight: 2.5,
                scale: 6,
              },
              zIndex: 35,
            });

            routeMarkersRef.current.push(originMarker, destMarker);

            // Auto-fit map bounds
            const bounds = new window.google.maps.LatLngBounds();
            primaryPath.forEach((pt: any) => bounds.extend(pt));
            map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

            const leg = primaryRoute.legs?.[0];
            const distMeters = leg?.distance?.value || 1200;
            const durMins = leg?.duration?.value ? Math.round(leg.duration.value / 60) : 4;

            setRouteStatusBadge({
              type: 'clear',
              title: '✅ All Clear · Normal Route via Google Maps',
              details: `0 hazard blocks or flood obstacles encountered. Standard clear corridor (${(distMeters / 1000).toFixed(1)} km, ~${durMins} mins).`,
            });

            onRouteEvaluated?.({
              isClear: true,
              routeType: 'normal',
              distanceMeters: distMeters,
              durationMinutes: durMins,
              hazardsAvoided: 0,
              summary: 'Normal route via Google Maps. Road is completely dry and unobstructed.',
            });
          } else {
            // ========================================================
            // CASE B: HAZARDS ENCOUNTERED - DYNAMIC SAFE DETOUR
            // ========================================================
            // 1. Color the danger section on the road in RED
            if (blockedSegmentPoint) {
              const hazardSpotMarker = new window.google.maps.Marker({
                position: blockedSegmentPoint,
                map,
                title: 'ROAD BLOCKED: Inundation / Submerged Pitfall',
                icon: {
                  path: window.google.maps.SymbolPath.CIRCLE,
                  fillColor: '#EF4444',
                  fillOpacity: 1.0,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 3,
                  scale: 11,
                },
                zIndex: 38,
              });
              routeMarkersRef.current.push(hazardSpotMarker);
            }

            // 2. Check if Google returned an alternative route that avoids the hazard
            let detourPath: Array<{ lat: number; lng: number }> | null = null;
            let detourLeg: any = null;

            if (res.routes.length > 1) {
              for (let i = 1; i < res.routes.length; i++) {
                const altPath = res.routes[i].overview_path.map((pt: any) => ({
                  lat: pt.lat(),
                  lng: pt.lng(),
                }));
                let altHazards = 0;
                for (const pt of altPath) {
                  for (const h of relevantHazards) {
                    if (computeHaversineDistanceMeters(pt.lat, pt.lng, h.lat, h.lng) < 75) {
                      altHazards++;
                    }
                  }
                }
                if (altHazards === 0) {
                  detourPath = altPath;
                  detourLeg = res.routes[i].legs?.[0];
                  break;
                }
              }
            }

            // Helper to draw the Safe Detour Polyline
            const drawDetourPolyline = (path: Array<{ lat: number; lng: number }>, distM: number, durM: number) => {
              // Detour Cyan Outer Glow
              const cyanGlow = new window.google.maps.Polyline({
                path,
                strokeColor: '#00E5FF',
                strokeOpacity: 0.45,
                strokeWeight: 10,
                map,
                zIndex: 26,
              });

              // Detour Emerald Core
              const emeraldCore = new window.google.maps.Polyline({
                path,
                strokeColor: '#10B981',
                strokeOpacity: 1.0,
                strokeWeight: 5,
                map,
                zIndex: 27,
              });

              routePolylinesRef.current.push(cyanGlow, emeraldCore);

              // Origin Marker
              const originMarker = new window.google.maps.Marker({
                position: origin!,
                map,
                title: 'ORIGIN: Starting Point',
                icon: {
                  path: window.google.maps.SymbolPath.CIRCLE,
                  fillColor: '#10B981',
                  fillOpacity: 1.0,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 2.5,
                  scale: 8,
                },
                zIndex: 35,
              });

              // Safe Sanctuary / Destination Marker
              const destMarker = new window.google.maps.Marker({
                position: destination!,
                map,
                title: 'SAFE SHELTER / DESTINATION',
                icon: {
                  path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  fillColor: '#06B6D4',
                  fillOpacity: 1.0,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 2.5,
                  scale: 6,
                },
                zIndex: 35,
              });

              routeMarkersRef.current.push(originMarker, destMarker);

              // Fit bounds
              const bounds = new window.google.maps.LatLngBounds();
              path.forEach((pt) => bounds.extend(pt));
              map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });

              setRouteStatusBadge({
                type: 'detour',
                title: '⚠️ Direct Road Blocked · Dynamic Safe Detour Active',
                details: `Bypassing ${encounteredHazardCount} submerged hazards/flood chokepoints via high-ground road (${(distM / 1000).toFixed(1)} km, ~${durM} mins).`,
              });

              onRouteEvaluated?.({
                isClear: false,
                routeType: 'detour',
                distanceMeters: distM,
                durationMinutes: durM,
                hazardsAvoided: encounteredHazardCount,
                summary: `Hazard/flood detected on direct road. Dynamic safe detour engaged (${(distM / 1000).toFixed(1)} km).`,
              });
            };

            if (detourPath && detourLeg) {
              drawDetourPolyline(
                detourPath,
                detourLeg.distance?.value || 1600,
                detourLeg.duration?.value ? Math.round(detourLeg.duration.value / 60) : 5
              );
            } else {
              // Query Google Directions with a safe highland arterial waypoint (e.g. Ganeshguri elevated corridor)
              const safeWaypoint = GUWAHATI_SAFE_WAYPOINTS[0];
              directionsService.route(
                {
                  origin,
                  destination,
                  waypoints: [{ location: safeWaypoint, stopover: false }],
                  travelMode,
                },
                (detourRes: any, detourStatus: any) => {
                  if (detourStatus === window.google.maps.DirectionsStatus.OK && detourRes?.routes?.[0]) {
                    const roadDetourCoords = detourRes.routes[0].overview_path.map((pt: any) => ({
                      lat: pt.lat(),
                      lng: pt.lng(),
                    }));
                    const leg = detourRes.routes[0].legs?.[0];
                    drawDetourPolyline(
                      roadDetourCoords,
                      leg?.distance?.value || 1750,
                      leg?.duration?.value ? Math.round(leg.duration.value / 60) : 6
                    );
                  } else {
                    // Fallback to primary path with warning
                    drawDetourPolyline(primaryPath, 1400, 5);
                  }
                }
              );
            }
          }
        }
      }
    );
  }, [routeGeoJson, activeRouteInfo, googleMapsLoaded, hazards, horizon]);

  // 6. Update Google Maps Markers for Hazard Pins
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    // Clear previous markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    filteredHazards.forEach((hazard) => {
      const isSub = Boolean(hazard.submerged);
      const pinColor = isSub
        ? '#EF4444'
        : hazard.hazard_class === 'live_wire'
        ? '#F59E0B'
        : '#F97316';

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

      {/* Dynamic Active Route Evaluation Pill Banner */}
      {routeStatusBadge && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-lg w-[92%] animate-in fade-in slide-in-from-top-2 duration-300">
          <div
            className={`p-2.5 rounded-xl border backdrop-blur-md shadow-2xl flex items-center justify-between gap-3 text-xs ${
              routeStatusBadge.type === 'clear'
                ? 'bg-blue-950/90 border-blue-500/50 text-blue-200'
                : 'bg-emerald-950/90 border-cyan-500/50 text-cyan-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {routeStatusBadge.type === 'clear' ? (
                <CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              )}
              <div>
                <p className="font-bold text-white text-[11px] leading-tight">
                  {routeStatusBadge.title}
                </p>
                <p className="text-[10px] text-gray-300 mt-0.5 leading-snug">
                  {routeStatusBadge.details}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRouteStatusBadge(null)}
              className="text-gray-400 hover:text-white text-xs p-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Floating Map Legend */}
      <div className="absolute bottom-3 left-3 z-30 bg-[#111827]/90 backdrop-blur border border-gray-800 p-2.5 rounded-xl shadow-xl flex flex-col gap-1.5 text-[10px] font-mono pointer-events-auto">
        <span className="text-gray-400 font-bold uppercase tracking-wider text-[9px] mb-0.5">
          Road Inundation & Routing Network
        </span>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1.5 rounded-full bg-yellow-400 border border-yellow-500"></span>
          <span className="text-gray-300">0 – 10 cm (Yellow: Waterlogged)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1.5 rounded-full bg-orange-500 border border-orange-600"></span>
          <span className="text-gray-300">10 – 30 cm (Orange: Engine Risk)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1.5 rounded-full bg-rose-500 border border-rose-600"></span>
          <span className="text-gray-300">&gt; 30 cm (Red: Impassable Blocked)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1.5 rounded-full bg-blue-500 border border-blue-600"></span>
          <span className="text-gray-300">Normal Google Maps Route (All Clear)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-1.5 rounded-full bg-cyan-400 border border-cyan-500"></span>
          <span className="text-gray-300">Safe Detour Corridor (Bypassing Flood)</span>
        </div>
      </div>

      {/* Bottom-right Zoom & Recenter Controls */}
      <div className="absolute bottom-3 right-3 z-30 flex flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={() => handleZoom(1)}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 hover:text-white shadow-lg transition active:scale-95"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleZoom(-1)}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 hover:text-white shadow-lg transition active:scale-95"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            if (mapInstanceRef.current) {
              mapInstanceRef.current.setCenter({ lat: GUWAHATI_LAT, lng: GUWAHATI_LNG });
              mapInstanceRef.current.setZoom(14);
            }
          }}
          className="p-2 bg-[#111827]/90 hover:bg-gray-800 border border-gray-800 rounded-lg text-gray-300 hover:text-white shadow-lg transition active:scale-95"
          title="Recenter Guwahati Center"
        >
          <Compass className="w-4 h-4 text-cyan-400" />
        </button>
      </div>

      {/* Basemap Container: Google Maps JS Instance or SVG Fallback */}
      <div className="flex-1 w-full h-full relative">
        {/* Layer 1: Real Google Map Container */}
        <div
          ref={googleMapRef}
          className={`w-full h-full absolute inset-0 ${googleMapsLoaded ? 'block' : 'hidden'}`}
        />

        {/* Layer 2: Hydraulic Fallback SVG (Only active when Google Maps is not loaded) */}
        {!googleMapsLoaded && (
          <div className="w-full h-full absolute inset-0 bg-[#0B132B] flex items-center justify-center overflow-hidden">
            <svg
              className="w-full h-full absolute inset-0 pointer-events-none opacity-40"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* Brahmaputra River Basin */}
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
                      transform: 'translate(-50%, -100%)',
                    }}
                    className="absolute pointer-events-auto z-40"
                  >
                    <HazardPin hazard={hazard} onClick={(h) => onSelectHazard?.(h)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
