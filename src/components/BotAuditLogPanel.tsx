import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  Trash2, 
  Search, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Zap, 
  MessageSquare, 
  Phone, 
  ChevronDown, 
  ChevronUp,
  Activity,
  Filter
} from 'lucide-react';
import type { BotAuditLogEntry, BotDecisionType } from '../types';

interface BotAuditStats {
  total: number;
  sent: number;
  blocked: number;
  errors: number;
  avgDurationMs: number;
  inFlightCount: number;
  activeCooldowns: number;
}

interface BotAuditLogPanelProps {
  initialSearchTerm?: string;
  onClose?: () => void;
}

export const BotAuditLogPanel: React.FC<BotAuditLogPanelProps> = ({
  initialSearchTerm = '',
  onClose,
}) => {
  const [logs, setLogs] = useState<BotAuditLogEntry[]>([]);
  const [stats, setStats] = useState<BotAuditStats>({
    total: 0,
    sent: 0,
    blocked: 0,
    errors: 0,
    avgDurationMs: 0,
    inFlightCount: 0,
    activeCooldowns: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [filterDecision, setFilterDecision] = useState<'all' | 'sent' | 'blocked' | 'error'>('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchAuditLogs = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch('/api/admin/bot-audit-log');
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (err) {
      console.warn('Error fetching bot audit logs:', err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuditLogs();

    // Listen to real-time events from server
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'bot_audit_update') {
          if (payload.payload?.type === 'clear') {
            setLogs([]);
            setStats({
              total: 0,
              sent: 0,
              blocked: 0,
              errors: 0,
              avgDurationMs: 0,
              inFlightCount: 0,
              activeCooldowns: 0,
            });
          } else if (payload.payload?.id) {
            const newEntry: BotAuditLogEntry = payload.payload;
            setLogs((prev) => [newEntry, ...prev.filter((l) => l.id !== newEntry.id)].slice(0, 300));
            setStats((prev) => {
              const isSent = newEntry.decision === 'sent';
              const isBlocked = newEntry.decision.startsWith('blocked_');
              const isErr = newEntry.decision === 'error';
              return {
                ...prev,
                total: prev.total + 1,
                sent: isSent ? prev.sent + 1 : prev.sent,
                blocked: isBlocked ? prev.blocked + 1 : prev.blocked,
                errors: isErr ? prev.errors + 1 : prev.errors,
              };
            });
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    // Auto-poll every 5 seconds as fallback
    const interval = setInterval(() => {
      fetchAuditLogs(true);
    }, 5000);

    return () => {
      eventSource.close();
      clearInterval(interval);
    };
  }, [fetchAuditLogs]);

  const handleClearLogs = async () => {
    if (!window.confirm('¿Deseas limpiar todo el registro de auditoría del bot?')) return;
    try {
      const res = await fetch('/api/admin/bot-audit-log/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLogs([]);
        setStats({
          total: 0,
          sent: 0,
          blocked: 0,
          errors: 0,
          avgDurationMs: 0,
          inFlightCount: 0,
          activeCooldowns: 0,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filterDecision === 'sent' && log.decision !== 'sent') return false;
    if (filterDecision === 'blocked' && !log.decision.startsWith('blocked_')) return false;
    if (filterDecision === 'error' && log.decision !== 'error') return false;

    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (log.customerName && log.customerName.toLowerCase().includes(term)) ||
      (log.customerPhone && log.customerPhone.includes(term)) ||
      (log.incomingText && log.incomingText.toLowerCase().includes(term)) ||
      (log.reason && log.reason.toLowerCase().includes(term)) ||
      (log.replyText && log.replyText.toLowerCase().includes(term))
    );
  });

  const getDecisionBadge = (decision: BotDecisionType) => {
    switch (decision) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Enviado a WhatsApp</span>
          </span>
        );
      case 'blocked_duplicate_id':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span>Duplicado ID Bloqueado</span>
          </span>
        );
      case 'blocked_duplicate_text':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
            <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />
            <span>Texto Repetido Bloqueado</span>
          </span>
        );
      case 'blocked_cooldown':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            <Clock className="w-3.5 h-3.5" />
            <span>Cooldown Activo (Anti-Spam)</span>
          </span>
        );
      case 'blocked_in_flight':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
            <Zap className="w-3.5 h-3.5" />
            <span>Respuesta en Proceso</span>
          </span>
        );
      case 'blocked_already_answered':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-500/15 text-slate-300 border border-slate-500/30">
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat ya Respondido</span>
          </span>
        );
      case 'blocked_group':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-700/30 text-slate-400 border border-slate-700/50">
            <span>Grupo Excluido</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Error en Envío</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300">
            <span>{decision}</span>
          </span>
        );
    }
  };

  const getTriggerSourceLabel = (src: string) => {
    switch (src) {
      case 'live_evolution_poll':
        return 'Sincronización WhatsApp (2s)';
      case 'evolution_webhook':
        return 'Webhook en Tiempo Real';
      case 'manual_crm_trigger':
        return 'Disparo Manual en CRM';
      case 'outbound_dispatch_guard':
        return 'Filtro Pre-Despacho';
      default:
        return src;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Registro de Auditoría de Envíos & Diagnóstico de Duplicados
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              EN VIVO
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Auditoría detallada de cada mensaje entrante de WhatsApp, decisión tomada por el bot y razón técnica de cualquier duplicado prevenido.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => fetchAuditLogs()}
            disabled={isLoading}
            className="px-3 py-2 rounded-xl bg-[#121822] hover:bg-[#18202E] border border-white/[0.08] text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            title="Refrescar auditoría"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-lime-400' : ''}`} />
            <span>Actualizar</span>
          </button>
          <button
            onClick={handleClearLogs}
            className="px-3 py-2 rounded-xl bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/40 text-xs font-semibold text-rose-300 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Limpiar registro"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpiar</span>
          </button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Evaluaciones Totales</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1">{stats.total}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Mensajes analizados por el motor</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-emerald-500/20 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400 font-medium">Respuestas Entregadas</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-300 mt-1">{stats.sent}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Despachadas a WhatsApp</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-amber-500/20 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-300 font-medium">Duplicados Bloqueados</span>
            <ShieldCheck className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 mt-1">{stats.blocked}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Protegidos contra spam</div>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Latencia Promedio</span>
            <Clock className="w-4 h-4 text-lime-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1">
            {stats.avgDurationMs ? `${stats.avgDurationMs}ms` : '< 200ms'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Tiempo de generación y envío</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-[#0F141C] border border-white/[0.06]">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por cliente, teléfono, mensaje o motivo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[#121822] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-lime-500/50"
          />
        </div>

        <div className="flex items-center gap-1 bg-[#121822] p-1 rounded-lg border border-white/[0.06] text-xs shrink-0">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
          <button
            onClick={() => setFilterDecision('all')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
              filterDecision === 'all'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos ({logs.length})
          </button>
          <button
            onClick={() => setFilterDecision('sent')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
              filterDecision === 'sent'
                ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                : 'text-slate-400 hover:text-emerald-300'
            }`}
          >
            Enviados ({stats.sent})
          </button>
          <button
            onClick={() => setFilterDecision('blocked')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
              filterDecision === 'blocked'
                ? 'bg-amber-500/20 text-amber-300 font-bold'
                : 'text-slate-400 hover:text-amber-300'
            }`}
          >
            Duplicados ({stats.blocked})
          </button>
          <button
            onClick={() => setFilterDecision('error')}
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-all ${
              filterDecision === 'error'
                ? 'bg-rose-500/20 text-rose-300 font-bold'
                : 'text-slate-400 hover:text-rose-300'
            }`}
          >
            Errores ({stats.errors})
          </button>
        </div>
      </div>

      {/* Logs Table / Cards */}
      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-2">
            <ShieldCheck className="w-10 h-10 mx-auto text-emerald-400/60" />
            <h3 className="text-sm font-bold text-white">No hay registros con los filtros seleccionados</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Cada vez que un cliente escriba a WhatsApp o el bot evalúe un mensaje, verás aquí el diagnóstico exacto de por qué se envió o por qué se bloqueó como duplicado.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            const isSent = log.decision === 'sent';
            const isBlocked = log.decision.startsWith('blocked_');

            return (
              <div
                key={log.id}
                className={`p-4 rounded-xl border transition-all ${
                  isSent
                    ? 'bg-[#0F141C] border-emerald-500/25'
                    : isBlocked
                    ? 'bg-[#0F141C] border-amber-500/20'
                    : 'bg-[#0F141C] border-white/[0.06]'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Timestamp RD */}
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#121822] text-cyan-300 border border-white/[0.06]">
                      {log.timeRd || 'RD'}
                    </span>

                    {/* Decision Badge */}
                    {getDecisionBadge(log.decision)}

                    {/* Trigger source */}
                    <span className="text-[11px] text-slate-400">
                      vía <span className="text-slate-300 font-medium">{getTriggerSourceLabel(log.triggerSource)}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    {/* Latency */}
                    {log.durationMs > 0 && (
                      <span className="text-slate-400 font-mono text-[11px]">
                        ⏱️ {log.durationMs}ms
                      </span>
                    )}

                    <button
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors text-xs font-semibold"
                    >
                      <span>{isExpanded ? 'Ocultar' : 'Detalles'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Customer and Summary Row */}
                <div className="mt-3 flex flex-col md:flex-row md:items-center justify-between gap-2 pt-2.5 border-t border-white/[0.04]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-white">{log.customerName}</span>
                    {log.customerPhone && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400">
                        <Phone className="w-3 h-3 text-slate-500" />
                        +{log.customerPhone}
                      </span>
                    )}
                  </div>

                  {log.incomingText && (
                    <div className="text-xs text-slate-300 italic truncate max-w-lg">
                      &ldquo;{log.incomingText}&rdquo;
                    </div>
                  )}
                </div>

                {/* Diagnostic Reason Highlight */}
                <div className="mt-2 text-xs text-slate-300 flex items-start gap-1.5">
                  <span className="font-semibold text-slate-400 shrink-0">Diagnóstico:</span>
                  <span className={isSent ? 'text-emerald-300' : isBlocked ? 'text-amber-300' : 'text-slate-200'}>
                    {log.reason}
                  </span>
                </div>

                {/* Expanded Details View */}
                {isExpanded && (
                  <div className="mt-3.5 pt-3 border-t border-white/[0.06] space-y-2.5 text-xs">
                    {log.replyText && (
                      <div className="p-3 rounded-lg bg-[#121822] border border-emerald-500/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block">
                          Respuesta Despachada al Cliente
                        </span>
                        <p className="text-xs text-slate-200 whitespace-pre-wrap">{log.replyText}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 bg-[#121822] p-2.5 rounded-lg border border-white/[0.04]">
                      <div>
                        <span className="text-slate-500">ID Mensaje Entrante:</span> {log.incomingMessageId || 'N/A'}
                      </div>
                      <div>
                        <span className="text-slate-500">ID Despacho WhatsApp:</span> {log.evolutionMessageId || 'N/A'}
                      </div>
                      <div>
                        <span className="text-slate-500">Timestamp ISO:</span> {log.timestamp}
                      </div>
                      <div>
                        <span className="text-slate-500">Session ID:</span> {log.sessionId}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
