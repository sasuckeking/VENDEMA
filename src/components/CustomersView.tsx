import React, { useState } from 'react';
import { 
  Users, 
  Search, 
  PlusCircle, 
  MessageSquare, 
  MapPin, 
  Tag,
  CheckCircle2,
  RefreshCw,
  ShoppingBag,
  Phone,
  Building2
} from 'lucide-react';
import type { CustomerLead } from '../types';

interface CustomersViewProps {
  customers: CustomerLead[];
  onSelectChat: (phone: string) => void;
  onOpenCreateOrder: (prefill: { clientName: string; clientPhone: string; address?: string }) => void;
  onCreateCustomer: (customerData: Partial<CustomerLead>) => Promise<void>;
  onRefreshCustomers?: () => Promise<void>;
  isSyncing?: boolean;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  onSelectChat,
  onOpenCreateOrder,
  onCreateCustomer,
  onRefreshCustomers,
  isSyncing,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'with_phone' | 'with_orders'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New Customer Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [zone, setZone] = useState<'santo_domingo' | 'provincia'>('santo_domingo');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const odooCustomersCount = customers.filter(c => c.isOdooClient || c.odooPartnerId).length;
  const withPhoneCount = customers.filter(c => c.phone && c.phone.length >= 7).length;
  const withOrdersCount = customers.filter(c => c.ordersCount > 0).length;

