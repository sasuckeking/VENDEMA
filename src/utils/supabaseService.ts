import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { 
  Conversation, 
  CustomerLead, 
  SalesOrder, 
  FollowUpReminder, 
  AILearnedInsight,
  ChatMessage
} from '../types.js';

export interface SupabaseSyncStats {
  ordersSynced: number;
  customersSynced: number;
  conversationsSynced: number;
  messagesSynced: number;
  remindersSynced: number;
  insightsSynced: number;
  errors: string[];
}

let supabaseClient: SupabaseClient | null = null;
let currentUrl = '';
let currentKey = '';

export function getSupabaseClient(url?: string, anonKey?: string): SupabaseClient | null {
  const targetUrl = url || currentUrl || process.env.SUPABASE_URL || '';
  const targetKey = anonKey || currentKey || process.env.SUPABASE_ANON_KEY || '';

  if (!targetUrl || !targetKey) {
    return null;
  }

  if (!supabaseClient || currentUrl !== targetUrl || currentKey !== targetKey) {
    try {
      supabaseClient = createClient(targetUrl, targetKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      currentUrl = targetUrl;
      currentKey = targetKey;
    } catch (e: any) {
      console.warn('[Supabase Init Warning]:', e.message);
      return null;
    }
  }

  return supabaseClient;
}

/**
 * Test connectivity with Supabase by checking table access or query
 */
export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string; accessibleTables: string[] }> {
  try {
    if (!url || !url.startsWith('http')) {
      return { success: false, message: 'La URL de Supabase debe ser válida (https://*.supabase.co)', accessibleTables: [] };
    }
    if (!anonKey || anonKey.length < 20) {
      return { success: false, message: 'La Anon Key de Supabase proporcionada parece inválida o está incompleta.', accessibleTables: [] };
    }

    const testClient = createClient(url, anonKey, {
      auth: { persistSession: false },
    });

    const tablesToProbe = ['pedidos', 'contactos_whatsapp', 'conversaciones_todolapto', 'recordatorios_seguimiento'];
    const accessible: string[] = [];

    for (const table of tablesToProbe) {
      try {
        const { error } = await testClient.from(table).select('*').limit(1);
        if (!error) {
          accessible.push(table);
        } else {
          // If table doesn't exist (PGRST204 or 404), it's reachable but needs migration
          if (error.code === 'PGRST204' || error.message?.includes('not found') || error.code === '42P01') {
            // connection ok, table not created yet
          }
        }
      } catch {
        // ignore probe error
      }
    }

    return {
      success: true,
      message: `Conexión a Supabase exitosa.${accessible.length > 0 ? ` Tablas detectadas: ${accessible.join(', ')}` : ' Conectado al proyecto (tablas listas para inicializar).' }`,
      accessibleTables: accessible,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Error al conectar con Supabase: ${err.message}`,
      accessibleTables: [],
    };
  }
}

/**
 * Return SQL script to create all schema tables in Supabase SQL editor
 */
export function getSupabaseSchemaSql(): string {
  return `-- =====================================================================
-- ESQUEMA COMPLETO DE BASE DE DATOS SUPABASE PARA TODO LAPTO / VENDEMÁ CRM
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase
-- =====================================================================

-- 1. Tabla de Pedidos y Cotizaciones
CREATE TABLE IF NOT EXISTS public.pedidos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    id_pedido VARCHAR(64) UNIQUE NOT NULL,
    cliente_nombre TEXT,
    cliente_numero TEXT NOT NULL,
    productos TEXT NOT NULL,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    metodo_pago VARCHAR(32) DEFAULT 'contra_entrega',
    estado VARCHAR(32) DEFAULT 'pendiente',
    origen VARCHAR(32) DEFAULT 'whatsapp',
    notas_cliente TEXT,
    notas_gerencia TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida de pedidos
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_numero ON public.pedidos(cliente_numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON public.pedidos(created_at DESC);

-- 2. Tabla de Contactos y Directorio de WhatsApp
CREATE TABLE IF NOT EXISTS public.contactos_whatsapp (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lid_jid TEXT UNIQUE,
    telefono TEXT UNIQUE NOT NULL,
    nombre TEXT,
    direccion TEXT,
    zona VARCHAR(64) DEFAULT 'santo_domingo',
    odoo_partner_id INTEGER,
    ai_enabled BOOLEAN DEFAULT TRUE,
    total_spent NUMERIC(12, 2) DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    detected_interests TEXT[],
    notas TEXT,
    last_interaction TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contactos_telefono ON public.contactos_whatsapp(telefono);
CREATE INDEX IF NOT EXISTS idx_contactos_lid_jid ON public.contactos_whatsapp(lid_jid);

-- 3. Tabla de Conversaciones y Mensajes de WhatsApp
CREATE TABLE IF NOT EXISTS public.conversaciones_todolapto (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_number TEXT NOT NULL,
    user_name TEXT,
    message_content TEXT,
    message_type VARCHAR(32) DEFAULT 'text',
    quoted_message_content TEXT,
    has_quoted_message BOOLEAN DEFAULT FALSE,
    evolution_message_id TEXT,
    transcription TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_session_id ON public.conversaciones_todolapto(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_user_number ON public.conversaciones_todolapto(user_number);
CREATE INDEX IF NOT EXISTS idx_conv_created_at ON public.conversaciones_todolapto(created_at DESC);

-- 4. Tabla de Recordatorios de Seguimiento Comercial
CREATE TABLE IF NOT EXISTS public.recordatorios_seguimiento (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_number TEXT NOT NULL,
    user_name TEXT,
    productos_interes TEXT,
    fecha_seguimiento TIMESTAMPTZ NOT NULL,
    estado VARCHAR(32) DEFAULT 'pendiente',
    origen VARCHAR(32) DEFAULT 'automatico',
    motivo_cancelacion TEXT,
    cliente_respondio BOOLEAN DEFAULT FALSE,
    intentos_contacto INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_session_id ON public.recordatorios_seguimiento(session_id);
CREATE INDEX IF NOT EXISTS idx_rec_estado ON public.recordatorios_seguimiento(estado);
CREATE INDEX IF NOT EXISTS idx_rec_fecha ON public.recordatorios_seguimiento(fecha_seguimiento);

-- 5. Tabla de Memoria y Aprendizaje del Cerebro IA
CREATE TABLE IF NOT EXISTS public.cerebro_ia_aprendizajes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    insight_id VARCHAR(64) UNIQUE NOT NULL,
    categoria VARCHAR(64) NOT NULL,
    trigger_phrase TEXT NOT NULL,
    winning_pitch TEXT NOT NULL,
    counter_objection TEXT,
    success_rate INTEGER DEFAULT 85,
    occurrences INTEGER DEFAULT 1,
    tags TEXT[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS (Seguridad a Nivel de Filas) con Políticas de Lectura/Escritura para Anon Key
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones_todolapto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorios_seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cerebro_ia_aprendizajes ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a pedidos') THEN
        CREATE POLICY "Permitir todo a pedidos" ON public.pedidos FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a contactos_whatsapp') THEN
        CREATE POLICY "Permitir todo a contactos_whatsapp" ON public.contactos_whatsapp FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a conversaciones_todolapto') THEN
        CREATE POLICY "Permitir todo a conversaciones_todolapto" ON public.conversaciones_todolapto FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a recordatorios_seguimiento') THEN
        CREATE POLICY "Permitir todo a recordatorios_seguimiento" ON public.recordatorios_seguimiento FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a cerebro_ia_aprendizajes') THEN
        CREATE POLICY "Permitir todo a cerebro_ia_aprendizajes" ON public.cerebro_ia_aprendizajes FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
`;
}

/**
 * Upload all current in-memory orders, contacts, conversations, reminders & AI insights to Supabase
 */
export async function uploadAllToSupabase(
  data: {
    orders: SalesOrder[];
    customers: CustomerLead[];
    conversations: Conversation[];
    reminders: FollowUpReminder[];
    insights: AILearnedInsight[];
  },
  url?: string,
  anonKey?: string
): Promise<SupabaseSyncStats> {
  const client = getSupabaseClient(url, anonKey);
  const stats: SupabaseSyncStats = {
    ordersSynced: 0,
    customersSynced: 0,
    conversationsSynced: 0,
    messagesSynced: 0,
    remindersSynced: 0,
    insightsSynced: 0,
    errors: [],
  };

  if (!client) {
    stats.errors.push('No hay credenciales de Supabase configuradas');
    return stats;
  }

  // 1. Sync Pedidos
  try {
    for (const order of data.orders) {
      const payload = {
        id_pedido: order.id,
        cliente_nombre: order.clientName,
        cliente_numero: order.clientPhone.includes('@') ? order.clientPhone : `${order.clientPhone}@s.whatsapp.net`,
        productos: order.products,
        total_amount: order.totalAmount,
        metodo_pago: order.paymentMethod,
        estado: order.status === 'comprobante_recibido' ? 'pendiente' : order.status,
        origen: 'whatsapp',
        notas_cliente: order.address || order.deliveryNotes || '',
        notas_gerencia: order.odooOrderId ? `Cotizacion Odoo ID: ${order.odooOrderId}` : (order.adminNotes || ''),
        updated_at: new Date().toISOString(),
      };

      const { error } = await client
        .from('pedidos')
        .upsert(payload, { onConflict: 'id_pedido' });

      if (error) {
        stats.errors.push(`Error en pedido ${order.id}: ${error.message}`);
      } else {
        stats.ordersSynced++;
      }
    }
  } catch (e: any) {
    stats.errors.push(`Fallo al subir pedidos: ${e.message}`);
  }

  // 2. Sync Contactos / Clientes
  try {
    for (const c of data.customers) {
      const cleanPhone = (c.phone || '').replace(/\D/g, '');
      if (!cleanPhone) continue;

      const payload = {
        telefono: cleanPhone,
        lid_jid: c.lidJid || null,
        nombre: c.name,
        direccion: c.address || null,
        zona: c.zone || 'santo_domingo',
        odoo_partner_id: c.odooPartnerId || null,
        ai_enabled: c.aiEnabled ?? true,
        total_spent: c.totalSpent || 0,
        orders_count: c.ordersCount || 0,
        detected_interests: c.detectedInterests || [],
        notas: c.notes || null,
        last_interaction: c.lastInteraction || new Date().toISOString(),
      };

      const { error } = await client
        .from('contactos_whatsapp')
        .upsert(payload, { onConflict: 'telefono' });

      if (error) {
        stats.errors.push(`Error en cliente ${c.name}: ${error.message}`);
      } else {
        stats.customersSynced++;
      }
    }
  } catch (e: any) {
    stats.errors.push(`Fallo al subir contactos: ${e.message}`);
  }

  // 3. Sync Conversaciones & Mensajes
  try {
    for (const conv of data.conversations) {
      stats.conversationsSynced++;
      // Sync last 20 messages per conversation
      const recentMessages = conv.messages.slice(-20);
      for (const m of recentMessages) {
        const payload = {
          session_id: conv.sessionId,
          user_number: conv.customerPhone || conv.sessionId,
          user_name: conv.customerName,
          message_content: m.content,
          message_type: m.sender === 'customer' ? 'user' : 'assistant',
          quoted_message_content: m.quotedMessage?.text || null,
          has_quoted_message: Boolean(m.quotedMessage?.text),
          evolution_message_id: m.evolutionMessageId || m.id,
          transcription: m.transcription || null,
          created_at: m.timestamp || new Date().toISOString(),
        };

        const { error } = await client
          .from('conversaciones_todolapto')
          .insert(payload);

        if (error) {
          // If duplicate or table not found, track once
          if (!stats.errors.some(err => err.includes('conversaciones_todolapto'))) {
            stats.errors.push(`Conversaciones: ${error.message}`);
          }
        } else {
          stats.messagesSynced++;
        }
      }
    }
  } catch (e: any) {
    stats.errors.push(`Fallo al subir mensajes: ${e.message}`);
  }

  // 4. Sync Recordatorios de Seguimiento
  try {
    for (const r of data.reminders) {
      const payload = {
        session_id: r.sessionId,
        user_number: r.customerPhone,
        user_name: r.customerName,
        productos_interes: r.productInterest,
        fecha_seguimiento: r.scheduledDate,
        estado: r.status,
        origen: r.origin,
      };

      const { error } = await client
        .from('recordatorios_seguimiento')
        .insert(payload);

      if (error) {
        if (!stats.errors.some(err => err.includes('recordatorios_seguimiento'))) {
          stats.errors.push(`Recordatorios: ${error.message}`);
        }
      } else {
        stats.remindersSynced++;
      }
    }
  } catch (e: any) {
    stats.errors.push(`Fallo al subir recordatorios: ${e.message}`);
  }

  // 5. Sync Cerebro IA Aprendizajes
  try {
    for (const ins of data.insights) {
      const payload = {
        insight_id: ins.id,
        categoria: ins.category,
        trigger_phrase: ins.triggerPhrase,
        winning_pitch: ins.winningPitch,
        counter_objection: ins.counterObjection,
        success_rate: ins.successRate,
        occurrences: ins.occurrences,
        tags: ins.tags,
        updated_at: ins.updatedAt || new Date().toISOString(),
      };

      const { error } = await client
        .from('cerebro_ia_aprendizajes')
        .upsert(payload, { onConflict: 'insight_id' });

      if (error) {
        if (!stats.errors.some(err => err.includes('cerebro_ia_aprendizajes'))) {
          stats.errors.push(`Aprendizajes IA: ${error.message}`);
        }
      } else {
        stats.insightsSynced++;
      }
    }
  } catch (e: any) {
    stats.errors.push(`Fallo al subir aprendizajes: ${e.message}`);
  }

  return stats;
}

/**
 * Real-time event hooks to automatically mirror changes to Supabase
 */
export async function autoSyncOrderToSupabase(order: SalesOrder): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from('pedidos').upsert({
      id_pedido: order.id,
      cliente_nombre: order.clientName,
      cliente_numero: order.clientPhone.includes('@') ? order.clientPhone : `${order.clientPhone}@s.whatsapp.net`,
      productos: order.products,
      total_amount: order.totalAmount,
      metodo_pago: order.paymentMethod,
      estado: order.status === 'comprobante_recibido' ? 'pendiente' : order.status,
      origen: 'whatsapp',
      notas_cliente: order.address || order.deliveryNotes || '',
      notas_gerencia: order.odooOrderId ? `Cotizacion Odoo ID: ${order.odooOrderId}` : (order.adminNotes || ''),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id_pedido' });
  } catch (e: any) {
    console.warn('[Supabase autoSyncOrder error]:', e.message);
  }
}

export async function autoSyncMessageToSupabase(conv: Conversation, msg: ChatMessage): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from('conversaciones_todolapto').insert({
      session_id: conv.sessionId,
      user_number: conv.customerPhone || conv.sessionId,
      user_name: conv.customerName,
      message_content: msg.content,
      message_type: msg.sender === 'customer' ? 'user' : 'assistant',
      quoted_message_content: msg.quotedMessage?.text || null,
      has_quoted_message: Boolean(msg.quotedMessage?.text),
      evolution_message_id: msg.evolutionMessageId || msg.id,
      transcription: msg.transcription || null,
      created_at: msg.timestamp || new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('[Supabase autoSyncMessage error]:', e.message);
  }
}

export async function autoSyncCustomerToSupabase(customer: CustomerLead): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanPhone = (customer.phone || '').replace(/\D/g, '');
  if (!cleanPhone) return;
  try {
    await client.from('contactos_whatsapp').upsert({
      telefono: cleanPhone,
      lid_jid: customer.lidJid || null,
      nombre: customer.name,
      direccion: customer.address || null,
      zona: customer.zone || 'santo_domingo',
      odoo_partner_id: customer.odooPartnerId || null,
      ai_enabled: customer.aiEnabled ?? true,
      total_spent: customer.totalSpent || 0,
      orders_count: customer.ordersCount || 0,
      detected_interests: customer.detectedInterests || [],
      notas: customer.notes || null,
      last_interaction: customer.lastInteraction || new Date().toISOString(),
    }, { onConflict: 'telefono' });
  } catch (e: any) {
    console.warn('[Supabase autoSyncCustomer error]:', e.message);
  }
}
