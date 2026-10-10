'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  MapPin,
  RefreshCw,
  Send,
  ArrowRight,
  Flame,
  Radio,
  FileText,
  Video,
  Layers
} from 'lucide-react';
import {
  VideoUploadItem,
  RepairTicketItem,
  AuditLogItem,
  fetchAdminUploads,
  approveUpload,
  rejectUpload,
  fetchAdminTickets,
  updateAdminTicket,
  fetchAdminAuditLogs
} from '@/lib/api';

const KANBAN_COLUMNS: Array<{ id: RepairTicketItem['status']; title: string; color: string; bg: string }> = [
  { id: 'REQUIRED', title: 'Action Required', color: 'text-amber-400', bg: 'bg-amber-950/20 border-amber-800/40' },
  { id: 'DOING', title: 'Work In Progress', color: 'text-blue-400', bg: 'bg-blue-950/20 border-blue-800/40' },
  { id: 'DONE_CANDIDATE', title: 'Done Candidate (CV Verified)', color: 'text-purple-400', bg: 'bg-purple-950/20 border-purple-800/40' },
  { id: 'DONE', title: 'Resolved & Archived', color: 'text-emerald-400', bg: 'bg-emerald-950/20 border-emerald-800/40' },
];

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<'kanban' | 'uploads' | 'audit'>('kanban');
  const [uploads, setUploads] = useState<VideoUploadItem[]>([]);
  const [tickets, setTickets] = useState<RepairTicketItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [u, t, a] = await Promise.all([
        fetchAdminUploads().catch(() => []),
        fetchAdminTickets().catch(() => []),
        fetchAdminAuditLogs(30).catch(() => []),
      ]);
      setUploads(u);
      setTickets(t);
      setAuditLogs(a);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (uploadId: string) => {
    try {
      setActionNotice(`Processing approval & temporal cross-reference for ${uploadId}...`);
      await approveUpload(uploadId);
      setActionNotice(`Upload ${uploadId} approved and processed through auto-repair pipeline.`);
      await loadData();
    } catch (err) {
      setActionNotice(`Failed to approve upload: ${err}`);
    }
  };

  const handleReject = async (uploadId: string) => {
    try {
      setActionNotice(`Quarantining upload ${uploadId}...`);
      await rejectUpload(uploadId, 'Quarantined by municipal admin');
      setActionNotice(`Upload ${uploadId} quarantined from public live map.`);
      await loadData();
    } catch (err) {
      setActionNotice(`Failed to quarantine upload: ${err}`);
    }
  };

  const handleMoveTicket = async (ticketId: string, newStatus: RepairTicketItem['status']) => {
    try {
      setActionNotice(`Updating work-order ${ticketId} -> ${newStatus}...`);
      await updateAdminTicket(ticketId, { status: newStatus });
      setActionNotice(`Ticket ${ticketId} updated to ${newStatus}.`);
      await loadData();
    } catch (err) {
      setActionNotice(`Failed to update ticket: ${err}`);
    }
  };

  const handleEscalateUrgency = async (ticketId: string) => {
    try {
      setActionNotice(`Escalating ticket ${ticketId} to CRITICAL (3/3)...`);
      await updateAdminTicket(ticketId, { urgency: 3, status: 'ESCALATED' });
      setActionNotice(`🚨 Ticket ${ticketId} escalated to CRITICAL! SDRF Emergency SMS alert dispatched.`);
      await loadData();
    } catch (err) {
      setActionNotice(`Failed to escalate urgency: ${err}`);
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggedTicketId(id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: RepairTicketItem['status']) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('text/plain') || draggedTicketId;
    if (ticketId) {
      await handleMoveTicket(ticketId, targetStatus);
    }
    setDraggedTicketId(null);
  };

  const pendingUploads = uploads.filter((u) => u.status === 'PENDING');
  const criticalTickets = tickets.filter((t) => t.urgency === 3);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Banner */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400">
            <ShieldAlert className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">JAL-SENTINEL Municipal Admin Console</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Radio className="w-3 h-3 animate-pulse" /> Live Guard
              </span>
            </div>
            <p className="text-xs text-slate-400">Guwahati Urban Flood Mitigation & Hazard Work-Order Command Center</p>
          </div>
        </div>

        {/* Action Controls & Fast Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700/60">
              <span className="text-slate-400">Pending Uploads: </span>
              <span className="font-bold text-amber-400">{pendingUploads.length}</span>
            </div>
            <div className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700/60">
              <span className="text-slate-400">Active Work Orders: </span>
              <span className="font-bold text-blue-400">{tickets.filter((t) => t.status !== 'DONE').length}</span>
            </div>
            <div className="px-3 py-1.5 rounded-md bg-rose-950/40 border border-rose-800/50">
              <span className="text-rose-400 flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-400" /> Critical: <strong className="font-bold">{criticalTickets.length}</strong>
              </span>
            </div>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-xs font-medium transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Action Toast / Feedback Bar */}
      {actionNotice && (
        <div className="bg-blue-900/40 border-b border-blue-800/50 px-6 py-2 text-xs text-blue-200 flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-slate-900/40 border-b border-slate-800/60 px-6 pt-3 flex gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('kanban')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeTab === 'kanban'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Work-Order Kanban ({tickets.length})
        </button>
        <button
          onClick={() => setActiveTab('uploads')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeTab === 'uploads'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Video className="w-4 h-4" />
          Citizen Upload Queue ({pendingUploads.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition ${
            activeTab === 'audit'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          Audit Trail ({auditLogs.length})
        </button>
      </div>

      {/* Main Tab Content */}
      <main className="flex-1 p-6 overflow-x-auto">
        {/* TAB 1: KANBAN WORK-ORDER BOARD */}
        {activeTab === 'kanban' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 min-w-[1000px]">
            {KANBAN_COLUMNS.map((col) => {
              const colTickets = tickets.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
                  className={`rounded-xl border p-4 flex flex-col flex-1 min-h-[600px] ${col.bg}`}
                >
                  {/* Column Header */}
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                    <h2 className={`font-semibold text-sm ${col.color}`}>{col.title}</h2>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-900/80 text-slate-300 border border-slate-700">
                      {colTickets.length}
                    </span>
                  </div>

                  {/* Cards List */}
                  <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                    {colTickets.length === 0 ? (
                      <div className="h-32 border border-dashed border-slate-800 rounded-lg flex items-center justify-center text-xs text-slate-500">
                        Drop cards here
                      </div>
                    ) : (
                      colTickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, ticket.id)}
                          className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-lg p-3.5 shadow-sm cursor-grab active:cursor-grabbing transition"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 bg-slate-800 px-2 py-0.5 rounded">
                              {ticket.hazard_class}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                ticket.urgency === 3
                                  ? 'bg-rose-900/60 text-rose-300 border border-rose-700'
                                  : ticket.urgency === 2
                                  ? 'bg-amber-900/60 text-amber-300'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              Urgency {ticket.urgency}
                            </span>
                          </div>

                          <div className="text-xs text-slate-400 flex items-center gap-1.5 mb-2">
                            <MapPin className="w-3 h-3 text-slate-500" />
                            <span className="font-mono text-[11px] text-slate-300 truncate">{ticket.h3_hex_id}</span>
                          </div>

                          {ticket.admin_notes && (
                            <p className="text-xs text-slate-400 mb-3 bg-slate-950/60 p-2 rounded border border-slate-800/80">
                              {ticket.admin_notes}
                            </p>
                          )}

                          {/* Quick Action Transitions */}
                          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1 text-[11px]">
                            {col.id === 'REQUIRED' && (
                              <button
                                onClick={() => handleMoveTicket(ticket.id, 'DOING')}
                                className="px-2 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 rounded border border-blue-500/40 font-medium transition"
                              >
                                Dispatch Crew →
                              </button>
                            )}
                            {col.id === 'DOING' && (
                              <button
                                onClick={() => handleMoveTicket(ticket.id, 'DONE')}
                                className="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded border border-emerald-500/40 font-medium transition"
                              >
                                Mark Done ✓
                              </button>
                            )}
                            {col.id === 'DONE_CANDIDATE' && (
                              <button
                                onClick={() => handleMoveTicket(ticket.id, 'DONE')}
                                className="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 rounded border border-purple-500/40 font-medium transition"
                              >
                                Confirm Fixed ✓
                              </button>
                            )}
                            {ticket.urgency !== 3 && col.id !== 'DONE' && (
                              <button
                                onClick={() => handleEscalateUrgency(ticket.id)}
                                title="Escalate to Critical & Trigger SDRF SMS Alert"
                                className="px-1.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 rounded border border-rose-800/40 text-[10px]"
                              >
                                🚨 Escalate
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: CITIZEN UPLOAD APPROVAL QUEUE */}
        {activeTab === 'uploads' && (
          <div className="space-y-4 max-w-5xl">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-300">Citizen Crowd-Gauged Uploads Awaiting Admin Gate Approval</h2>
              <span className="text-xs text-slate-400">Total in queue: {pendingUploads.length}</span>
            </div>

            {pendingUploads.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3 opacity-60" />
                <p className="text-sm text-slate-400">Upload queue is empty. All citizen submissions have been verified.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingUploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 space-y-3 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-200">{upload.filename}</h3>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-slate-500" />
                          Recorded: {new Date(upload.recorded_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/60 text-amber-300 border border-amber-800/40">
                        {upload.status}
                      </span>
                    </div>

                    <div className="text-xs bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Coordinates:</span>
                        <span className="font-mono text-slate-200">{upload.lat.toFixed(4)}, {upload.lng.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">H3 Hex Res-12:</span>
                        <span className="font-mono text-blue-400">{upload.h3_hex_id}</span>
                      </div>
                      {upload.description && (
                        <div className="pt-1 text-slate-300 border-t border-slate-800/60 mt-1">
                          &quot;{upload.description}&quot;
                        </div>
                      )}
                    </div>

                    {/* Approve & Reject Actions */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => handleApprove(upload.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Approve & Verify (CV)
                      </button>
                      <button
                        onClick={() => handleReject(upload.id)}
                        className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded-lg text-xs font-semibold transition"
                      >
                        <XCircle className="w-4 h-4" />
                        Quarantine
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: AUDIT TRAIL LOG */}
        {activeTab === 'audit' && (
          <div className="max-w-5xl space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 mb-2">Immutable Administrative & Automated Action Ledger</h2>
            <div className="border border-slate-800 rounded-xl bg-slate-900/60 overflow-hidden">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Actor</th>
                    <th className="py-2.5 px-4">Rationale</th>
                    <th className="py-2.5 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          log.action.includes('APPROVED')
                            ? 'bg-emerald-950 text-emerald-400'
                            : log.action.includes('REJECTED')
                            ? 'bg-rose-950 text-rose-400'
                            : log.action.includes('ESCALATED')
                            ? 'bg-amber-950 text-amber-400'
                            : 'bg-blue-950 text-blue-400'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">
                        {log.ticket_id ? `Ticket: ${log.ticket_id.slice(0, 8)}...` : log.hazard_event_id ? `Event: ${log.hazard_event_id.slice(0, 8)}...` : 'Upload'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 uppercase text-[10px] font-semibold">{log.performed_by}</td>
                      <td className="py-2.5 px-4 text-slate-400 max-w-xs truncate">{log.reason || '—'}</td>
                      <td className="py-2.5 px-4 text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
