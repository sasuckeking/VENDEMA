import React, { useState } from 'react';
import { 
  CreditCard, 
  Package, 
  MapPin, 
  User, 
  Phone, 
  X 
} from 'lucide-react';
import type { ProductItem } from '../types';

interface CreateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: ProductItem[];
  customers?: any[];
  prefill?: {
    clientName?: string;
    clientPhone?: string;
    address?: string;
    productId?: number;
    productsSummary?: string;
    price?: number;
  };
  onCreateOrder: (orderData: any) => Promise<void>;
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  isOpen,
  onClose,
  products,
  customers = [],
  prefill,
  onCreateOrder,
}) => {
  // Filter only in-stock and available for sale products
  const saleProducts = products.filter(p => p.virtual_available > 0);

  const [clientName, setClientName] = useState(prefill?.clientName || '');
  const [clientPhone, setClientPhone] = useState(prefill?.clientPhone || '');
  const [address, setAddress] = useState(prefill?.address || '');
  const [selectedProductId, setSelectedProductId] = useState<number>(
    prefill?.productId || (saleProducts[0]?.variantId || saleProducts[0]?.id || 1042)
  );
  const [paymentMethod, setPaymentMethod] = useState<'contra_entrega' | 'transferencia'>('contra_entrega');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [sendWhatsAppNotification, setSendWhatsAppNotification] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sync state when modal opens or prefill changes
  React.useEffect(() => {
    if (isOpen) {
      setClientName(prefill?.clientName || '');
      setClientPhone(prefill?.clientPhone || '');
      setAddress(prefill?.address || '');
      if (prefill?.productId) {
        setSelectedProductId(prefill.productId);
      } else if (saleProducts.length > 0) {
        setSelectedProductId(saleProducts[0]?.variantId || saleProducts[0]?.id || 1042);
      }
      setDeliveryNotes('');
      setFormError(null);
    }
  }, [isOpen, prefill]);

  // Clean phone digits for validation & Odoo lookup
  const cleanPhoneDigits = (clientPhone || '').replace(/\D/g, '');
  const isPhoneValid = cleanPhoneDigits.length >= 10;
  const last10 = cleanPhoneDigits.slice(-10);

  // Check if client is already an Odoo partner
  const matchedCustomer = customers.find(c => {
    const cPhoneDigits = (c.phone || '').replace(/\D/g, '');
    return (
      (last10 && cPhoneDigits.endsWith(last10)) ||
      (c.name && clientName && c.name.toLowerCase() === clientName.toLowerCase().trim())
    );
  });

  const selectedProduct = saleProducts.find(p => (p.variantId || p.id) === selectedProductId) || saleProducts[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!clientName.trim()) {
      setFormError('Por favor ingresa el nombre del cliente.');
      return;
    }

    if (!isPhoneValid) {
      setFormError('Se requiere un teléfono válido de al menos 10 dígitos (Ej: 809-123-4567) para registrar la cotización.');
      return;
    }

    if (!address.trim()) {
      setFormError('Por favor ingresa la dirección o sector de entrega.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreateOrder({
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        productsSummary: selectedProduct ? selectedProduct.name : 'Laptop Todo Lapto',
        productId: selectedProductId,
        price: selectedProduct ? selectedProduct.list_price : 18500,
        paymentMethod,
        address: address.trim(),
        notes: deliveryNotes.trim(),
        sendWhatsAppNotification,
      });
      onClose();
    } catch (err: any) {
      setFormError(err.message || 'Error al registrar pedido');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[#0C1017] border border-white/[0.08] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl my-8 text-slate-100"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-lime-400" />
            <span>Generar Nueva Cotización / Pedido</span>
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {formError && (
          <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-200 flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Customer info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Nombre del Cliente</label>
              <input
                type="text"
                required
                placeholder="Ej. Roberto Gómez"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Teléfono WhatsApp</label>
              <input
                type="text"
                required
                placeholder="18091234567"
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
                className={`w-full bg-[#121822] border rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                  clientPhone && !isPhoneValid
                    ? 'border-amber-500/70 focus:border-amber-500'
                    : isPhoneValid
                    ? 'border-lime-500/50 focus:border-lime-500'
                    : 'border-white/[0.07] focus:border-lime-500'
                }`}
              />
            </div>
          </div>

          {/* Live Customer Status & Phone Validation Badge */}
          <div className="text-[11px] space-y-1">
            {clientPhone && !isPhoneValid && (
              <div className="text-amber-400 flex items-center gap-1.5 font-medium">
                <span>⚠️ Teléfono incompleto ({cleanPhoneDigits.length}/10 dígitos requeridos).</span>
              </div>
            )}
            {matchedCustomer ? (
              <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Cliente Registrado: {matchedCustomer.name}
                </span>
                <span className="font-mono text-[10px] bg-emerald-900/60 px-1.5 py-0.5 rounded text-emerald-200">
                  {matchedCustomer.odooPartnerId ? `#${matchedCustomer.odooPartnerId}` : 'Existente'}
                </span>
              </div>
            ) : isPhoneValid ? (
              <div className="p-1.5 text-slate-400 flex items-center gap-1.5 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span>Cliente nuevo: se registrará automáticamente en el sistema al generar la orden.</span>
              </div>
            ) : null}
          </div>

          {/* Product Select (Only available for sale) */}
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">
              Producto (Solo disponibles para venta)
            </label>
            <select
              value={selectedProductId}
              onChange={e => setSelectedProductId(Number(e.target.value))}
              className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
            >
              {saleProducts.map(p => (
                <option key={p.id} value={p.variantId || p.id}>
                  {p.name} — RD${p.list_price.toLocaleString()} (Stock: {p.virtual_available})
                </option>
              ))}
            </select>
            {selectedProduct && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 px-1">
                <span>Vitrina: <strong className="text-slate-300">{selectedProduct.vitrinaStock || 0}</strong> unid. | Total stock: <strong className="text-slate-300">{selectedProduct.virtual_available}</strong> unid.</span>
                <span className="text-lime-400 font-medium">6 meses de garantía Todo Lapto</span>
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">Método de Pago</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('contra_entrega')}
                className={`py-2 px-3 rounded-lg border text-left transition-colors ${
                  paymentMethod === 'contra_entrega'
                    ? 'bg-lime-950/80 border-lime-500 text-lime-300 font-bold'
                    : 'bg-[#121822] border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div>🚚 Contra Entrega</div>
                <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                  Solo Santo Domingo (paga al recibir)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('transferencia')}
                className={`py-2 px-3 rounded-lg border text-left transition-colors ${
                  paymentMethod === 'transferencia'
                    ? 'bg-lime-950/80 border-lime-500 text-lime-300 font-bold'
                    : 'bg-[#121822] border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div>🏦 Transferencia Bancaria</div>
                <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                  Banreservas / Popular / BHD
                </div>
              </button>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">Dirección de Entrega</label>
            <input
              type="text"
              required
              placeholder="Calle, número, edificio, sector o municipio..."
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
            />
          </div>

          {/* Delivery Notes */}
          <div>
            <label className="block text-slate-400 mb-1 font-semibold">Notas u Horario de Entrega</label>
            <input
              type="text"
              placeholder="Ej. Entregar en la tarde, llevar cambio de RD$2,000"
              value={deliveryNotes}
              onChange={e => setDeliveryNotes(e.target.value)}
              className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
            />
          </div>

          {/* WhatsApp Notification Toggle */}
          <div className="p-2.5 rounded-xl bg-[#121822] border border-white/[0.06] flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300">
              <input
                type="checkbox"
                checked={sendWhatsAppNotification}
                onChange={e => setSendWhatsAppNotification(e.target.checked)}
                className="w-4 h-4 rounded text-lime-500 focus:ring-0 bg-[#0C1017] border-white/[0.2]"
              />
              <span className="font-semibold text-[11px]">Enviar confirmación oficial inmediata al cliente por WhatsApp</span>
            </label>
            <span className="text-[10px] text-lime-400 font-mono">Evolution API</span>
          </div>

          {/* Price Summary */}
          <div className="p-3 rounded-xl bg-[#121822] border border-white/[0.06] flex items-center justify-between">
            <span className="text-slate-400">Total a Facturar:</span>
            <span className="text-base font-bold text-white font-mono tabular-nums">
              RD${selectedProduct ? selectedProduct.list_price.toLocaleString() : '0'}
            </span>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isPhoneValid}
              className="px-5 py-2 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold shadow-lg shadow-lime-500/20 disabled:opacity-50"
            >
              {isSubmitting ? 'Registrando...' : 'Crear Cotización & Notificar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
