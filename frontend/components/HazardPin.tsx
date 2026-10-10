'use client';

import React, { useState } from 'react';
import { 
  AlertOctagon, 
  Zap, 
  CircleDot, 
  Trash2, 
  Car, 
  MapPin, 
  ShieldAlert 
} from 'lucide-react';

export type HazardClass = 'manhole' | 'pothole' | 'live_wire' | 'debris' | 'vehicle';

export interface HazardPinData {
  id: string;
  hazard_class: HazardClass;
  lat: number;
  lng: number;
  confidence_score: number;
  h3_hex_id: string;
  submerged?: boolean;
  depth_cm?: number;
  notes?: string;
}

interface HazardPinProps {
  hazard: HazardPinData;
  onClick?: (hazard: HazardPinData) => void;
  showPopover?: boolean;
}

export function getHazardConfig(hazardClass: HazardClass) {
  switch (hazardClass) {
    case 'manhole':
      return {
        label: 'Open Manhole',
        color: 'bg-rose-600 text-white border-rose-400',
        glow: 'shadow-rose-600/50',
        icon: CircleDot,
        dangerLevel: 'CRITICAL: Drowning & Falling Pitfall'
      };
    case 'live_wire':
      return {
        label: 'Live Wire',
        color: 'bg-amber-500 text-black border-yellow-300',
        glow: 'shadow-amber-500/60',
        icon: Zap,
        dangerLevel: 'FATAL: Water Electrocution Zone'
      };
    case 'pothole':
      return {
        label: 'Submerged Crater',
        color: 'bg-orange-600 text-white border-orange-400',
        glow: 'shadow-orange-600/40',
        icon: AlertOctagon,
        dangerLevel: 'HIGH: Vehicle Wheel Axel Fracture'
      };
    case 'debris':
      return {
        label: 'Drainage Debris Blockage',
        color: 'bg-emerald-600 text-white border-emerald-400',
        glow: 'shadow-emerald-600/30',
        icon: Trash2,
        dangerLevel: 'MEDIUM: Choking Storm Drain Culvert'
      };
    case 'vehicle':
      return {
        label: 'Submerged Vehicle',
        color: 'bg-blue-600 text-white border-blue-400',
        glow: 'shadow-blue-600/40',
        icon: Car,
        dangerLevel: 'BLOCKED: Inundated Transit Lane'
      };
    default:
      return {
        label: 'Hazard Pin',
        color: 'bg-gray-700 text-white border-gray-500',
        glow: 'shadow-gray-700/30',
        icon: MapPin,
        dangerLevel: 'CAUTION: General Obstruction'
      };
  }
}

export default function HazardPin({
  hazard,
  onClick,
  showPopover = false
}: HazardPinProps) {
  const [open, setOpen] = useState(showPopover);
  const config = getHazardConfig(hazard.hazard_class);
  const IconComponent = config.icon;

  return (
    <div 
      className="relative group cursor-pointer inline-block"
      onClick={() => {
        setOpen(!open);
        onClick?.(hazard);
      }}
    >
      {/* Submerged Pitfall Pulse Ring */}
      {hazard.submerged && (
        <span className="absolute -inset-2 rounded-full bg-rose-500/40 animate-ping pointer-events-none" />
      )}

      {/* Main Pin Badge */}
      <div 
        className={`relative z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full border-2 text-xs font-bold shadow-lg transition-transform transform group-hover:scale-110 ${config.color} ${config.glow}`}
      >
        <IconComponent className="w-3.5 h-3.5" />
        <span className="font-mono text-[10px]">{config.label}</span>
        {hazard.submerged && (
          <span className="bg-black/60 text-white text-[9px] px-1 rounded font-bold uppercase tracking-tighter">
            Submerged
          </span>
        )}
      </div>

      {/* Interactive Detail Popover */}
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-[#111827] border border-gray-700 rounded-xl p-3 shadow-2xl z-50 text-left pointer-events-auto">
          <div className="flex items-center justify-between border-b border-gray-800 pb-1.5 mb-2">
            <span className="text-[11px] font-bold text-white flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              Submerged Pitfall Radar
            </span>
            <span className="text-[9px] font-mono bg-blue-500/20 text-blue-300 px-1 rounded">
              {(hazard.confidence_score * 100).toFixed(0)}% Conf
            </span>
          </div>

          <p className="text-[11px] font-semibold text-rose-400 mb-1">
            {config.dangerLevel}
          </p>

          {hazard.depth_cm !== undefined && (
            <p className="text-xs text-gray-300 mb-1">
              Water Depth: <span className="font-bold font-mono text-cyan-400">{hazard.depth_cm} cm</span>
            </p>
          )}

          {hazard.notes && (
            <p className="text-[11px] text-gray-400 italic mb-2">
              "{hazard.notes}"
            </p>
          )}

          <div className="text-[10px] font-mono text-gray-500 pt-1 border-t border-gray-800 flex justify-between">
            <span>H3: {hazard.h3_hex_id.slice(0, 10)}...</span>
            <span>{hazard.lat.toFixed(4)}, {hazard.lng.toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
