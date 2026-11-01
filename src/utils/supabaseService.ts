import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { 
  Conversation, 
  CustomerLead, 
  SalesOrder, 
  FollowUpReminder, 
  AILearnedInsight,
  ChatMessage,
  UserAccount,
  UserRole,
  AppConfig,
  ProductItem,
  HolidayOverride,
  HolidayOverrideStatus
} from '../types.js';
import {
  getDominicanTimeContext,
  getAvailableHolidayYears,
  getHolidaysWithOverridesForYear,
  formatHumanDateShortRD
} from './businessSchedule.js';

export const DEFAULT_SUPABASE_URL = 'https://idpsjmyjhkabuenqdpyf.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkcHNqbXlqaGthYnVlbnFkcHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MzE3NDEsImV4cCI6MjEwOTEwNzc0MX0.rH7p8Ipg2pLn0T4-ZN0Onk3oAKtRrVIoqQ6ukKeJTnA';

export const INTERNAL_USERS_BACKUP_ID = '__sys_users_registry__';
export const INTERNAL_HOLIDAYS_BACKUP_ID = '__sys_holidays_calendar_rd__';

export interface SupabaseSyncStats {
  usersSynced: number;
  holidaysSynced: number;
  ordersSynced: number;
  customersSynced: number;
  conversationsSynced: number;
  messagesSynced: number;
  remindersSynced: number;
  insightsSynced: number;
  productsSynced: number;
  configSynced: boolean;
  errors: string[];
}

let supabaseClient: SupabaseClient | null = null;
let currentUrl = '';
let currentKey = '';

