import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  UserPlus, 
  Users, 
  Crown, 
  Briefcase, 
  Headphones, 
  Phone, 
  MessageSquare, 
  Edit3, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  RefreshCw,
  KeyRound,
  LogOut,
  Database,
  FileCode,
  Copy,
  Check,
  Terminal
} from 'lucide-react';
import type { UserAccount, UserRole } from '../types';
import { 
  loadUsersFromSupabase, 
  autoSyncUserToSupabase, 
  deleteUserFromSupabase, 
  syncAllUsersToSupabase,
  getSupabaseSchemaSql 
} from '../utils/supabaseService';

interface UsersViewProps {
  currentUser: UserAccount;
  onLogout?: () => void;
}

const DEFAULT_FALLBACK_USERS: UserAccount[] = [
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

export const UsersView: React.FC<UsersViewProps> = ({ currentUser, onLogout }) => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // SQL Modal State
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const schemaSql = getSupabaseSchemaSql();

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);

  // Form Fields (NO EMAIL)
  const [formNombre, setFormNombre] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formWhatsapp, setFormWhatsapp] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('empleado');
  const [formActivo, setFormActivo] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Role permissions check
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isDueno = currentUser.role === 'dueno';
  const canManageUsers = isSuperAdmin || isDueno;

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      let apiUsers: UserAccount[] = [];
      try {
        const res = await fetch('/api/users');
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (data.success && Array.isArray(data.users)) {
            apiUsers = data.users;
          }
        }
      } catch {}

      const supaUsers = await loadUsersFromSupabase();
      let localStored: UserAccount[] = [];
      try {
        const raw = localStorage.getItem('vendema_local_users');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) localStored = parsed;
        }
      } catch {}

      const mergedMap = new Map<string, UserAccount>();
      for (const u of DEFAULT_FALLBACK_USERS) {
        mergedMap.set(u.username.toLowerCase(), { ...u });
      }
      for (const u of localStored) {
        if (u.username) mergedMap.set(u.username.toLowerCase(), { ...mergedMap.get(u.username.toLowerCase()), ...u });
      }
      for (const u of supaUsers) {
        if (u.username) mergedMap.set(u.username.toLowerCase(), { ...mergedMap.get(u.username.toLowerCase()), ...u });
      }
      for (const u of apiUsers) {
        if (u.username) {
          const existing = mergedMap.get(u.username.toLowerCase());
          mergedMap.set(u.username.toLowerCase(), { ...existing, ...u, password: existing?.password || u.password });
        }
      }

      const finalUsers = Array.from(mergedMap.values());
      setUsers(finalUsers);
      try {
        localStorage.setItem('vendema_local_users', JSON.stringify(finalUsers));
      } catch {}
    } catch (err: any) {
      setErrorMessage('Error al cargar la lista de usuarios: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleManualSupabaseSync = async () => {
    setIsSyncingSupabase(true);
    setErrorMessage(null);
    try {
      const res = await syncAllUsersToSupabase(users);
      if (res.error) {
        setSuccessToast(`Usuarios respaldados en la nube (${res.synced}). Ejecuta el "Script SQL Tabla Usuarios" en Supabase para activar la tabla dedicada 'usuarios'.`);
      } else {
        setSuccessToast(`¡${res.synced} usuarios sincronizados directamente en la tabla 'usuarios' de Supabase!`);
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSyncingSupabase(false);
      setTimeout(() => setSuccessToast(null), 5000);
    }
  };

  const openCreateModal = () => {
    setModalMode('create');
    setSelectedUser(null);
    setFormNombre('');
    setFormUsername('');
    setFormPassword('');
    setFormWhatsapp('');
    setFormRole('empleado');
    setFormActivo(true);
    setShowPassword(false);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const openEditModal = (u: UserAccount) => {
    setModalMode('edit');
    setSelectedUser(u);
    setFormNombre(u.nombre);
    setFormUsername(u.username);
    setFormPassword('');
    setFormWhatsapp(u.whatsapp);
    setFormRole(u.role);
    setFormActivo(u.activo);
    setShowPassword(false);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (modalMode === 'create') {
        if (!formNombre.trim() || !formUsername.trim() || !formPassword.trim() || !formWhatsapp.trim()) {
          throw new Error('Todos los campos son obligatorios: Nombre, Usuario, Contraseña y WhatsApp.');
        }

        const cleanU = formUsername.trim().replace(/^@+/, '').toLowerCase().replace(/\s+/g, '');
        const newUserObj: UserAccount = {
          id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          nombre: formNombre.trim(),
          username: cleanU,
          password: formPassword.trim(),
          whatsapp: formWhatsapp.trim().replace(/[^\d+]/g, ''),
          role: formRole,
          activo: true,
          createdAt: new Date().toISOString(),
        };

        // 1. Try Backend API
        try {
          const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: newUserObj.nombre,
              username: newUserObj.username,
              password: newUserObj.password,
              whatsapp: newUserObj.whatsapp,
              role: newUserObj.role,
            }),
          });
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = await res.json();
            if (!res.ok && data.message) {
              throw new Error(data.message);
            }
            if (data.user?.id) {
              newUserObj.id = data.user.id;
            }
          }
        } catch (apiErr: any) {
          if (apiErr.message?.includes('ya existe')) throw apiErr;
        }

        // 2. Sync to Supabase & LocalStorage directly as well
        const updatedList = [...users.filter(u => u.username.toLowerCase() !== cleanU), newUserObj];
        setUsers(updatedList);
        try {
          localStorage.setItem('vendema_local_users', JSON.stringify(updatedList));
        } catch {}
        await autoSyncUserToSupabase(newUserObj, updatedList);

        setSuccessToast(`Usuario ${newUserObj.nombre} (@${newUserObj.username}) creado y sincronizado con Supabase.`);
        setIsModalOpen(false);
        fetchUsers();
      } else if (modalMode === 'edit' && selectedUser) {
        const updatedUserObj: UserAccount = {
          ...selectedUser,
          nombre: formNombre.trim(),
          whatsapp: formWhatsapp.trim().replace(/[^\d+]/g, ''),
          role: selectedUser.username.toLowerCase() === 'nelson' ? 'super_admin' : formRole,
          activo: selectedUser.username.toLowerCase() === 'nelson' ? true : formActivo,
          ...(formPassword.trim() ? { password: formPassword.trim() } : {}),
        };

        try {
          await fetch(`/api/users/${selectedUser.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: updatedUserObj.nombre,
              whatsapp: updatedUserObj.whatsapp,
              role: updatedUserObj.role,
              activo: updatedUserObj.activo,
              ...(formPassword.trim() ? { password: formPassword.trim() } : {}),
            }),
          });
        } catch {}

        const updatedList = users.map(u => (u.id === selectedUser.id || u.username === selectedUser.username ? updatedUserObj : u));
        setUsers(updatedList);
        try {
          localStorage.setItem('vendema_local_users', JSON.stringify(updatedList));
        } catch {}
        await autoSyncUserToSupabase(updatedUserObj, updatedList);

        setSuccessToast(`Usuario ${updatedUserObj.nombre} actualizado y sincronizado con Supabase.`);
        setIsModalOpen(false);
        fetchUsers();
      }
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setSuccessToast(null), 4000);
    }
  };

  const handleDeleteUser = async (u: UserAccount) => {
    if (u.username.toLowerCase() === 'nelson') {
      setErrorMessage('No es posible eliminar al Super Administrador principal (nelson).');
      return;
    }

    try {
      await fetch(`/api/users/${u.id}`, { method: 'DELETE' }).catch(() => {});
      const remaining = users.filter(item => item.id !== u.id && item.username !== u.username);
      setUsers(remaining);
      try {
        localStorage.setItem('vendema_local_users', JSON.stringify(remaining));
      } catch {}
      await deleteUserFromSupabase(u, remaining);

      setSuccessToast(`Usuario @${u.username} eliminado de forma permanente.`);
      setTimeout(() => setSuccessToast(null), 3500);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'super_admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-950/80 border border-purple-500/40 text-purple-300 text-[11px] font-bold">
            <Crown className="w-3.5 h-3.5 text-purple-400" />
            <span>Super Admin</span>
          </span>
        );
      case 'dueno':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold">
            <Briefcase className="w-3.5 h-3.5 text-cyan-400" />
            <span>Dueño del Negocio</span>
          </span>
        );
      case 'empleado':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 border border-white/[0.08] text-slate-300 text-[11px] font-medium">
            <Headphones className="w-3.5 h-3.5 text-slate-400" />
            <span>Empleado / Vendedor</span>
          </span>
        );
    }
  };

  const totalSuperAdmins = users.filter(u => u.role === 'super_admin').length;
  const totalDuenos = users.filter(u => u.role === 'dueno').length;
  const totalEmpleados = users.filter(u => u.role === 'empleado').length;

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 bg-[#090D12] text-slate-100">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-purple-950/80 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>Jerarquía de Usuarios & Control de Accesos</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                RBAC + Supabase
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Gestiona y sincroniza en Supabase los accesos del Super Admin, Dueño del Negocio y Empleados.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSuperAdmin && (
            <>
              <button
                type="button"
                onClick={() => setShowSqlModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-xs font-semibold transition-colors cursor-pointer"
                title="Ver Script SQL para crear la tabla usuarios y demás tablas en Supabase"
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Script SQL Tablas</span>
              </button>

              <button
                type="button"
                onClick={handleManualSupabaseSync}
                disabled={isSyncingSupabase}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                title="Sincronizar todos los usuarios con Supabase"
              >
                <Database className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingSupabase ? 'animate-bounce' : ''}`} />
                <span>{isSyncingSupabase ? 'Sincronizando...' : 'Subir Usuarios a Supabase'}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={fetchUsers}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08] text-xs font-semibold transition-colors disabled:opacity-50"
            title="Recargar usuarios"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
            <span>Actualizar</span>
          </button>

          {canManageUsers && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-lime-500/20 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Crear Nuevo Usuario</span>
            </button>
          )}

          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/50 hover:bg-rose-900 border border-rose-500/40 text-rose-200 hover:text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
              title="Cerrar sesión y salir del sistema"
            >
              <LogOut className="w-3.5 h-3.5 text-rose-400" />
              <span>Salir</span>
            </button>
          )}
        </div>
      </div>

      {successToast && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {errorMessage && !isModalOpen && (
        <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total de Usuarios</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-white">{users.length}</div>
          <span className="text-[11px] text-slate-500">Cuentas con acceso activo</span>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-xs text-purple-300 font-semibold">
            <span>Super Administrador</span>
            <Crown className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-200">{totalSuperAdmins}</div>
          <span className="text-[11px] text-purple-400/80">Control total del CRM (@nelson)</span>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-xs text-cyan-300 font-semibold">
            <span>Dueños del Negocio</span>
            <Briefcase className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-cyan-200">{totalDuenos}</div>
          <span className="text-[11px] text-cyan-400/80">Ventas, finanzas e inventario</span>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
            <span>Empleados / Asesores</span>
            <Headphones className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-100">{totalEmpleados}</div>
          <span className="text-[11px] text-slate-500">Atención WhatsApp y ventas</span>
        </div>
      </div>

      {/* Users Table / Directory */}
      <div className="bg-[#0F141C] border border-white/[0.06] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Directorio de Equipo y Credenciales</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Autenticación basada estrictamente en Nombre de Usuario + Clave + WhatsApp (Sincronizado con Supabase)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0A0E15] text-slate-400 border-b border-white/[0.06] uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 sm:px-6">Usuario & Nombre</th>
                <th className="py-3 px-4">Jerarquía / Rol</th>
                <th className="py-3 px-4">Número de WhatsApp</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4">Creado / Último Acceso</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-lime-400 mb-2" />
                    <span>Cargando usuarios...</span>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No hay usuarios registrados.
                  </td>
                </tr>
              ) : (
                users.map(u => {
                  const isCurrent = u.username === currentUser.username;
                  const isPrincipalNelson = u.username.toLowerCase() === 'nelson';
                  const cleanPhone = (u.whatsapp || '').replace(/[^\d]/g, '');

                  return (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      {/* Name & Username */}
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs uppercase ${
                            u.role === 'super_admin'
                              ? 'bg-purple-950/80 border border-purple-500/40 text-purple-300'
                              : u.role === 'dueno'
                              ? 'bg-cyan-950/80 border border-cyan-500/40 text-cyan-300'
                              : 'bg-slate-800 border border-white/[0.08] text-slate-300'
                          }`}>
                            {u.nombre.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <span>{u.nombre}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.2 rounded bg-lime-500/20 text-lime-400 border border-lime-500/30 text-[9px] font-mono">
                                  TÚ
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-slate-400">
                              @{u.username}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="py-3.5 px-4">
                        {getRoleBadge(u.role)}
                      </td>

                      {/* WhatsApp Phone */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-lime-400 shrink-0" />
                          <span className="font-mono text-slate-200">
                            +{u.whatsapp}
                          </span>
                          <a
                            href={`https://wa.me/${cleanPhone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded bg-lime-950/60 hover:bg-lime-900 border border-lime-700/50 text-lime-400 transition-colors"
                            title={`Chatear con ${u.nombre} por WhatsApp`}
                          >
                            <MessageSquare className="w-3 h-3" />
                          </a>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          u.activo
                            ? 'bg-emerald-950/70 border border-emerald-500/30 text-emerald-400'
                            : 'bg-rose-950/70 border border-rose-500/30 text-rose-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.activo ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          <span>{u.activo ? 'Activo' : 'Inactivo'}</span>
                        </span>
                      </td>

                      {/* Dates */}
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        <div>{new Date(u.createdAt).toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo' })}</div>
                        {u.lastLogin && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            Acceso (RD): {new Date(u.lastLogin).toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hour12: true })}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {canManageUsers && (
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-slate-300 hover:text-white transition-colors"
                              title="Editar usuario / Cambiar contraseña"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {isSuperAdmin && !isPrincipalNelson && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 hover:text-rose-100 transition-colors"
                              title="Eliminar usuario"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE / EDIT USER MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0E141D] border border-white/[0.1] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-lime-950/80 border border-lime-500/30 flex items-center justify-center text-lime-400">
                  {modalMode === 'create' ? <UserPlus className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {modalMode === 'create' ? 'Crear Nuevo Usuario' : `Editar Usuario @${selectedUser?.username}`}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {modalMode === 'create'
                      ? 'Asigna nombre, usuario, contraseña y rol (se guarda en Supabase)'
                      : 'Actualiza los datos de acceso o el estado de la cuenta'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMessage && (
              <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Modal Form */}
            <form onSubmit={handleFormSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nombre Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Nelson Pérez"
                  value={formNombre}
                  onChange={e => setFormNombre(e.target.value)}
                  className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Nombre de Usuario (Sin Correo)
                  </label>
                  <input
                    type="text"
                    required
                    disabled={modalMode === 'edit'}
                    placeholder="nelson"
                    value={formUsername}
                    onChange={e => setFormUsername(e.target.value.toLowerCase().trim().replace(/\s+/g, ''))}
                    className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-lime-500 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Número de WhatsApp
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="18492588738"
                    value={formWhatsapp}
                    onChange={e => setFormWhatsapp(e.target.value)}
                    className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-lime-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    {modalMode === 'create' ? 'Contraseña' : 'Nueva Contraseña (dejar en blanco para no cambiar)'}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[11px] text-lime-400 hover:text-lime-300 font-normal"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required={modalMode === 'create'}
                    placeholder={modalMode === 'create' ? 'Mínimo 6 caracteres' : '••••••••'}
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    className="w-full bg-[#080C12] border border-white/[0.1] rounded-xl px-3 pr-10 py-2 text-xs text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:border-lime-500"
                  />
                  <KeyRound className="w-4 h-4 text-slate-500 absolute right-3 top-2.5 pointer-events-none" />
                </div>
              </div>

              {/* Role Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Rol y Nivel de Jerarquía
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    {
                      id: 'super_admin' as UserRole,
                      label: 'Super Admin',
                      desc: 'Acceso total y creador de usuarios',
                      disabled: !isSuperAdmin,
                    },
                    {
                      id: 'dueno' as UserRole,
                      label: 'Dueño Negocio',
                      desc: 'Ventas, inventario, pedidos y métricas',
                      disabled: false,
                    },
                    {
                      id: 'empleado' as UserRole,
                      label: 'Empleado',
                      desc: 'Atención WhatsApp y pedidos',
                      disabled: false,
                    },
                  ].map(r => {
                    const active = formRole === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={r.disabled}
                        onClick={() => setFormRole(r.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          active
                            ? 'bg-lime-950/60 border-lime-500 text-lime-200 shadow-sm'
                            : 'bg-[#080C12] border-white/[0.08] text-slate-400 hover:border-white/[0.15]'
                        } ${r.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <div className="font-bold text-xs text-white flex items-center justify-between">
                          <span>{r.label}</span>
                          <span className={`w-2 h-2 rounded-full ${active ? 'bg-lime-400' : 'bg-slate-600'}`} />
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5 leading-snug">
                          {r.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {modalMode === 'edit' && selectedUser?.username.toLowerCase() !== 'nelson' && (
                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="text-xs text-slate-300 font-semibold">Estado de la Cuenta:</span>
                  <button
                    type="button"
                    onClick={() => setFormActivo(!formActivo)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      formActivo
                        ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950 border border-rose-500/40 text-rose-300'
                    }`}
                  >
                    {formActivo ? '✓ Cuenta Activa' : '✕ Cuenta Desactivada'}
                  </button>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="pt-3 border-t border-white/[0.08] flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-lime-500/20 disabled:opacity-50"
                >
                  {isSubmitting
                    ? 'Guardando...'
                    : modalMode === 'create'
                    ? 'Crear Usuario'
                    : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SQL Schema Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D1219] border border-white/[0.1] rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-950/70 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Script SQL Completo para Supabase (Incluye Tabla Usuarios)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Copia y ejecuta este script en el SQL Editor de tu proyecto en Supabase para crear las 8 tablas del sistema.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-3 bg-cyan-950/20 border-b border-cyan-900/30 text-xs text-cyan-200/90 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                <strong>Pasos:</strong> 1. Abre Supabase &gt; <strong>SQL Editor</strong> &gt; <strong>New Query</strong>. 2. Pega este código SQL. 3. Haz clic en <strong>Run</strong>.
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-[#080B10]">
              <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed p-4 rounded-xl bg-black/60 border border-white/[0.05] overflow-x-auto select-all whitespace-pre">
                {schemaSql}
              </pre>
            </div>

            <div className="flex items-center justify-between p-4 border-t border-white/[0.08] bg-[#0A0E14] rounded-b-2xl">
              <span className="text-[11px] text-slate-400">
                Crea 8 tablas: <code>usuarios</code>, <code>configuracion_sistema</code>, <code>catalogo_productos</code>, <code>pedidos</code>, <code>contactos_whatsapp</code>, <code>conversaciones_todolapto</code>, <code>recordatorios_seguimiento</code> y <code>cerebro_ia_aprendizajes</code>.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSqlModal(false)}
                  className="px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(schemaSql);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors shadow-md shadow-cyan-500/20"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? '¡Copiado al Portapapeles!' : 'Copiar Script SQL'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
