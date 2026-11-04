import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  PlusCircle,
  Trash2,
  Clock,
  Sparkles,
  AlertCircle,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  Database,
  ChevronLeft,
  ChevronRight,
  FileCode,
  Copy,
  Check,
  RefreshCw,
  X
} from 'lucide-react';
import type { AppConfig, HolidayOverride } from '../types';
import {
  getDominicanTimeContext,
  getHolidaysWithOverridesForYear,
  getAvailableHolidayYears,
  formatHumanDateShortRD,
  buildHolidayOverridesSummaryText,
  setGlobalHolidayOverrides
} from '../utils/businessSchedule';
import { getHolidaysTableSql } from '../utils/supabaseService';

interface HolidayManagerPanelProps {
  config: AppConfig;
  onUpdateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  compact?: boolean;
}

export const HolidayManagerPanel: React.FC<HolidayManagerPanelProps> = ({
  config,
  onUpdateConfig,
  compact = false,
}) => {
  const [currentRd, setCurrentRd] = useState(() =>
    getDominicanTimeContext(new Date(), config.holidayOverrides || [])
  );

  useEffect(() => {
    const update = () => {
      setCurrentRd(getDominicanTimeContext(new Date(), config.holidayOverrides || []));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [config.holidayOverrides]);

  const [selectedYear, setSelectedYear] = useState<number>(currentRd.year);
  const [customMaxYear, setCustomMaxYear] = useState<number>(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [dbSyncedBadge, setDbSyncedBadge] = useState<boolean>(true);
  const [showHolidaysSql, setShowHolidaysSql] = useState<boolean>(false);
  const [holidaysSqlText, setHolidaysSqlText] = useState<string>('');
  const [copiedHolidaysSql, setCopiedHolidaysSql] = useState<boolean>(false);
  const [isSyncingTable, setIsSyncingTable] = useState<boolean>(false);

  // Custom holiday form state
  const [customName, setCustomName] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [customNote, setCustomNote] = useState('');

  const overrides = config.holidayOverrides || [];

  const availableYears = useMemo(
    () =>
      getAvailableHolidayYears(
        currentRd.year,
        currentRd.month,
        overrides,
        Math.max(selectedYear, customMaxYear)
      ),
    [currentRd.year, currentRd.month, overrides, selectedYear, customMaxYear]
  );

  const holidays = useMemo(
    () => getHolidaysWithOverridesForYear(selectedYear, overrides),
    [selectedYear, overrides]
  );

  const activeChangesCount = overrides.filter(o => o.status !== 'normal').length;

  const handleOpenHolidaysSql = async () => {
    try {
      const res = await fetch('/api/holidays/sql');
      if (res.ok) {
        const data = await res.json();
        if (data.sql) {
          setHolidaysSqlText(data.sql);
          setShowHolidaysSql(true);
          return;
        }
      }
    } catch {}
    setHolidaysSqlText(getHolidaysTableSql());
    setShowHolidaysSql(true);
  };

  const handleManualSyncHolidaysTable = async () => {
    setIsSyncingTable(true);
    try {
      const res = await fetch('/api/holidays/sync-supabase', { method: 'POST' });
      const data = await res.json();
      if (data.tableExists) {
        setFeedbackMsg(
          `✅ Tabla "calendario_feriados" sincronizada en Supabase (${data.tableRowsSynced} días feriados guardados en la tabla).`
        );
      } else {
        setFeedbackMsg(
          `ℹ️ Cambios respaldados en Supabase (${data.storage}). Para ver la tabla "calendario_feriados" en tu Table Editor de Supabase, haz clic en "Script SQL Tabla calendario_feriados" y ejecútalo en SQL Editor.`
        );
        handleOpenHolidaysSql();
      }
      setTimeout(() => setFeedbackMsg(null), 7000);
    } catch (e: any) {
      setFeedbackMsg(`Error al sincronizar: ${e.message}`);
    } finally {
      setIsSyncingTable(false);
    }
  };

  const persistOverrides = async (nextOverrides: HolidayOverride[], toast: string, targetId?: string) => {
    if (targetId) setSavingId(targetId);
    try {
      setGlobalHolidayOverrides(nextOverrides);
      let syncedInDb = false;
      let dedicatedTable = false;
      try {
        const res = await fetch('/api/holidays/overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ holidayOverrides: nextOverrides }),
        });
        if (res.ok) {
          const data = await res.json();
          syncedInDb = Boolean(data.dbSynced);
          dedicatedTable = Boolean(data.tableExists);
        }
      } catch {}
      setDbSyncedBadge(true);
      await onUpdateConfig({ holidayOverrides: nextOverrides });
      const dbTag = dedicatedTable
        ? ' (Guardado en tabla Supabase: calendario_feriados)'
        : syncedInDb
        ? ' (Guardado en Base de Datos Supabase)'
        : ' (Guardado en Base de Datos del Sistema)';
      setFeedbackMsg(`${toast}${dbTag}`);
      setTimeout(() => setFeedbackMsg(null), 5000);
    } finally {
      setSavingId(null);
    }
  };

  const handleSetOriginalDay = async (originalDate: string, name: string) => {
    const next = overrides.filter(o => o.originalDate !== originalDate && o.id !== originalDate);
    await persistOverrides(
      next,
      `✅ "${name}" restaurado a su fecha original (${formatHumanDateShortRD(originalDate)}).`,
      originalDate
    );
  };

  const handleMoveHoliday = async (originalDate: string, name: string, newTargetDate: string) => {
    if (!newTargetDate || newTargetDate === originalDate) {
      return handleSetOriginalDay(originalDate, name);
    }
    const existingIdx = overrides.findIndex(
      o => !o.isCustom && (o.originalDate === originalDate || o.id === originalDate)
    );
    const updatedItem: HolidayOverride = {
      id: originalDate,
      name,
      originalDate,
      status: 'moved',
      movedToDate: newTargetDate,
      updatedAt: new Date().toISOString(),
    };
    const next = [...overrides];
    if (existingIdx >= 0) {
      next[existingIdx] = updatedItem;
    } else {
      next.push(updatedItem);
    }
    await persistOverrides(
      next,
      `🔄 Feriado "${name}" movido: El ${formatHumanDateShortRD(originalDate)} ahora es DÍA LABORABLE NORMAL y el feriado pasa al ${formatHumanDateShortRD(newTargetDate)}.`,
      originalDate
    );
  };

  const handleMarkAsWorkday = async (originalDate: string, name: string) => {
    const existingIdx = overrides.findIndex(
      o => !o.isCustom && (o.originalDate === originalDate || o.id === originalDate)
    );
    const updatedItem: HolidayOverride = {
      id: originalDate,
      name,
      originalDate,
      status: 'workday',
      updatedAt: new Date().toISOString(),
    };
    const next = [...overrides];
    if (existingIdx >= 0) {
      next[existingIdx] = updatedItem;
    } else {
      next.push(updatedItem);
    }
    await persistOverrides(
      next,
      `💼 "${name}" (${formatHumanDateShortRD(originalDate)}) marcado como DÍA LABORABLE NORMAL (No feriado).`,
      originalDate
    );
  };

  const handleAddCustomHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customDate.trim()) return;
    const id = `custom-${customDate}`;
    const newItem: HolidayOverride = {
      id,
      name: customName.trim(),
      originalDate: customDate.trim(),
      status: 'custom_holiday',
      note: customNote.trim() || undefined,
      isCustom: true,
      updatedAt: new Date().toISOString(),
    };
    const next = [...overrides.filter(o => o.id !== id), newItem];
    setCustomName('');
    setCustomDate('');
    setCustomNote('');
    await persistOverrides(
      next,
      `📅 Feriado / cierre especial "${newItem.name}" agregado para el ${formatHumanDateShortRD(newItem.originalDate)}.`,
      id
    );
  };

  const handleDeleteCustomHoliday = async (id: string, name: string) => {
    const next = overrides.filter(o => o.id !== id);
    await persistOverrides(next, `🗑️ Feriado especial "${name}" eliminado.`, id);
  };

  const aiSummaryText = useMemo(
    () => buildHolidayOverridesSummaryText(selectedYear, overrides),
    [selectedYear, overrides]
  );

  return (
    <div className="space-y-5">
      {/* Top Explanation & Live Status Card */}
      <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.08] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-950/80 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Gestión de Días Feriados en RD (Ley 139-97 — Traslados a Lunes)
                </h2>
                {dbSyncedBadge && (
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Database className="w-3 h-3 text-emerald-400" />
                    Tabla Supabase: <code className="font-mono text-emerald-200">calendario_feriados</code>
                  </span>
                )}
                {activeChangesCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {activeChangesCount} cambio(s) guardado(s) en BD
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                En República Dominicana, cuando un feriado cae martes, miércoles, jueves o viernes y el Ministerio de Trabajo lo mueve (por ejemplo, para el lunes), márcalo aquí.{' '}
                <strong className="text-lime-300">
                  El sistema y la IA sabrán automáticamente que el día original (ej. viernes) YA NO ES FERIADO (se trabaja normal de 8:30 AM a 6:00 PM) y que el nuevo día (ej. lunes) es el feriado cerrado.
                </strong>
              </p>

              {/* Quick Actions for Supabase `calendario_feriados` Table */}
              <div className="flex flex-wrap items-center gap-2 pt-2.5">
                <button
                  type="button"
                  onClick={handleOpenHolidaysSql}
                  className="px-3 py-1.5 rounded-lg bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/40 text-cyan-200 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Ver y copiar el Script SQL para crear la tabla calendario_feriados en Supabase"
                >
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Script SQL Tabla <code className="font-mono">calendario_feriados</code></span>
                </button>

                <button
                  type="button"
                  disabled={isSyncingTable}
                  onClick={handleManualSyncHolidaysTable}
                  className="px-3 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-200 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Subir todos los días feriados y modificaciones a la tabla calendario_feriados en Supabase"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingTable ? 'animate-spin' : ''}`} />
                  <span>{isSyncingTable ? 'Sincronizando tabla...' : 'Sincronizar Tabla en Supabase'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Current RD Status Pill */}
          <div className="p-3.5 rounded-xl bg-[#121822] border border-white/[0.07] shrink-0 min-w-[260px]">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 mb-1">
              <span className="flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-lime-400 animate-pulse" />
                <span>{currentRd.fullDateStr} · </span>
                <span className="text-lime-300 font-bold tabular-nums">{currentRd.time12WithSeconds}</span>
              </span>
            </div>
            <div className="text-xs font-bold text-white">{currentRd.statusSummary}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Próxima apertura: <span className="text-slate-200 font-semibold">{currentRd.nextOpeningStr}</span>
            </div>
          </div>
        </div>

        {/* Inline SQL Box for `calendario_feriados` when clicked */}
        {showHolidaysSql && (
          <div className="p-4 rounded-xl bg-[#080B10] border border-cyan-500/40 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-cyan-200">
                <strong>Crear tabla <code className="font-mono text-cyan-300">calendario_feriados</code> en Supabase:</strong>{' '}
                Copia este SQL, abre <strong>Supabase &gt; SQL Editor &gt; New Query</strong>, pégalo y presiona <strong>Run</strong>.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(holidaysSqlText);
                    setCopiedHolidaysSql(true);
                    setTimeout(() => setCopiedHolidaysSql(false), 2500);
                  }}
                  className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedHolidaysSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedHolidaysSql ? '¡SQL Copiado!' : 'Copiar SQL de Feriados'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowHolidaysSql(false)}
                  className="p-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <pre className="text-[11px] font-mono text-emerald-300 bg-black/70 border border-white/[0.06] rounded-lg p-3 max-h-56 overflow-y-auto select-all whitespace-pre">
              {holidaysSqlText}
            </pre>
          </div>
        )}

        {/* Special Notice if TODAY had a holiday moved */}
        {currentRd.movedHolidayNotice && (
          <div className="p-3.5 rounded-xl bg-lime-950/60 border border-lime-500/40 text-xs text-lime-200 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block text-lime-300 font-bold">
                ¡Día original de feriado detectado hoy como laborable!
              </strong>
              <span>{currentRd.movedHolidayNotice}</span>
            </div>
          </div>
        )}

        {/* Live AI Context Preview */}
        <div className="p-3.5 rounded-xl bg-[#090D12] border border-white/[0.06] space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Contexto en vivo que recibe el Agente IA en WhatsApp:
            </span>
            {activeChangesCount > 0 && (
              <button
                type="button"
                onClick={() => persistOverrides([], 'Todos los feriados fueron restaurados a sus fechas originales.')}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restaurar todos</span>
              </button>
            )}
          </div>
          <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
            {aiSummaryText}
          </pre>
        </div>
      </div>

      {feedbackMsg && (
        <div className="p-3.5 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-xs text-emerald-200 flex items-center gap-2 shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{feedbackMsg}</span>
        </div>
      )}

      {/* Year Filter & Holiday Cards Grid */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-lime-400" />
              <h3 className="text-sm font-bold text-white">
                Calendario Oficial de Feriados de República Dominicana ({selectedYear})
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Los próximos años se cargan automáticamente a medida que se acerca el nuevo año (y puedes avanzar a cualquier año futuro con <strong>+ Año</strong>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 bg-[#0F141C] p-1.5 rounded-xl border border-white/[0.07] text-xs">
            <button
              type="button"
              onClick={() => setSelectedYear(prev => Math.max(2024, prev - 1))}
              title="Ver año anterior"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {availableYears.map(yr => {
              const yearChanges = overrides.filter(
                o => o.status !== 'normal' && o.originalDate.startsWith(`${yr}-`)
              ).length;
              return (
                <button
                  key={yr}
                  type="button"
                  onClick={() => setSelectedYear(yr)}
                  className={`px-3 py-1.5 rounded-lg font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedYear === yr
                      ? 'bg-lime-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{yr}</span>
                  {yearChanges > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                        selectedYear === yr
                          ? 'bg-slate-950 text-lime-400'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {yearChanges}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                const maxLoaded = availableYears[availableYears.length - 1] || currentRd.year + 2;
                const nextYr = selectedYear < maxLoaded ? selectedYear + 1 : maxLoaded + 1;
                if (nextYr > maxLoaded) {
                  setCustomMaxYear(nextYr);
                }
                setSelectedYear(nextYr);
              }}
              title="Cargar y ver próximo año"
              className="px-2.5 py-1.5 rounded-lg font-mono font-bold text-[11px] text-lime-400 hover:bg-lime-500/15 border border-lime-500/25 transition-all cursor-pointer flex items-center gap-0.5"
            >
              <span>+ Año</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className={`grid grid-cols-1 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'} gap-4`}>
          {holidays.map(item => {
            const isMoved = item.status === 'moved';
            const isWorkday = item.status === 'workday';
            const isCustom = item.isCustom || item.status === 'custom_holiday';
            const isTodayOriginal = item.originalDate === currentRd.ymd;
            const isTodayEffective = item.effectiveDate === currentRd.ymd;
            const isWeekdayMovable = ['Martes', 'Miércoles', 'Jueves', 'Viernes'].includes(item.originalDayName);

            return (
              <div
                key={item.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3.5 ${
                  isMoved
                    ? 'bg-amber-950/20 border-amber-500/40 shadow-lg shadow-amber-950/20'
                    : isWorkday
                    ? 'bg-cyan-950/20 border-cyan-500/40'
                    : isCustom
                    ? 'bg-purple-950/20 border-purple-500/40'
                    : 'bg-[#0F141C] border-white/[0.07]'
                }`}
              >
                <div className="space-y-2.5">
                  {/* Header: Holiday Name & Day Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h4 className="text-sm font-bold text-white leading-snug">{item.name}</h4>
                        {isTodayOriginal && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-lime-500 text-slate-950">
                            HOY
                          </span>
                        )}
                        {isTodayEffective && !isTodayOriginal && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white">
                            FERIADO HOY
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Fecha calendario:{' '}
                        <span className={`font-semibold ${isMoved || isWorkday ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                          {item.originalHumanDate}
                        </span>
                      </p>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0 border ${
                        isWeekdayMovable
                          ? 'bg-amber-950/80 text-amber-300 border-amber-600/40'
                          : 'bg-slate-800/80 text-slate-300 border-white/[0.08]'
                      }`}
                    >
                      Cae {item.originalDayName}
                    </span>
                  </div>

                  {/* Current State Box */}
                  {isMoved && item.effectiveHumanDate ? (
                    <div className="p-3 rounded-xl bg-[#090D12]/90 border border-amber-500/30 space-y-1.5 text-xs">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {item.originalHumanDate}: <strong>DÍA LABORABLE NORMAL</strong> (No es feriado)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Nuevo día feriado (Cerrado): <strong>{item.effectiveHumanDate}</strong>
                        </span>
                      </div>
                    </div>
                  ) : isWorkday ? (
                    <div className="p-3 rounded-xl bg-[#090D12]/90 border border-cyan-500/30 text-xs text-cyan-300 flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>
                        <strong>Día Laborable Normal:</strong> El {item.originalHumanDate} la tienda abre de 8:30 AM a 6:00 PM.
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.05] text-xs text-slate-300 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <CalendarCheck className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>Se celebra en su día:</span>
                      </span>
                      <strong className="text-rose-300">{item.originalHumanDate} (Cerrado)</strong>
                    </div>
                  )}
                </div>

                {/* Action Controls */}
                {isCustom ? (
                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-[11px] text-purple-300 font-mono">Feriado personalizado</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteCustomHoliday(item.id, item.name)}
                      className="px-2.5 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar</span>
                    </button>
                  </div>
                ) : (
                  <div className="pt-2.5 border-t border-white/[0.06] space-y-2">
                    <div className="text-[11px] font-semibold text-slate-400">
                      ¿Se cambió este día feriado en RD?
                    </div>

                    {/* Quick Move Buttons to Monday */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => handleMoveHoliday(item.originalDate, item.name, item.nextMondayDate)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border text-left transition-all cursor-pointer flex flex-col ${
                          isMoved && item.movedToDate === item.nextMondayDate
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                            : 'bg-white/[0.04] hover:bg-amber-500/15 text-slate-200 border-white/[0.08] hover:border-amber-500/40'
                        }`}
                      >
                        <span>👉 Mover al Lunes sig.</span>
                        <span className={`text-[10px] font-mono ${isMoved && item.movedToDate === item.nextMondayDate ? 'text-slate-900' : 'text-amber-400'}`}>
                          {item.nextMondayLabel}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => handleMoveHoliday(item.originalDate, item.name, item.prevMondayDate)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border text-left transition-all cursor-pointer flex flex-col ${
                          isMoved && item.movedToDate === item.prevMondayDate
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                            : 'bg-white/[0.04] hover:bg-amber-500/15 text-slate-200 border-white/[0.08] hover:border-amber-500/40'
                        }`}
                      >
                        <span>👈 Mover al Lunes ant.</span>
                        <span className={`text-[10px] font-mono ${isMoved && item.movedToDate === item.prevMondayDate ? 'text-slate-900' : 'text-amber-400'}`}>
                          {item.prevMondayLabel}
                        </span>
                      </button>
                    </div>

                    {/* Custom Date Picker + Workday / Restore */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[160px] bg-[#090D12] border border-white/[0.08] rounded-lg px-2 py-1">
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">Otra fecha:</span>
                        <input
                          type="date"
                          value={item.movedToDate || ''}
                          onChange={e => {
                            if (e.target.value) {
                              handleMoveHoliday(item.originalDate, item.name, e.target.value);
                            }
                          }}
                          className="bg-transparent text-[11px] text-slate-200 font-mono focus:outline-none w-full"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => handleMarkAsWorkday(item.originalDate, item.name)}
                        title="Marcar este día como laborable normal sin moverlo a otro día"
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                          isWorkday
                            ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                            : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/[0.08]'
                        }`}
                      >
                        💼 Se trabaja
                      </button>

                      {(isMoved || isWorkday) && (
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => handleSetOriginalDay(item.originalDate, item.name)}
                          title="Volver a dejar el feriado en su fecha original"
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-950/60 hover:bg-rose-900 text-rose-200 border border-rose-500/40 flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Original</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Extraordinary / Custom Holiday */}
      <form
        onSubmit={handleAddCustomHoliday}
        className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] space-y-3"
      >
        <div className="flex items-center gap-2">
          <PlusCircle className="w-4 h-4 text-lime-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Agregar Día Feriado Extraordinario o Cierre Especial
          </h3>
        </div>
        <p className="text-xs text-slate-400">
          Si el Poder Ejecutivo declara un día no laborable especial o la tienda cerrará en una fecha específica, agrégalo aquí para que la IA informe a los clientes:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Ej: Día Feriado Especial / Inventario"
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            className="bg-[#090D12] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-lime-500"
          />
          <input
            type="date"
            value={customDate}
            onChange={e => setCustomDate(e.target.value)}
            className="bg-[#090D12] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-lime-500"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Nota opcional..."
              value={customNote}
              onChange={e => setCustomNote(e.target.value)}
              className="flex-1 bg-[#090D12] border border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-lime-500"
            />
            <button
              type="submit"
              disabled={!customName.trim() || !customDate.trim()}
              className="px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 disabled:opacity-40 text-slate-950 font-bold text-xs whitespace-nowrap cursor-pointer"
            >
              Agregar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
