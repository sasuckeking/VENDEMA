import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  MessageSquare, 
  Package, 
  ClipboardList, 
  Users, 
  BrainCircuit, 
  Settings, 
  Clock,
  ShieldCheck,
  LogOut,
  Crown,
  Briefcase,
  Headphones
} from 'lucide-react';
import { 
  setGlobalHolidayOverrides, 
  getDominicanTimeContext, 
  type DominicanTimeContext 
} from '../utils/businessSchedule';
import type { AppConfig, UserAccount } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  config: AppConfig;
  onUpdateConfig?: (newConfig: Partial<AppConfig>) => Promise<void>;
  onToggleGlobalAi: () => void;
  isSyncing?: boolean;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  config,
  onUpdateConfig,
  onToggleGlobalAi,
  currentUser,
  onLogout,
}) => {
  const [rdTime, setRdTime] = useState<DominicanTimeContext>(() =>
    getDominicanTimeContext(new Date(), config.holidayOverrides || [])
  );

  useEffect(() => {
    setGlobalHolidayOverrides(config.holidayOverrides || []);
  }, [config.holidayOverrides]);

  // Live real-time Dominican Republic ticking clock (every 1 second)
  useEffect(() => {
    const updateClock = () => {
      setRdTime(getDominicanTimeContext(new Date(), config.holidayOverrides || []));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, [config.holidayOverrides]);

  // Sync client real-world time with server on mount
  useEffect(() => {
    fetch('/api/system/time-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientTimestamp: Date.now() }),
    }).catch(() => {});
  }, []);

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isDueno = currentUser?.role === 'dueno';
  const isEmpleado = currentUser?.role === 'empleado';

  const canAccessUsers = isSuperAdmin || isDueno;
  const canAccessSettings = true; // Super Admin (control total), Dueño y Empleados (modo solo lectura)
  const canAccessBrain = true; // Super Admin (Prompt Maestro exclusivo), Dueño y Empleados (Feriados RD y Tácticas)

  return (
    <header className="border-b border-white/[0.07] bg-[#090D12]/95 backdrop-blur-xl sticky top-0 z-50 px-4 lg:px-8 py-2.5 transition-all">
      <div className="flex items-center justify-between gap-4 max-w-[1720px] mx-auto">
        {/* Zone 1: Brand Icon (Authenticated View) */}
        <div className="flex items-center shrink-0">
          <a
            href="#inbox"
            onClick={e => {
              e.preventDefault();
              setCurrentTab('inbox');
            }}
            className="flex items-center group focus:outline-none py-0.5"
            title="Vendemá - Inicio / WhatsApp Inbox"
          >
            <img
              src="/assets/aistudio/image_0e849e13.png"
              alt="Vendemá CRM"
              className="h-10 w-10 sm:h-11 sm:w-11 rounded-full object-cover object-center select-none transition-transform duration-200 group-hover:scale-[1.05]"
            />
          </a>
        </div>

        {/* Zone 2: Navigation Links (RBAC filtered) */}
        <nav className="hidden xl:flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <button
            onClick={() => setCurrentTab('inbox')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              currentTab === 'inbox'
                ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                : 'hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <MessageSquare className={`w-3.5 h-3.5 ${currentTab === 'inbox' ? 'text-lime-400' : 'text-slate-400'}`} />
            <span>WhatsApp Inbox</span>
          </button>

          <button
            onClick={() => setCurrentTab('inventory')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              currentTab === 'inventory'
                ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                : 'hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Package className={`w-3.5 h-3.5 ${currentTab === 'inventory' ? 'text-lime-400' : 'text-slate-400'}`} />
            <span>Inventario</span>
          </button>

          <button
            onClick={() => setCurrentTab('orders')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              currentTab === 'orders'
                ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                : 'hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <ClipboardList className={`w-3.5 h-3.5 ${currentTab === 'orders' ? 'text-lime-400' : 'text-slate-400'}`} />
            <span>Pedidos & Cobros</span>
          </button>

          <button
            onClick={() => setCurrentTab('customers')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              currentTab === 'customers'
                ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                : 'hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Users className={`w-3.5 h-3.5 ${currentTab === 'customers' ? 'text-lime-400' : 'text-slate-400'}`} />
            <span>Clientes & Leads</span>
          </button>

          {canAccessBrain && (
            <button
              onClick={() => setCurrentTab('brain')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'brain'
                  ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                  : 'hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <BrainCircuit className={`w-3.5 h-3.5 ${currentTab === 'brain' ? 'text-lime-400' : 'text-slate-400'}`} />
              <span>Cerebro IA</span>
            </button>
          )}

          {canAccessUsers && (
            <button
              onClick={() => setCurrentTab('users')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'users'
                  ? 'bg-purple-950/80 text-purple-200 font-semibold shadow-sm shadow-black/40 border border-purple-500/40'
                  : 'hover:text-purple-300 hover:bg-white/[0.04]'
              }`}
            >
              <ShieldCheck className={`w-3.5 h-3.5 ${currentTab === 'users' ? 'text-purple-400' : 'text-purple-400/80'}`} />
              <span>Equipo & Roles</span>
            </button>
          )}

          {canAccessSettings && (
            <button
              onClick={() => setCurrentTab('settings')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                currentTab === 'settings'
                  ? 'bg-white/[0.08] text-white font-semibold shadow-sm shadow-black/40 border border-white/[0.08]'
                  : 'hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Settings className={`w-3.5 h-3.5 ${currentTab === 'settings' ? 'text-lime-400' : 'text-slate-400'}`} />
              <span>Conexiones</span>
            </button>
          )}
        </nav>

        {/* Zone 3: Global System Controls + User Profile */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Live Dominican Republic Real-Time Clock Badge */}
          <div
            onClick={() => setCurrentTab('brain')}
            title={`República Dominicana (America/Santo_Domingo UTC-4)\n${rdTime.fullDateStr} · ${rdTime.time12WithSeconds}\nEstado: ${rdTime.statusSummary}\n${rdTime.statusDetail}\nClic para abrir configuración de feriados y horarios`}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-xs font-mono cursor-pointer hover:border-lime-500/40 transition-colors select-none"
          >
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="text-sm leading-none">🇩🇴</span>
              <span className="font-semibold text-white">
                {rdTime.dayName.slice(0, 3)} {rdTime.day} {rdTime.monthName.slice(0, 3)}
              </span>
              <span className="text-slate-500">·</span>
              <span className="tabular-nums text-lime-400 font-bold">
                {rdTime.time12WithSeconds}
              </span>
            </span>

            <span
              className={`text-[10px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                rdTime.isOpen
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-600/50'
                  : 'bg-rose-950/90 text-rose-300 border border-rose-600/50'
              }`}
            >
              {rdTime.isOpen ? 'ABIERTO' : 'CERRADO'}
            </span>
          </div>

          {/* Master Global AI Switch */}
          <button
            onClick={onToggleGlobalAi}
            title={
              config.globalAiActive
                ? 'IA General Activa: Clic para pausar todas las respuestas automáticas.'
                : 'IA General Pausada: Todas las conversaciones están en modo humano manual. Clic para activar.'
            }
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              config.globalAiActive
                ? 'bg-[#152712] border-lime-500/40 text-lime-300 hover:bg-[#1a3317]'
                : 'bg-amber-950/60 border-amber-600/50 text-amber-300 hover:bg-amber-900/60'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-lime-400" />
            <span className="tabular-nums hidden sm:inline">
              {config.globalAiActive ? 'IA ACTIVA' : 'IA PAUSADA'}
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                config.globalAiActive ? 'bg-lime-400' : 'bg-amber-400'
              }`}
            />
          </button>

          {/* User Profile Pill & Logout */}
          {currentUser && (
            <div className="flex items-center gap-2 pl-2 border-l border-white/[0.08]">
              <div 
                className="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]"
                title={`Usuario activo: @${currentUser.username}\nWhatsApp: +${currentUser.whatsapp}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs uppercase ${
                  isSuperAdmin
                    ? 'bg-purple-950 border border-purple-500/50 text-purple-300'
                    : isDueno
                    ? 'bg-cyan-950 border border-cyan-500/50 text-cyan-300'
                    : 'bg-slate-800 border border-white/[0.1] text-slate-200'
                }`}>
                  {isSuperAdmin ? <Crown className="w-3.5 h-3.5 text-purple-400" /> : currentUser.nombre.charAt(0)}
                </div>

                <div className="hidden sm:block text-left">
                  <div className="text-xs font-bold text-white leading-tight">
                    {currentUser.nombre}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 leading-tight">
                    {isSuperAdmin ? 'Super Admin' : isDueno ? 'Dueño' : 'Ventas'}
                  </div>
                </div>
              </div>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/50 hover:bg-rose-900 border border-rose-500/40 hover:border-rose-400 text-rose-200 hover:text-white text-xs font-bold transition-all cursor-pointer shadow-sm shadow-rose-950/40"
                  title="Cerrar sesión y salir del sistema"
                >
                  <LogOut className="w-3.5 h-3.5 text-rose-400" />
                  <span>Salir</span>
                </button>
              )}
            </div>
          )}

          {/* Mobile Tab Select Dropdown & Quick Logout */}
          <div className="xl:hidden flex items-center gap-1.5">
            <select
              value={currentTab}
              onChange={e => {
                if (e.target.value === 'logout') {
                  if (onLogout) onLogout();
                } else {
                  setCurrentTab(e.target.value);
                }
              }}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-lime-500"
            >
              <option value="inbox">💬 WhatsApp Inbox</option>
              <option value="inventory">📦 Inventario</option>
              <option value="orders">📋 Pedidos & Cobros</option>
              <option value="customers">👥 Clientes & Leads</option>
              {canAccessBrain && <option value="brain">🧠 Cerebro IA</option>}
              {canAccessUsers && <option value="users">🛡️ Equipo & Roles</option>}
              {canAccessSettings && <option value="settings">⚙️ Conexiones</option>}
              <option value="logout">🚪 Salir del sistema</option>
            </select>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/70 border border-rose-500/50 text-rose-200 hover:bg-rose-900 text-xs font-bold cursor-pointer transition-colors"
                title="Cerrar sesión y salir del sistema"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