export function getSupabaseClient(url?: string, anonKey?: string): SupabaseClient | null {
  const envUrl = typeof process !== 'undefined' && process.env ? process.env.SUPABASE_URL : '';
  const envKey = typeof process !== 'undefined' && process.env ? process.env.SUPABASE_ANON_KEY : '';

  const targetUrl = (url || currentUrl || envUrl || DEFAULT_SUPABASE_URL).trim();
  const targetKey = (anonKey || currentKey || envKey || DEFAULT_SUPABASE_ANON_KEY).trim();

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
 * Test connectivity with Supabase by checking table access across all 9 CRM tables
 */
export async function testSupabaseConnection(
  url: string,
  anonKey: string
): Promise<{
  success: boolean;
  message: string;
  accessibleTables: string[];
  missingTables: string[];
}> {
  try {
    const cleanUrl = (url || DEFAULT_SUPABASE_URL).trim();
    const cleanKey = (anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();

    if (!cleanUrl || !cleanUrl.startsWith('http')) {
      return {
        success: false,
        message: 'La URL de Supabase debe ser válida (https://*.supabase.co)',
        accessibleTables: [],
        missingTables: [],
      };
    }
    if (!cleanKey || cleanKey.length < 20) {
      return {
        success: false,
        message: 'La Anon Key de Supabase proporcionada parece inválida o está incompleta.',
        accessibleTables: [],
        missingTables: [],
      };
    }

    const testClient = createClient(cleanUrl, cleanKey, {
      auth: { persistSession: false },
    });

    const tablesToProbe = [
      'usuarios',
      'calendario_feriados',
      'configuracion_sistema',
      'catalogo_productos',
      'pedidos',
      'contactos_whatsapp',
      'conversaciones_todolapto',
      'recordatorios_seguimiento',
      'cerebro_ia_aprendizajes',
    ];
    const accessible: string[] = [];
    const missing: string[] = [];

    for (const table of tablesToProbe) {
      try {
        const { error } = await testClient.from(table).select('*').limit(1);
        if (!error) {
          accessible.push(table);
        } else {
          missing.push(table);
        }
      } catch {
        missing.push(table);
      }
    }

    const missingNotice =
      missing.length > 0
        ? ` | Tablas pendientes por crear con el Script SQL: ${missing.join(', ')}`
        : ' | ¡Todas las 9 tablas del sistema (incluyendo calendario_feriados) están creadas y activas!';

    return {
      success: true,
      message: `Conexión a Supabase exitosa (${accessible.length}/9 tablas detectadas: ${accessible.join(', ') || 'ninguna aún'})${missingNotice}`,
      accessibleTables: accessible,
      missingTables: missing,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Error al conectar con Supabase: ${err.message}`,
      accessibleTables: [],
      missingTables: [],
    };
  }
}

/**
 * Generates the SQL snippet specifically for the `public.calendario_feriados` table + pre-populated RD holidays
 */
export function getHolidaysTableSql(): string {
  const rdNow = getDominicanTimeContext(new Date(), []);
  const years = getAvailableHolidayYears(rdNow.year, rdNow.month, []);
  const valueRows: string[] = [];

  for (const yr of years) {
    const items = getHolidaysWithOverridesForYear(yr, []);
    for (const it of items) {
      const safeName = it.name.replace(/'/g, "''");
      const safeDay = it.originalDayName.replace(/'/g, "''");
      const safeNote = `Se celebra en su fecha original (${it.originalHumanDate})`.replace(/'/g, "''");
      valueRows.push(
        `    ('${it.id}', ${yr}, '${safeName}', '${it.originalDate}', '${safeDay}', 'normal', '${it.originalDate}', NULL, FALSE, '${safeNote}')`
      );
    }
  }

  return `-- =====================================================================
-- TABLA DEDICADA: CALENDARIO OFICIAL DE FERIADOS DE REPÚBLICA DOMINICANA
-- Ejecuta este bloque en Supabase -> SQL Editor -> Run
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.calendario_feriados (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    feriado_id VARCHAR(64) UNIQUE NOT NULL,
    anio INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    fecha_original VARCHAR(16) NOT NULL,
    dia_original VARCHAR(32),
    estado VARCHAR(32) DEFAULT 'normal' NOT NULL,
    fecha_efectiva VARCHAR(16),
    movido_a_fecha VARCHAR(16),
    es_personalizado BOOLEAN DEFAULT FALSE,
    nota TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feriados_anio ON public.calendario_feriados(anio);
CREATE INDEX IF NOT EXISTS idx_feriados_fecha_orig ON public.calendario_feriados(fecha_original);
CREATE INDEX IF NOT EXISTS idx_feriados_fecha_efec ON public.calendario_feriados(fecha_efectiva);

ALTER TABLE public.calendario_feriados ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a calendario_feriados') THEN
        CREATE POLICY "Permitir todo a calendario_feriados" ON public.calendario_feriados FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Insertar feriados oficiales de República Dominicana (${years.join(', ')}) sin sobrescribir cambios existentes
INSERT INTO public.calendario_feriados (feriado_id, anio, nombre, fecha_original, dia_original, estado, fecha_efectiva, movido_a_fecha, es_personalizado, nota)
VALUES
${valueRows.join(',\n')}
ON CONFLICT (feriado_id) DO NOTHING;`;
}

/**
 * Return SQL script to create all 9 schema tables in Supabase SQL editor (including usuarios, calendario_feriados, configuracion_sistema & catalogo_productos)
 */
export function getSupabaseSchemaSql(): string {
  const holidaysSql = getHolidaysTableSql();
  return `-- =====================================================================
-- ESQUEMA COMPLETO DE BASE DE DATOS SUPABASE PARA TODO LAPTO / VENDEMÁ CRM
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase (Run)
-- Es 100% seguro: usa IF NOT EXISTS para no borrar datos existentes.
-- =====================================================================

-- 1. Tabla de Usuarios y Jerarquía de Accesos (RBAC: Super Admin, Dueño, Empleado)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    username VARCHAR(64) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    whatsapp VARCHAR(32) NOT NULL,
    role VARCHAR(32) DEFAULT 'empleado' NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON public.usuarios(username);
CREATE INDEX IF NOT EXISTS idx_usuarios_role ON public.usuarios(role);

-- Insertar usuarios iniciales por defecto (sin sobrescribir si ya existen)
INSERT INTO public.usuarios (user_id, nombre, username, password, whatsapp, role, activo)
VALUES
    ('usr_super_nelson', 'Nelson', 'nelson', 'elmejor19', '18496260800', 'super_admin', TRUE),
    ('usr_dueno_negocio', 'Dueño Todo Lapto', 'dueno', 'dueno123', '18094228738', 'dueno', TRUE),
    ('usr_empleado_ventas', 'Asesor de Ventas', 'empleado', 'empleado123', '18492588738', 'empleado', TRUE)
ON CONFLICT (username) DO NOTHING;

-- 2. Tabla de Configuración Global del Sistema y Credenciales
CREATE TABLE IF NOT EXISTS public.configuracion_sistema (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    config_key VARCHAR(64) UNIQUE NOT NULL DEFAULT 'main',
    global_ai_active BOOLEAN DEFAULT TRUE,
    ai_provider JSONB DEFAULT '{}'::jsonb,
    odoo_config JSONB DEFAULT '{}'::jsonb,
    evolution_config JSONB DEFAULT '{}'::jsonb,
    supabase_config JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Catálogo de Productos e Inventario (Respaldo Odoo ERP)
CREATE TABLE IF NOT EXISTS public.catalogo_productos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id INTEGER UNIQUE NOT NULL,
    variant_id INTEGER,
    nombre TEXT NOT NULL,
    marca VARCHAR(64),
    categoria VARCHAR(64),
    condicion VARCHAR(64),
    condicion_detalle TEXT,
    precio NUMERIC(12, 2) DEFAULT 0,
    stock_total INTEGER DEFAULT 0,
    stock_vitrina INTEGER DEFAULT 0,
    stock_almacen INTEGER DEFAULT 0,
    website_url TEXT,
    image_url TEXT,
    specs_summary TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_categoria ON public.catalogo_productos(categoria);
CREATE INDEX IF NOT EXISTS idx_catalogo_stock ON public.catalogo_productos(stock_total DESC);

-- 4. Tabla de Pedidos y Cotizaciones
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

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_numero ON public.pedidos(cliente_numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON public.pedidos(created_at DESC);

-- 5. Tabla de Contactos y Directorio de WhatsApp
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

-- 6. Tabla de Conversaciones y Mensajes de WhatsApp
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

-- 7. Tabla de Recordatorios de Seguimiento Comercial
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

-- 8. Tabla de Memoria y Aprendizaje del Cerebro IA
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

-- 9. Tabla del Calendario Oficial de Feriados de República Dominicana (Ley 139-97)
${holidaysSql}

-- Habilitar RLS (Seguridad a Nivel de Filas) con Políticas de Lectura/Escritura para Anon Key
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones_todolapto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorios_seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cerebro_ia_aprendizajes ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a usuarios') THEN
        CREATE POLICY "Permitir todo a usuarios" ON public.usuarios FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a configuracion_sistema') THEN
        CREATE POLICY "Permitir todo a configuracion_sistema" ON public.configuracion_sistema FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a catalogo_productos') THEN
        CREATE POLICY "Permitir todo a catalogo_productos" ON public.catalogo_productos FOR ALL USING (true) WITH CHECK (true);
    END IF;
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
 * Load users from Supabase `public.usuarios` table (or fallback cloud registry in `cerebro_ia_aprendizajes` if `usuarios` table is not created yet)
 */
export async function loadUsersFromSupabase(url?: string, anonKey?: string): Promise<UserAccount[]> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return [];

  // 1. Try primary `public.usuarios` table
  try {
    const { data, error } = await client
      .from('usuarios')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row: any) => ({
        id: row.user_id || row.id || `usr_${row.username}`,
        nombre: row.nombre || row.username,
        username: String(row.username || '').toLowerCase().trim(),
        password: row.password || '',
        whatsapp: row.whatsapp || '',
        role: (['super_admin', 'dueno', 'empleado'].includes(row.role) ? row.role : 'empleado') as UserRole,
        activo: row.activo !== undefined ? Boolean(row.activo) : true,
        createdAt: row.created_at || new Date().toISOString(),
        lastLogin: row.last_login || undefined,
      }));
    }
  } catch {
    // Table might not be created yet
  }

  // 2. Fallback: Check cloud registry inside `cerebro_ia_aprendizajes` (works even before `public.usuarios` is created)
  try {
    const { data, error } = await client
      .from('cerebro_ia_aprendizajes')
      .select('winning_pitch')
      .eq('insight_id', INTERNAL_USERS_BACKUP_ID)
      .maybeSingle();

    if (!error && data?.winning_pitch) {
      const parsed = JSON.parse(data.winning_pitch);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore fallback error
  }

  return [];
}

/**
 * Sync all users to `public.usuarios` AND keep a backup snapshot in `cerebro_ia_aprendizajes`
 */
export async function syncAllUsersToSupabase(
  users: UserAccount[],
  url?: string,
  anonKey?: string
): Promise<{ synced: number; usedFallback: boolean; error?: string }> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { synced: 0, usedFallback: false, error: 'Sin cliente de Supabase' };
  }

  let synced = 0;
  let tableError: string | undefined;

  for (const u of users) {
    try {
      const payload = {
        user_id: u.id,
        nombre: u.nombre,
        username: u.username.toLowerCase().trim(),
        password: u.password || '',
        whatsapp: u.whatsapp || '',
        role: u.role,
        activo: u.activo ?? true,
        last_login: u.lastLogin || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await client
        .from('usuarios')
        .upsert(payload, { onConflict: 'username' });

      if (error) {
        tableError = error.message;
      } else {
        synced++;
      }
    } catch (e: any) {
      tableError = e.message;
    }
  }

  // Always maintain cloud backup in `cerebro_ia_aprendizajes` so users persist in Supabase even before `public.usuarios` SQL is run
  let usedFallback = false;
  try {
    const { error: backupErr } = await client
      .from('cerebro_ia_aprendizajes')
      .upsert(
        {
          insight_id: INTERNAL_USERS_BACKUP_ID,
          categoria: '__system_internal__',
          trigger_phrase: 'Registro encriptado de usuarios del sistema Vendemá CRM',
          winning_pitch: JSON.stringify(users),
          counter_objection: 'Respaldo automático de usuarios en Supabase',
          success_rate: 100,
          occurrences: users.length,
          tags: ['system', 'users_backup'],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'insight_id' }
      );
    if (!backupErr && synced === 0) {
      usedFallback = true;
      synced = users.length;
    }
  } catch {
    // Ignore backup error
  }

  return { synced, usedFallback, error: tableError };
}

export async function autoSyncUserToSupabase(user: UserAccount, allUsers?: UserAccount[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client.from('usuarios').upsert(
      {
        user_id: user.id,
        nombre: user.nombre,
        username: user.username.toLowerCase().trim(),
        password: user.password || '',
        whatsapp: user.whatsapp || '',
        role: user.role,
        activo: user.activo ?? true,
        last_login: user.lastLogin || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'username' }
    );
  } catch (e: any) {
    console.warn('[Supabase autoSyncUser warning]:', e.message);
  }

  if (allUsers && allUsers.length > 0) {
    try {
      await client.from('cerebro_ia_aprendizajes').upsert(
        {
          insight_id: INTERNAL_USERS_BACKUP_ID,
          categoria: '__system_internal__',
          trigger_phrase: 'Registro encriptado de usuarios del sistema Vendemá CRM',
          winning_pitch: JSON.stringify(allUsers),
          counter_objection: 'Respaldo automático de usuarios en Supabase',
          success_rate: 100,
          occurrences: allUsers.length,
          tags: ['system', 'users_backup'],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'insight_id' }
      );
    } catch {}
  }
}

export async function deleteUserFromSupabase(user: UserAccount, remainingUsers?: UserAccount[]): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    await client.from('usuarios').delete().eq('username', user.username.toLowerCase().trim());
  } catch {}

  if (remainingUsers) {
    try {
      await client.from('cerebro_ia_aprendizajes').upsert(
        {
          insight_id: INTERNAL_USERS_BACKUP_ID,
          categoria: '__system_internal__',
          trigger_phrase: 'Registro encriptado de usuarios del sistema Vendemá CRM',
          winning_pitch: JSON.stringify(remainingUsers),
          counter_objection: 'Respaldo automático de usuarios en Supabase',
          success_rate: 100,
          occurrences: remainingUsers.length,
          tags: ['system', 'users_backup'],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'insight_id' }
      );
    } catch {}
  }
}

export async function loadHolidaysFromSupabase(
  url?: string,
  anonKey?: string
): Promise<HolidayOverride[] | null> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return null;

  const mergedByKey = new Map<string, HolidayOverride>();
  let foundAnySource = false;

  // 1. Check dedicated table `public.calendario_feriados` first
  try {
    const { data, error } = await client
      .from('calendario_feriados')
      .select('*')
      .order('fecha_original', { ascending: true });

    if (!error && Array.isArray(data)) {
      foundAnySource = true;
      for (const row of data) {
        const estado = (row.estado || 'normal') as HolidayOverrideStatus;
        const isCustom = Boolean(row.es_personalizado) || estado === 'custom_holiday';
        if (estado !== 'normal' || isCustom) {
          const item: HolidayOverride = {
            id: row.feriado_id || row.fecha_original,
            name: row.nombre || 'Día Feriado',
            originalDate: row.fecha_original,
            status: isCustom ? 'custom_holiday' : estado,
            movedToDate: row.movido_a_fecha || undefined,
            note: row.nota || undefined,
            isCustom,
            updatedAt: row.updated_at || new Date().toISOString(),
          };
          mergedByKey.set(item.id, item);
        }
      }
    }
  } catch {
    // Table might not exist yet
  }

  // 2. Also check `configuracion_sistema`
  try {
    const { data, error } = await client
      .from('configuracion_sistema')
      .select('supabase_config')
      .eq('config_key', 'main')
      .maybeSingle();

    if (!error && data?.supabase_config && Array.isArray(data.supabase_config.holidayOverrides)) {
      foundAnySource = true;
      for (const o of data.supabase_config.holidayOverrides as HolidayOverride[]) {
        const key = o.id || o.originalDate;
        if (key && !mergedByKey.has(key)) {
          mergedByKey.set(key, o);
        }
      }
    }
  } catch {
    // Table might not exist yet
  }

  // 3. Fallback: Check cloud registry inside `cerebro_ia_aprendizajes`
  try {
    const { data, error } = await client
      .from('cerebro_ia_aprendizajes')
      .select('winning_pitch')
      .eq('insight_id', INTERNAL_HOLIDAYS_BACKUP_ID)
      .maybeSingle();

    if (!error && data?.winning_pitch) {
      const parsed = JSON.parse(data.winning_pitch);
      if (Array.isArray(parsed)) {
        foundAnySource = true;
        for (const o of parsed as HolidayOverride[]) {
          const key = o.id || o.originalDate;
          if (key && !mergedByKey.has(key)) {
            mergedByKey.set(key, o);
          }
        }
      }
    }
  } catch {
    // Ignore fallback error
  }

  return foundAnySource ? Array.from(mergedByKey.values()) : null;
}

export async function syncHolidaysToSupabase(
  holidayOverrides: HolidayOverride[],
  url?: string,
  anonKey?: string
): Promise<{ synced: boolean; count: number; tableRowsSynced: number; tableExists: boolean; storage: string; error?: string }> {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { synced: false, count: 0, tableRowsSynced: 0, tableExists: false, storage: 'local_only' };
  }

  const safeList = Array.isArray(holidayOverrides) ? holidayOverrides : [];
  let syncedToDedicatedTable = false;
  let tableRowsSynced = 0;
  let tableError: string | undefined;
  let syncedToMain = false;
  let syncedToCloudBackup = false;

  // 0. Sync all full holiday calendar rows (2025..2028+ and custom overrides) into dedicated table `public.calendario_feriados`
  try {
    const rdNow = getDominicanTimeContext(new Date(), safeList);
    const years = getAvailableHolidayYears(rdNow.year, rdNow.month, safeList);
    const allRows: any[] = [];

    for (const yr of years) {
      const enriched = getHolidaysWithOverridesForYear(yr, safeList);
      for (const item of enriched) {
        let notaTexto = item.note || '';
        if (!notaTexto) {
          if (item.status === 'moved' && item.movedToDate) {
            notaTexto = `Feriado movido al ${formatHumanDateShortRD(item.movedToDate, true)} (El ${item.originalHumanDate} es día laborable normal)`;
          } else if (item.status === 'workday') {
            notaTexto = `Habilitado como día laborable normal (Tienda abierta de 8:30 AM a 6:00 PM)`;
          } else if (item.status === 'custom_holiday' || item.isCustom) {
            notaTexto = 'Feriado / Cierre especial configurado';
          } else {
            notaTexto = `Se celebra en su fecha original (${item.originalHumanDate})`;
          }
        }

        allRows.push({
          feriado_id: item.id,
          anio: yr,
          nombre: item.name,
          fecha_original: item.originalDate,
          dia_original: item.originalDayName,
          estado: item.status,
          fecha_efectiva: item.effectiveDate,
          movido_a_fecha: item.movedToDate || null,
          es_personalizado: Boolean(item.isCustom),
          nota: notaTexto,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (allRows.length > 0) {
      const { error } = await client
        .from('calendario_feriados')
        .upsert(allRows, { onConflict: 'feriado_id' });

      if (!error) {
        syncedToDedicatedTable = true;
        tableRowsSynced = allRows.length;

        // Also clean up any deleted custom holidays in `calendario_feriados`
        const activeCustomIds = safeList
          .filter(o => o.isCustom || o.status === 'custom_holiday')
          .map(o => o.id);
        const { data: existingCustom } = await client
          .from('calendario_feriados')
          .select('feriado_id')
          .eq('es_personalizado', true);

        if (Array.isArray(existingCustom)) {
          for (const row of existingCustom) {
            if (row.feriado_id && !activeCustomIds.includes(row.feriado_id)) {
              await client.from('calendario_feriados').delete().eq('feriado_id', row.feriado_id);
            }
          }
        }
      } else {
        tableError = error.message;
      }
    }
  } catch (e: any) {
    tableError = e.message;
  }

  // 1. Save in `cerebro_ia_aprendizajes` cloud registry (guaranteed to exist in Supabase)
  try {
    const { error } = await client
      .from('cerebro_ia_aprendizajes')
      .upsert(
        {
          insight_id: INTERNAL_HOLIDAYS_BACKUP_ID,
          categoria: '__system_internal__',
          trigger_phrase: 'Calendario Oficial de Feriados de República Dominicana (Ley 139-97)',
          winning_pitch: JSON.stringify(safeList),
          counter_objection: 'Respaldo en tiempo real de modificaciones de días feriados RD',
          success_rate: 100,
          occurrences: safeList.length,
          tags: ['system', 'holidays_rd_backup'],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'insight_id' }
      );
    if (!error) {
      syncedToCloudBackup = true;
    }
  } catch {}

  // 2. Also update `configuracion_sistema` if table exists
  try {
    const { data: existing } = await client
      .from('configuracion_sistema')
      .select('supabase_config')
      .eq('config_key', 'main')
      .maybeSingle();

    const prevSupaCfg = (existing?.supabase_config && typeof existing.supabase_config === 'object')
      ? existing.supabase_config
      : {};

    const { error } = await client
      .from('configuracion_sistema')
      .upsert(
        {
          config_key: 'main',
          supabase_config: {
            ...prevSupaCfg,
            holidayOverrides: safeList,
            lastHolidaysSync: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'config_key' }
      );
    if (!error) {
      syncedToMain = true;
    }
  } catch {}

  return {
    synced: syncedToDedicatedTable || syncedToMain || syncedToCloudBackup,
    count: safeList.length,
    tableRowsSynced,
    tableExists: syncedToDedicatedTable,
    storage: syncedToDedicatedTable
      ? 'calendario_feriados'
      : syncedToMain
      ? 'configuracion_sistema + cloud_backup'
      : syncedToCloudBackup
      ? 'cloud_backup'
      : 'local',
    error: tableError,
  };
}

export async function autoSyncConfigToSupabase(config: AppConfig): Promise<void> {
  const client = getSupabaseClient(config.supabase?.url, config.supabase?.anonKey);
  if (!client) return;

  try {
    await client.from('configuracion_sistema').upsert(
      {
        config_key: 'main',
        global_ai_active: config.globalAiActive,
        ai_provider: config.aiProvider || {},
        odoo_config: config.odoo || {},
        evolution_config: config.evolution || {},
        supabase_config: {
          url: config.supabase?.url || '',
          connected: config.supabase?.connected ?? true,
          autoSync: config.supabase?.autoSync ?? true,
          holidayOverrides: config.holidayOverrides || [],
          lastSync: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'config_key' }
    );
  } catch {
    // Table might not exist yet
  }

  if (Array.isArray(config.holidayOverrides)) {
    await syncHolidaysToSupabase(config.holidayOverrides, config.supabase?.url, config.supabase?.anonKey);
  }
}

/**
 * Upload all current in-memory users, config, holidays, products, orders, contacts, conversations, reminders & AI insights to Supabase
 */
export async function uploadAllToSupabase(
  data: {
    users?: UserAccount[];
    config?: AppConfig;
    products?: ProductItem[];
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
    usersSynced: 0,
    holidaysSynced: 0,
    ordersSynced: 0,
    customersSynced: 0,
    conversationsSynced: 0,
    messagesSynced: 0,
    remindersSynced: 0,
    insightsSynced: 0,
    productsSynced: 0,
    configSynced: false,
    errors: [],
  };

  if (!client) {
    stats.errors.push('No hay credenciales de Supabase configuradas');
    return stats;
  }

  // 0. Sync Usuarios (RBAC)
  if (data.users && data.users.length > 0) {
    const userRes = await syncAllUsersToSupabase(data.users, url, anonKey);
    stats.usersSynced = userRes.synced;
    if (userRes.error) {
      stats.errors.push(`Tabla usuarios: ${userRes.error} (respaldado en nube; ejecuta el Script SQL para crear la tabla 'usuarios' dedicada)`);
    }
  }

  // 0.5 Sync Configuración del Sistema y Tabla calendario_feriados
  if (data.config) {
    try {
      const { error } = await client.from('configuracion_sistema').upsert(
        {
          config_key: 'main',
          global_ai_active: data.config.globalAiActive,
          ai_provider: data.config.aiProvider || {},
          odoo_config: data.config.odoo || {},
          evolution_config: data.config.evolution || {},
          supabase_config: {
            url: data.config.supabase?.url || '',
            connected: true,
            autoSync: data.config.supabase?.autoSync ?? true,
            holidayOverrides: data.config.holidayOverrides || [],
            lastSync: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'config_key' }
      );
      if (!error) {
        stats.configSynced = true;
      }
    } catch {}

    const holRes = await syncHolidaysToSupabase(data.config.holidayOverrides || [], url, anonKey);
    stats.holidaysSynced = holRes.tableRowsSynced > 0 ? holRes.tableRowsSynced : holRes.count;
    if (holRes.synced) {
      stats.configSynced = true;
    }
    if (holRes.error) {
      stats.errors.push(`Tabla calendario_feriados: ${holRes.error} (ejecuta el Script SQL para crear la tabla 'calendario_feriados' en Supabase)`);
    }
  }

  // 0.8 Sync Catálogo de Productos (en stock)
  if (data.products && data.products.length > 0) {
    try {
      const inStockProducts = data.products.filter(p => p.virtual_available > 0).slice(0, 250);
      const rows = inStockProducts.map(p => ({
        product_id: p.id,
        variant_id: p.variantId || p.id,
        nombre: p.name,
        marca: p.brand || null,
        categoria: p.category,
        condicion: p.condition || 'Usado / Reacondicionado',
        condicion_detalle: p.conditionDetail || null,
        precio: p.list_price || 0,
        stock_total: p.virtual_available || 0,
        stock_vitrina: p.vitrinaStock || 0,
        stock_almacen: p.almacenStock || 0,
        website_url: p.website_url || null,
        image_url: p.image_url || null,
        specs_summary: p.specsSummary || p.description_sale || null,
        updated_at: new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error } = await client
          .from('catalogo_productos')
          .upsert(rows, { onConflict: 'product_id' });
        if (!error) {
          stats.productsSynced = rows.length;
        }
      }
    } catch {}
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
      if (ins.id === INTERNAL_USERS_BACKUP_ID || ins.id === INTERNAL_HOLIDAYS_BACKUP_ID) continue;
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
      has_quoted_message: Boolean(m_has_quote(msg)),
      evolution_message_id: msg.evolutionMessageId || msg.id,
      transcription: msg.transcription || null,
      created_at: msg.timestamp || new Date().toISOString(),
    });
  } catch (e: any) {
    console.warn('[Supabase autoSyncMessage error]:', e.message);
  }
}

function m_has_quote(msg: ChatMessage): boolean {
  return Boolean(msg.quotedMessage?.text);
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