  const filteredCustomers = customers.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm) ||
      (c.address && c.address.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.notes && c.notes.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (c.odooPartnerId && String(c.odooPartnerId).includes(searchTerm));

    if (!matchesSearch) return false;

    if (filterType === 'with_phone') return Boolean(c.phone && c.phone.length >= 7);
    if (filterType === 'with_orders') return c.ordersCount > 0;
    return true;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    setIsSubmitting(true);
    await onCreateCustomer({
      name,
      phone,
      address,
      zone,
      notes,
    });
    setIsSubmitting(false);
    setIsModalOpen(false);
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 bg-[#090D12] text-slate-100">
      {/* Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-lime-950/80 border border-lime-500/30 flex items-center justify-center text-lime-400 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Directorio de Clientes & Leads
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                {odooCustomersCount} clientes registrados
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Directorio unificado de contactos: distingue clientes registrados y prospectos de WhatsApp con deduplicación por teléfono.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {onRefreshCustomers && (
            <button
              onClick={() => onRefreshCustomers()}
              disabled={isSyncing}
              title="Sincronizar directorio de clientes"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 font-semibold text-xs transition-colors border border-white/[0.08] disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-lime-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sincronizar Clientes</span>
            </button>
          )}

          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar cliente, teléfono o ID..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#121822] border border-white/[0.07] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
            />
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors shrink-0 shadow-lg shadow-lime-500/20"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Registrar Cliente</span>
          </button>
        </div>
      </div>

      {/* KPI Stats & Filter Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div 
          onClick={() => setFilterType('all')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterType === 'all'
              ? 'bg-white/[0.06] border-lime-500/50 shadow-md'
              : 'bg-[#0F141C] border-white/[0.05] hover:bg-white/[0.03]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total Contactos</span>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {customers.length.toLocaleString()}
          </div>
          <span className="text-[10px] text-lime-400 font-medium mt-1 block">
            {odooCustomersCount} registrados
          </span>
        </div>

        <div 
          onClick={() => setFilterType('with_phone')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterType === 'with_phone'
              ? 'bg-white/[0.06] border-lime-500/50 shadow-md'
              : 'bg-[#0F141C] border-white/[0.05] hover:bg-white/[0.03]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Con Teléfono Verificado</span>
            <Phone className="w-4 h-4 text-lime-400" />
          </div>
          <div className="text-xl font-bold font-mono text-lime-300 mt-1">
            {withPhoneCount.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Listos para cotización y despacho
          </span>
        </div>

        <div 
          onClick={() => setFilterType('with_orders')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            filterType === 'with_orders'
              ? 'bg-white/[0.06] border-lime-500/50 shadow-md'
              : 'bg-[#0F141C] border-white/[0.05] hover:bg-white/[0.03]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Con Historial de Pedidos</span>
            <ShoppingBag className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
            {withOrdersCount.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Compras registradas
          </span>
        </div>
      </div>

      {/* Customers Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0F141C] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#121822] border-b border-white/[0.06] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Cliente</th>
                <th className="py-3.5 px-4">Teléfono WhatsApp</th>
                <th className="py-3.5 px-4">Zona / Ubicación</th>
                <th className="py-3.5 px-4">Código / ID</th>
                <th className="py-3.5 px-4">Intereses Detectados</th>
                <th className="py-3.5 px-4">Modo IA</th>
                <th className="py-3.5 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No se encontraron clientes con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(customer => (
                  <tr key={customer.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      <div>{customer.name}</div>
                      {customer.notes && (
                        <span className="text-[10px] text-slate-500 block truncate max-w-xs font-normal">
                          {customer.notes}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono text-lime-400">
                      {customer.phone}
                    </td>

                    <td className="py-3 px-4 text-slate-300">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate max-w-xs">{customer.address || 'No especificada'}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {customer.zone === 'santo_domingo' ? 'Santo Domingo' : 'Provincia'}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-mono">
                      {customer.odooPartnerId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>Cliente Registrado #{customer.odooPartnerId}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-white/[0.04] text-slate-400 border border-white/[0.06]">
                          <span>Prospecto</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 flex-wrap max-w-xs">
                        {customer.detectedInterests.length > 0 ? (
                          customer.detectedInterests.map((interest, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.04] text-slate-300 border border-white/[0.06]"
                            >
                              {interest}
                            </span>
                          ))
                        ) : (
                          <span className="text-slate-500 text-[11px]">Sin registro</span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          customer.aiEnabled
                            ? 'bg-lime-950/80 text-lime-300 border border-lime-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        }`}
                      >
                        {customer.aiEnabled ? 'IA Activa' : 'Humano'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onSelectChat(customer.phone)}
                          title="Abrir conversación en WhatsApp Inbox"
                          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-lime-400 transition-colors border border-white/[0.06]"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() =>
                            onOpenCreateOrder({
                              clientName: customer.name,
                              clientPhone: customer.phone,
                              address: customer.address,
                            })
                          }
                          title="Generar cotización"
                          className="px-2.5 py-1 rounded-lg bg-lime-500/10 hover:bg-lime-500/20 text-lime-300 border border-lime-500/30 text-xs font-semibold transition-colors"
                        >
                          Cotizar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Customer Modal */}
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
                <Users className="w-4 h-4 text-lime-400" />
                <span>Registrar Nuevo Cliente</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Nombre Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Ing. Juan Pérez"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">
                  Número de WhatsApp (con código de país ej: 18091234567)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. 18094228738"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Zona Geográfica</label>
                <select
                  value={zone}
                  onChange={e => setZone(e.target.value as any)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
                >
                  <option value="santo_domingo">Gran Santo Domingo (Contra Entrega disponible)</option>
                  <option value="provincia">Provincia / Interior (Transferencia previa requerida)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Dirección de Entrega</label>
                <textarea
                  rows={2}
                  placeholder="Calle, número, sector, punto de referencia..."
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Notas Internas</label>
                <input
                  type="text"
                  placeholder="Preferencias, RNC de empresa, etc."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
                />
              </div>

              <div className="p-3 rounded-xl bg-lime-950/40 border border-lime-800/40 text-lime-300 text-[11px] flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Deduplicación automática:</strong> Si el número telefónico ya está registrado, el sistema enlazará el contacto existente en lugar de duplicarlo.
                </span>
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
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold shadow-lg shadow-lime-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Registrando...' : 'Crear Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
