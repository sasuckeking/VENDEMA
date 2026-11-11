import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Search,
  Filter,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Server,
  MessageSquare,
  Database,
  Cpu,
  Clock,
  Zap,
  Radio,
  Layers,
  Lock,
  Unlock,
  RotateCcw,
  GitBranch,
  HardDrive,
  ShieldCheck
} from 'lucide-react';
import type {
  SystemApiLog,
  ApiLogService,
  LogSeverity,
  QueueJobEntry,
  ConversationLockEntry,
  ServiceHealthProbe,
} from '../types';

interface SystemLogsViewProps {
  onRefreshStats?: () => void;
}

interface DiagnosticsSummary {
  services: {
    backend: ServiceHealthProbe;
    supabase: ServiceHealthProbe;
    evolution: ServiceHealthProbe;
    openai: ServiceHealthProbe;
    odoo: ServiceHealthProbe;
  };
  queueStats: {
    total: number;
    pending: number;
    processing: number;
    retry: number;
    failed: number;
    completed: number;
  };
  queueJobs: QueueJobEntry[];
  activeLocks: ConversationLockEntry[];
  pendingSyncCount: number;
  lastWebhookAt: string | null;
}

export const SystemLogsView: React.FC<SystemLogsViewProps> = ({ onRefreshStats }) => {
  const [logs, setLogs] = useState<SystemApiLog[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [serviceFilter, setServiceFilter] = useState<'all' | ApiLogService>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'success'>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | LogSeverity>('all');
  const [correlationFilter, setCorrelationFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingPing, setTestingPing] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    backend?: { ok: boolean; status: number; details?: string };
    supabase?: { ok: boolean; status: number; details?: string };
    evolution?: { ok: boolean; status: number; state?: string; details?: string };
    odoo?: { ok: boolean; status: number; serverVersion?: string; error?: string };
    openai?: { ok: boolean; status: number; model?: string; reply?: string; error?: string };
  } | null>(null);

  const getAuthHeaders = (extra?: Record<string, string>) => {
    const token = localStorage.getItem('vendema_auth_token');
    return {
      ...(extra || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/system/logs', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        if (data.diagnostics) {
          setDiagnostics(data.diagnostics);
        }
      }
    } catch (err) {
      console.warn('[SystemLogs]: Error al cargar registros', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const handleClearLogs = async () => {
    if (!window.confirm('¿Deseas vaciar el historial de registros del sistema?')) return;
    try {
      await fetch('/api/system/logs/clear', { method: 'POST', headers: getAuthHeaders() });
      await fetchLogs();
    } catch {}
  };

  const handleTestPing = async () => {
    setTestingPing(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/system/logs/test-ping', { method: 'POST', headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTestResult(data.results);
      }
      await fetchLogs(true);
      if (onRefreshStats) onRefreshStats();
    } catch (err: any) {
      console.warn('[SystemLogs Ping Error]:', err);
    } finally {
      setTestingPing(false);
    }
  };

  const handleRetryQueueJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      await fetch(`/api/system/queue/retry/${encodeURIComponent(jobId)}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      await fetchLogs(true);
    } catch (err) {
      console.warn('[Queue Retry Error]:', err);
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleReleaseLocks = async (conversationId?: string) => {
    try {
      await fetch('/api/system/locks/release', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(conversationId ? { conversationId } : {}),
      });
      await fetchLogs(true);
    } catch (err) {
      console.warn('[Release Lock Error]:', err);
    }
  };

  const handleClearQueue = async () => {
    try {
      await fetch('/api/system/queue/clear', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      await fetchLogs(true);
    } catch (err) {
      console.warn('[Clear Queue Error]:', err);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredLogs = logs.filter(log => {
    if (serviceFilter !== 'all' && log.service !== serviceFilter) return false;
    if (statusFilter === 'error' && log.success && (!log.statusCode || log.statusCode < 400)) return false;
    if (statusFilter === 'success' && (!log.success || (log.statusCode && log.statusCode >= 400))) return false;
    if (severityFilter !== 'all' && log.severity !== severityFilter) return false;
    if (correlationFilter && log.correlationId !== correlationFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        log.action.toLowerCase().includes(q) ||
        log.service.toLowerCase().includes(q) ||
        (log.target && log.target.toLowerCase().includes(q)) ||
        (log.customer && log.customer.toLowerCase().includes(q)) ||
        (log.correlationId && log.correlationId.toLowerCase().includes(q)) ||
        (log.stage && log.stage.toLowerCase().includes(q)) ||
        (log.messageId && log.messageId.toLowerCase().includes(q)) ||
        (log.requestPreview && log.requestPreview.toLowerCase().includes(q)) ||
        (log.responseSnippet && log.responseSnippet.toLowerCase().includes(q)) ||
        (log.error && log.error.toLowerCase().includes(q)) ||
        (log.statusCode && String(log.statusCode).includes(q));
      if (!match) return false;
    }
    return true;
  });

  const totalErrors = logs.filter(l => !l.success || (l.statusCode && l.statusCode >= 400)).length;
  const criticalCount = logs.filter(l => l.severity === 'CRITICAL' || l.severity === 'HIGH').length;

  const getHealthBadgeStyle = (status?: ServiceHealthProbe['status']) => {
    switch (status) {
      case 'CONNECTED':
        return {
          dot: 'bg-emerald-400 animate-pulse',
          text: 'text-emerald-300',
          border: 'border-emerald-500/30',
          bg: 'bg-emerald-950/40',
          label: 'CONNECTED',
        };
      case 'DEGRADED':
        return {
          dot: 'bg-amber-400 animate-pulse',
          text: 'text-amber-300',
          border: 'border-amber-500/30',
          bg: 'bg-amber-950/40',
          label: 'DEGRADED',
        };
      case 'DISCONNECTED':
        return {
          dot: 'bg-rose-500',
          text: 'text-rose-300',
          border: 'border-rose-500/40',
          bg: 'bg-rose-950/40',
          label: 'DISCONNECTED',
        };
      default:
        return {
          dot: 'bg-slate-500',
          text: 'text-slate-400',
          border: 'border-white/[0.08]',
          bg: 'bg-slate-900/60',
          label: 'UNKNOWN',
        };
    }
  };

  const getStatusBadge = (log: SystemApiLog) => {
    const code = log.statusCode;
    if (!log.success || (code && code >= 500) || code === 0) {
      return {
        bg: 'bg-rose-950/80 border-rose-500/40 text-rose-300',
        label: code ? `HTTP ${code}` : 'ERROR',
        icon: XCircle,
      };
    }
    if (code && code >= 400) {
      return {
        bg: 'bg-amber-950/80 border-amber-500/40 text-amber-300',
        label: `HTTP ${code}`,
        icon: AlertTriangle,
      };
    }
    return {
      bg: 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300',
      label: log.method === 'TRACE' ? 'STAGE OK' : code ? `HTTP ${code}` : '200 OK',
      icon: CheckCircle2,
    };
  };

  const getSeverityBadge = (severity?: LogSeverity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-rose-600/30 border-rose-500/60 text-rose-200';
      case 'HIGH':
        return 'bg-orange-950/80 border-orange-500/50 text-orange-300';
      case 'MEDIUM':
        return 'bg-amber-950/80 border-amber-500/40 text-amber-300';
      case 'LOW':
        return 'bg-slate-800 border-slate-600 text-slate-300';
      default:
        return 'bg-slate-800/70 border-white/[0.06] text-slate-400';
    }
  };

  const getServiceIcon = (service: ApiLogService) => {
    switch (service) {
      case 'Evolution API':
        return <MessageSquare className="w-3.5 h-3.5 text-lime-400" />;
      case 'Odoo ERP':
        return <Database className="w-3.5 h-3.5 text-purple-400" />;
      case 'AI Engine':
        return <Cpu className="w-3.5 h-3.5 text-sky-400" />;
      case 'Supabase':
        return <HardDrive className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Server className="w-3.5 h-3.5 text-slate-300" />;
    }
  };

  const serviceCards: Array<{
    key: string;
    title: string;
    probe?: ServiceHealthProbe;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      key: 'backend',
      title: 'Backend Node.js',
      probe: diagnostics?.services.backend,
      icon: <Server className="w-4 h-4 text-slate-200" />,
      accent: 'bg-slate-800/80 border-white/10',
    },
    {
      key: 'supabase',
      title: 'Supabase Cloud',
      probe: diagnostics?.services.supabase,
      icon: <HardDrive className="w-4 h-4 text-emerald-400" />,
      accent: 'bg-emerald-950/60 border-emerald-500/30',
    },
    {
      key: 'evolution',
      title: 'Evolution API (WA)',
      probe: diagnostics?.services.evolution,
      icon: <MessageSquare className="w-4 h-4 text-lime-400" />,
      accent: 'bg-lime-950/60 border-lime-500/30',
    },
    {
      key: 'openai',
      title: 'OpenAI (GPT/Whisper)',
      probe: diagnostics?.services.openai,
      icon: <Cpu className="w-4 h-4 text-sky-400" />,
      accent: 'bg-sky-950/60 border-sky-500/30',
    },
    {
      key: 'odoo',
      title: 'Odoo ERP Inventario',
      probe: diagnostics?.services.odoo,
      icon: <Database className="w-4 h-4 text-purple-400" />,
      accent: 'bg-purple-950/60 border-purple-500/30',
    },
  ];

  const qStats = diagnostics?.queueStats || {
    total: 0,
    pending: 0,
    processing: 0,
    retry: 0,
    failed: 0,
    completed: 0,
  };

  return (
    <div className="space-y-5">
      {/* 5-Service Health Monitor Grid (Fase 1.8) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {serviceCards.map(card => {
          const st = getHealthBadgeStyle(card.probe?.status);
          return (
            <div
              key={card.key}
              className="p-3.5 rounded-2xl bg-[#0F141C] border border-white/[0.07] flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider truncate">
                  {card.title}
                </span>
                <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${card.accent}`}>
                  {card.icon}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border font-mono ${st.bg} ${st.border} ${st.text}`}
                >
                  <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                  <span>{st.label}</span>
                </span>
                {card.probe?.responseTimeMs !== undefined && card.probe.responseTimeMs > 0 && (
                  <span className="text-[10px] text-slate-400 font-mono">{card.probe.responseTimeMs}ms</span>
                )}
              </div>

              <p className="text-[11px] text-slate-400 truncate" title={card.probe?.details || card.probe?.error || ''}>
                {card.probe?.error || card.probe?.details || 'Verificando estado...'}
              </p>
            </div>
          );
        })}
      </div>

      {/* Operational & Queue Resilience Bar (Sección 12) */}
      <div className="p-3.5 rounded-2xl bg-[#0B0F17] border border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowQueuePanel(!showQueuePanel)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border font-semibold transition-all ${
              showQueuePanel
                ? 'bg-lime-500/20 border-lime-500/50 text-lime-300'
                : 'bg-slate-900 border-white/[0.08] text-slate-200 hover:border-white/20'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-lime-400" />
            <span>Cola Persistente:</span>
            <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-slate-800 text-lime-300">
              {qStats.pending + qStats.processing} activas
            </span>
            {qStats.retry > 0 && (
              <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-500/30">
                {qStats.retry} retry
              </span>
            )}
            {qStats.failed > 0 && (
              <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-500/30">
                {qStats.failed} fallidas
              </span>
            )}
            <span className="text-[10px] text-slate-400 font-mono">({qStats.completed} ok)</span>
          </button>

          {/* Active Conversation Locks */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/[0.07] text-slate-300">
            <Lock className="w-3.5 h-3.5 text-sky-400" />
            <span>Locks Activos:</span>
            <span className="font-mono font-bold text-white">{diagnostics?.activeLocks?.length || 0}</span>
            {(diagnostics?.activeLocks?.length || 0) > 0 && (
              <button
                type="button"
                onClick={() => handleReleaseLocks()}
                className="ml-1 px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-200 text-[10px] flex items-center gap-1 border border-rose-500/30"
                title="Liberar bloqueos activos manualmente"
              >
                <Unlock className="w-2.5 h-2.5" />
                <span>Liberar</span>
              </button>
            )}
          </div>

          {/* Pending Supabase Syncs */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/[0.07] text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sync Pendiente Supabase:</span>
            <span
              className={`font-mono font-bold ${
                (diagnostics?.pendingSyncCount || 0) > 0 ? 'text-amber-300' : 'text-emerald-400'
              }`}
            >
              {diagnostics?.pendingSyncCount || 0}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
          <span>
            Último Webhook:{' '}
            <b className="text-slate-200">
              {diagnostics?.lastWebhookAt
                ? new Date(diagnostics.lastWebhookAt).toLocaleTimeString('es-DO', {
                    timeZone: 'America/Santo_Domingo',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true,
                  })
                : 'En espera'}
            </b>
          </span>
          {criticalCount > 0 && (
            <span className="px-2 py-0.5 rounded-md bg-rose-950/80 border border-rose-500/40 text-rose-300 font-bold">
              {criticalCount} Críticos/Altos
            </span>
          )}
        </div>
      </div>

      {/* Expandable Persistent Queue & Locks Inspector */}
      {showQueuePanel && diagnostics && (
        <div className="p-4 rounded-2xl bg-[#0F141C] border border-lime-500/30 space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Layers className="w-4 h-4 text-lime-400" />
              <span>Monitor de Cola Persistente (.vendema-job-queue.json) y Bloqueos Atómicos</span>
            </div>
            <div className="flex items-center gap-2">
              {diagnostics.queueJobs.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearQueue}
                  className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/30 text-rose-200 text-[11px] font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Limpiar Historial de Cola</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowQueuePanel(false)}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                Ocultar cola
              </button>
            </div>
          </div>

          {diagnostics.queueJobs.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              No hay tareas registradas en la cola persistente todavía.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {diagnostics.queueJobs.slice(0, 25).map(job => (
                <div
                  key={job.id}
                  className="p-2.5 rounded-xl bg-slate-900/80 border border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                        job.status === 'COMPLETED'
                          ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                          : job.status === 'PROCESSING' || job.status === 'PENDING'
                          ? 'bg-sky-950/80 border-sky-500/40 text-sky-300'
                          : job.status === 'RETRY'
                          ? 'bg-amber-950/80 border-amber-500/40 text-amber-300'
                          : 'bg-rose-950/80 border-rose-500/40 text-rose-300'
                      }`}
                    >
                      {job.status} ({job.attempts}/{job.maxAttempts})
                    </span>
                    <span className="font-bold text-white truncate">{job.customer}</span>
                    <span className="text-[11px] text-slate-400 font-mono">Msg: {job.messageId}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setCorrelationFilter(job.correlationId);
                        setShowQueuePanel(false);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-lime-300 font-mono text-[10px]"
                      title="Filtrar logs por este correlation_id"
                    >
                      <GitBranch className="w-3 h-3" />
                      <span>{job.correlationId}</span>
                    </button>
                    {job.lastError && (
                      <span className="text-[11px] text-rose-300 font-mono truncate max-w-md">
                        ⚠️ {job.lastError}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(job.receivedAt).toLocaleTimeString('es-DO', {
                        timeZone: 'America/Santo_Domingo',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      })}
                    </span>
                    {(job.status === 'FAILED' || job.status === 'DEAD_LETTER' || job.status === 'RETRY') && (
                      <button
                        type="button"
                        onClick={() => handleRetryQueueJob(job.id)}
                        disabled={retryingJobId === job.id}
                        className="px-2.5 py-1 rounded-lg bg-lime-500/20 hover:bg-lime-500/30 border border-lime-500/40 text-lime-300 text-[11px] font-semibold flex items-center gap-1"
                      >
                        <RotateCcw className={`w-3 h-3 ${retryingJobId === job.id ? 'animate-spin' : ''}`} />
                        <span>Reintentar</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Test Diagnostic Result Alert if recently run */}
      {testResult && (
        <div className="p-4 rounded-2xl bg-[#0B0F17] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Zap className="w-4 h-4 text-lime-400" />
              <span>Resultado de Diagnóstico en Vivo de los 5 Servicios</span>
            </div>
            <button
              onClick={() => setTestResult(null)}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Cerrar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div
              className={`p-3 rounded-xl border ${
                testResult.evolution?.ok
                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                  : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>WhatsApp / Evolution API:</span>
                <span className="font-mono">HTTP {testResult.evolution?.status || 'N/A'}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">
                Estado del socket: <b>{testResult.evolution?.state || 'N/A'}</b>
              </p>
              {testResult.evolution?.details && (
                <p className="mt-1 text-[10px] text-slate-400 font-mono truncate">
                  {testResult.evolution.details}
                </p>
              )}
            </div>

            <div
              className={`p-3 rounded-xl border ${
                testResult.odoo?.ok
                  ? 'bg-purple-950/30 border-purple-500/30 text-purple-200'
                  : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>Odoo ERP / Inventario:</span>
                <span className="font-mono">HTTP {testResult.odoo?.status || 'N/A'}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">
                Versión Servidor:{' '}
                <b>{testResult.odoo?.serverVersion || testResult.odoo?.error || 'OK'}</b>
              </p>
            </div>

            <div
              className={`p-3 rounded-xl border ${
                testResult.openai?.ok
                  ? 'bg-sky-950/30 border-sky-500/30 text-sky-200'
                  : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>OpenAI (AI Engine):</span>
                <span className="font-mono">HTTP {testResult.openai?.status || 'N/A'}</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">
                {testResult.openai?.ok
                  ? `Modelo activo: ${testResult.openai.model || 'gpt-4o-mini'}`
                  : `Error: ${testResult.openai?.error || 'Fallo de autenticación'}`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Control Bar: Filters, Search, Diagnostics */}
      <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Service Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" />
              <span>Servicio:</span>
            </span>
            {(['all', 'Backend', 'Supabase', 'Evolution API', 'Odoo ERP', 'AI Engine'] as const).map(svc => (
              <button
                key={svc}
                type="button"
                onClick={() => setServiceFilter(svc)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  serviceFilter === svc
                    ? 'bg-lime-500/20 border border-lime-500/50 text-lime-300 shadow-sm'
                    : 'bg-slate-800/60 border border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {svc === 'all' ? 'Todos' : svc}
              </button>
            ))}
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Auto refresh toggle */}
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                autoRefresh
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-800/60 border-white/[0.06] text-slate-400'
              }`}
              title="Actualiza los logs automáticamente cada 4 segundos"
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse text-emerald-400' : ''}`} />
              <span>{autoRefresh ? 'Auto-refresco Activo' : 'Auto-refresco Pausado'}</span>
            </button>

            {/* Test Ping Diagnostic */}
            <button
              type="button"
              onClick={handleTestPing}
              disabled={testingPing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-xs font-semibold transition-all disabled:opacity-50"
              title="Envía una prueba de conexión a los 5 servicios en vivo"
            >
              <Zap className={`w-3.5 h-3.5 text-purple-400 ${testingPing ? 'animate-bounce' : ''}`} />
              <span>{testingPing ? 'Probando...' : 'Diagnóstico en Vivo'}</span>
            </button>

            {/* Manual Refresh */}
            <button
              type="button"
              onClick={() => fetchLogs()}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-white/[0.06] text-slate-300 transition-all disabled:opacity-50"
              title="Recargar registros ahora"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-lime-400' : ''}`} />
            </button>

            {/* Clear Logs */}
            <button
              type="button"
              onClick={handleClearLogs}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/60 hover:text-rose-300 border border-white/[0.06] hover:border-rose-500/40 text-slate-400 transition-all"
              title="Vaciar registros del sistema"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Second Row: Status Filter, Severity Filter, Active Correlation Chip & Search Input */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-bold text-slate-400 mr-1">Estado:</span>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  statusFilter === 'all'
                    ? 'bg-slate-700/80 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Todos ({logs.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('error')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  statusFilter === 'error'
                    ? 'bg-rose-950/80 border border-rose-500/50 text-rose-300'
                    : 'text-rose-400 hover:text-rose-300'
                }`}
              >
                <XCircle className="w-3 h-3" />
                <span>Errores ({totalErrors})</span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('success')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  statusFilter === 'success'
                    ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300'
                    : 'text-emerald-400 hover:text-emerald-300'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>OK ({logs.length - totalErrors})</span>
              </button>
            </div>

            {/* Severity Filter */}
            <div className="flex items-center gap-1 pl-2 border-l border-white/[0.06]">
              <span className="text-[11px] font-bold text-slate-400 mr-1">Severidad:</span>
              {(['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'INFO'] as const).map(sev => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition-all ${
                    severityFilter === sev
                      ? 'bg-lime-500/20 border border-lime-500/50 text-lime-300'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sev === 'all' ? 'TODAS' : sev}
                </button>
              ))}
            </div>

            {/* Active Correlation Trace Filter Badge */}
            {correlationFilter && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-lime-950/80 border border-lime-500/50 text-lime-300 text-xs font-mono">
                <GitBranch className="w-3.5 h-3.5" />
                <span>Traza: {correlationFilter}</span>
                <button
                  type="button"
                  onClick={() => setCorrelationFilter('')}
                  className="ml-1 text-lime-200 hover:text-white font-bold"
                  title="Quitar filtro de traza"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Search box */}
          <div className="relative flex-1 lg:max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por correlation_id, cliente, etapa o error..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-900/90 border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-lime-500/50"
            />
          </div>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
            <span>Llamadas API y Trazabilidad de Mensajes (Correlation Trace)</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-mono">
              {filteredLogs.length} de {logs.length}
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Haz clic en cualquier correlation_id para ver las 16 etapas completas de un mensaje
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-lime-400" />
            <span>Cargando registros del sistema...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs space-y-2">
            <CheckCircle2 className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-medium text-slate-300">No se encontraron registros con los filtros actuales</p>
            <p className="text-[11px] text-slate-500">
              Prueba cambiando el filtro de servicio o realizando una prueba de diagnóstico en vivo.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredLogs.map(log => {
              const badge = getStatusBadge(log);
              const isExpanded = expandedLogId === log.id;
              const formattedTime = new Date(log.timestamp).toLocaleTimeString('es-DO', {
                timeZone: 'America/Santo_Domingo',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              });

              return (
                <div
                  key={log.id}
                  className={`rounded-xl border transition-all ${
                    !log.success || (log.statusCode && log.statusCode >= 400)
                      ? 'bg-rose-950/20 border-rose-500/30'
                      : 'bg-slate-900/60 border-white/[0.06] hover:border-white/[0.12]'
                  }`}
                >
                  {/* Summary Bar */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                      {/* Status Pill */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border font-mono shrink-0 ${badge.bg}`}
                      >
                        <badge.icon className="w-3.5 h-3.5 shrink-0" />
                        <span>{badge.label}</span>
                      </span>

                      {/* Severity Pill */}
                      {log.severity && log.severity !== 'INFO' && (
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border shrink-0 ${getSeverityBadge(
                            log.severity
                          )}`}
                        >
                          {log.severity}
                        </span>
                      )}

                      {/* Service Badge */}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-bold text-slate-300 shrink-0 border border-white/[0.05]">
                        {getServiceIcon(log.service)}
                        <span>{log.service}</span>
                      </span>

                      {/* Action, Stage & Correlation ID */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-slate-100 truncate">
                            {log.action}
                          </span>
                          {log.stage && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-950/80 border border-sky-500/30 text-sky-300">
                              {log.stage}
                            </span>
                          )}
                          {log.correlationId && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setCorrelationFilter(
                                  correlationFilter === log.correlationId ? '' : log.correlationId!
                                );
                              }}
                              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 hover:bg-lime-950 text-lime-300 border border-white/[0.06]"
                              title="Filtrar todas las etapas de este correlation_id"
                            >
                              <GitBranch className="w-2.5 h-2.5" />
                              <span>{log.correlationId}</span>
                            </button>
                          )}
                          {log.customer && (
                            <span className="text-[10px] text-slate-300 bg-slate-800/80 px-1.5 py-0.2 rounded">
                              👤 {log.customer}
                            </span>
                          )}
                        </div>

                        {log.target && (
                          <span className="text-[11px] text-lime-400 font-mono block mt-0.5">
                            Destino: {log.target}
                          </span>
                        )}

                        {log.requestPreview && !log.target && (
                          <span className="text-[11px] text-slate-400 truncate block mt-0.5">
                            {log.requestPreview}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side: Latency & Time */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      {log.durationMs !== undefined && log.durationMs > 0 && (
                        <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>{log.durationMs}ms</span>
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 font-mono">{formattedTime}</span>
                      <div className="text-slate-400">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-slate-300" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Error snippet callout if failed */}
                  {(!log.success || (log.statusCode && log.statusCode >= 400)) && log.error && (
                    <div className="mx-3 mb-2.5 p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-all">
                        {log.error}
                      </div>
                    </div>
                  )}

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="p-3.5 border-t border-white/[0.06] bg-[#070A0F] rounded-b-xl space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 font-mono">
                        {log.correlationId && (
                          <div>
                            <span className="text-slate-500">Correlation ID: </span>
                            <span className="text-lime-300">{log.correlationId}</span>
                          </div>
                        )}
                        {log.conversationId && (
                          <div>
                            <span className="text-slate-500">Conversación: </span>
                            <span className="text-slate-200">{log.conversationId}</span>
                          </div>
                        )}
                        {log.messageId && (
                          <div>
                            <span className="text-slate-500">Message ID: </span>
                            <span className="text-slate-200">{log.messageId}</span>
                          </div>
                        )}
                      </div>

                      {log.url && (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-semibold text-slate-300">Endpoint / URL:</span>
                          <span className="font-mono text-slate-400 truncate max-w-md">{log.url}</span>
                        </div>
                      )}

                      {log.requestPreview && (
                        <div>
                          <div className="text-[11px] font-semibold text-slate-300 mb-1">
                            Datos de Solicitud / Contexto:
                          </div>
                          <pre className="p-2.5 rounded-lg bg-slate-950 border border-white/[0.05] text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all">
                            {log.requestPreview}
                          </pre>
                        </div>
                      )}

                      {log.responseSnippet && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-slate-300">
                              Respuesta de la API / Detalle:
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(log.id, log.responseSnippet || '')}
                              className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 font-mono"
                            >
                              {copiedId === log.id ? (
                                <>
                                  <Check className="w-3 h-3 text-lime-400" />
                                  <span className="text-lime-400">Copiado</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copiar Respuesta</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="p-2.5 rounded-lg bg-slate-950 border border-white/[0.05] text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                            {log.responseSnippet}
                          </pre>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 font-mono">
                        <span>ID: {log.id}</span>
                        <span>ISO: {log.timestamp}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

