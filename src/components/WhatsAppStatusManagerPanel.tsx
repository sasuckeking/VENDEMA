import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Eye, 
  Sparkles, 
  Tag, 
  DollarSign, 
  HelpCircle,
  Laptop,
  Image,
  Mic,
  RotateCcw,
  Send,
  Loader2
} from 'lucide-react';
import type { AppConfig, WhatsAppStatusItem } from '../types';

interface WhatsAppStatusManagerPanelProps {
  config: AppConfig;
  onUpdateConfig?: (newConfig: AppConfig) => void;
}

export const WhatsAppStatusManagerPanel: React.FC<WhatsAppStatusManagerPanelProps> = ({
  config,
  onUpdateConfig,
}) => {
  const [statuses, setStatuses] = useState<WhatsAppStatusItem[]>(
    config.activeWhatsAppStatuses || []
  );
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // New Status Form state
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Simulator state
  const [selectedStatusId, setSelectedStatusId] = useState<string>('status-1');
  const [testQuery, setTestQuery] = useState('¿Precio y todavía la tienen disponible?');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);

  useEffect(() => {
    fetchStatuses();
  }, []);

  const showNotice = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchStatuses = async () => {
    try {
      const res = await fetch('/api/whatsapp-statuses');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.statuses)) {
          setStatuses(data.statuses);
        }
      }
    } catch (err: any) {
      console.log('Error fetching statuses:', err.message);
    }
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    try {
      const res = await fetch('/api/whatsapp-statuses/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active: !currentActive }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.statuses);
        if (onUpdateConfig) {
          onUpdateConfig({ ...config, activeWhatsAppStatuses: data.statuses });
        }
        showNotice(`Estado ${!currentActive ? 'activado' : 'desactivado'} con éxito.`);
      }
    } catch {
      showNotice('No se pudo cambiar el estado', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/whatsapp-statuses/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.statuses);
        if (onUpdateConfig) {
          onUpdateConfig({ ...config, activeWhatsAppStatuses: data.statuses });
        }
        showNotice('Estado eliminado del cerebro del bot.');
      }
    } catch {
      showNotice('Error al eliminar', 'error');
    }
  };

  const handleCreateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() && !newProduct.trim()) {
      showNotice('Indica el nombre de la laptop o título del estado', 'error');
      return;
    }

    setLoading(true);
    try {
      const newStatusObj: WhatsAppStatusItem = {
        id: `status-${Date.now()}`,
        title: newTitle.trim() || newProduct.trim(),
        productName: newProduct.trim() || newTitle.trim(),
        price: newPrice.trim(),
        description: newDescription.trim(),
        active: true,
        createdAt: new Date().toISOString(),
      };

      const res = await fetch('/api/whatsapp-statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatusObj }),
      });

      if (res.ok) {
        const data = await res.json();
        setStatuses(data.statuses);
        if (onUpdateConfig) {
          onUpdateConfig({ ...config, activeWhatsAppStatuses: data.statuses });
        }
        setNewTitle('');
        setNewProduct('');
        setNewPrice('');
        setNewDescription('');
        setIsAdding(false);
        showNotice('¡Nuevo estado publicado en la memoria del bot!');
      }
    } catch {
      showNotice('Error al guardar estado', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTestStatusQuestion = async () => {
    if (!testQuery.trim()) return;
    setTestingAi(true);
    setTestResult(null);
    try {
      const chosenStatus = statuses.find(s => s.id === selectedStatusId);
      const quotedStatusText = chosenStatus
        ? `${chosenStatus.title} — ${chosenStatus.productName || ''} ${chosenStatus.price ? `(RD$${chosenStatus.price})` : ''}: ${chosenStatus.description || ''}`
        : undefined;

      const res = await fetch('/api/ai/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: testQuery.trim(),
          quotedStatusText,
          isStatusReply: Boolean(chosenStatus),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult(data.reply || data.text || 'Sin respuesta');
      } else {
        setTestResult('No se pudo simular la respuesta del bot.');
      }
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    } finally {
      setTestingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            notification.type === 'success'
              ? 'bg-lime-950/70 border-lime-500/30 text-lime-300'
              : 'bg-red-950/70 border-red-500/30 text-red-300'
          }`}
        >
          <span>{notification.text}</span>
          <button onClick={() => setNotification(null)} className="text-xs opacity-70 hover:opacity-100">
            Cerrar
          </button>
        </div>
      )}

      {/* Main Header / Explanation */}
      <div className="p-6 rounded-2xl bg-[#0F141C] border border-white/[0.08] relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Estados de WhatsApp (Stories) & Multimedia IA
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                  En Vivo
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                El bot de WhatsApp de Todo Lapto ahora <strong>entiende fotos enviadas</strong> (analiza marcas, specs de pantallas y vouchers con GPT-4o Vision), <strong>escucha notas de voz</strong> (transcribe audios con Whisper) y <strong>sabe exactamente qué ofertas están publicadas en los estados</strong> para responder al instante cuando un cliente responde a una historia o pregunta por ella.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsAdding(!isAdding)}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-md shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{isAdding ? 'Cancelar' : 'Agregar Estado de Hoy'}</span>
          </button>
        </div>

        {/* Feature Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-5 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="w-8 h-8 rounded-lg bg-emerald-900/40 text-emerald-400 flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-white">Respuestas a Estados</div>
              <div className="text-slate-400 text-[11px]">Detecta citas directas a stories</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="w-8 h-8 rounded-lg bg-purple-900/40 text-purple-400 flex items-center justify-center shrink-0">
              <Image className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-white">Visión Artificial (GPT-4o)</div>
              <div className="text-slate-400 text-[11px]">Fotos de laptops, daños y pagos</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <div className="w-8 h-8 rounded-lg bg-amber-900/40 text-amber-400 flex items-center justify-center shrink-0">
              <Mic className="w-4 h-4" />
            </div>
            <div className="text-xs">
              <div className="font-bold text-white">Notas de Voz (Whisper)</div>
              <div className="text-slate-400 text-[11px]">Transcripción automática a texto</div>
            </div>
          </div>
        </div>
      </div>

      {/* Add New Status Modal/Form */}
      {isAdding && (
        <form
          onSubmit={handleCreateStatus}
          className="p-6 rounded-2xl bg-[#0D121A] border border-emerald-500/30 space-y-4 shadow-xl"
        >
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Publicar Nuevo Producto o Promoción de Estado en la Memoria del Bot</span>
            </h3>
            <span className="text-xs text-slate-400">El bot lo usará inmediatamente</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Título del Estado / Oferta
              </label>
              <input
                type="text"
                placeholder="Ej. Oferta Flash: Laptop HP ProBook x360 Táctil"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Modelo / Producto en Stock
              </label>
              <input
                type="text"
                placeholder="Ej. LAPTOP HP PROBOOK X360 11 G5 EE"
                value={newProduct}
                onChange={e => setNewProduct(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Precio Mostrado en el Estado
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-xs text-slate-400 font-mono">RD$</span>
                <input
                  type="text"
                  placeholder="7,500"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  className="w-full pl-11 pr-3.5 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Detalles / Especificaciones Clave en el Estado
              </label>
              <input
                type="text"
                placeholder="Ej. Pantalla táctil 360°, 4GB RAM, 128GB SSD, 6 meses de garantía"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-2 hover:bg-emerald-400 transition-all cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>Guardar en Memoria del Bot</span>
            </button>
          </div>
        </form>
      )}

      {/* List of Active Statuses */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <Laptop className="w-4 h-4 text-emerald-400" />
            <span>Estados de WhatsApp Cargados Actualmente ({statuses.length})</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {statuses.filter(s => s.active !== false).length} activos para respuestas automáticas
          </span>
        </div>

        {statuses.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#0F141C] border border-white/[0.06] text-center space-y-2">
            <p className="text-xs text-slate-400">No hay estados de WhatsApp cargados actualmente.</p>
            <button
              onClick={() => setIsAdding(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30 hover:bg-emerald-500/30"
            >
              + Agregar el primer estado
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {statuses.map((status, index) => {
              const isActive = status.active !== false;
              return (
                <div
                  key={status.id || index}
                  className={`p-4 rounded-2xl border transition-all ${
                    isActive
                      ? 'bg-[#0F141C] border-white/[0.08] hover:border-emerald-500/40 shadow-sm'
                      : 'bg-[#0A0E14] border-white/[0.03] opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                          Estado #{index + 1}
                        </span>
                        <h4 className="text-xs font-bold text-white line-clamp-1">
                          {status.title || status.productName}
                        </h4>
                      </div>

                      {status.productName && status.productName !== status.title && (
                        <div className="text-[11px] text-slate-300 mt-1 flex items-center gap-1.5">
                          <Tag className="w-3 h-3 text-slate-400" />
                          <span>{status.productName}</span>
                        </div>
                      )}

                      {status.price && (
                        <div className="text-xs font-bold font-mono text-emerald-400 mt-1">
                          {typeof status.price === 'number'
                            ? `RD$${status.price.toLocaleString()}`
                            : status.price.toString().startsWith('RD$')
                            ? status.price
                            : `RD$${status.price}`}
                        </div>
                      )}

                      {status.description && (
                        <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                          {status.description}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggle(status.id, isActive)}
                        title={isActive ? 'Desactivar este estado' : 'Activar este estado'}
                        className={`p-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/60'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {isActive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      </button>

                      <button
                        onClick={() => handleDelete(status.id)}
                        title="Eliminar del cerebro del bot"
                        className="p-2 rounded-xl text-xs text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Simulator / Interactive Tester */}
      <div className="p-5 rounded-2xl bg-[#0D121A] border border-white/[0.08] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Simulador de Respuesta Directa desde Estado de WhatsApp
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Simula cuando el cliente abre un estado subido y pregunta directamente por vía de ese estado
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              1. Estado de WhatsApp sobre el cual pregunta el cliente:
            </label>
            <select
              value={selectedStatusId}
              onChange={e => setSelectedStatusId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-amber-400"
            >
              {statuses.map((s, idx) => (
                <option key={s.id || idx} value={s.id}>
                  📱 Estado #{idx + 1}: {s.productName || s.title} {s.price ? `(RD$${s.price})` : ''}
                </option>
              ))}
              <option value="">💬 Pregunta en el chat sin citar estado específico</option>
            </select>
          </div>

          <div className="md:col-span-7">
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              2. Lo que el cliente escribe desde el estado:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={testQuery}
                onChange={e => setTestQuery(e.target.value)}
                placeholder="Ej. ¿Precio?, ¿Todavía la tienen?, ¿Cuánta memoria tiene?"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#141A24] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-amber-400"
              />
              <button
                onClick={handleTestStatusQuestion}
                disabled={testingAi}
                className="px-4 py-2.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 hover:bg-amber-300 transition-all shrink-0 cursor-pointer disabled:opacity-50"
              >
                {testingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Probar Respuesta</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Question Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-500 uppercase font-mono">Preguntas rápidas desde el estado:</span>
          {[
            '¿Precio?',
            '¿Todavía está disponible?',
            '¿Qué especificaciones tiene esa?',
            '¿Hacen envío a domicilio?',
            'Me interesa, ¿dónde están ubicados?',
          ].map(q => (
            <button
              key={q}
              onClick={() => setTestQuery(q)}
              className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-[11px] text-slate-300 border border-white/[0.05] transition-all cursor-pointer"
            >
              "{q}"
            </button>
          ))}
        </div>

        {testResult && (
          <div className="p-4 rounded-xl bg-[#141A24] border border-amber-500/30 space-y-1.5">
            <div className="text-[10px] font-mono text-amber-400 uppercase tracking-wider font-bold">
              Respuesta del Agente de Ventas Todo Lapto:
            </div>
            <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
              {testResult}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
