import React, { useState, useEffect } from 'react';
import { 
  BrainCircuit, 
  Sparkles, 
  PlusCircle, 
  CheckCircle2, 
  Search, 
  Award,
  RefreshCw,
  FileCode2,
  Save,
  RotateCcw,
  Wrench,
  Database,
  CalendarClock
} from 'lucide-react';
import type { AILearnedInsight, AppConfig } from '../types';
import { OFFICIAL_TODO_LAPTO_MASTER_PROMPT } from '../masterPrompt';
import { HolidayManagerPanel } from './HolidayManagerPanel';

interface AIBrainViewProps {
  insights: AILearnedInsight[];
  onAddInsight: (insight: Partial<AILearnedInsight>) => Promise<void>;
  onTriggerGlobalLearning: () => Promise<void>;
  config: AppConfig;
  onUpdateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
}

export const AIBrainView: React.FC<AIBrainViewProps> = ({
  insights,
  onAddInsight,
  onTriggerGlobalLearning,
  config,
  onUpdateConfig,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'master_prompt' | 'holidays_rd' | 'learned_tactics'>('master_prompt');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Master Prompt Editor state
  const [systemPromptText, setSystemPromptText] = useState<string>(
    config.aiProvider?.systemPrompt || OFFICIAL_TODO_LAPTO_MASTER_PROMPT
  );
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  useEffect(() => {
    if (config.aiProvider?.systemPrompt) {
      setSystemPromptText(config.aiProvider.systemPrompt);
    }
  }, [config.aiProvider?.systemPrompt]);

  // New Insight Form state
  const [category, setCategory] = useState('objecion_precio');
  const [triggerPhrase, setTriggerPhrase] = useState('');
  const [winningPitch, setWinningPitch] = useState('');
  const [counterObjection, setCounterObjection] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const categories = [
    { id: 'all', label: 'Todas las Tácticas' },
    { id: 'objeciones_garantia', label: 'Garantía & Usados' },
    { id: 'envios_provincias', label: 'Envíos al Interior' },
    { id: 'precio_y_presupuesto', label: 'Precio & Presupuesto' },
    { id: 'cierre_upsell', label: 'Cierre Activo & Upsell' },
  ];

  const filteredInsights = insights.filter(ins => {
    const matchesCat = selectedCategory === 'all' || ins.category === selectedCategory;
    const matchesSearch =
      ins.triggerPhrase.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ins.winningPitch.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ins.counterObjection.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ins.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesCat && matchesSearch;
  });

  const avgSuccessRate = Math.round(
    insights.reduce((acc, i) => acc + i.successRate, 0) / (insights.length || 1)
  );

  const handleSaveMasterPrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await onUpdateConfig({
        aiProvider: {
          provider: config.aiProvider?.provider || 'gemini',
          model: config.aiProvider?.model || 'gemini-3.8-flash',
          temperature: config.aiProvider?.temperature ?? 0.35,
          ...config.aiProvider,
          systemPrompt: systemPromptText,
        },
      });
      setNotification('¡Prompt Maestro de 36 Reglas guardado y activado en tiempo real para el Agente IA!');
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleRestoreDefaultPrompt = async () => {
    setSystemPromptText(OFFICIAL_TODO_LAPTO_MASTER_PROMPT);
    await onUpdateConfig({
      aiProvider: {
        provider: config.aiProvider?.provider || 'gemini',
        model: config.aiProvider?.model || 'gemini-3.8-flash',
        temperature: config.aiProvider?.temperature ?? 0.35,
        ...config.aiProvider,
        systemPrompt: OFFICIAL_TODO_LAPTO_MASTER_PROMPT,
      },
    });
    setNotification('Prompt Maestro restaurado a la versión oficial de 36 reglas de Todo Lapto.');
    setTimeout(() => setNotification(null), 4000);
  };

  const handleSubmitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!triggerPhrase.trim() || !winningPitch.trim()) return;

    await onAddInsight({
      category,
      triggerPhrase,
      winningPitch,
      counterObjection: counterObjection || 'Estrategia de ventas agregada por el equipo directivo.',
      tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
    });

    setIsModalOpen(false);
    setTriggerPhrase('');
    setWinningPitch('');
    setCounterObjection('');
    setTagsInput('');
    setNotification('¡Nueva táctica agregada y disponible de inmediato para el agente IA!');
    setTimeout(() => setNotification(null), 4000);
  };

  const handleRunGlobalAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      await onTriggerGlobalLearning();
      setNotification('¡Análisis completado! Se han integrado nuevas tácticas basadas en los chats recientes.');
    } catch (err: any) {
      setNotification(`Error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 bg-[#090D12] text-slate-100">
      {/* Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-lime-950/80 border border-lime-500/30 flex items-center justify-center text-lime-400 shrink-0">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Cerebro IA: Prompt Maestro Oficial (36 Reglas) & Aprendizaje Continuo
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-lime-950 text-lime-400 border border-lime-800/60">
                Adaptado de n8n a Vendemá CRM
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Combina las 36 reglas oficiales de venta de Todo Lapto con herramientas nativas del CRM, Evolution API y aprendizaje automático de objeciones.
            </p>
          </div>
        </div>

        {/* Sub-navigation Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 bg-[#121822] p-1 rounded-xl border border-white/[0.06] text-xs">
          <button
            onClick={() => setActiveSubTab('master_prompt')}
            className={`px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeSubTab === 'master_prompt'
                ? 'bg-lime-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>Prompt Maestro (36 Reglas)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('holidays_rd')}
            className={`px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeSubTab === 'holidays_rd'
                ? 'bg-amber-400 text-slate-950 shadow-sm'
                : 'text-amber-300 hover:text-white bg-amber-500/10 border border-amber-500/20'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span>Días Feriados RD (Cambios de Día)</span>
            {(config.holidayOverrides || []).filter(o => o.status !== 'normal').length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-950 text-amber-300">
                {(config.holidayOverrides || []).filter(o => o.status !== 'normal').length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('learned_tactics')}
            className={`px-3.5 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeSubTab === 'learned_tactics'
                ? 'bg-lime-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Tácticas Aprendidas ({insights.length})</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-600/60 rounded-xl text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {activeSubTab === 'master_prompt' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Left Column: Master Prompt Editor */}
          <div className="xl:col-span-8 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] flex flex-col space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-lime-400" />
                  <span>Instrucción Maestra del Agente de Ventas Todo Lapto</span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Este prompt gobierna todas las respuestas automáticas y sugerencias en WhatsApp (compatible con Gemini, OpenAI y DeepSeek).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDefaultPrompt}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restaurar Oficial</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveMasterPrompt}
                  disabled={isSavingPrompt}
                  className="px-4 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-lime-500/20 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingPrompt ? 'Guardando...' : 'Guardar Prompt Maestro'}</span>
                </button>
              </div>
            </div>

            <textarea
              value={systemPromptText}
              onChange={e => setSystemPromptText(e.target.value)}
              rows={28}
              className="w-full flex-1 bg-[#090D12] border border-white/[0.08] rounded-xl p-4 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-lime-500 resize-y"
            />
          </div>

          {/* Right Column: Native CRM Tools & Dynamic Variables Reference */}
          <div className="xl:col-span-4 space-y-4">
            {/* Dynamic Variables Injected Automatically */}
            <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                <Database className="w-4 h-4 text-lime-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Variables Dinámicas (Reemplazo de n8n)
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                El servidor del CRM inyecta automáticamente estos datos en tiempo real antes de cada respuesta:
              </p>
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06]">
                  <code className="text-lime-400 font-mono font-bold block mb-0.5">
                    {'{{TELEFONO_CLIENTE}}'}
                  </code>
                  <span className="text-slate-400 text-[11px]">
                    Reemplaza a <code>$json.telefono_cliente</code> con el teléfono real detectado en Evolution API (ej. <code>18495393496</code>).
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06]">
                  <code className="text-lime-400 font-mono font-bold block mb-0.5">
                    {'{{INVENTARIO_COMPLETO}}'}
                  </code>
                  <span className="text-slate-400 text-[11px]">
                    Reemplaza a <code>$json.inventario_completo</code> con los 607+ productos vendibles en vivo desde el catálogo central ordenados por categoría y precio.
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06]">
                  <code className="text-lime-400 font-mono font-bold block mb-0.5">
                    {'{{APRENDIZAJE_CEREBRO_IA}}'}
                  </code>
                  <span className="text-slate-400 text-[11px]">
                    Inyecta todas las objeciones y cierres exitosos aprendidos en la pestaña de Tácticas.
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06]">
                  <code className="text-cyan-400 font-mono font-bold block mb-0.5">
                    {'{{FECHA_RD}} · {{HORA_RD}}'}
                  </code>
                  <span className="text-slate-400 text-[11px]">
                    Fecha y hora oficial de República Dominicana (ej. <code>Jueves 29 de Octubre de 2026 · 07:18 PM</code>).
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06] space-y-2">
                  <code className="text-emerald-400 font-mono font-bold block mb-0.5">
                    {'{{ESTADO_NEGOCIO}} · {{PROXIMA_APERTURA}}'}
                  </code>
                  <span className="text-slate-400 text-[11px] block">
                    Estado de apertura en tiempo real (<code>🟢 ABIERTO</code> / <code>🔴 CERRADO</code>), domingos, días feriados oficiales de RD (con traslados a lunes) y fecha/hora exacta de próxima apertura.
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('holidays_rd')}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>Configurar / Mover Días Feriados RD</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Native CRM Tools Reference */}
            <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
                <Wrench className="w-4 h-4 text-lime-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Tools Nativas del CRM (&lt;crm_tools&gt;)
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Los nodos antiguos de n8n ahora son funciones nativas del servidor que la IA ejecuta directamente sobre el ERP central y WhatsApp:
              </p>

              <div className="space-y-2 text-[11px]">
                {[
                  {
                    name: 'odoo_buscar_cliente',
                    desc: 'Busca por teléfono en el directorio central para evitar duplicar clientes.',
                  },
                  {
                    name: 'odoo_crear_cliente',
                    desc: 'Registra al cliente en el servidor central si aún no existe.',
                  },
                  {
                    name: 'odoo_crear_cotizacion',
                    desc: 'Crea el pedido oficial con el ID real del producto y devuelve la referencia #ID.',
                  },
                  {
                    name: 'registrar_pedido',
                    desc: 'Agrega el pedido al tablero de Pedidos del CRM (contra entrega o transferencia).',
                  },
                  {
                    name: 'notificar_equipo',
                    desc: 'Envía alerta inmediata por WhatsApp al teléfono del equipo (Servicio Técnico, Descuentos, Fotos Reales, Vacantes, Pedidos).',
                  },
                  {
                    name: 'guardar_telefono_cliente',
                    desc: 'Actualiza y normaliza el teléfono del cliente en la sesión activa.',
                  },
                ].map(t => (
                  <div
                    key={t.name}
                    className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06]"
                  >
                    <span className="font-mono font-bold text-cyan-400 block">{t.name}</span>
                    <span className="text-slate-400">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : activeSubTab === 'holidays_rd' ? (
        <HolidayManagerPanel config={config} onUpdateConfig={onUpdateConfig} />
      ) : (
        <>
          {/* Actions for Learned Tactics */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
              <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
                <span className="text-slate-400 text-xs block mb-1">Tácticas Aprendidas</span>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  {insights.length}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
                <span className="text-slate-400 text-xs block mb-1">Efectividad Media</span>
                <div className="text-2xl font-bold text-lime-400 font-mono tabular-nums">
                  {avgSuccessRate}%
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
                <span className="text-slate-400 text-xs block mb-1">Objeciones Resueltas</span>
                <div className="text-2xl font-bold text-white font-mono tabular-nums">
                  {insights.reduce((acc, i) => acc + i.occurrences, 0)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] flex flex-col justify-center gap-2">
                <button
                  onClick={handleRunGlobalAnalysis}
                  disabled={isAnalyzing}
                  className="w-full py-1.5 px-3 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  <span>{isAnalyzing ? 'Analizando...' : 'Aprender de Chats'}</span>
                </button>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="w-full py-1.5 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-lime-400" />
                  <span>Nueva Táctica</span>
                </button>
              </div>
            </div>
          </div>

          {/* Filter Tabs & Search */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
                    selectedCategory === c.id
                      ? 'bg-white/[0.09] text-white border border-white/[0.09] shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="relative md:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por objeción, respuesta o tag..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-[#0F141C] border border-white/[0.07] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
              />
            </div>
          </div>

          {/* Insights Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredInsights.length === 0 ? (
              <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-[#0F141C] rounded-2xl border border-white/[0.06]">
                No se encontraron tácticas con los filtros actuales.
              </div>
            ) : (
              filteredInsights.map(ins => (
                <div
                  key={ins.id}
                  className="p-5 rounded-xl bg-[#0F141C] border border-white/[0.06] space-y-3.5 hover:border-lime-500/40 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-lime-950/80 text-lime-300 border border-lime-800/60 uppercase">
                      {ins.category.replace('_', ' ')}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-lime-400">
                      <Award className="w-3.5 h-3.5" />
                      <span>{ins.successRate}% efectividad</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500 text-[10px] block uppercase font-bold tracking-wider mb-1">
                      Pregunta u Objeción del Cliente
                    </span>
                    <p className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                      <span className="text-amber-400">💬</span> "{ins.triggerPhrase}"
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-[#121822] border border-white/[0.06]">
                    <span className="text-lime-400 text-[10px] block uppercase font-bold tracking-wider mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Táctica de Respuesta de la IA
                    </span>
                    <p className="text-xs text-slate-200 leading-relaxed">{ins.winningPitch}</p>
                  </div>

                  <div className="text-[11px] text-slate-400 italic">
                    💡 Razón del éxito: {ins.counterObjection}
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-500">
                    <div className="flex items-center gap-1 flex-wrap">
                      {ins.tags.map((t, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-300">
                          #{t}
                        </span>
                      ))}
                    </div>
                    <span>Aplicado en {ins.occurrences} chats</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Add New Insight Modal */}
      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#0C1017] border border-white/[0.08] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-lime-400" />
                <span>Enseñar Nueva Táctica al Agente IA</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitNew} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Categoría</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
                >
                  <option value="objeciones_garantia">Garantía & Equipos Usados</option>
                  <option value="envios_provincias">Envíos a Provincias (Fuera de Santo Domingo)</option>
                  <option value="precio_y_presupuesto">Precios, Descuentos & Presupuesto</option>
                  <option value="cierre_upsell">Cierre Activo & Upsell de Accesorios</option>
                  <option value="reparaciones">Servicio Técnico & Reparaciones</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  Pregunta u Objeción Típica del Cliente
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. ¿Por qué comprar una ThinkPad y no una de marca genérica?"
                  value={triggerPhrase}
                  onChange={e => setTriggerPhrase(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  Táctica de Respuesta Ganadora
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Ej. Enfatizar la construcción de grado militar, teclado antiderrame y facilidad de repuestos."
                  value={winningPitch}
                  onChange={e => setWinningPitch(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  Razón de Efectividad / Psicología del Cliente
                </label>
                <input
                  type="text"
                  placeholder="Ej. Resuelve el temor a que la laptop se dañe en poco tiempo."
                  value={counterObjection}
                  onChange={e => setCounterObjection(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Etiquetas (separadas por coma)</label>
                <input
                  type="text"
                  placeholder="durabilidad, thinkpad, garantia"
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold shadow-lg shadow-lime-500/20"
                >
                  Guardar Táctica
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
