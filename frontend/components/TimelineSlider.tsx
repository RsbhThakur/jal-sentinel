'use client';

import React from 'react';
import { Clock, TrendingUp } from 'lucide-react';

export type TimeHorizon = 'T+0' | 'T+15' | 'T+30' | 'T+60';

interface TimelineSliderProps {
  currentHorizon: TimeHorizon;
  onChange: (horizon: TimeHorizon) => void;
}

const HORIZONS: { id: TimeHorizon; label: string; desc: string; surgeEstimate: string }[] = [
  {
    id: 'T+0',
    label: 'T+0 min',
    desc: 'Live Ground State',
    surgeEstimate: 'Current Baseline'
  },
  {
    id: 'T+15',
    label: 'T+15 min',
    desc: 'Flash Chokepoint Surge',
    surgeEstimate: '+6.5 cm predicted'
  },
  {
    id: 'T+30',
    label: 'T+30 min',
    desc: 'Drainage Culvert Spillover',
    surgeEstimate: '+14.0 cm predicted'
  },
  {
    id: 'T+60',
    label: 'T+60 min',
    desc: 'Catchment Basin Crest',
    surgeEstimate: '+22.5 cm predicted'
  }
];

export default function TimelineSlider({
  currentHorizon,
  onChange,
}: TimelineSliderProps) {
  const activeMeta = HORIZONS.find((h) => h.id === currentHorizon) || HORIZONS[1];

  return (
    <div className="bg-[#111827]/90 backdrop-blur border border-gray-800 rounded-xl p-3 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
      {/* Label and Horizon Meta */}
      <div className="flex items-center gap-3">
        <div className="bg-blue-600/20 p-2 rounded-lg border border-blue-500/30 text-blue-400">
          <Clock className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Hydraulic Predictive Timeline
            </span>
            <span className="text-[10px] font-mono bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30 font-semibold">
              2D Manning Solver
            </span>
          </div>
          <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            <span className="text-white font-medium">{activeMeta.desc}:</span> {activeMeta.surgeEstimate}
          </p>
        </div>
      </div>

      {/* Button Slider Toggle */}
      <div className="flex items-center bg-gray-900/90 p-1 rounded-lg border border-gray-800 w-full md:w-auto justify-between md:justify-start">
        {HORIZONS.map((h) => {
          const isActive = currentHorizon === h.id;
          return (
            <button
              key={h.id}
              onClick={() => onChange(h.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-105'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
              }`}
            >
              {h.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
