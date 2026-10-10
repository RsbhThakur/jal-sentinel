'use client';

import React from 'react';
import { Activity, AlertTriangle, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface DepthGaugeProps {
  depthCm: number;
  dhdtMmMin: number;
  status?: string;
  location?: string;
  maxDepthCm?: number;
}

export default function DepthGauge({
  depthCm,
  dhdtMmMin,
  status = 'SURGING',
  location = 'Christian Basti Chokepoint',
  maxDepthCm = 50,
}: DepthGaugeProps) {
  // Normalize percentage for the radial arc (clamp between 0 and 100%)
  const percentage = Math.min(Math.max((depthCm / maxDepthCm) * 100, 0), 100);
  
  // Circumference for r=70: 2 * PI * 70 = 439.82
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  // Arc covers 240 degrees (leaving bottom 120 open)
  const arcLength = circumference * (240 / 360);
  const strokeDashoffset = arcLength - (arcLength * percentage) / 100;

  // Color selection based on hydraulic flood hazard thresholds
  let colorClass = 'text-emerald-400 stroke-emerald-500';
  let badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  let clearanceWarning = 'Safe for all vehicles';

  if (depthCm >= 30) {
    colorClass = 'text-rose-500 stroke-rose-500';
    badgeColor = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
    clearanceWarning = 'CRITICAL: Blocked for all vehicles';
  } else if (depthCm >= 20) {
    colorClass = 'text-amber-500 stroke-amber-500';
    badgeColor = 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    clearanceWarning = 'WARNING: Scooty & Sedan engine risk';
  } else if (depthCm >= 10) {
    colorClass = 'text-yellow-400 stroke-yellow-400';
    badgeColor = 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
    clearanceWarning = 'CAUTION: Standing water on asphalt';
  }

  const isRising = dhdtMmMin > 0;

  return (
    <div className="bg-[#111827] border border-gray-800 rounded-2xl p-5 flex flex-col items-center justify-between shadow-xl">
      <div className="w-full flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">
            Waterline Metric Gauge
          </h3>
        </div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-semibold ${badgeColor}`}>
          {status}
        </span>
      </div>

      {/* Circular SVG Gauge */}
      <div className="relative w-44 h-44 flex items-center justify-center my-2">
        <svg className="w-full h-full -rotate-210" viewBox="0 0 180 180">
          {/* Background Track */}
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="12"
            strokeDasharray={arcLength}
            className="text-gray-800"
            strokeLinecap="round"
          />
          {/* Active Value Arc */}
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth="12"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            className={`${colorClass} transition-all duration-700 ease-out`}
            strokeLinecap="round"
          />
        </svg>

        {/* Center Readout Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-extrabold tracking-tight font-mono text-white">
            {depthCm.toFixed(1)}
          </span>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            Centimeters
          </span>
          <div className="mt-1 flex items-center gap-1 text-xs font-mono font-semibold">
            {isRising ? (
              <span className="text-amber-400 flex items-center">
                <ArrowUpRight className="w-3.5 h-3.5" />
                +{dhdtMmMin.toFixed(1)} mm/min
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center">
                <ArrowDownRight className="w-3.5 h-3.5" />
                {dhdtMmMin.toFixed(1)} mm/min
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Gauge Telemetry & Clearance Notice */}
      <div className="w-full mt-1 pt-3 border-t border-gray-800 text-center">
        <p className="text-[11px] font-medium text-gray-400 truncate">
          {location}
        </p>
        <p className="text-[10px] font-semibold text-amber-400 mt-0.5 flex items-center justify-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {clearanceWarning}
        </p>
      </div>
    </div>
  );
}
