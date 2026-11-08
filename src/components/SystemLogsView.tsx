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
  ExternalLink
} from 'lucide-react';
import type { SystemApiLog, ApiLogService } from '../types';

interface SystemLogsViewProps {
  onRefreshStats?: () => void;
}

export const SystemLogsView: React.FC<SystemLogsViewProps> = ({ onRefreshStats }) => {
  const [logs, setLogs] = useState<SystemApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [serviceFilter, setServiceFilter] = useState<'all' | ApiLogService>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'success'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingPing, setTestingPing] = useState(false);
  const [testResult, setTestResult] = useState<{
    evolution?: { ok: boolean; status: number; state?: string; details?: string };
    odoo?: { ok: boolean; status: number; serverVersion?: string; error?: string };
    openai?: { ok: boolean; status: number; model?: string; reply?: string; error?: string };
  } | null>(null);

  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/system/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
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
      await fetch('/api/system/logs/clear', { method: 'POST' });
      await fetchLogs();
    } catch {}
  };

  const handleTestPing = async () => {
    setTestingPing(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/system/logs/test-ping', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTestResult(data.results);
      }
      await fetchLogs(true);
    } catch (err: any) {
      console.warn('[SystemLogs Ping Error]:', err);
    } finally {
      setTestingPing(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredLogs = logs.filter(log => {
    if (serviceFilter !== 'all' && log.service !== serviceFilter) return false;
    if (statusFilter === 'error' && (log.success && (!log.statusCode || log.statusCode < 400))) return false;
    if (statusFilter === 'success' && (!log.success || (log.statusCode && log.statusCode >= 400))) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        log.action.toLowerCase().includes(q) ||
        log.service.toLowerCase().includes(q) ||
        (log.target && log.target.toLowerCase().includes(q)) ||
        (log.requestPreview && log.requestPreview.toLowerCase().includes(q)) ||
        (log.responseSnippet && log.responseSnippet.toLowerCase().includes(q)) ||
        (log.error && log.error.toLowerCase().includes(q)) ||
        (log.statusCode && String(log.statusCode).includes(q));
      if (!match) return false;
    }
    return true;
  });

  const totalErrors = logs.filter(l => !l.success || (l.statusCode && l.statusCode >= 400)).length;
  const lastEvoLog = logs.find(l => l.service === 'Evolution API');
  const lastOdooLog = logs.find(l => l.service === 'Odoo ERP');
  const lastAiLog = logs.find(l => l.service === 'AI Engine');

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
      label: code ? `HTTP ${code}` : '200 OK',
      icon: CheckCircle2,
    };
  };

  const getServiceIcon = (service: ApiLogService) => {
    switch (service) {
      case 'Evolution API':
        return <MessageSquare className="w-3.5 h-3.5 text-lime-400" />;
      case 'Odoo ERP':
        return <Database className="w-3.5 h-3.5 text-purple-400" />;
      case 'AI Engine':
        return <Cpu className="w-3.5 h-3.5 text-sky-400" />;
      default:
        return <Server className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: OpenAI Engine Status */}
        <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              OpenAI (AI Engine)
            </span>
            <div className="text-sm font-bold text-white mt-1 flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  lastAiLog ? (lastAiLog.success ? 'bg-sky-400 animate-pulse' : 'bg-rose-500') : 'bg-slate-500'
                }`}
              />
              <span>
                {lastAiLog
                  ? lastAiLog.statusCode
                    ? `HTTP ${lastAiLog.statusCode}`
                    : lastAiLog.success
                    ? 'Conectado'
                    : 'Error'
                  : `${logs.length} regs`}
              </span>
              {lastAiLog?.durationMs ? (
                <span className="text-[11px] text-slate-500 font-mono">({lastAiLog.durationMs}ms)</span>
              ) : null}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Cpu className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Error Rate */}
        <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              Errores Detectados
            </span>
            <div className="text-2xl font-black mt-1 flex items-baseline gap-2">
              <span className={totalErrors > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {totalErrors}
              </span>
              <span className="text-[11px] font-normal text-slate-500">fallos 4xx / 5xx</span>
            </div>
          </div>
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
              totalErrors > 0
                ? 'bg-rose-950/60 border-rose-500/40 text-rose-400'
                : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
            }`}
          >
            {totalErrors > 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
        </div>

        {/* Card 3: Evolution WhatsApp Status */}
        <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              WhatsApp (Evolution API)
            </span>
            <div className="text-sm font-bold text-white mt-1 flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  lastEvoLog?.success ? 'bg-lime-400 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span>
                {lastEvoLog
                  ? lastEvoLog.statusCode
                    ? `Código ${lastEvoLog.statusCode}`
                    : lastEvoLog.success
                    ? 'Conectado'
                    : 'Error'
                  : 'Sin registros'}
              </span>
              {lastEvoLog?.durationMs ? (
                <span className="text-[11px] text-slate-500 font-mono">({lastEvoLog.durationMs}ms)</span>
              ) : null}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-lime-950/60 border border-lime-500/30 flex items-center justify-center text-lime-400">
            <MessageSquare className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Odoo ERP Status */}
        <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              Inventario (Odoo ERP)
            </span>
            <div className="text-sm font-bold text-white mt-1 flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  lastOdooLog?.success ? 'bg-purple-400' : 'bg-rose-500'
                }`}
              />
              <span>
                {lastOdooLog
                  ? lastOdooLog.statusCode
                    ? `Código ${lastOdooLog.statusCode}`
                    : lastOdooLog.success
                    ? 'Conectado'
                    : 'Error'
                  : 'Sin registros'}
              </span>
              {lastOdooLog?.durationMs ? (
                <span className="text-[11px] text-slate-500 font-mono">({lastOdooLog.durationMs}ms)</span>
              ) : null}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-950/60 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Database className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Test Diagnostic Result Alert if recently run */}
      {testResult && (
        <div className="p-4 rounded-2xl bg-[#0B0F17] border border-white/[0.08] space-y-3">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Zap className="w-4 h-4 text-lime-400" />
              <span>Resultado de Diagnóstico de Conexión en Vivo (Evolution API, Odoo & OpenAI)</span>
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
            {(['all', 'Evolution API', 'Odoo ERP', 'AI Engine'] as const).map(svc => (
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
                {svc === 'all' ? 'Todos los Servicios' : svc}
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
              title="Envía una prueba de conexión a Evolution API y Odoo en vivo"
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

        {/* Second Row: Status Filter & Search Input */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
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
              <span>Solo Errores ({totalErrors})</span>
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
              <span>Exitosos ({logs.length - totalErrors})</span>
            </button>
          </div>

          {/* Search box */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por teléfono, error o acción..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-900/90 border border-white/[0.08] rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-lime-500/50"
            />
          </div>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="p-4 rounded-2xl bg-[#0F141C] border border-white/[0.07] space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
            <span>Llamadas API Registradas</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-mono">
              {filteredLogs.length} de {logs.length}
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            Muestra el estado HTTP real y las respuestas de Evolution API y Odoo
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
              const formattedTime = new Date(log.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
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

                      {/* Service Badge */}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-bold text-slate-300 shrink-0 border border-white/[0.05]">
                        {getServiceIcon(log.service)}
                        <span>{log.service}</span>
                      </span>

                      {/* Action & Target */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-100 truncate">
                            {log.action}
                          </span>
                          {log.method && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                              {log.method}
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
                      {log.durationMs !== undefined && (
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
                      {log.url && (
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-semibold text-slate-300">Endpoint / URL:</span>
                          <span className="font-mono text-slate-400 truncate max-w-md">{log.url}</span>
                        </div>
                      )}

                      {log.requestPreview && (
                        <div>
                          <div className="text-[11px] font-semibold text-slate-300 mb-1">
                            Datos de Solicitud:
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
                              Respuesta de la API:
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
