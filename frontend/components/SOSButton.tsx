'use client';

import React from 'react';
import Link from 'next/link';
import { AlertOctagon, Radio } from 'lucide-react';

interface SOSButtonProps {
  className?: string;
}

export default function SOSButton({ className = '' }: SOSButtonProps) {
  return (
    <Link
      href="/sos"
      className={`group fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full bg-gradient-to-r from-rose-600 to-red-600 px-5 py-3.5 text-white shadow-2xl transition-all duration-300 hover:scale-105 hover:from-rose-500 hover:to-red-500 hover:shadow-rose-600/50 active:scale-95 ${className}`}
      title="Citizen Emergency SOS Dispatch"
      aria-label="Citizen Emergency SOS Dispatch"
    >
      {/* Outer Ping Animation Ring */}
      <span className="relative flex h-4 w-4">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-300 opacity-75" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-white shadow-sm" />
      </span>

      <AlertOctagon className="h-6 w-6 stroke-[2.5] text-white transition-transform group-hover:rotate-12" />

      <div className="flex flex-col text-left">
        <span className="text-xs font-black uppercase tracking-wider text-white">
          Emergency SOS
        </span>
        <span className="text-[10px] font-medium text-rose-100">
          Instant SDRF Boat Dispatch
        </span>
      </div>

      <div className="hidden rounded-full bg-rose-700/60 px-2 py-0.5 text-[10px] font-mono font-bold sm:inline-block">
        ONE-TAP
      </div>
    </Link>
  );
}
