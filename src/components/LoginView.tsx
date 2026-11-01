import React, { useState } from 'react';
import { 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import type { UserAccount } from '../types';
import { loadUsersFromSupabase, autoSyncUserToSupabase } from '../utils/supabaseService';

interface LoginViewProps {
  onLoginSuccess: (user: UserAccount, token: string) => void;
}

const FALLBACK_DEFAULT_USERS: UserAccount[] = [
  {
    id: 'usr_super_nelson',
    nombre: 'Nelson',
    username: 'nelson',
    password: 'elmejor19',
    whatsapp: '18496260800',
    role: 'super_admin',
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_dueno_negocio',
    nombre: 'Dueño Todo Lapto',
    username: 'dueno',
    password: 'dueno123',
    whatsapp: '18094228738',
    role: 'dueno',
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_empleado_ventas',
    nombre: 'Asesor de Ventas',
    username: 'empleado',
    password: 'empleado123',
    whatsapp: '18492588738',
    role: 'empleado',
    activo: true,
    createdAt: new Date().toISOString(),
  },
];

function matchUserInList(list: UserAccount[], rawUser: string): UserAccount | undefined {
  const cleanUser = rawUser.trim().replace(/^@+/, '').toLowerCase();
  const digitsOnly = cleanUser.replace(/\D/g, '');
  return list.find(u => {
    if ((u.username || '').toLowerCase().trim() === cleanUser) return true;
    if ((u.nombre || '').toLowerCase().trim() === cleanUser) return true;
    if (digitsOnly.length >= 10 && (u.whatsapp || '').replace(/\D/g, '').endsWith(digitsOnly.slice(-10))) return true;
    return false;
  });
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsernameInput = username.trim().replace(/^@+/, '');
    const cleanPasswordInput = password.trim();

    if (!cleanUsernameInput || !cleanPasswordInput) {
      setErrorMessage('Por favor ingresa tu nombre de usuario y contraseña.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 1. Primary authentication via Backend API (/api/auth/login)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUsernameInput,
            password: cleanPasswordInput,
          }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (res.ok && data.success && data.user) {
            onLoginSuccess(data.user, data.token || `vendema_tk_${data.user.id}_${Date.now()}`);
            return;
          }
          // If deactivated, stop immediately
          if (res.status === 403) {
            throw new Error(data.message || 'Esta cuenta ha sido desactivada.');
          }
        }
      } catch (apiErr: any) {
        if (apiErr.message?.includes('desactivada')) {
          throw apiErr;
        }
        // Otherwise proceed to direct Supabase + Fallback verification
      }

      // 2. Direct Supabase Authentication Fallback (`public.usuarios` + Cloud Backup + Local Storage + Defaults)
      const supabaseUsers = await loadUsersFromSupabase();
      let localStoredUsers: UserAccount[] = [];
      try {
        const rawLocal = localStorage.getItem('vendema_local_users');
        if (rawLocal) {
          const parsed = JSON.parse(rawLocal);
          if (Array.isArray(parsed)) localStoredUsers = parsed;
        }
      } catch {}

      const combinedMap = new Map<string, UserAccount>();
      for (const u of FALLBACK_DEFAULT_USERS) {
        combinedMap.set(u.username.toLowerCase(), { ...u });
      }
      for (const u of localStoredUsers) {
        if (u.username && u.password) {
          combinedMap.set(u.username.toLowerCase(), { ...u });
        }
      }
      for (const u of supabaseUsers) {
        if (u.username && u.password) {
          combinedMap.set(u.username.toLowerCase(), { ...u });
        }
      }

      const combinedUsers = Array.from(combinedMap.values());
      const found = matchUserInList(combinedUsers, cleanUsernameInput);

      if (!found) {
        throw new Error('Nombre de usuario no encontrado.');
      }

      if (!found.activo) {
        throw new Error('Esta cuenta ha sido desactivada por el Super Administrador.');
      }

      if (found.password !== cleanPasswordInput) {
        throw new Error('Contraseña incorrecta.');
      }

      const updatedUser: UserAccount = {
        ...found,
        lastLogin: new Date().toISOString(),
      };

      autoSyncUserToSupabase(updatedUser, combinedUsers).catch(() => {});

      const { password: _pw, ...sanitizedUser } = updatedUser;
      const token = `vendema_tk_${updatedUser.id}_${Date.now()}`;
      onLoginSuccess(sanitizedUser as UserAccount, token);
    } catch (err: any) {
      setErrorMessage(err.message || 'Credenciales inválidas.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070A0F] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Background radial ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[450px] bg-gradient-to-tr from-lime-600/10 via-emerald-600/10 to-transparent blur-3xl pointer-events-none rounded-full" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-cyan-600/5 blur-3xl pointer-events-none rounded-full" />

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center justify-center py-2">
          <img
            src="/assets/aistudio/image_018235a4.png"
            alt="Vendemá - CRM • Ventas • Automatización"
            className="h-20 sm:h-24 w-auto object-contain select-none drop-shadow-[0_4px_24px_rgba(132,204,22,0.18)]"
          />
        </div>

        {/* Login Card */}
        <div className="bg-[#0E141D] border border-white/[0.08] rounded-2xl p-6 sm:p-7 shadow-2xl space-y-5">
          <div className="border-b border-white/[0.06] pb-3">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-lime-400" />
              <span>Acceso de Usuario al Sistema</span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Ingresa con tu nombre de usuario y clave asignada
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Nombre de Usuario</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Tu usuario"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().trim())}
                  className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 font-medium placeholder-slate-500 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500/30 transition-all font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Contraseña</span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-lime-400 hover:text-lime-300 transition-colors font-normal"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl pl-9 pr-10 py-2.5 text-xs text-slate-100 font-medium placeholder-slate-500 focus:outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500/30 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-lime-500/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed group cursor-pointer"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Verificando credenciales...</span>
                </>
              ) : (
                <>
                  <span>Ingresar al CRM</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
