'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { 
  Camera, 
  Video, 
  MapPin, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  ChevronLeft,
  Clock,
  FileVideo,
  XCircle,
  StopCircle
} from 'lucide-react';
import { uploadCitizenVideoFile } from '@/lib/api';

export default function CitizenUploadPage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  
  // Coordinates (Default: Guwahati central coordinates)
  const [lat, setLat] = useState<string>('26.1448');
  const [lng, setLng] = useState<string>('91.7365');
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [description, setDescription] = useState<string>('');
  const [timestamp, setTimestamp] = useState<string>('');
  
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimestamp(new Date().toISOString());
    captureLocation();
  }, []);

  const captureLocation = () => {
    setGpsLoading(true);
    setGpsError(null);
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(position.coords.latitude.toFixed(6));
          setLng(position.coords.longitude.toFixed(6));
          setGpsLoading(false);
        },
        (error) => {
          setGpsError('Could not auto-detect GPS. You can manually enter coordinates.');
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      setGpsError('Geolocation is not supported by your browser.');
      setGpsLoading(false);
    }


  const startInlineRecording = async () => {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }

      recordedChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const file = new File([blob], `recorded_citizen_${Date.now()}.webm`, { type: 'video/webm' });
        setVideoFile(file);
        setVideoPreview(URL.createObjectURL(blob));
        setTimestamp(new Date().toISOString());

        stream.getTracks().forEach((track) => track.stop());
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
        }
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setErrorMessage(`Camera access error: ${err.message || 'Permission denied'}`);
    }
  };

  const stopInlineRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setVideoFile(file);
      setVideoPreview(URL.createObjectURL(file));
      setTimestamp(new Date().toISOString());
      setErrorMessage(null);
    }
  };

  const handleResetVideo = () => {
    setVideoFile(null);
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoFile) {
      setErrorMessage('Please capture or choose a video file to upload.');
      return;
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setErrorMessage('Please enter valid numerical latitude and longitude coordinates.');
      return;
    }

    setUploading(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('file', videoFile);
    formData.append('lat', String(latNum));
    formData.append('lng', String(lngNum));
    formData.append('timestamp', timestamp || new Date().toISOString());
    if (description.trim()) {
      formData.append('description', description.trim());
    }

    try {
      const res = await uploadCitizenVideoFile(formData);
      setUploadResult(res);
      setUploadSuccess(true);
      setUploading(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to upload video to server. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-gray-100 flex flex-col font-sans">
      <header className="border-b border-gray-800 bg-[#111827]/90 backdrop-blur sticky top-0 z-50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link 
            href="/"
            className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-cyan-400" />
              Citizen Flood & Hazard Ingest
            </h1>
            <p className="text-[11px] text-gray-400">Guwahati Urban Hydrology Sentinel</p>
          </div>
        </div>

        <Link
          href="/"
          className="text-xs px-2.5 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
        >
          View Map
        </Link>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto p-4 flex flex-col justify-start">
        {uploadSuccess ? (
          <div className="bg-[#111827] border border-gray-800 rounded-2xl p-6 text-center space-y-4 my-auto shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            
            <h2 className="text-lg font-bold text-white">Your video is in review. Thank you!</h2>
            <p className="text-xs text-gray-300 leading-relaxed">
              Your submission has been securely queued for municipal admin verification. It will be validated before appearing on the public flood radar.
            </p>

            <div className="bg-gray-900/80 border border-gray-800 rounded-xl p-3 text-left space-y-1.5 text-xs font-mono text-gray-300">
              <div className="flex justify-between">
                <span className="text-gray-500">Upload ID:</span>
                <span className="text-cyan-400 font-bold">{uploadResult?.id ? `${String(uploadResult.id).slice(0, 13)}...` : 'QUEUED'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                <span className="text-amber-400 font-bold uppercase">{uploadResult?.status || 'PENDING'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">H3 Hex ID:</span>
                <span>{uploadResult?.h3_hex_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Coordinates:</span>
                <span>{lat}, {lng}</span>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setUploadSuccess(false);
                  setUploadResult(null);
                  handleResetVideo();
                  setDescription('');
                  setTimestamp(new Date().toISOString());
                }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold py-2.5 px-3 rounded-xl transition"
              >
                Upload Another Clip
              </button>
              <Link
                href="/"
                className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1 transition shadow-lg shadow-cyan-600/20"
              >
                Return to Live Map
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5 text-cyan-400" />
                  Video Capture
                </label>
                {videoFile && (
                  <button
                    type="button"
                    onClick={handleResetVideo}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Remove
                  </button>
                )}
              </div>

              <div className="relative w-full aspect-video bg-black/60 rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center">
                {videoPreview ? (
                  <video 
                    src={videoPreview} 
                    controls 
                    className="w-full h-full object-contain" 
                  />
                ) : isRecording ? (
                  <>
                    <video 
                      ref={videoPreviewRef} 
                      muted 
                      playsInline 
                      className="w-full h-full object-cover" 
                    />
                    <div className="absolute top-3 left-3 bg-red-600/90 text-white text-[11px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-white"></span>
                      REC {recordingSeconds}s
                    </div>
                  </>
                ) : (
                  <div className="text-center p-6 space-y-2">
                    <FileVideo className="w-10 h-10 text-gray-600 mx-auto" />
                    <p className="text-xs text-gray-400 font-medium">Record flood/hazard clip directly or choose file</p>
                    <p className="text-[11px] text-gray-500">MP4, WebM, MOV</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {isRecording ? (
                <button
                  type="button"
                  onClick={stopInlineRecording}
                  className="col-span-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-rose-600/30"
                >
                  <StopCircle className="w-4 h-4" /> Stop Recording
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={startInlineRecording}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg shadow-cyan-600/20"
                  >
                    <Camera className="w-4 h-4" /> Record Video
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 transition border border-gray-700/60"
                  >
                    <Upload className="w-4 h-4 text-gray-400" /> Choose Gallery
                  </button>
                </>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-400" />
                  GPS Tagging (H3 Snapped)
                </label>
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={gpsLoading}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${gpsLoading ? 'animate-spin' : ''}`} />
                  Auto-Detect GPS
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-400 font-mono block mb-1">Latitude</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-100 focus:outline-none focus:border-cyan-500"
                    placeholder="26.1448"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 font-mono block mb-1">Longitude</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-100 focus:outline-none focus:border-cyan-500"
                    placeholder="91.7365"
                  />
                </div>
              </div>

              {gpsError && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  {gpsError}
                </p>
              )}
            </div>

            <div className="bg-[#111827] border border-gray-800 rounded-2xl p-4 shadow-xl space-y-3">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                Recording Timestamp & Details
              </label>

              <div>
                <span className="text-[10px] text-gray-400 font-mono block mb-1">Client Timestamp (ISO 8601)</span>
                <input
                  type="text"
                  required
                  value={timestamp}
                  onChange={(e) => setTimestamp(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-300 focus:outline-none focus:border-cyan-500"
                  placeholder="2026-10-10T14:30:00Z"
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block">Must be within the last 24 hours.</span>
              </div>

              <div>
                <span className="text-[10px] text-gray-400 font-mono block mb-1">Observation Description (Optional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={300}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500 resize-none"
                  placeholder="E.g., open manhole near curb, water depth rising rapidly ~20cm"
                />
              </div>
            </div>

            {errorMessage && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={uploading || isRecording || !videoFile}
              className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-600/30"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Uploading Video Clip...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Submit to Admin Queue
                </>
              )}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

  };
