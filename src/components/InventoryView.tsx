import React, { useState, useEffect } from 'react';
import { 
  Package, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  PlusCircle,
  Copy,
  Check,
  Store,
  Warehouse,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { ProductItem } from '../types';

interface InventoryViewProps {
  products: ProductItem[];
  onRefreshOdoo: () => Promise<void>;
  isSyncing: boolean;
  lastSync?: string;
  onOpenCreateOrder: (prefill: { productId?: number; productsSummary?: string; price?: number }) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  onRefreshOdoo,
  isSyncing,
  lastSync,
  onOpenCreateOrder,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | 'vitrina' | 'almacen'>('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [priceRangeFilter, setPriceRangeFilter] = useState<'all' | 'under8k' | '8k_15k' | '15k_25k' | 'over25k'>('all');
  const [previewProduct, setPreviewProduct] = useState<ProductItem | null>(null);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const ITEMS_PER_PAGE = 48;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, locationFilter, priceRangeFilter]);

  // Base available products (sale_ok = true, virtual_available > 0)
  const allVendibleProducts = products.filter(p => p.virtual_available > 0);
  const vitrinaOnlyProducts = allVendibleProducts.filter(p => (p.vitrinaStock ?? 0) > 0);
  const almacenProducts = allVendibleProducts.filter(p => (p.almacenStock ?? 0) > 0);

  // Apply location filter first so category counts reflect the active location mode
  const locationScopedProducts = allVendibleProducts.filter(p => {
    if (locationFilter === 'vitrina') return (p.vitrinaStock ?? 0) > 0;
    if (locationFilter === 'almacen') return (p.almacenStock ?? 0) > 0;
    return true;
  });

  const categories = [
    { id: 'all', label: 'Todos', count: locationScopedProducts.length },
    { id: 'laptop', label: 'Laptops', count: locationScopedProducts.filter(p => p.category === 'laptop').length },
    { id: 'red', label: 'Redes y Wi-Fi', count: locationScopedProducts.filter(p => p.category === 'red').length },
    { id: 'monitor', label: 'Monitores', count: locationScopedProducts.filter(p => p.category === 'monitor').length },
    { id: 'impresora', label: 'Impresoras', count: locationScopedProducts.filter(p => p.category === 'impresora').length },
    { id: 'accesorio', label: 'Accesorios y Piezas', count: locationScopedProducts.filter(p => p.category === 'accesorio').length },
  ];

  // Helper to detect if searchTerm is a budget / price query (e.g. "10000", "10,000", "10 mil", "8000-12000")
  const parsePriceSearch = (raw: string): { min: number; max: number } | null => {
    const s = raw.trim().toLowerCase();
    if (!s) return null;
    const rangeM = s.match(/^(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?\s*(?:-|a|y)\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?$/i);
    if (rangeM) {
      let v1 = parseFloat(rangeM[1].replace(/[,.]/g, ''));
      let v2 = parseFloat(rangeM[3].replace(/[,.]/g, ''));
      if ((rangeM[2] || rangeM[4]) && v1 < 1000) v1 *= 1000;
      if (rangeM[4] && v2 < 1000) v2 *= 1000;
      if (v1 > 0 && v2 >= v1) return { min: v1, max: v2 };
    }
    const singleM = s.match(/^(?:rd\$|\$|de|por|hasta|menos de)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k|pesos)?$/i);
    if (singleM) {
      let v = parseFloat(singleM[1].replace(/[,.]/g, ''));
      const isMil = singleM[2] === 'mil' || singleM[2] === 'k';
      if (isMil && v < 1000) v *= 1000;
      if (v >= 1500 && v <= 150000) {
        if (s.startsWith('hasta') || s.startsWith('menos')) {
          return { min: 1, max: v };
        }
        return { min: Math.max(500, Math.round(v * 0.7)), max: v + 2500 };
      }
    }
    return null;
  };

  const budgetSearchBounds = parsePriceSearch(searchTerm);

  const filteredProducts = locationScopedProducts.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;

    let matchesPriceFilter = true;
    if (priceRangeFilter === 'under8k') matchesPriceFilter = p.list_price <= 8000;
    else if (priceRangeFilter === '8k_15k') matchesPriceFilter = p.list_price > 8000 && p.list_price <= 15000;
    else if (priceRangeFilter === '15k_25k') matchesPriceFilter = p.list_price > 15000 && p.list_price <= 25000;
    else if (priceRangeFilter === 'over25k') matchesPriceFilter = p.list_price > 25000;

    const qLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm.trim() ||
      (budgetSearchBounds
        ? p.list_price >= budgetSearchBounds.min && p.list_price <= budgetSearchBounds.max
        : false) ||
      p.name.toLowerCase().includes(qLower) ||
      String(p.id).includes(searchTerm) ||
      String(p.list_price).includes(searchTerm.replace(/[,.]/g, '')) ||
      (p.brand && p.brand.toLowerCase().includes(qLower)) ||
      (p.condition && p.condition.toLowerCase().includes(qLower)) ||
      (p.specsSummary && p.specsSummary.toLowerCase().includes(qLower)) ||
      (p.useCases && p.useCases.some(u => u.toLowerCase().includes(qLower))) ||
      (p.description_sale && p.description_sale.toLowerCase().includes(qLower));

    return matchesCategory && matchesPriceFilter && matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalStockUnits = locationScopedProducts.reduce((acc, p) => {
    if (locationFilter === 'vitrina') return acc + (p.vitrinaStock ?? p.virtual_available);
    if (locationFilter === 'almacen') return acc + (p.almacenStock ?? 0);
    return acc + p.virtual_available;
  }, 0);

  const totalValue = locationScopedProducts.reduce((acc, p) => {
    const qty =
      locationFilter === 'vitrina'
        ? p.vitrinaStock ?? p.virtual_available
        : locationFilter === 'almacen'
        ? p.almacenStock ?? 0
        : p.virtual_available;
    return acc + qty * p.list_price;
  }, 0);

  const handleCopy = (p: ProductItem) => {
    const link = `https://todolapto.com.do${p.website_url || ''}`;
    navigator.clipboard.writeText(
      `💻 *${p.name}*\n💰 Precio: RD$${p.list_price.toLocaleString()}\n📦 Stock disponible: ${p.virtual_available} unidad(es)${
        p.vitrinaStock ? ` (En Vitrina: ${p.vitrinaStock})` : ''
      }\n🏷️ Condición: ${p.conditionDetail || p.condition || 'Reacondicionado Clase A'}${
        p.specsSummary ? `\n⚙️ Specs: ${p.specsSummary}` : ''
      }${p.useCases?.length ? `\n🎯 Ideal para: ${p.useCases.join(', ')}` : ''}\n🔗 ${link}`
    );
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 bg-[#090D12] text-slate-100">
      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-lime-950/80 border border-lime-500/30 flex items-center justify-center text-lime-400 shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Inventario en Tiempo Real — Todo Lapto
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-lime-950 text-lime-400 border border-lime-800/60 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse" />
                Sincronización Automática 60s
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
              <span>Catálogo Centralizado:</span>
              <span className="text-lime-300 font-medium">
                {allVendibleProducts.length} modelos vendibles activos
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                Vitrina/Tienda: <strong className="text-white font-mono">{vitrinaOnlyProducts.length}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                Almacén TLP: <strong className="text-white font-mono">{almacenProducts.length}</strong>
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
          {lastSync && (
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              Último sync (RD): {new Date(lastSync).toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit', hour12: true })}
            </span>
          )}
          <button
            onClick={onRefreshOdoo}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-lime-500/20 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sincronizando...' : 'Actualizar Stock Ahora'}</span>
          </button>
        </div>
      </div>

      {/* Location Selector Bar (Vitrina vs Todos vs Almacén) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl bg-[#0F141C] border border-white/[0.06]">
        <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
          <Store className="w-4 h-4 text-lime-400 shrink-0" />
          <span className="font-medium text-slate-300">Ubicación de Stock:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setLocationFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              locationFilter === 'all'
                ? 'bg-lime-500 text-slate-950 shadow-sm'
                : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Todos los Disponibles ({allVendibleProducts.length})</span>
          </button>

          <button
            onClick={() => setLocationFilter('vitrina')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              locationFilter === 'vitrina'
                ? 'bg-lime-500 text-slate-950 shadow-sm'
                : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Solo Vitrina / Tienda — No Almacén ({vitrinaOnlyProducts.length})</span>
          </button>

          <button
            onClick={() => setLocationFilter('almacen')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              locationFilter === 'almacen'
                ? 'bg-lime-500 text-slate-950 shadow-sm'
                : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            <Warehouse className="w-3.5 h-3.5" />
            <span>En Almacén TLP ({almacenProducts.length})</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
          <span className="text-slate-400 text-xs block mb-1">
            Modelos en Vista ({locationFilter === 'vitrina' ? 'Solo Vitrina' : locationFilter === 'almacen' ? 'Almacén' : 'Total Vendibles'})
          </span>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {filteredProducts.length}{' '}
            <span className="text-xs font-normal text-slate-500">
              de {allVendibleProducts.length} productos
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
          <span className="text-slate-400 text-xs block mb-1">Unidades Físicas Disponibles</span>
          <div className="text-2xl font-bold text-lime-400 font-mono tabular-nums">
            {totalStockUnits.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-500">unidades en stock</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06]">
          <span className="text-slate-400 text-xs block mb-1">Valor de Inventario en Vista</span>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            RD${totalValue.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg whitespace-nowrap font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-white/[0.09] text-white border border-white/[0.09] shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          {/* Live Search (Name, Brand, Use Case, Condition, or Price/Budget) */}
          <div className="relative md:w-96">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar marca, uso (oficina, gaming, nuevo) o precio (ej: Dell, 10000)..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#0F141C] border border-white/[0.07] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
            />
          </div>
        </div>

        {/* Quick Budget / Price Range Filter Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
          <span className="text-slate-500 font-medium mr-1 shrink-0">Presupuesto RD$:</span>
          {[
            { id: 'all', label: 'Todos los Precios' },
            { id: 'under8k', label: 'Hasta RD$8,000' },
            { id: '8k_15k', label: 'RD$8,000 – RD$15,000' },
            { id: '15k_25k', label: 'RD$15,000 – RD$25,000' },
            { id: 'over25k', label: 'Más de RD$25,000' },
          ].map(pr => (
            <button
              key={pr.id}
              onClick={() => setPriceRangeFilter(pr.id as any)}
              className={`px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors font-mono ${
                priceRangeFilter === pr.id
                  ? 'bg-lime-950/90 text-lime-300 border border-lime-700/60 font-semibold'
                  : 'bg-[#0F141C] text-slate-400 border border-white/[0.05] hover:text-slate-200'
              }`}
            >
              {pr.label}
            </button>
          ))}
          {budgetSearchBounds && (
            <span className="ml-auto text-lime-400 font-mono text-[11px]">
              🎯 Filtrando por presupuesto: RD${budgetSearchBounds.min.toLocaleString()} – RD${budgetSearchBounds.max.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Product Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {paginatedProducts.length === 0 ? (
          <div className="col-span-full p-12 text-center text-slate-500 text-xs bg-[#0F141C] rounded-2xl border border-white/[0.06]">
            No se encontraron productos disponibles para venta con los criterios seleccionados.
          </div>
        ) : (
          paginatedProducts.map(p => {
            const imgUrl = p.image_url || `https://todolapto.com.do/web/image/product.template/${p.id}/image_256`;
            const hasFailedImg = failedImages[p.id];

            return (
              <div
                key={p.id}
                className="p-4 rounded-xl bg-[#0F141C] border border-white/[0.06] hover:border-lime-500/40 transition-all flex flex-col justify-between group shadow-sm hover:shadow-lg hover:shadow-black/40"
              >
                <div>
                  {/* Header metadata */}
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-2.5">
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className="text-slate-500">Código</span>
                      <span className="text-slate-300 font-semibold">#{p.variantId || p.id}</span>
                      {p.brand && p.brand !== 'Genérico' && (
                        <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 font-sans text-[10px] font-semibold">
                          {p.brand}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      {(p.vitrinaStock ?? 0) > 0 && (
                        <span className="text-lime-400 font-semibold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-lime-400" />
                          Vitrina: {p.vitrinaStock}
                        </span>
                      )}
                      {(p.almacenStock ?? 0) > 0 && (
                        <span className="text-cyan-400 font-medium">
                          Almacén: {p.almacenStock}
                        </span>
                      )}
                      {(p.vitrinaStock ?? 0) === 0 && (p.almacenStock ?? 0) === 0 && (
                        <span className="text-lime-400 font-semibold">
                          {p.virtual_available} disp.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Product Photo + Title & Specs */}
                  <div className="flex gap-3.5 mb-3">
                    <div
                      onClick={() => setPreviewProduct(p)}
                      title="Clic para ampliar imagen del producto"
                      className="w-20 h-20 rounded-xl bg-[#161D2A] border border-white/[0.07] overflow-hidden shrink-0 flex items-center justify-center cursor-pointer group-hover:border-lime-500/30 transition-colors"
                    >
                      {!hasFailedImg ? (
                        <img
                          src={imgUrl}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          onError={() => setFailedImages(prev => ({ ...prev, [p.id]: true }))}
                          className="w-full h-full object-contain p-1 bg-white/95 hover:scale-105 transition-transform"
                        />
                      ) : (
                        <Package className="w-7 h-7 text-slate-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3
                        onClick={() => setPreviewProduct(p)}
                        className="font-bold text-slate-100 text-sm mb-1 leading-snug line-clamp-2 cursor-pointer hover:text-lime-400 transition-colors"
                      >
                        {p.name}
                      </h3>

                      <div className="flex flex-wrap items-center gap-1 mb-1">
                        {p.condition && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              p.condition === 'Nuevo'
                                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/50'
                                : 'bg-amber-950/80 text-amber-300 border border-amber-700/40'
                            }`}
                          >
                            {p.condition === 'Nuevo' ? '✨ Nuevo (1 Año Gar.)' : '♻️ Reacond. Clase A (6m Gar.)'}
                          </span>
                        )}
                        {p.useCases?.slice(0, 2).map(uc => (
                          <span
                            key={uc}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/90 text-slate-300 border border-white/[0.06]"
                          >
                            {uc}
                          </span>
                        ))}
                      </div>

                      <p className="text-xs text-slate-400 line-clamp-2">
                        {p.specsSummary || p.description_sale || 'Disponible para facturación inmediata en Todo Lapto.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">
                      Precio Venta ({p.virtual_available} total)
                    </span>
                    <span className="text-base font-bold text-white font-mono tabular-nums">
                      RD${p.list_price.toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleCopy(p)}
                      title="Copiar ficha para enviar por WhatsApp"
                      className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 transition-colors border border-white/[0.04]"
                    >
                      {copiedId === p.id ? (
                        <Check className="w-3.5 h-3.5 text-lime-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <a
                      href={`https://todolapto.com.do${p.website_url || ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir producto en todolapto.com.do"
                      className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 transition-colors border border-white/[0.04]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    <button
                      onClick={() =>
                        onOpenCreateOrder({
                          productId: p.variantId || p.id,
                          productsSummary: p.name,
                          price: p.list_price,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 text-xs font-bold transition-colors flex items-center gap-1 shadow-sm"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Cotizar</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06] text-xs text-slate-400">
          <div>
            Mostrando página <strong className="text-white font-mono">{currentPage}</strong> de{' '}
            <strong className="text-white font-mono">{totalPages}</strong> ({filteredProducts.length}{' '}
            productos encontrados)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-[#0F141C] border border-white/[0.08] text-slate-200 hover:bg-white/[0.06] disabled:opacity-40 flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Anterior</span>
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-[#0F141C] border border-white/[0.08] text-slate-200 hover:bg-white/[0.06] disabled:opacity-40 flex items-center gap-1"
            >
              <span>Siguiente</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Product Image & Details Modal */}
      {previewProduct && (
        <div
          onClick={() => setPreviewProduct(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#0F141C] border border-white/[0.08] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono text-lime-400">
                  Código #{previewProduct.variantId || previewProduct.id} · {previewProduct.category.toUpperCase()}
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">{previewProduct.name}</h3>
              </div>
              <button
                onClick={() => setPreviewProduct(null)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-white p-4 flex items-center justify-center h-64 overflow-hidden">
              <img
                src={`https://todolapto.com.do/web/image/product.template/${previewProduct.id}/image_512`}
                alt={previewProduct.name}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-[#141C26] border border-white/[0.06]">
              <div>
                <span className="text-[10px] text-slate-400 uppercase block">Precio de Venta</span>
                <span className="text-xl font-bold text-lime-400 font-mono">
                  RD${previewProduct.list_price.toLocaleString()}
                </span>
              </div>
              <div className="text-right text-xs font-mono">
                <div className="text-slate-200 font-semibold">
                  Stock Total: {previewProduct.virtual_available} u.
                </div>
                <div className="text-slate-400 text-[11px]">
                  Vitrina: {previewProduct.vitrinaStock || 0} · Almacén: {previewProduct.almacenStock || 0}
                </div>
              </div>
            </div>

            {previewProduct.description_sale && (
              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                {previewProduct.description_sale}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => handleCopy(previewProduct)}
                className="px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Ficha WhatsApp</span>
              </button>
              <button
                onClick={() => {
                  const prod = previewProduct;
                  setPreviewProduct(null);
                  onOpenCreateOrder({
                    productId: prod.variantId || prod.id,
                    productsSummary: prod.name,
                    price: prod.list_price,
                  });
                }}
                className="px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Crear Cotización</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
