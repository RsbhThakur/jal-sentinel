'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  AlertOctagon, 
  PhoneCall, 
  MapPin, 
  ShieldAlert, 
  Clock, 
  ArrowLeft, 
  CheckCircle2, 
  Radio, 
  LifeBuoy, 
  AlertTriangle,
  Send,
  Navigation
} from 'lucide-react';
import { dispatchCitizenSos, fetchNearestSdrfUnit, SdrfUnitItem, CitizenSosResponse } from '@/lib/api';

export default function CitizenSosPage() {
  const [lat, setLat] = useState<number>(26.1448);
  const [lng, setLng] = useState<number>(91.7365);
  const [gpsStatus, setGpsStatus] = useState<'DETECTING' | 'LOCKED' | 'DEFAULT'>('DETECTING');
  const [message, setMessage] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  
  const [nearestUnit, setNearestUnit] = useState<SdrfUnitItem | null>(null);
  const [loadingNearest, setLoadingNearest] = useState<boolean>(true);
  
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [dispatchedData, setDispatchedData] = useState<CitizenSosResponse | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Auto-capture GPS Location on Mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
          setGpsStatus('LOCKED');
        },
        (err) => {
          console.warn('Geolocation access denied or failed, using calibrated Guwahati default:', err);
          setGpsStatus('DEFAULT');
        },
        { timeout: 5000, enableHighAccuracy: true }
      );
    } else {
      setGpsStatus('DEFAULT');
    }
  }, []);

  // 2. Fetch nearest SDRF staging post
  useEffect(() => {
    setLoadingNearest(true);
    fetchNearestSdrfUnit(lat, lng)
      .then((unit) => {
        setNearestUnit(unit);
        setLoadingNearest(false);
      })
      .catch((err) => {
        console.warn('Failed to fetch nearest SDRF post:', err);
        setLoadingNearest(false);
      });
  }, [lat, lng]);

  // 3. Countdown timer when dispatched
  useEffect(() => {
    if (!dispatchedData || countdownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCountdownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [dispatchedData, countdownSeconds]);

  // Handle One-Tap SOS Dispatch
  const handleTriggerSos = async () => {
    setDispatching(true);
    setErrorMessage(null);

    try {
      const res = await dispatchCitizenSos({
        lat,
        lng,
        message: message.trim() || undefined,
        citizen_phone: phone.trim() || undefined
      });
      setDispatchedData(res);
      setCountdownSeconds(res.eta_min * 60);
      setDispatching(false);
    } catch (err: any) {
      console.error('Failed to dispatch SOS:', err);
      setErrorMessage(err?.message || 'Emergency dispatch gateway temporarily unreachable. Call 112 or 1077 directly.');
      setDispatching(false);
    }
  };

  const formatCountdown = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-black text-white px-4 py-8 flex flex-col justify-between">
      {/* Top Header */}
      <div className="max-w-2xl mx-auto w-full flex items-center justify-between pb-6 border-b border-gray-800">
        <Link
          href="/"
          className="flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition px-3 py-1.5 rounded-lg hover:bg-gray-800/60"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Live Radar
        </Link>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono font-bold uppercase tracking-wider">
          <Radio className="w-3.5 h-3.5 animate-pulse text-rose-500" />
          SDRF Emergency Band
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-2xl mx-auto w-full my-auto py-8 flex flex-col items-center text-center">
        {!dispatchedData ? (
          <>
            {/* Alert Status Title */}
            <div className="mb-4">
              <span className="text-xs uppercase tracking-widest font-mono text-rose-500 font-bold">
                JAL-SENTINEL RAPID RESCUE
              </span>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-1 text-white">
                Citizen Emergency SOS
              </h1>
              <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
                One-tap priority dispatch to the Assam State Disaster Response Force (SDRF) with instant rescue boat routing.
              </p>
            </div>

            {/* Massive Pulsing Red SOS Button */}
            <div className="relative my-8 flex items-center justify-center">
              <div className="absolute w-64 h-64 rounded-full bg-rose-600/20 animate-ping" />
              <div className="absolute w-52 h-52 rounded-full bg-rose-600/30 animate-pulse" />
              
              <button
                onClick={handleTriggerSos}
                disabled={dispatching}
                className="relative w-44 h-44 rounded-full bg-gradient-to-tr from-rose-700 via-rose-600 to-red-600 text-white font-black text-2xl uppercase tracking-widest shadow-2xl shadow-rose-600/60 hover:scale-105 active:scale-95 transition-all duration-300 flex flex-col items-center justify-center border-4 border-rose-400/40 disabled:opacity-50"
              >
                <AlertOctagon className="w-10 h-10 mb-1 stroke-[2.5]" />
                <span>{dispatching ? 'CALLING...' : 'SOS'}</span>
                <span className="text-[10px] tracking-normal font-sans font-medium text-rose-200 mt-0.5">
                  TAP TO DISPATCH
                </span>
              </button>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="w-full bg-rose-950/60 border border-rose-500/40 text-rose-300 rounded-xl p-3 text-xs mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* GPS Location & Nearest Station Card */}
            <div className="w-full bg-gray-900/80 border border-gray-800 rounded-2xl p-5 shadow-xl text-left mb-6">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800 text-xs">
                <div className="flex items-center gap-2 text-gray-300 font-semibold">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  Your GPS Coordinates
                </div>
                <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                  gpsStatus === 'LOCKED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-gray-800 text-gray-400'
                }`}>
                  {gpsStatus === 'LOCKED' ? 'GPS LOCKED' : 'APPROX GUWAHATI'}
                </span>
              </div>

              <div className="py-2.5 font-mono text-xs text-gray-400">
                Lat: <span className="text-white font-bold">{lat.toFixed(4)}</span> | Lng: <span className="text-white font-bold">{lng.toFixed(4)}</span>
              </div>

              {nearestUnit && (
                <div className="mt-2 pt-3 border-t border-gray-800/80 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase font-mono block">Nearest Standby Unit</span>
                    <span className="font-semibold text-gray-200">{nearestUnit.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-gray-500 uppercase font-mono block">Distance</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {(nearestUnit.distance_meters / 1000).toFixed(1)} km
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Optional Input Fields */}
            <div className="w-full space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Optional: trapped landmark / specific distress details..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-2.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <input
                  type="tel"
                  placeholder="Optional: callback mobile number (e.g., 9864012345)..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-gray-900/70 border border-gray-800 rounded-xl px-4 py-2.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>
          </>
        ) : (
          /* =============================================================== */
          /* DISPATCH CONFIRMED DASHBOARD                                    */
          /* =============================================================== */
          <div className="w-full space-y-6">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/60 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/20">
              <CheckCircle2 className="w-10 h-10 animate-bounce" />
            </div>

            <div>
              <span className="text-xs uppercase tracking-widest font-mono text-emerald-400 font-bold">
                RESCUE ACTION CONFIRMED
              </span>
              <h2 className="text-3xl font-extrabold text-white mt-1">
                Help Is On The Way
              </h2>
              <p className="text-sm text-gray-400 mt-1">
                Assam State Disaster Response Force has acknowledged your beacon.
              </p>
            </div>

            {/* Prominent Countdown / ETA Card */}
            <div className="bg-gradient-to-r from-gray-900 via-rose-950/40 to-gray-900 border border-rose-500/40 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <span className="text-xs uppercase font-mono font-bold text-gray-400 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-rose-400" /> Estimated Time of Arrival
                </span>
                <span className="text-xs font-mono bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
                  {dispatchedData.sms_gateway_status === 'SENT' ? 'SMS GATEWAY ACTIVE' : 'LIVE DISPATCH RECORDED'}
                </span>
              </div>

              <div className="text-4xl sm:text-5xl font-black font-mono text-rose-400 my-4 tracking-tight">
                {countdownSeconds > 0 ? formatCountdown(countdownSeconds) : `${dispatchedData.eta_min} min`}
              </div>

              <p className="text-xs text-gray-300">
                Unit <span className="font-bold text-white">{dispatchedData.sdrf_unit.name}</span> mobilized with {dispatchedData.sdrf_unit.boats_available || 4} motorized rescue boats.
              </p>
            </div>

            {/* SDRF Contact Card */}
            <div className="bg-gray-900/90 border border-gray-800 rounded-2xl p-5 text-left space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-500 uppercase font-mono block">Assigned Commander Unit</span>
                  <span className="text-base font-bold text-white">{dispatchedData.sdrf_unit.name}</span>
                </div>
                <a
                  href={`tel:${dispatchedData.sdrf_unit.contact}`}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/30 transition"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  Call Base
                </a>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 text-xs border-t border-gray-800">
                <div>
                  <span className="text-[10px] text-gray-500 font-mono block">Direct Hotline</span>
                  <span className="font-mono text-cyan-400 font-bold">{dispatchedData.sdrf_unit.contact}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 font-mono block">Incident ID</span>
                  <span className="font-mono text-gray-300 text-[11px]">{dispatchedData.incident_id}</span>
                </div>
              </div>
            </div>

            {/* Life Safety Directives */}
            <div className="bg-gray-900/50 border border-gray-800/80 rounded-2xl p-4 text-left text-xs space-y-2">
              <span className="text-[10px] uppercase font-mono font-bold text-amber-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Emergency Directives While Awaiting Boat
              </span>
              <ul className="list-disc list-inside space-y-1 text-gray-300 text-[11px]">
                <li>Ascend to the highest accessible structural level / rooftop.</li>
                <li>Stay clear of low-hanging electrical powerlines and flooded manholes.</li>
                <li>Keep bright clothing, a whistle, or mobile screen light ready to signal rescue boats.</li>
              </ul>
            </div>

            <div className="pt-2 flex gap-3">
              <Link
                href="/"
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold py-3 rounded-xl transition text-center"
              >
                Return to Live Radar
              </Link>
              <Link
                href="/route"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-3 rounded-xl transition text-center flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20"
              >
                <Navigation className="w-4 h-4" />
                Evacuation Corridors
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="max-w-2xl mx-auto w-full pt-6 border-t border-gray-800 text-center text-[10px] font-mono text-gray-500">
        JAL-SENTINEL DISASTER RELIEF SYSTEM • ASSAM STATE DISASTER MANAGEMENT AUTHORITY (ASDMA) • GUWAHATI MUNICIPAL CORP
      </div>
    </main>
  );
}
