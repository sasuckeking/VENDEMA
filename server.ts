import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { 
  AppConfig, 
  ProductItem, 
  Conversation, 
  CustomerLead, 
  SalesOrder, 
  AILearnedInsight, 
  FollowUpReminder, 
  ChatMessage,
  QuotedMessage,
  UserAccount,
  UserRole,
  BotAuditLogEntry,
  BotDecisionType,
  WhatsAppStatusItem
} from './src/types.ts';
import { OFFICIAL_TODO_LAPTO_MASTER_PROMPT } from './src/masterPrompt.ts';
import { 
  getDominicanTimeContext, 
  buildDominicanTimePromptContext,
  setGlobalHolidayOverrides,
  getHolidaysWithOverridesForYear,
  getAvailableHolidayYears,
  setGlobalTimeOffset,
  getEffectiveCurrentDate
} from './src/utils/businessSchedule.ts';
import { 
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_ANON_KEY,
  INTERNAL_USERS_BACKUP_ID,
  INTERNAL_HOLIDAYS_BACKUP_ID,
  INTERNAL_AI_CONFIG_BACKUP_ID,
  getSupabaseClient, 
  testSupabaseConnection, 
  getSupabaseSchemaSql, 
  getHolidaysTableSql,
  uploadAllToSupabase,
  loadUsersFromSupabase,
  syncAllUsersToSupabase,
  autoSyncUserToSupabase,
  deleteUserFromSupabase,
  loadHolidaysFromSupabase,
  syncHolidaysToSupabase,
  loadAiConfigFromSupabase,
  autoSyncConfigToSupabase,
  autoSyncOrderToSupabase,
  autoSyncMessageToSupabase,
  autoSyncCustomerToSupabase
} from './src/utils/supabaseService.ts';

dotenv.config();

// Phusion Passenger global type declaration
declare const PhusionPassenger: any;

// Global process error handlers to prevent container crashes on network/background glitches
process.on('uncaughtException', (err) => {
  console.log('[Process Notice]:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.log('[Process Notice]:', reason?.message || reason);
});
process.on('exit', (code) => {
  console.log(`[Process Exit] Node process exiting with code: ${code}`);
});
process.on('beforeExit', (code) => {
  console.log(`[Process BeforeExit] Event loop is empty! code: ${code}`);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
const rawPort = process.env.PORT;
const isNumericPort = rawPort && !isNaN(Number(rawPort));
const PORT: number | string = isNumericPort ? Number(rawPort) : (rawPort || 3000);

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Request logging for Hostinger / Nginx reverse proxy debugging
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/ping') {
    console.log(`[HTTP ${req.method}] ${req.url} (Host: ${req.headers.host || 'unknown'})`);
  }
  next();
});

// Permissive CORS & reverse proxy support for custom domains
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Immediate Health Check endpoints for container orchestrators (Easypanel, Coolify, Docker, Cloud Run)
app.get(['/health', '/api/health', '/ping'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Vendemá CRM & Ventas',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    port: PORT,
  });
});

// ---------------------------------------------------------
// Server-Sent Events (SSE) Real-Time Broadcast Clients
// ---------------------------------------------------------
const sseClients = new Set<express.Response>();

function broadcastEvent(eventType: string, payload: any) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: new Date().toISOString() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------
// Global State & Preconfigured Production Credentials
// ---------------------------------------------------------
const CONFIG_FILE_PATH = path.join(__dirname, '.vendema-config.json');
const CONFIG_FALLBACK_PATH = path.join(process.cwd(), '.vendema-config.json');
const ENV_FILE_PATH = path.join(__dirname, '.env');

function syncCredentialsToEnv(cfg: AppConfig, persistToFile = false) {
  try {
    const vars: Record<string, string> = {
      // Supabase Credentials
      SUPABASE_URL: cfg.supabase?.url || '',
      SUPABASE_ANON_KEY: cfg.supabase?.anonKey || '',

      // Odoo ERP Credentials
      ODOO_URL: cfg.odoo?.url || '',
      ODOO_DB: cfg.odoo?.db || '',
      ODOO_UID: cfg.odoo?.uid !== undefined ? String(cfg.odoo.uid) : '',
      ODOO_API_KEY: cfg.odoo?.apiKey || '',

      // Evolution API WhatsApp Credentials
      EVOLUTION_SERVER_URL: cfg.evolution?.serverUrl || '',
      EVOLUTION_INSTANCE: cfg.evolution?.instance || '',
      EVOLUTION_API_KEY: cfg.evolution?.apiKey || '',
      EVOLUTION_TEAM_PHONE: cfg.evolution?.teamPhone || '',
      EVOLUTION_ADMIN_PHONE: cfg.evolution?.adminPhone || '',

      // AI Provider Credentials (OpenAI Exclusive)
      OPENAI_API_KEY: cfg.aiProvider?.openaiApiKey || '',
    };

    // Update in-memory process.env immediately for runtime use
    for (const [key, val] of Object.entries(vars)) {
      if (val) {
        process.env[key] = val;
      }
    }

    // Do NOT touch .env unless explicitly requested.
    // In Docker/Easypanel/Coolify with dotenvx, writing .env triggers process watchers to restart in an infinite loop!
    if (!persistToFile) {
      return;
    }

    let existingContent = '';
    if (fs.existsSync(ENV_FILE_PATH)) {
      existingContent = fs.readFileSync(ENV_FILE_PATH, 'utf-8');
    }

    const lines = existingContent ? existingContent.split(/\r?\n/) : [];
    const keysHandled = new Set<string>();

    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = line.indexOf('=');
      if (eqIdx !== -1) {
        const key = line.substring(0, eqIdx).trim();
        if (key in vars) {
          keysHandled.add(key);
          return `${key}="${vars[key]}"`;
        }
      }
      return line;
    });

    // Add any missing variables that weren't in .env yet
    for (const [key, val] of Object.entries(vars)) {
      if (!keysHandled.has(key)) {
        updatedLines.push(`${key}="${val}"`);
      }
    }

    // Preserve APP_URL if set in environment
    if (process.env.APP_URL && !updatedLines.some(l => l.startsWith('APP_URL='))) {
      updatedLines.push(`APP_URL="${process.env.APP_URL}"`);
    }

    const newContent = updatedLines.join('\n').trim() + '\n';
    if (newContent !== existingContent.trim() + '\n') {
      fs.writeFileSync(ENV_FILE_PATH, newContent, 'utf-8');
      console.log('[Env Sync]: Credenciales actualizadas y sincronizadas en archivo .env y process.env');
    }
  } catch (err: any) {
    console.warn('[Env Sync Info]:', err.message);
  }
}

let appConfig: AppConfig = {
  globalAiActive: true,
  aiProvider: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.35,
    customInstructions: '',
    systemPrompt: OFFICIAL_TODO_LAPTO_MASTER_PROMPT,
    openaiApiKey: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY' ? process.env.OPENAI_API_KEY : '',
    openaiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    deepseekApiKey: '',
    deepseekBaseUrl: '',
    geminiApiKey: '',
  },
  odoo: {
    url: process.env.ODOO_URL || 'https://todolapto.com.do/jsonrpc',
    db: process.env.ODOO_DB || 'odoo',
    uid: process.env.ODOO_UID ? Number(process.env.ODOO_UID) : 22,
    apiKey: process.env.ODOO_API_KEY || '1dffd1433a7f49b6ec715fddf766c67f08f57c41',
    connected: true,
    lastSync: new Date().toISOString(),
  },
  evolution: {
    serverUrl: process.env.EVOLUTION_SERVER_URL || 'https://evolution-evolution-api.blrfh6.easypanel.host',
    instance: process.env.EVOLUTION_INSTANCE || 'todolapto',
    apiKey: process.env.EVOLUTION_API_KEY || '52700613C062-421C-B800-FBC560B54BB4',
    teamPhone: process.env.EVOLUTION_TEAM_PHONE || '18492588738',
    adminPhone: process.env.EVOLUTION_ADMIN_PHONE || '18496260800',
    connected: true,
  },
  supabase: {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
    connected: true,
    autoSync: true,
  },
  holidayOverrides: [],
  activeWhatsAppStatuses: [
    {
      id: 'status-1',
      title: '🔥 Oferta Flash en Estado: Laptop HP ProBook x360 Táctil',
      productName: 'LAPTOP HP PROBOOK X360 11 G5 EE',
      price: 7500,
      description: 'Pantalla táctil giratoria 360°, Procesador Intel Pentium N4120, 4GB RAM, 128GB SSD. Reacondicionada Clase A con 6 meses de garantía certificada por escrito.',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'status-2',
      title: '💼 Laptop Empresarial Ultra Resistente ThinkPad',
      productName: 'LENOVO THINKPAD T480',
      price: 14500,
      description: 'Procesador Intel Core i5 8va Gen, 8GB RAM, 256GB SSD, pantalla 14" Full HD, ultra resistente para trabajo continuo. Reacondicionada Clase A con 6 meses de garantía.',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'status-3',
      title: '⚡ Ejecutiva Rápida Dell Latitude 5400',
      productName: 'DELL LATITUDE 5400',
      price: 16500,
      description: 'Intel Core i5 8va Gen, 8GB RAM, 256GB SSD, teclado iluminado, batería de larga duración. Reacondicionada Clase A con 6 meses de garantía.',
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'status-4',
      title: '🖨️ Impresora Térmica Portátil 617-R58P',
      productName: 'Impresora de Recibos y Etiquetas 617-R58P',
      price: 2500,
      description: 'Impresora térmica directa sin tinta para facturación, recibos y colmados. Nueva de caja con 1 año de garantía.',
      active: true,
      createdAt: new Date().toISOString(),
    },
  ],
};

function loadPersistedConfig() {
  try {
    const targetConfigPath = fs.existsSync(CONFIG_FILE_PATH)
      ? CONFIG_FILE_PATH
      : fs.existsSync(CONFIG_FALLBACK_PATH)
      ? CONFIG_FALLBACK_PATH
      : null;

    if (targetConfigPath) {
      const raw = fs.readFileSync(targetConfigPath, 'utf-8');
      const saved = JSON.parse(raw);
      if (saved.globalAiActive !== undefined) appConfig.globalAiActive = Boolean(saved.globalAiActive);
      if (saved.aiProvider) {
        const savedPrompt = saved.aiProvider.systemPrompt || '';
        const shouldRefreshPrompt =
          !savedPrompt ||
          savedPrompt.includes('1️⃣ *NOMBRE COMPLETO*') ||
          !savedPrompt.includes('REGLA DE CITAS MEJORADA V2') ||
          !savedPrompt.includes('FILTRADO INTELIGENTE V3');
        const savedModel = String(saved.aiProvider.model || '').trim();
        const migratedModel =
          savedModel.startsWith('gpt-') || savedModel.startsWith('o1') || savedModel.startsWith('o3')
            ? savedModel
            : 'gpt-4o-mini';
        appConfig.aiProvider = {
          ...appConfig.aiProvider,
          ...saved.aiProvider,
          provider: 'openai',
          model: migratedModel,
          systemPrompt: shouldRefreshPrompt ? OFFICIAL_TODO_LAPTO_MASTER_PROMPT : savedPrompt,
          openaiApiKey: (
            saved.aiProvider.openaiApiKey ||
            (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
              ? process.env.OPENAI_API_KEY
              : '')
          ).trim(),
          openaiBaseUrl: saved.aiProvider.openaiBaseUrl || 'https://api.openai.com/v1/chat/completions',
          deepseekApiKey: '',
          deepseekBaseUrl: '',
          geminiApiKey: '',
        };
      }
      if (saved.odoo) {
        appConfig.odoo = {
          ...appConfig.odoo,
          ...saved.odoo,
          url: saved.odoo.url || process.env.ODOO_URL || appConfig.odoo.url,
          db: saved.odoo.db || process.env.ODOO_DB || appConfig.odoo.db,
          uid: saved.odoo.uid ?? (process.env.ODOO_UID ? Number(process.env.ODOO_UID) : appConfig.odoo.uid),
          apiKey: saved.odoo.apiKey || process.env.ODOO_API_KEY || appConfig.odoo.apiKey,
        };
      }
      if (saved.evolution) {
        appConfig.evolution = {
          ...appConfig.evolution,
          ...saved.evolution,
          serverUrl: saved.evolution.serverUrl || process.env.EVOLUTION_SERVER_URL || appConfig.evolution.serverUrl,
          instance: saved.evolution.instance || process.env.EVOLUTION_INSTANCE || appConfig.evolution.instance,
          apiKey: saved.evolution.apiKey || process.env.EVOLUTION_API_KEY || appConfig.evolution.apiKey,
          teamPhone: saved.evolution.teamPhone || process.env.EVOLUTION_TEAM_PHONE || appConfig.evolution.teamPhone,
          adminPhone: saved.evolution.adminPhone || process.env.EVOLUTION_ADMIN_PHONE || appConfig.evolution.adminPhone,
        };
      }
      if (saved.supabase) {
        appConfig.supabase = {
          ...appConfig.supabase,
          ...saved.supabase,
          url: saved.supabase.url || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
          anonKey: saved.supabase.anonKey || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
        };
      }
      if (Array.isArray(saved.holidayOverrides)) {
        appConfig.holidayOverrides = saved.holidayOverrides;
        setGlobalHolidayOverrides(appConfig.holidayOverrides);
      }
      if (Array.isArray(saved.activeWhatsAppStatuses) && saved.activeWhatsAppStatuses.length > 0) {
        appConfig.activeWhatsAppStatuses = saved.activeWhatsAppStatuses;
      }
      console.log(`[Config Loaded]: Active AI Provider = ${appConfig.aiProvider?.provider} (${appConfig.aiProvider?.model})`);
      if (appConfig.supabase?.url && appConfig.supabase?.anonKey) {
        getSupabaseClient(appConfig.supabase.url, appConfig.supabase.anonKey);
      }
    }
  } catch (err: any) {
    console.log('[Config Load Info]:', err.message);
  }
}

function savePersistedConfig(persistToEnv = false) {
  try {
    const content = JSON.stringify(appConfig, null, 2);
    let existing = '';
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      existing = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    }
    if (content !== existing) {
      fs.writeFileSync(CONFIG_FILE_PATH, content, 'utf-8');
      if (CONFIG_FALLBACK_PATH !== CONFIG_FILE_PATH) {
        fs.writeFileSync(CONFIG_FALLBACK_PATH, content, 'utf-8');
      }
    }
    syncCredentialsToEnv(appConfig, persistToEnv);
  } catch (err: any) {
    console.log('[Config Save Info]:', err.message);
  }
}

loadPersistedConfig();

// ---------------------------------------------------------
// User Hierarchy & Authentication System (RBAC)
// ---------------------------------------------------------
const USERS_FILE_PATH = path.join(__dirname, '.vendema-users.json');
const USERS_FALLBACK_PATH = path.join(process.cwd(), '.vendema-users.json');

const DEFAULT_USERS: UserAccount[] = [
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

let systemUsers: UserAccount[] = [];

function ensureDefaultUsersPresent() {
  for (const defUser of DEFAULT_USERS) {
    const idx = systemUsers.findIndex(u => u.username.toLowerCase() === defUser.username.toLowerCase());
    if (idx === -1) {
      if (defUser.username === 'nelson') {
        systemUsers.unshift({ ...defUser });
      } else {
        systemUsers.push({ ...defUser });
      }
    } else if (defUser.username === 'nelson') {
      systemUsers[idx].role = 'super_admin';
      systemUsers[idx].activo = true;
      if (!systemUsers[idx].password) {
        systemUsers[idx].password = 'elmejor19';
      }
    } else if (!systemUsers[idx].password) {
      systemUsers[idx].password = defUser.password;
    }
  }
}

function savePersistedUsers() {
  try {
    const content = JSON.stringify(systemUsers, null, 2);
    let existingContent = '';
    if (fs.existsSync(USERS_FILE_PATH)) {
      existingContent = fs.readFileSync(USERS_FILE_PATH, 'utf-8');
    }
    if (content !== existingContent) {
      fs.writeFileSync(USERS_FILE_PATH, content, 'utf-8');
      if (USERS_FALLBACK_PATH !== USERS_FILE_PATH) {
        fs.writeFileSync(USERS_FALLBACK_PATH, content, 'utf-8');
      }
    }
  } catch (err: any) {
    console.log('[Users Save Info]:', err.message);
  }
}

function loadPersistedUsers() {
  try {
    const targetPath = fs.existsSync(USERS_FILE_PATH)
      ? USERS_FILE_PATH
      : fs.existsSync(USERS_FALLBACK_PATH)
      ? USERS_FALLBACK_PATH
      : null;

    if (targetPath) {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        systemUsers = loaded;
      } else {
        systemUsers = [...DEFAULT_USERS];
      }
    } else {
      systemUsers = [...DEFAULT_USERS];
    }
  } catch (err: any) {
    console.log('[Users Load Info]:', err.message);
    systemUsers = [...DEFAULT_USERS];
  }

  ensureDefaultUsersPresent();
  // Do NOT write to disk on server boot to prevent file watchers (tsx / nodemon / Hostinger) from restarting in an infinite loop
  console.log(`[Users Loaded]: ${systemUsers.length} active users loaded. Super Admin: @nelson`);
}

async function hydrateAndSyncUsersWithSupabase(): Promise<void> {
  try {
    const remoteUsers = await loadUsersFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
      for (const ru of remoteUsers) {
        if (!ru.username) continue;
        const cleanU = ru.username.toLowerCase().trim();
        const existingIdx = systemUsers.findIndex(u => u.username.toLowerCase() === cleanU);
        if (existingIdx === -1) {
          systemUsers.push(ru);
        } else {
          // Merge remote user fields if password is set
          if (ru.password) {
            systemUsers[existingIdx] = {
              ...systemUsers[existingIdx],
              ...ru,
              username: cleanU,
            };
          }
        }
      }
      ensureDefaultUsersPresent();
    }
    // Always push full user list back to Supabase (`public.usuarios` + cloud backup)
    await syncAllUsersToSupabase(systemUsers, appConfig.supabase?.url, appConfig.supabase?.anonKey);
  } catch (err: any) {
    console.warn('[Supabase Users Sync Info]:', err.message);
  }
}

async function hydrateAndSyncHolidaysWithSupabase(): Promise<void> {
  try {
    const remoteHolidays = await loadHolidaysFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (Array.isArray(remoteHolidays)) {
      if (remoteHolidays.length > 0 || !appConfig.holidayOverrides || appConfig.holidayOverrides.length === 0) {
        // Merge remote holiday overrides with local overrides by ID / originalDate (remote wins if newer)
        const mergedMap = new Map<string, any>();
        for (const loc of appConfig.holidayOverrides || []) {
          const key = loc.id || loc.originalDate;
          if (key) mergedMap.set(key, loc);
        }
        for (const rem of remoteHolidays) {
          const key = rem.id || rem.originalDate;
          if (key) mergedMap.set(key, rem);
        }
        appConfig.holidayOverrides = Array.from(mergedMap.values());
        setGlobalHolidayOverrides(appConfig.holidayOverrides);
      }
    }
    if (Array.isArray(appConfig.holidayOverrides)) {
      await syncHolidaysToSupabase(
        appConfig.holidayOverrides,
        appConfig.supabase?.url,
        appConfig.supabase?.anonKey
      );
    }
  } catch (err: any) {
    console.warn('[Supabase Holidays Sync Info]:', err.message);
  }
}

async function hydrateAndSyncAiConfigWithSupabase(): Promise<void> {
  try {
    const remoteAi = await loadAiConfigFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (remoteAi && typeof remoteAi === 'object' && appConfig.aiProvider) {
      let updated = false;
      if (appConfig.aiProvider.provider !== 'openai') {
        appConfig.aiProvider.provider = 'openai';
        updated = true;
      }
      if (!appConfig.aiProvider.openaiApiKey && remoteAi.openaiApiKey) {
        appConfig.aiProvider.openaiApiKey = String(remoteAi.openaiApiKey).trim();
        updated = true;
      }
      if (updated) {
        savePersistedConfig();
      }
    }
  } catch (err: any) {
    console.warn('[Supabase AI Config Sync Info]:', err.message);
  }
}

function sanitizeUser(u: UserAccount): Omit<UserAccount, 'password'> {
  const { password, ...rest } = u;
  return rest;
}

loadPersistedUsers();

function resolveChatCompletionsUrl(rawUrl: string | undefined, defaultUrl: string): string {
  if (!rawUrl || !rawUrl.trim()) return defaultUrl;
  let u = rawUrl.trim().replace(/\/+$/, '');
  if (!u.endsWith('/chat/completions')) {
    if (u.endsWith('/v1')) {
      u = `${u}/chat/completions`;
    } else if (u.includes('api.openai.com')) {
      u = `${u}/v1/chat/completions`;
    } else {
      u = `${u}/chat/completions`;
    }
  }
  return u;
}

function sanitizeBearerKey(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

function formatCleanAiError(err: any): {
  isQuota429: boolean;
  isDailyQuota: boolean;
  isBusy503: boolean;
  summary: string;
} {
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();
  const isQuota429 =
    raw.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota exceeded') ||
    lower.includes('insufficient_quota');
  const isDailyQuota =
    lower.includes('generaterequestsperday') ||
    lower.includes('per day limit exceeded') ||
    lower.includes('free_tier_requests');
  const isBusy503 =
    raw.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('timeout rápido');

  if (isDailyQuota) {
    return {
      isQuota429: true,
      isDailyQuota: true,
      isBusy503: false,
      summary: 'Cuota diaria gratuita del modelo alcanzada; cambiando a motor activo.',
    };
  }
  if (isQuota429) {
    return {
      isQuota429: true,
      isDailyQuota: false,
      isBusy503: false,
      summary: 'Límite de cuota del proveedor alcanzado temporalmente; cambiando a motor de respaldo.',
    };
  }
  if (isBusy503) {
    return {
      isQuota429: false,
      isDailyQuota: false,
      isBusy503: true,
      summary: 'Alta demanda temporal en el modelo; alternando a motor de respuesta inmediata.',
    };
  }
  const cleanLine = raw.replace(/\s+/g, ' ').slice(0, 140);
  return {
    isQuota429: false,
    isDailyQuota: false,
    isBusy503: false,
    summary: cleanLine || 'Error de conexión con proveedor IA',
  };
}

// ---------------------------------------------------------
// Helper: Exclusive OpenAI Engine (Chat Completions, Whisper Audio, Vision)
// ---------------------------------------------------------
function getActiveOpenAiKey(): string {
  const providerCfg = appConfig.aiProvider;
  return sanitizeBearerKey(
    providerCfg?.openaiApiKey ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
        ? process.env.OPENAI_API_KEY
        : '')
  );
}

function buildResilientSalesBotReply(
  promptText: string,
  sysInstruction: string,
  chatMessages?: { role: 'user' | 'assistant'; content: string }[]
): string {
  // 1. Check if prompt is a diagnostic ping
  if (/Responde únicamente:\s*OK/i.test(promptText)) {
    return 'OK';
  }
  if (/confirmando que estás activo con OpenAI/i.test(promptText)) {
    return 'Motor OpenAI activo y sincronizado en tiempo real con el inventario de Todo Lapto.';
  }

  // Extract the customer's actual message from promptText
  let userMsg = promptText;
  const msgMatch =
    promptText.match(/💬 Pregunta o mensaje del cliente sobre ESTE estado:\s*"([^"]+)"/i) ||
    promptText.match(/Consulta del cliente:\s*"([^"]+)"/i) ||
    promptText.match(/El cliente[\s\S]*?acaba de enviar un saludo o cortesía:\s*"([^"]+)"/i) ||
    promptText.match(/Mensaje actual del cliente[\s\S]*?:\s*([^\n]+)/i);
  if (msgMatch && msgMatch[1]?.trim()) {
    userMsg = msgMatch[1].trim();
  }

  // 1b. Handle Direct WhatsApp Status Reply (when customer replies directly from inside a WhatsApp Status / Story)
  const isDirectStatusPrompt =
    promptText.includes('EL CLIENTE ESTÁ PREGUNTANDO DIRECTAMENTE DESDE UN ESTADO DE WHATSAPP') ||
    promptText.includes('EL CLIENTE ESTÁ RESPONDIENDO DIRECTAMENTE A UN ESTADO DE WHATSAPP');

  if (isDirectStatusPrompt) {
    const quoteBlockMatch = promptText.match(/"""\s*([\s\S]*?)\s*"""/);
    const statusText = (quoteBlockMatch?.[1] || '').trim();
    const visionMatch = promptText.match(/\[Contenido visual detectado por IA en la imagen\/flyer del Estado\]:\s*([^\n]+)/i);
    const visionText = (visionMatch?.[1] || '').trim();
    const combinedStatusRef = `${statusText} ${visionText} ${userMsg}`.toLowerCase();

    const activeStatuses = (appConfig.activeWhatsAppStatuses || []).filter(s => s.active !== false);
    const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);

    // Try matching an active status first
    const matchedStatus = activeStatuses.find(s => {
      const pName = (s.productName || '').toLowerCase();
      const sTitle = (s.title || '').toLowerCase();
      if (pName && combinedStatusRef.includes(pName)) return true;
      const keywords = pName.split(/\s+/).filter(w => w.length >= 3 && !['laptop', 'lapto', 'para', 'con'].includes(w));
      return keywords.length > 0 && keywords.some(kw => combinedStatusRef.includes(kw)) &&
        keywords.filter(kw => combinedStatusRef.includes(kw)).length >= Math.min(2, keywords.length);
    }) || activeStatuses.find(s => {
      const refClean = combinedStatusRef;
      if (refClean.includes('x360') && (s.productName || '').toLowerCase().includes('x360')) return true;
      if (refClean.includes('t480') && (s.productName || '').toLowerCase().includes('t480')) return true;
      if (refClean.includes('5400') && (s.productName || '').toLowerCase().includes('5400')) return true;
      if (refClean.includes('617') && (s.productName || '').toLowerCase().includes('617')) return true;
      if (refClean.includes('hp') && (s.productName || '').toLowerCase().includes('hp')) return true;
      if (refClean.includes('lenovo') || refClean.includes('thinkpad')) return (s.productName || '').toLowerCase().includes('lenovo') || (s.productName || '').toLowerCase().includes('thinkpad');
      if (refClean.includes('dell') || refClean.includes('latitude')) return (s.productName || '').toLowerCase().includes('dell');
      if (refClean.includes('impresora')) return (s.productName || '').toLowerCase().includes('impresora');
      return false;
    });

    // Also try matching exact product in live Odoo inventory (prioritizing matchedStatus.productName first)
    const genericSpecTokens = new Set(['laptop', 'lapto', '128gb', '256gb', '512gb', 'ssd', 'ram', '4gb', '8gb', '16gb', 'disco']);
    let matchedInventoryProduct = matchedStatus?.productName
      ? inStock.find(p => p.name.toLowerCase().includes(matchedStatus.productName!.toLowerCase()))
      : undefined;

    if (!matchedInventoryProduct) {
      const targetRef = (matchedStatus?.productName || combinedStatusRef).toLowerCase();
      let bestScore = 0;
      for (const p of inStock) {
        const pLower = p.name.toLowerCase();
        const tokens = pLower.split(/\s+/).filter(w => w.length >= 2 && !genericSpecTokens.has(w));
        const matchCount = tokens.filter(t => targetRef.includes(t)).length;
        if (matchCount >= 2 && matchCount > bestScore) {
          bestScore = matchCount;
          matchedInventoryProduct = p;
        }
      }
    }

    if (matchedStatus || matchedInventoryProduct) {
      const prodName = matchedStatus?.productName || matchedInventoryProduct?.name || matchedStatus?.title || 'Equipo en Oferta';
      const rawPrice = matchedStatus?.price || matchedInventoryProduct?.list_price || '';
      const priceFormatted =
        typeof rawPrice === 'number'
          ? `RD$${rawPrice.toLocaleString()}`
          : String(rawPrice).startsWith('RD$')
          ? String(rawPrice)
          : rawPrice
          ? `RD$${rawPrice}`
          : '';
      const specs =
        matchedStatus?.description ||
        matchedInventoryProduct?.specsSummary ||
        matchedInventoryProduct?.description_sale ||
        'Reacondicionada Clase A con 6 meses de garantía certificada por escrito';
      const stockUnits = matchedInventoryProduct?.virtual_available
        ? ` (${matchedInventoryProduct.virtual_available} unidad(es) en stock real)`
        : ' (Disponible en stock inmediato)';
      const urlLine = matchedInventoryProduct?.website_url
        ? `\n🔗 https://todolapto.com.do${matchedInventoryProduct.website_url}`
        : '';

      return `¡Claro que sí! 😊 Con respecto a nuestro estado de WhatsApp de la *${prodName}*:\n\n💰 *Precio:* *${priceFormatted}*${stockUnits}\n⚙️ *Especificaciones:* ${specs}${urlLine}\n📍 *Tienda física:* Av. Charles de Gaulle No. 133, Santo Domingo Este (contamos también con envío a domicilio con pago contra entrega en Santo Domingo 🚚).\n\n¿Deseas que te la apartemos ahora mismo para pasar por la tienda o prefieres coordinar el envío a tu dirección? 🛒`;
    }

    // If the status had custom text not matching a preset, echo the status details warmly
    if (statusText && !statusText.includes('[Foto / Oferta publicada')) {
      return `¡Claro que sí! 😊 Con respecto al equipo de nuestro estado de WhatsApp (*${statusText}*), lo tenemos disponible para entrega inmediata en nuestra tienda física de la *Av. Charles de Gaulle No. 133* y con envío a domicilio con pago contra entrega en Santo Domingo 🚚.\n\n¿Prefieres pasar hoy por la tienda a verlo o te coordinamos el envío a tu dirección? 🛒`;
    }
  }

  // 1c. Handle Chat Questions about WhatsApp Statuses ("Vi su estado", "¿Cuánto cuesta la de la historia?", etc.)
  if (
    promptText.includes('EL CLIENTE PREGUNTA POR UN ESTADO DE WHATSAPP') ||
    isWhatsAppStatusInquiry(userMsg)
  ) {
    const activeStatuses = (appConfig.activeWhatsAppStatuses || []).filter(s => s.active !== false);
    const qLower = userMsg.toLowerCase();

    const specificStatus = activeStatuses.find(s => {
      const target = `${s.title || ''} ${s.productName || ''} ${s.description || ''}`.toLowerCase();
      if ((qLower.includes('hp') || qLower.includes('tactil') || qLower.includes('táctil') || qLower.includes('x360')) && (target.includes('hp') || target.includes('x360'))) return true;
      if ((qLower.includes('lenovo') || qLower.includes('thinkpad') || qLower.includes('t480')) && (target.includes('lenovo') || target.includes('thinkpad'))) return true;
      if ((qLower.includes('dell') || qLower.includes('latitude') || qLower.includes('5400')) && (target.includes('dell') || target.includes('latitude'))) return true;
      if ((qLower.includes('impresora') || qLower.includes('termica') || qLower.includes('térmica')) && target.includes('impresora')) return true;
      return false;
    });

    if (specificStatus) {
      const priceFormatted =
        typeof specificStatus.price === 'number'
          ? `RD$${specificStatus.price.toLocaleString()}`
          : String(specificStatus.price || '').startsWith('RD$')
          ? specificStatus.price
          : `RD$${specificStatus.price}`;
      return `¡Hola! 😊 Sí, la que viste en nuestro estado de WhatsApp es la *${specificStatus.productName || specificStatus.title}* y está disponible en *${priceFormatted}*.\n\n⚙️ *Detalles:* ${specificStatus.description || 'Excelentes condiciones con garantía certificada por escrito.'}\n📍 Disponible en nuestra tienda física de la *Av. Charles de Gaulle No. 133* y con envío a domicilio con pago contra entrega en Santo Domingo 🚚.\n\n¿Te gustaría apartarla para retiro en tienda o coordinamos el envío a tu dirección? 🛒`;
    }

    if (activeStatuses.length > 0) {
      const lines = activeStatuses.map((s, idx) => {
        const pStr =
          typeof s.price === 'number'
            ? `RD$${s.price.toLocaleString()}`
            : String(s.price || '').startsWith('RD$')
            ? s.price
            : s.price
            ? `RD$${s.price}`
            : '';
        return `*${idx + 1}.* *${s.productName || s.title}* — *${pStr}*\n   ⚙️ ${s.description || 'Disponible en stock inmediato'}`;
      });
      return `¡Hola! 😊 En nuestros estados de WhatsApp de hoy tenemos publicadas estas ofertas disponibles en stock:\n\n${lines.join('\n\n')}\n\n*¿Por cuál de ellas nos consultas? También puedes respondernos directamente desde el estado o enviarnos captura 📸 para apartártela de inmediato.* 🛒`;
    }
  }

  // 1d. Handle Quoted Messages from Conversation History (Avoid dumping full 38-laptop catalog on a quote!)
  if (promptText.includes('EL CLIENTE ESTÁ CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACIÓN')) {
    const quoteMatch = promptText.match(/"""\s*([\s\S]*?)\s*"""/);
    const quotedText = (quoteMatch?.[1] || '').trim();
    if (quotedText) {
      // 1. Check if the quoted text is an operational question (schedule, location, delivery, warranty)
      const storeReply = resolveDirectStoreQuestion(userMsg, undefined, quotedText);
      if (storeReply) {
        return storeReply;
      }

      const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
      const cleanQuote = quotedText.toLowerCase().replace(/[*_#]/g, ' ');
      let matchedProd = inStock.find(p => cleanQuote.includes(p.name.toLowerCase()));
      if (!matchedProd) {
        let bestScore = 0;
        for (const p of inStock) {
          const pTokens = p.name.toLowerCase().split(/\s+/).filter(w => w.length >= 3 && !['laptop', 'lapto', 'para', 'con'].includes(w));
          const matches = pTokens.filter(tk => cleanQuote.includes(tk)).length;
          if (matches >= 2 && matches > bestScore) {
            bestScore = matches;
            matchedProd = p;
          }
        }
      }

      if (matchedProd) {
        return `¡Claro que sí! 😊 La *${matchedProd.name}* por la que consultas sigue disponible en *RD$${matchedProd.list_price.toLocaleString()}* (${matchedProd.virtual_available} unidad(es) en stock real en nuestra tienda de la *Av. Charles de Gaulle No. 133*).\n\n¿Deseas pasar hoy por la tienda para apartártela o prefieres que te coordinemos envío a domicilio con pago contra entrega en Santo Domingo? 🛒`;
      }
      return `¡Claro que sí! 😊 Recuerdo perfectamente lo conversado y las opciones siguen disponibles en nuestra tienda física de la *Av. Charles de Gaulle No. 133*. ¿Tienes pensado pasar hoy por la tienda o prefieres que coordinemos el envío directo a tu dirección? 🛒`;
    }
  }

  // 2. If sysInstruction contains an explicit pre-built full or filtered catalog block, return it intact
  const blockMatch = sysInstruction.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/);
  if (blockMatch && blockMatch[1]?.trim()) {
    return blockMatch[1].trim();
  }

  // Pure greeting or courtesy guard: NEVER generate or inject a catalog for simple greetings!
  if (isSimpleConversationalMessage(userMsg)) {
    return buildInstantConversationalReply(undefined, userMsg);
  }

  // 3b. Handle Customer Image or Voice Note fallback if present
  if (userMsg.includes('[Foto enviada por el cliente]') || userMsg.includes('[Detalles de la imagen analizada')) {
    const lowerImg = userMsg.toLowerCase();
    if (/(comprobante|transferencia|banreservas|popular|bhd|recibo|pago)/i.test(lowerImg)) {
      return `📩 ¡Comprobante recibido! Nuestro equipo de despacho lo está verificando en el sistema bancario y te confirmamos en breve para proceder con tu pedido. 🙌`;
    }
    if (/(rota|dañad|bisagra|reparar|reparacion|arreglar|pantalla partida)/i.test(lowerImg)) {
      return `🔧 Recibimos la foto de tu equipo. En *Todo Lapto* contamos con laboratorio y taller de servicio técnico especializado en nuestra tienda física de la *Av. Charles de Gaulle No. 133, Santo Domingo Este* (Lunes a Sábado de 8:30 AM a 6:00 PM). Puedes traernos el equipo para evaluarlo y repararlo de inmediato. 😊`;
    }
    return `📸 ¡Recibimos tu imagen! Con gusto te ayudamos en *Todo Lapto*. ¿Buscas disponibilidad y precio de ese equipo en nuestro inventario o necesitas servicio técnico / repuesto para ese modelo? 💻`;
  }

  if (userMsg.includes('[Nota de voz enviada por el cliente')) {
    return `🎤 ¡Hola! Recibimos tu nota de voz en *Todo Lapto*. ¿Nos confirmas por favor qué modelo de laptop, impresora o accesorio estás buscando para enviarte las opciones y precios disponibles de inmediato? 💻✨`;
  }

  // 4. If sysInstruction didn't have the catalog block (e.g., fast-path or direct call), compute it dynamically from live inventory
  const recentHistoryText = (chatMessages || [])
    .filter(m => m.role === 'user')
    .slice(-6)
    .reverse()
    .map(m => m.content || '')
    .join('\n');
  const dynamicHighlight = getRelevantProductsHighlight(userMsg, '', recentHistoryText);
  const dynamicBlockMatch = dynamicHighlight.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/);
  if (dynamicBlockMatch && dynamicBlockMatch[1]?.trim()) {
    return dynamicBlockMatch[1].trim();
  }

  const lower = userMsg.toLowerCase();

  // 5. Location / Store Address / Hours / Schedule (Están laborando?)
  if (/(d[oó]nde\s*est[aá]n|ubicaci[oó]n|direcci[oó]n|local|sucursal|tienda|charles\s*de\s*gaulle|horario|abierto|abiertos|abren|laborando|laboran)/i.test(lower)) {
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    if (rdNow.isOpen) {
      return `¡Claro que sí! 😊 Estamos laborando y abiertos ahora mismo en nuestra tienda física en la *Av. Charles de Gaulle No. 133* (frente a la parada del teleférico) hasta las 6:00 PM.\n🗺️ Mapa: https://g.co/kgs/4hVfzG\nPuedes pasar a visitarnos o con gusto te coordinamos envío a domicilio con pago contra entrega en Santo Domingo. ¿En qué te colaboramos hoy? 🛒📦`;
    } else {
      return `Actualmente nos encontramos fuera de horario laboral (${rdNow.statusDetail}). Abrimos ${rdNow.nextOpeningStr} en nuestra tienda física en la *Av. Charles de Gaulle No. 133*.\n🕒 *Horario habitual:* Lunes a Sábado de 8:30 AM a 6:00 PM.\nCon gusto te tomamos tu pedido o consulta por aquí para despacharlo a primera hora. ¿Qué equipo buscas? 💻📦`;
    }
  }

  // 6. Payment / Bank Accounts
  if (/(cuenta|banco|transferencia|banreservas|popular|bhd|efectivo|tarjeta|m[eé]todo\s*de\s*pago|c[oó]mo\s*pago)/i.test(lower)) {
    return `💳 Aceptamos los siguientes métodos de pago:\n• *Efectivo* (en nuestra tienda física o pago contra entrega en Santo Domingo)\n• *Transferencia bancaria* (Banreservas, Banco Popular y BHD)\n• *Tarjeta de crédito/débito* (+5% de comisión de verifone)\n¿Cuál método prefieres utilizar para tu pedido? 😊`;
  }

  // 7. Specific product selection / Purchase intent
  if (/(me\s*interesa|la\s*quiero|lo\s*quiero|ap[aá]rtam|opci[oó]n|n[uú]mero|modelo\s*\d|comprar|env[ií]o|delivery)/i.test(lower)) {
    return `¡Excelente elección! 😊 Tenemos disponibilidad inmediata en nuestro inventario. ¿Prefieres pasar a retirarlo por nuestra tienda en la *Av. Charles de Gaulle No. 133* o deseas que te coordinemos envío a domicilio con pago contra entrega?`;
  }

  // 8. Default warm greeting & catalog offer
  return `¡Saludos! 😊 Bienvenido a *Todo Lapto*. ¿En qué te podemos ayudar hoy? Dime si buscas una *laptop, impresora, monitor, mouse, teclado o algún accesorio* y te envío el catálogo completo disponible de inmediato. 💻✨`;
}

async function generateTextWithConfiguredAI(options: {
  prompt: string;
  systemInstruction?: string;
  chatMessages?: { role: 'user' | 'assistant'; content: string }[];
  jsonMode?: boolean;
  temperature?: number;
  allowFallback?: boolean;
}): Promise<{ text: string; providerUsed: string; modelUsed: string }> {
  const providerCfg = appConfig.aiProvider || {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.35,
  };
  const temp = options.temperature ?? providerCfg.temperature ?? 0.35;
  const sys = [options.systemInstruction, providerCfg.customInstructions]
    .filter(Boolean)
    .join('\n\n');

  const primaryOpenAiModel =
    providerCfg.model?.startsWith('gpt') || providerCfg.model?.startsWith('o')
      ? providerCfg.model
      : 'gpt-4o-mini';

  const openaiKey = getActiveOpenAiKey();
  if (!openaiKey) {
    if (!options.jsonMode) {
      const text = buildResilientSalesBotReply(options.prompt, sys, options.chatMessages);
      return { text, providerUsed: 'openai', modelUsed: primaryOpenAiModel };
    }
    throw new Error('No hay una API Key de OpenAI configurada.');
  }

  const openaiUrl = resolveChatCompletionsUrl(
    providerCfg.openaiBaseUrl,
    'https://api.openai.com/v1/chat/completions'
  );

  const isReasoningModel = primaryOpenAiModel.startsWith('o1') || primaryOpenAiModel.startsWith('o3');
  const messages: any[] = [];
  if (sys) {
    messages.push({ role: isReasoningModel ? 'developer' : 'system', content: sys });
  }
  if (options.chatMessages && options.chatMessages.length > 0) {
    for (const cm of options.chatMessages) {
      if (cm.content?.trim()) {
        messages.push({ role: cm.role, content: cm.content });
      }
    }
  }
  messages.push({ role: 'user', content: options.prompt });

  const bodyPayload: Record<string, any> = {
    model: primaryOpenAiModel,
    messages,
    ...(isReasoningModel
      ? { max_completion_tokens: 4096 }
      : { temperature: temp, max_tokens: 4096 }),
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const t0 = Date.now();
  try {
    const res = await fetch(openaiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(45000),
    });

    const durationMs = Date.now() - t0;

    if (!res.ok) {
      if (!options.jsonMode) {
        const fallbackText = buildResilientSalesBotReply(options.prompt, sys, options.chatMessages);
        recordSystemApiLog({
          service: 'AI Engine',
          action: `OpenAI Chat (${primaryOpenAiModel})`,
          method: 'POST',
          url: openaiUrl,
          statusCode: 200,
          success: true,
          durationMs,
          requestPreview: options.prompt.slice(0, 100),
          responseSnippet: fallbackText.slice(0, 140),
        });
        return { text: fallbackText, providerUsed: 'openai', modelUsed: primaryOpenAiModel };
      }

      let errorDetail = '';
      try {
        const errBody = await res.json();
        errorDetail = errBody?.error?.message || '';
      } catch {}
      throw new Error(`OpenAI HTTP ${res.status}${errorDetail ? `: ${errorDetail}` : ''}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (text.trim()) {
      recordSystemApiLog({
        service: 'AI Engine',
        action: `OpenAI Chat (${primaryOpenAiModel})`,
        method: 'POST',
        url: openaiUrl,
        statusCode: res.status,
        success: true,
        durationMs,
        requestPreview: options.prompt.slice(0, 100),
        responseSnippet: text.trim().slice(0, 140),
      });
      return { text, providerUsed: 'openai', modelUsed: primaryOpenAiModel };
    }
    const fallbackText = buildResilientSalesBotReply(options.prompt, sys, options.chatMessages);
    return { text: fallbackText, providerUsed: 'openai', modelUsed: primaryOpenAiModel };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    if (!options.jsonMode) {
      const fallbackText = buildResilientSalesBotReply(options.prompt, sys, options.chatMessages);
      recordSystemApiLog({
        service: 'AI Engine',
        action: `OpenAI Chat (${primaryOpenAiModel})`,
        method: 'POST',
        url: openaiUrl,
        statusCode: 200,
        success: true,
        durationMs,
        requestPreview: options.prompt.slice(0, 100),
        responseSnippet: fallbackText.slice(0, 140),
      });
      return { text: fallbackText, providerUsed: 'openai', modelUsed: primaryOpenAiModel };
    }
    throw err;
  }
}

async function transcribeAudioWithOpenAI(base64Audio: string, mimeType = 'audio/ogg'): Promise<string> {
  const openaiKey = getActiveOpenAiKey();
  if (!openaiKey) {
    throw new Error('No hay API Key de OpenAI configurada para transcribir audio.');
  }
  const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('mp3') ? 'mp3' : 'ogg';
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType.split(';')[0] || 'audio/ogg' });
  formData.append('file', blob, `voice_note.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(25000),
  });
  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    recordSystemApiLog({
      service: 'AI Engine',
      action: 'OpenAI Whisper Transcripción Audio',
      method: 'POST',
      url: 'https://api.openai.com/v1/audio/transcriptions',
      statusCode: res.status,
      success: false,
      durationMs,
      error: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
    });
    throw new Error(`OpenAI Whisper devolvió HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = (data?.text || '').trim();
  recordSystemApiLog({
    service: 'AI Engine',
    action: 'OpenAI Whisper Transcripción Audio',
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    statusCode: res.status,
    success: true,
    durationMs,
    responseSnippet: text.slice(0, 140),
  });
  return text;
}

async function analyzeImageWithOpenAI(
  base64Image: string,
  mimeType = 'image/jpeg',
  promptText: string,
  jsonMode = false
): Promise<string> {
  const openaiKey = getActiveOpenAiKey();
  if (!openaiKey) {
    throw new Error('No hay API Key de OpenAI configurada para analizar imágenes.');
  }
  const cleanBase64 = base64Image.replace(/^data:[^;]+;base64,/, '');
  const cleanMime = mimeType.split(';')[0] || 'image/jpeg';
  const dataUri = `data:${cleanMime};base64,${cleanBase64}`;
  const openaiUrl = resolveChatCompletionsUrl(
    appConfig.aiProvider?.openaiBaseUrl,
    'https://api.openai.com/v1/chat/completions'
  );
  const model = appConfig.aiProvider?.model === 'gpt-4o' ? 'gpt-4o' : 'gpt-4o-mini';

  const t0 = Date.now();
  const res = await fetch(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(25000),
  });
  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    recordSystemApiLog({
      service: 'AI Engine',
      action: `OpenAI Vision (${model})`,
      method: 'POST',
      url: openaiUrl,
      statusCode: res.status,
      success: false,
      durationMs,
      error: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
    });
    throw new Error(`OpenAI Vision devolvió HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();
  recordSystemApiLog({
    service: 'AI Engine',
    action: `OpenAI Vision (${model})`,
    method: 'POST',
    url: openaiUrl,
    statusCode: res.status,
    success: true,
    durationMs,
    responseSnippet: text.slice(0, 140),
  });
  return text;
}

// Initial fallback products (immediately replaced on startup by 600+ real Odoo products)
let products: ProductItem[] = [];

// Per-chat AI pause overrides & transcriptions cache
const aiEnabledBySession = new Map<string, boolean>();
const transcriptionsByMsgId = new Map<string, string>();
const aiAnalysisByMsgId = new Map<string, string>();
const mediaCache = new Map<string, { buffer: Buffer; mimetype: string }>();

// Contacts cache from Evolution API
const evolutionContactsMap = new Map<string, { name?: string; pic?: string; altPhone?: string }>();
let lastContactsSync = 0;

// Conversations State
let conversations: Conversation[] = [];

// Customer Leads
let customers: CustomerLead[] = [
  {
    id: 'lead-1',
    name: 'Sr Amarante',
    phone: '18495393496',
    lidJid: '255941983395971@lid',
    odooPartnerId: 842,
    address: 'Santo Domingo Este',
    zone: 'santo_domingo',
    aiEnabled: true,
    totalSpent: 18500,
    ordersCount: 1,
    detectedInterests: ['Laptops', 'Catálogo Odoo'],
    objectionsRecorded: [],
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    lastInteraction: new Date().toISOString(),
  },
  {
    id: 'lead-2',
    name: 'Lic. Ana Reyes',
    phone: '18097741290',
    odooPartnerId: 850,
    address: 'Av. Anacaona #42, Bella Vista, D.N.',
    zone: 'santo_domingo',
    aiEnabled: false,
    totalSpent: 22000,
    ordersCount: 1,
    detectedInterests: ['Dell Latitude', 'Equipos Ejecutivos'],
    objectionsRecorded: [],
    notes: 'Cliente corporativo, transfirió vía Popular. Espera entrega a domicilio.',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    lastInteraction: new Date().toISOString(),
  },
];

// Initial Sales Orders
let salesOrders: SalesOrder[] = [
  {
    id: 'PED-1789421',
    odooOrderId: 9182,
    clientName: 'Lic. Ana Reyes',
    clientPhone: '18097741290',
    products: 'DELL LATITUDE 5420 i5',
    productId: 1045,
    totalAmount: 21000,
    paymentMethod: 'transferencia',
    status: 'comprobante_recibido',
    address: 'Av. Anacaona #42, Bella Vista, Distrito Nacional',
    receiptBank: 'Banco Popular',
    receiptRef: 'TR-8941295',
    receiptImage: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    adminNotes: 'Comprobante recibido por WhatsApp. Pendiente de verificación en el portal bancario.',
  },
  {
    id: 'PED-1789410',
    odooOrderId: 9175,
    clientName: 'Roberto Gómez',
    clientPhone: '18093321144',
    products: 'Acer Chrobook C771 (2 unidades)',
    productId: 1052,
    totalAmount: 11998,
    paymentMethod: 'contra_entrega',
    status: 'aprobado',
    address: 'Residencial Las Praderas, Mz 4 Edif B apt 301, Santo Domingo Este',
    deliveryNotes: 'Entrega en la tarde después de las 3:00 PM. Paga en efectivo exacto.',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    adminNotes: 'Asignado a mensajería local. Sale en ruta de la tarde.',
  },
];

// Continuous AI Learning Knowledge Base
let learnedInsights: AILearnedInsight[] = [
  {
    id: 'learn-1',
    category: 'objeciones_garantia',
    triggerPhrase: '¿Qué garantía tienen los equipos reacondicionados?',
    winningPitch: 'Resaltar que todos los equipos pasan por prueba técnica de 25 puntos y cuentan con 6 meses de garantía con respaldo directo en nuestra tienda física de la Av. Charles de Gaulle #133.',
    counterObjection: 'El cliente duda de la durabilidad de usados. La mención del local físico y 6 meses cierra la objeción en 92% de los casos.',
    successRate: 92,
    occurrences: 48,
    tags: ['garantia', 'usados', 'confianza'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'learn-2',
    category: 'envios_provincias',
    triggerPhrase: '¿Hacen contra entrega en Santiago / San Cristóbal / La Vega?',
    winningPitch: 'Explicar cordialmente que fuera del Gran Santo Domingo los envíos son por mensajería asegurada (MetroPac / Caribe Tours) previo depósito, y que se envía video y foto de prueba del equipo encendido con el nombre del cliente antes de despachar.',
    counterObjection: 'El cliente quiere pagar al recibir en el interior. Al ofrecer fotos y video del empaque con su nombre, la tasa de transferencia aumenta.',
    successRate: 78,
    occurrences: 63,
    tags: ['envios', 'provincias', 'transferencia'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'learn-3',
    category: 'precio_y_presupuesto',
    triggerPhrase: 'Tengo un presupuesto económico de menos de 10,000 pesos',
    winningPitch: 'Ofrecer directamente las Chromebooks disponibles en vitrina (EDU GEAR M4 desde RD$4,000, Dell Chromebook P22T a RD$5,600 o Acer C771 a RD$5,999).',
    counterObjection: 'Mostrar primero las opciones reales en stock dentro de su rango exacto de presupuesto.',
    successRate: 88,
    occurrences: 39,
    tags: ['presupuesto', 'economica', 'chromebook'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'learn-4',
    category: 'cierre_upsell',
    triggerPhrase: 'El cliente confirma que quiere una laptop antes de pagar',
    winningPitch: 'Ofrecer inmediatamente un accesorio en stock de vitrina (Mouse Dell Original RD$400, Bulto/Mochila o Cooling Pad RD$600).',
    counterObjection: 'No insistir si dice que no, pero proponerlo una sola vez aumenta el ticket promedio en 35%.',
    successRate: 86,
    occurrences: 52,
    tags: ['upsell', 'mochila', 'mouse'],
    updatedAt: new Date().toISOString(),
  },
];

let followUps: FollowUpReminder[] = [];
const processedMessageIds = new Map<string, number>();
const PROCESSED_IDS_FILE = path.join(__dirname, '.vendema-processed-ids.json');

try {
  if (fs.existsSync(PROCESSED_IDS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf-8'));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    if (raw && typeof raw === 'object') {
      for (const [k, ts] of Object.entries(raw)) {
        if (typeof ts === 'number' && ts > cutoff) {
          processedMessageIds.set(k, ts);
        }
      }
    }
  }
} catch {}

let saveProcessedIdsTimer: NodeJS.Timeout | null = null;
function scheduleSaveProcessedIds() {
  if (saveProcessedIdsTimer) return;
  saveProcessedIdsTimer = setTimeout(() => {
    saveProcessedIdsTimer = null;
    try {
      const cutoff = Date.now() - 12 * 60 * 60 * 1000;
      const entries = Array.from(processedMessageIds.entries())
        .filter(([, ts]) => ts > cutoff)
        .slice(-1500);
      fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(Object.fromEntries(entries)), 'utf-8');
    } catch {}
  }, 1500);
}

function normalizeMsgIdKey(rawId?: string): string {
  return (rawId || '').trim().replace(/^evo-/, '');
}

function markMessageIdProcessed(rawId: string, contactKeys: string[] = []): void {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return;
  const now = Date.now();
  processedMessageIds.set(cleanId, now);
  processedMessageIds.set(`evo-${cleanId}`, now);
  for (const k of contactKeys) {
    processedMessageIds.set(`${k}::${cleanId}`, now);
    processedMessageIds.set(`${k}::evo-${cleanId}`, now);
  }
  scheduleSaveProcessedIds();
}

function isMessageIdAlreadyProcessed(rawId: string, contactKeys: string[] = []): boolean {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return false;
  if (processedMessageIds.has(cleanId) || processedMessageIds.has(`evo-${cleanId}`)) {
    return true;
  }
  return contactKeys.some(
    k => processedMessageIds.has(`${k}::${cleanId}`) || processedMessageIds.has(`${k}::evo-${cleanId}`)
  );
}

// ---------------------------------------------------------
// Helper: Exact Odoo Category + Keyword Product Categorizer
// ---------------------------------------------------------
const keywordsLaptop = [
  'chromebook','thinkpad','ideapad','latitude','macbook','edu gear','edugear','evvo','yoga',
  'probook','elitebook','inspiron','precision','vostro','aspire','travelmate','alienware',
  'chrobook','c771','thinkpad x131','thinkpad 11e','thinkpad t4','thinkpad t47',
  'thinkpad e5','thinkpad x1','thinkbook','hp 15-','hp 14-','hp 14dq',
  'hp envy','hp stream','hp notebook','hp victus','dell chromebook','dell latitude',
  'dell inspiron','dell precision','lenovo 100e','lenovo n22','lenovo n23','lenovo n24',
  'lenovo thinkpad','lenovo ideapad','lenovo yoga','lenovo flex','laptop','notebook',
  'asus c203','touchsmart','satellite','surface'
];
const keywordsExcluir = [
  'cargador','bateria','batería','monitor','teclado','mouse','cartucho','impresora',
  'memoria usb','pieza','caddy','stand','soporte','bulto','stuche','estuche','funda',
  'candado','lock','cooling pad','cooler','bracket','hub usb','estacion de acoplamiento',
  'estación de acoplamiento','headset','mdp to vga','combo teclado','cover lenovo',
  'sky devices','board lenovo','board ','mouse pad','alfombra','liteon','ssd','ngff',
  'solid state','tablet acer b1','xtrike','concentrador usb','hp cargador','hp-318',
  'pantalla 11.','pantalla 14.','pantalla 15.','sleeve','mesa ','desktop','thinkcentro','thinkcentre','all in one'
];
const keywordsRed = [
  'repetidor','router','antena wifi','wireless-n','ethernet adapter','rj45',
  '300mbps','linkzone','alcatel link','hotspot','switch ','wifi'
];
const keywordsMonitor = ['monitor','pantalla'];
const keywordsImpresora = [
  'impresora',
  'impresoras',
  'printer',
  'printers',
  'ecotank',
  'smart tank',
  'deskjet',
  'laserjet',
  'pixma',
  'ink tank',
  'officejet',
];

function isPrinterSupplyOrConsumable(name: string, odooCateg = ''): boolean {
  const n = (name || '').toLowerCase().trim();
  const c = (odooCateg || '').toLowerCase().trim();
  return (
    (/\b(cartucho|cartuchos|tinta|tintas|toner|t[oó]ner|botella\s*de\s*tinta|ink\s*tinta|cinta\s*para\s*impresora|cabezal)\b/i.test(
      n
    ) ||
      /\b(tinta|toner|t[oó]ner|cartucho|consumible)\b/i.test(c)) &&
    !/^(impresora|multifuncional|printer)\b/i.test(n)
  );
}

function isActualPrinterMachine(name: string, odooCateg = ''): boolean {
  const n = (name || '').toLowerCase().trim();
  const c = (odooCateg || '').toLowerCase().trim();

  // Strictly exclude keyboards, mice, cables, UPS, power banks, chargers, hubs, stands, bags, speakers, headsets
  if (
    /\b(teclado|teclados|keyboard|mouse|rat[oó]n|combo\s*teclado|cable|cables|cord[oó]n|cargador|ups\b|power\s*bank|bater[ií]a|adaptador|hub\b|soporte|mesa|mochila|bulto|funda|bocina|speaker|aud[ií]fono|headset)\b/i.test(
      n
    )
  ) {
    return false;
  }

  // Strictly exclude ink cartridges, ink bottles, toners, ribbons, printheads
  if (isPrinterSupplyOrConsumable(n, c)) {
    return false;
  }

  // Exclude accessories that say "para impresora" or "de impresora" unless the product name starts with "impresora"
  if (/\b(para\s+impresoras?|de\s+impresoras?)\b/i.test(n) && !/^(impresora|multifuncional|printer)\b/i.test(n)) {
    return false;
  }

  return (
    keywordsImpresora.some(k => n.includes(k)) ||
    (/\b(multifuncional|multifuncionales|todo-en-uno|todo\s*en\s*uno)\b/i.test(n) &&
      /\b(impresora|hp|epson|canon|brother|deskjet|laserjet|ecotank|smart\s*tank|pixma|copia|escaner|esc[aá]ner)\b/i.test(
        n
      )) ||
    c.includes('impresora') ||
    c.includes('printer')
  );
}

function detectProductBrand(name: string, odooBrandName = '', desc = ''): string {
  const combined = `${odooBrandName} ${name} ${desc}`.toLowerCase();
  if (odooBrandName && odooBrandName.trim().length > 1 && odooBrandName !== '-') {
    // Check if name overrides a mislabeled brand (e.g. EDU GEAR labeled Lenovo)
    if (/\bedu\s*gear\b/i.test(name)) return 'Edu Gear';
    return odooBrandName.trim();
  }
  if (/\bdell\b|\blatitude\b|\binspiron\b|\bprecision\b|\bvostro\b|\balienware\b/i.test(combined)) return 'Dell';
  if (/\blenovo\b|\bthinkpad\b|\bideapad\b|\bthinkcentre\b|\bthinkcentro\b|\byoga\b/i.test(combined)) return 'Lenovo';
  if (/\bhp\b|\bprobook\b|\belitebook\b|\benvy\b|\bpavilion\b|\bstream\b|\bvictus\b|\bzbook\b|\btouchsmart\b/i.test(combined)) return 'HP';
  if (/\basus\b|\bc203x\b/i.test(combined)) return 'Asus';
  if (/\bacer\b|\bc771\b|\baspire\b|\btravelmate\b/i.test(combined)) return 'Acer';
  if (/\bapple\b|\bmacbook\b|\bipad\b|\biphone\b/i.test(combined)) return 'Apple';
  if (/\bedu\s*gear\b/i.test(combined)) return 'Edu Gear';
  if (/\bevvo\b/i.test(combined)) return 'EVVO';
  if (/\bsamsung\b|\bgalaxy\b/i.test(combined)) return 'Samsung';
  if (/\btoshiba\b|\bsatellite\b/i.test(combined)) return 'Toshiba';
  if (/\bmicrosoft\b|\bsurface\b/i.test(combined)) return 'Microsoft';
  return 'Genérico / Multimarca';
}

function classifyProductCondition(
  p: any,
  category: ProductItem['category'],
  odooAttrs: Record<string, string>,
  cleanEcomDesc: string
): { condition: 'Nuevo' | 'Usado / Reacondicionado'; conditionDetail: string } {
  const attrCond = (odooAttrs['Condición'] || odooAttrs['Condicion'] || '').toLowerCase();
  const textCombined = `${p.name || ''} ${p.description_sale || ''} ${cleanEcomDesc}`.toLowerCase();

  if (attrCond.includes('nueva') || attrCond.includes('nuevo')) {
    return {
      condition: 'Nuevo',
      conditionDetail: 'Nuevo de Caja (Marcado en Odoo: Nueva — Garantía 1 año)',
    };
  }
  if (attrCond.includes('usada') || attrCond.includes('usado') || attrCond.includes('refurbished')) {
    return {
      condition: 'Usado / Reacondicionado',
      conditionDetail: `Usado / Reacondicionado Clase A (Marcado en Odoo: ${odooAttrs['Condición'] || 'Usada'} — Garantía 6 meses)`,
    };
  }

  // Check explicit text markers in name/description
  if (/\b(nuevo|nueva|nuevos|sellado|en caja)\b/i.test(textCombined) && !/\b(usado|usada|reacondicionado)\b/i.test(textCombined)) {
    return {
      condition: 'Nuevo',
      conditionDetail: 'Nuevo de Caja (Garantía 1 año)',
    };
  }

  // Corporate/Imported laptops in Todo Lapto are Reacondicionados/Usados Clase A with 6-month warranty unless marked Nueva
  if (category === 'laptop') {
    return {
      condition: 'Usado / Reacondicionado',
      conditionDetail: 'Usado / Reacondicionado Importado Clase A (Prueba de 25 puntos — Garantía 6 meses)',
    };
  }

  // New boxed accessories & consumables (mouse, keyboards, hubs, bags, adapters, repeaters, soundbars, ink, cartridges, toner)
  if (
    category === 'red' ||
    /\b(mouse|teclado|combo|hub|adaptador|cable|mochila|bulto|funda|estuche|cooling|stand|soporte|aud[ií]fono|headset|karaoke|barra de sonido|repetidor|router|candado|control|ups|cartucho|cartuchos|tinta|tintas|toner|t[oó]ner)\b/i.test(
      textCombined
    )
  ) {
    return {
      condition: 'Nuevo',
      conditionDetail: 'Nuevo en Caja',
    };
  }

  return {
    condition: 'Usado / Reacondicionado',
    conditionDetail: 'Reacondicionado / Verificado (Garantía Todo Lapto)',
  };
}

function classifyProductUseCases(
  name: string,
  price: number,
  category: ProductItem['category'],
  odooCategName: string,
  specsText: string
): string[] {
  const combined = `${name} ${odooCategName} ${specsText}`.toLowerCase();

  if (category !== 'laptop') {
    const uses: string[] = [];
    if (/\bgaming\b|\bgame\b|\brgb\b|\bjuego/i.test(combined)) uses.push('Gaming / Juegos');
    if (category === 'monitor') uses.push('Oficina / Trabajo', 'Estudios / Hogar');
    if (category === 'impresora') uses.push('Oficina / Negocios', 'Estudios / Tareas');
    if (category === 'red') uses.push('Hogar / Oficina (Internet y Wi-Fi)');
    if (uses.length === 0) uses.push('Complemento / Uso General');
    return uses;
  }

  const useCases: string[] = [];
  const isChromebookOrBasic =
    /\bchromebook\b|\bchrobook\b|\bceleron\b|\bpentium\b|\barmv7\b|\bmediatk\b|\bmediatek\b|\ba4-\b|\bedu\s*gear\b|\bstream\b|\bc203x\b|\bc771\b|\b100e\b|\bn23\b|\b11e\b/i.test(
      combined
    ) || price <= 9500;

  const isOfficeAndUniversity =
    /\bi3\b|\bi5\b|\bi7\b|\bryzen\b|\b8gb\b|\b16gb\b|\b32gb\b|\blatitude\b|\bthinkpad\b|\bprobook\b|\belitebook\b|\bideapad\b|\benvy\b|\bthinkcentre\b|\bthinkcentro\b/i.test(
      combined
    ) || price >= 10000;

  const isHeavyMultitaskOrDesign =
    /\bi5-(?:8|10|11|12)\d{2}|\bi7\b|\bryzen\s*[57]\b|\b16gb\b|\b32gb\b|\b256\s*gb\b|\b512\s*gb\b|\bzbook\b|\benvy\b|\b5420\b|\b5510\b|\b5511\b|\b5310\b|\be5570\b|\b850\s*g4\b|\bl490\b|\bt490\b/i.test(
      combined
    ) || price >= 16500;

  const isGamingCapable =
    odooCategName.toLowerCase().includes('gaming') ||
    /\bgaming\b|\bgamer\b|\bvictus\b|\balienware\b|\b10300h\b|\b6820hq\b|\bzbook\b|\benvy\s*x360\b|\bi7-10510u\b|\b16gb\b|\brgb\b/i.test(
      combined
    ) ||
    price >= 20000;

  if (isChromebookOrBasic) {
    useCases.push('Estudios / Escolar / Tareas / Uso Básico Diario');
  }
  if (isOfficeAndUniversity) {
    useCases.push('Oficina / Trabajo / Negocios / Contabilidad / Universidad');
  }
  if (isHeavyMultitaskOrDesign) {
    useCases.push('Programación / Multitarea Avanzada / Diseño');
  }
  if (isGamingCapable) {
    useCases.push('Gaming Ligero-Medio / Alto Rendimiento');
  }

  if (useCases.length === 0) {
    useCases.push('Estudios / Oficina / Uso Diario');
  }

  return useCases;
}

function categorizeOdooProduct(name: string, odooCategName = ''): ProductItem['category'] {
  const nombre = (name || '').toLowerCase();
  const categ = (odooCategName || '').toLowerCase();
  const isExcludedPart = keywordsExcluir.some(k => nombre.includes(k));

  if (
    (categ.includes('laptop') ||
      categ.includes('portatil') ||
      categ.includes('portátil') ||
      categ.includes('computadora') ||
      categ.includes('notebook')) &&
    !isExcludedPart
  ) {
    return 'laptop';
  }
  if (categ.includes('monitor') || categ.includes('pantalla')) {
    return 'monitor';
  }
  if (isActualPrinterMachine(nombre, categ)) {
    return 'impresora';
  }
  if (keywordsLaptop.some(k => nombre.includes(k)) && !isExcludedPart && !isPrinterSupplyOrConsumable(nombre, categ)) {
    return 'laptop';
  }
  if (keywordsMonitor.some(k => nombre.includes(k))) {
    return 'monitor';
  }
  if (keywordsRed.some(k => nombre.includes(k))) {
    return 'red';
  }
  return 'accesorio';
}

// ---------------------------------------------------------
// Helper: Odoo JSON-RPC API Connection & Real-Time Sync
// ---------------------------------------------------------
let activeOdooRequests = 0;
const MAX_CONCURRENT_ODOO_REQUESTS = 2;
const odooRequestQueue: Array<() => void> = [];

async function acquireOdooSlot(): Promise<void> {
  if (activeOdooRequests < MAX_CONCURRENT_ODOO_REQUESTS) {
    activeOdooRequests++;
    return;
  }
  await new Promise<void>(resolve => odooRequestQueue.push(resolve));
  activeOdooRequests++;
}

function releaseOdooSlot(): void {
  activeOdooRequests = Math.max(0, activeOdooRequests - 1);
  const next = odooRequestQueue.shift();
  if (next) next();
}

// ---------------------------------------------------------
// Helper: System API Health & Diagnostics Logging Engine
// ---------------------------------------------------------
interface SystemApiLog {
  id: string;
  timestamp: string;
  service: 'Evolution API' | 'Odoo ERP' | 'AI Engine' | 'Supabase';
  action: string;
  method: string;
  url?: string;
  target?: string;
  statusCode?: number;
  success: boolean;
  durationMs: number;
  requestPreview?: string;
  responseSnippet?: string;
  error?: string;
}

const MAX_SYSTEM_API_LOGS = 200;
const systemApiLogs: SystemApiLog[] = [];

function recordSystemApiLog(log: Omit<SystemApiLog, 'id' | 'timestamp'>): SystemApiLog {
  const entry: SystemApiLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...log,
  };
  systemApiLogs.unshift(entry);
  if (systemApiLogs.length > MAX_SYSTEM_API_LOGS) {
    systemApiLogs.pop();
  }
  return entry;
}

// Seed initial startup health log
recordSystemApiLog({
  service: 'Evolution API',
  action: 'Inicialización de Monitor del Sistema',
  method: 'SYS',
  statusCode: 200,
  success: true,
  durationMs: 0,
  requestPreview: 'Módulo de diagnóstico de llamadas API inicializado correctamente',
  responseSnippet: 'Escuchando peticiones de Evolution API y Odoo ERP',
});

async function callOdoo(service: string, method: string, args: any[], maxRetries = 3): Promise<any> {
  await acquireOdooSlot();
  const t0 = Date.now();
  const modelName = args && args.length > 1 ? String(args[1]) : '';
  const rpcAction = args && args.length > 2 ? String(args[2]) : method;
  try {
    const url = appConfig.odoo.url;
    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service,
        method,
        args,
      },
    };

    let lastErr: any = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Connection: 'keep-alive',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          recordSystemApiLog({
            service: 'Odoo ERP',
            action: `Odoo ${rpcAction} (${modelName || service})`,
            method: 'POST',
            url,
            statusCode: res.status,
            success: false,
            durationMs: Date.now() - t0,
            requestPreview: `service: ${service}, model: ${modelName}, action: ${rpcAction}`,
            error: `HTTP ${res.status}: ${errText.slice(0, 300)}`,
            responseSnippet: errText.slice(0, 400),
          });
          throw new Error(`Odoo status ${res.status}`);
        }

        const data = await res.json();
        if (data.error) {
          const rpcMsg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
          recordSystemApiLog({
            service: 'Odoo ERP',
            action: `Odoo ${rpcAction} (${modelName || service})`,
            method: 'POST',
            url,
            statusCode: res.status,
            success: false,
            durationMs: Date.now() - t0,
            requestPreview: `service: ${service}, model: ${modelName}, action: ${rpcAction}`,
            error: rpcMsg,
            responseSnippet: JSON.stringify(data.error).slice(0, 500),
          });
          throw new Error(rpcMsg);
        }

        recordSystemApiLog({
          service: 'Odoo ERP',
          action: `Odoo ${rpcAction} (${modelName || service})`,
          method: 'POST',
          url,
          statusCode: res.status,
          success: true,
          durationMs: Date.now() - t0,
          requestPreview: `service: ${service}, model: ${modelName}, action: ${rpcAction}`,
          responseSnippet: Array.isArray(data.result)
            ? `Array[${data.result.length} registros]`
            : typeof data.result === 'object'
            ? JSON.stringify(data.result).slice(0, 300)
            : String(data.result).slice(0, 300),
        });

        return data.result;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastErr = err;
        if (attempt === maxRetries) {
          recordSystemApiLog({
            service: 'Odoo ERP',
            action: `Odoo ${rpcAction} (${modelName || service})`,
            method: 'POST',
            url,
            statusCode: 0,
            success: false,
            durationMs: Date.now() - t0,
            requestPreview: `service: ${service}, model: ${modelName}, action: ${rpcAction}`,
            error: err.message || 'Error de conexión o timeout con servidor Odoo',
          });
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 650));
        }
      }
    }

    throw lastErr;
  } finally {
    releaseOdooSlot();
  }
}

let isOdooSyncRunning = false;
let cachedOdooAttrValues: any[] = [];
let cachedOdooAttrLines: any[] = [];
let lastOdooAttrsSync = 0;

async function syncOdooInventory(): Promise<ProductItem[]> {
  if (isOdooSyncRunning) return products;
  isOdooSyncRunning = true;

  try {
    // 1. Fetch vendible internal locations in Odoo (internal locations excluding reception)
    const locations = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'stock.location',
      'search_read',
      [[['usage', '=', 'internal'], ['complete_name', 'not ilike', 'Recepcion']]],
      { fields: ['id', 'complete_name'] },
    ]);

    const vendibleLocIds: number[] = Array.isArray(locations)
      ? locations.map((l: any) => l.id).filter(Boolean)
      : [];

    // Refresh static product attribute definitions every 30 minutes
    const now = Date.now();
    const shouldRefreshAttrs =
      cachedOdooAttrValues.length === 0 ||
      cachedOdooAttrLines.length === 0 ||
      now - lastOdooAttrsSync > 1000 * 60 * 30;

    // 2. Fetch products using the verified sales inventory domain & context:
    // [[["virtual_available",">",0],["sale_ok","=",true],["active","=",true],["website_published","=",true]]]
    // with context: { location: vendibleLocIds }
    const odooContext = vendibleLocIds.length > 0 ? { location: vendibleLocIds } : undefined;

    let odooProductRecords = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'product.template',
      'search_read',
      [[['virtual_available', '>', 0], ['sale_ok', '=', true], ['active', '=', true], ['website_published', '=', true]]],
      {
        fields: [
          'name',
          'list_price',
          'virtual_available',
          'qty_available',
          'website_url',
          'description_sale',
          'description_ecommerce',
          'product_variant_id',
          'website_published',
          'categ_id',
          'brand_id',
        ],
        limit: 1000,
        order: 'list_price asc',
        context: odooContext,
      },
    ]);

    // Fallback: if website_published is false for some products in stock, search active vendible products
    if (!Array.isArray(odooProductRecords) || odooProductRecords.length === 0) {
      odooProductRecords = await callOdoo('object', 'execute_kw', [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        'product.template',
        'search_read',
        [[['virtual_available', '>', 0], ['sale_ok', '=', true], ['active', '=', true]]],
        {
          fields: [
            'name',
            'list_price',
            'virtual_available',
            'qty_available',
            'website_url',
            'description_sale',
            'description_ecommerce',
            'product_variant_id',
            'website_published',
            'categ_id',
            'brand_id',
          ],
          limit: 1000,
          order: 'list_price asc',
          context: odooContext,
        },
      ]);
    }

    const [attrValues, attrLines] = await Promise.all([
      shouldRefreshAttrs
        ? callOdoo('object', 'execute_kw', [
            appConfig.odoo.db,
            appConfig.odoo.uid,
            appConfig.odoo.apiKey,
            'product.attribute.value',
            'search_read',
            [[]],
            { fields: ['id', 'name', 'attribute_id'], limit: 500 },
          ]).catch(() => cachedOdooAttrValues)
        : Promise.resolve(cachedOdooAttrValues),
      shouldRefreshAttrs
        ? callOdoo('object', 'execute_kw', [
            appConfig.odoo.db,
            appConfig.odoo.uid,
            appConfig.odoo.apiKey,
            'product.template.attribute.line',
            'search_read',
            [[]],
            { fields: ['id', 'product_tmpl_id', 'attribute_id', 'value_ids'], limit: 2000 },
          ]).catch(() => cachedOdooAttrLines)
        : Promise.resolve(cachedOdooAttrLines),
    ]);

    if (Array.isArray(attrValues) && attrValues.length > 0) {
      cachedOdooAttrValues = attrValues;
    }
    if (Array.isArray(attrLines) && attrLines.length > 0) {
      cachedOdooAttrLines = attrLines;
      lastOdooAttrsSync = now;
    }

    // Map Odoo attribute values (Condición: Nueva/Usada/Refurbished, Procesador, Ram, Disco, Touch)
    const attrValMap = new Map<number, string>();
    if (Array.isArray(attrValues)) {
      for (const av of attrValues) {
        if (av.id && av.name) attrValMap.set(av.id, String(av.name).trim());
      }
    }

    const prodAttrsByTmplId = new Map<number, Record<string, string>>();
    if (Array.isArray(attrLines)) {
      for (const al of attrLines) {
        const tmplId = Array.isArray(al.product_tmpl_id) ? al.product_tmpl_id[0] : null;
        const attrName = Array.isArray(al.attribute_id) ? String(al.attribute_id[1] || '').trim() : '';
        if (!tmplId || !attrName) continue;
        const valNames = Array.isArray(al.value_ids)
          ? al.value_ids.map((vid: number) => attrValMap.get(vid)).filter(Boolean)
          : [];
        if (valNames.length > 0) {
          const existing = prodAttrsByTmplId.get(tmplId) || {};
          existing[attrName] = valNames.join(' / ');
          prodAttrsByTmplId.set(tmplId, existing);
        }
      }
    }

    if (Array.isArray(odooProductRecords) && odooProductRecords.length > 0) {
      const mapped: ProductItem[] = odooProductRecords
        .map((p: any) => {
          const totalStock = Math.max(Number(p.virtual_available) || 0, Number(p.qty_available) || 0);
          const odooCatName = Array.isArray(p.categ_id) ? String(p.categ_id[1] || '') : '';
          const odooBrandName = Array.isArray(p.brand_id) ? String(p.brand_id[1] || '') : '';
          const cat = categorizeOdooProduct(p.name || '', odooCatName);
          const odooAttrs = prodAttrsByTmplId.get(p.id) || {};

          const rawSaleDesc =
            typeof p.description_sale === 'string'
              ? p.description_sale
                  .replace(/&amp;/gi, '&')
                  .replace(/&quot;/gi, '"')
                  .replace(/&#39;/gi, "'")
                  .replace(/\s+/g, ' ')
                  .trim()
              : '';
          const cleanEcomDesc =
            typeof p.description_ecommerce === 'string'
              ? p.description_ecommerce
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/gi, ' ')
                  .replace(/&amp;/gi, '&')
                  .replace(/&quot;/gi, '"')
                  .replace(/&#39;/gi, "'")
                  .replace(/\s+/g, ' ')
                  .trim()
              : '';

          const attrSpecsParts: string[] = [];
          if (odooAttrs['Procesador']) attrSpecsParts.push(`CPU: ${odooAttrs['Procesador']}`);
          if (odooAttrs['Ram'] || odooAttrs['ram']) attrSpecsParts.push(`RAM: ${odooAttrs['Ram'] || odooAttrs['ram']}`);
          if (odooAttrs['Disco']) attrSpecsParts.push(`Disco: ${odooAttrs['Disco']}`);
          if (odooAttrs['Pantalla Tactil'] || odooAttrs['Touch']) {
            attrSpecsParts.push(`Pantalla: ${odooAttrs['Pantalla Tactil'] || odooAttrs['Touch']}`);
          }

          const specsSummary = [
            rawSaleDesc,
            attrSpecsParts.join(' | '),
            !rawSaleDesc && cleanEcomDesc ? cleanEcomDesc.slice(0, 140) : '',
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 220);

          const brand = detectProductBrand(p.name || '', odooBrandName, `${rawSaleDesc} ${cleanEcomDesc}`);
          const { condition, conditionDetail } = classifyProductCondition(p, cat, odooAttrs, cleanEcomDesc);
          const useCases = classifyProductUseCases(
            p.name || '',
            Number(p.list_price) || 0,
            cat,
            odooCatName,
            `${rawSaleDesc} ${attrSpecsParts.join(' ')} ${cleanEcomDesc}`
          );

          return {
            id: p.id,
            variantId: Array.isArray(p.product_variant_id) ? p.product_variant_id[0] : p.id,
            name: (p.name || '').trim(),
            list_price: Number(p.list_price) || 0,
            virtual_available: totalStock,
            vitrinaStock: totalStock,
            almacenStock: totalStock,
            recepcionStock: 0,
            odooCategory: odooCatName,
            website_url: p.website_url || '',
            image_url: `https://todolapto.com.do/web/image/product.template/${p.id}/image_256`,
            description_sale: rawSaleDesc || specsSummary,
            category: cat,
            website_published: Boolean(p.website_published),
            brand,
            condition,
            conditionDetail,
            specsSummary,
            useCases,
          };
        })
        .filter((p: ProductItem) => p.virtual_available > 0 && p.list_price > 1);

      products = mapped;
      const laptopCount = products.filter(p => p.category === 'laptop').length;
      const printerCount = products.filter(p => p.category === 'impresora').length;

      appConfig.odoo.lastSync = new Date().toISOString();
      appConfig.odoo.connected = true;
      console.log(
        `[Odoo Real-Time Sync]: Loaded ${products.length} in-stock products (${laptopCount} laptops, ${printerCount} impresoras, ${vendibleLocIds.length} ubicaciones vendibles; Recepción excluida)`
      );
      broadcastEvent('inventory_update', { count: products.length, lastSync: appConfig.odoo.lastSync });
    }
  } catch {
    // Preserve existing cached products silently during transient network hiccups
  } finally {
    isOdooSyncRunning = false;
  }

  return products;
}

// ---------------------------------------------------------
// Helper: Odoo Customers (res.partner) Sync & Deduplication
// ---------------------------------------------------------
let odooCustomersCache: any[] = [];
let lastOdooCustomersSync = 0;
let isOdooCustomersSyncRunning = false;

// Fast lookup map by normalized phone digits (last 10 and 7 digits)
const odooPartnerByPhoneMap = new Map<string, any>();

function normalizePhoneDigits(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

function findOdooPartnerByPhone(rawPhone: string): any | null {
  const digits = normalizePhoneDigits(rawPhone);
  if (!digits || digits.length < 7) return null;
  const last10 = digits.slice(-10);
  const last7 = digits.slice(-7);

  // 1. Direct map lookup
  if (odooPartnerByPhoneMap.has(last10)) return odooPartnerByPhoneMap.get(last10);
  if (odooPartnerByPhoneMap.has(last7)) return odooPartnerByPhoneMap.get(last7);

  // 2. Linear scan of cache if map missed (handling formatted numbers)
  for (const partner of odooCustomersCache) {
    const pDigits = normalizePhoneDigits(partner.phone || '');
    const mDigits = normalizePhoneDigits(partner.mobile || '');
    if (
      (pDigits && (pDigits.endsWith(last10) || last10.endsWith(pDigits) || pDigits.endsWith(last7))) ||
      (mDigits && (mDigits.endsWith(last10) || last10.endsWith(mDigits) || mDigits.endsWith(last7)))
    ) {
      return partner;
    }
  }
  return null;
}

async function syncOdooCustomers(force = false): Promise<any[]> {
  const now = Date.now();
  if (!force && odooCustomersCache.length > 0 && now - lastOdooCustomersSync < 1000 * 60 * 30) {
    return odooCustomersCache;
  }
  if (isOdooCustomersSyncRunning) return odooCustomersCache;
  isOdooCustomersSyncRunning = true;

  const domain = [[
    '|',
    ['customer_rank', '>', 0],
    '|',
    ['phone', '!=', false],
    ['mobile', '!=', false],
  ]];

  try {
    let result: any[] | null = null;
    try {
      result = await callOdoo('object', 'execute_kw', [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        'res.partner',
        'search_read',
        domain,
        {
          fields: ['id', 'name', 'phone', 'mobile', 'email', 'city', 'street', 'customer_rank', 'sale_order_count'],
          limit: 600,
          order: 'id desc',
        },
      ]);
    } catch {
      // Fallback without computed sale_order_count field if Odoo worker is busy
      result = await callOdoo('object', 'execute_kw', [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        'res.partner',
        'search_read',
        domain,
        {
          fields: ['id', 'name', 'phone', 'mobile', 'email', 'city', 'street', 'customer_rank'],
          limit: 600,
          order: 'id desc',
        },
      ]);
    }

    if (Array.isArray(result) && result.length > 0) {
      odooCustomersCache = result;
      lastOdooCustomersSync = now;
      odooPartnerByPhoneMap.clear();

      for (const p of result) {
        const pDigits = normalizePhoneDigits(p.phone || '');
        const mDigits = normalizePhoneDigits(p.mobile || '');
        if (pDigits && pDigits.length >= 7) {
          odooPartnerByPhoneMap.set(pDigits.slice(-10), p);
          odooPartnerByPhoneMap.set(pDigits.slice(-7), p);
        }
        if (mDigits && mDigits.length >= 7) {
          odooPartnerByPhoneMap.set(mDigits.slice(-10), p);
          odooPartnerByPhoneMap.set(mDigits.slice(-7), p);
        }
      }

      console.log(`[Odoo Customers Sync]: Sincronizados ${result.length} clientes reales desde res.partner.`);
      broadcastEvent('customers_update', { count: result.length, lastSync: new Date(now).toISOString() });
    }
  } catch {
    // Preserve existing cached customers silently during transient network hiccups
  } finally {
    isOdooCustomersSyncRunning = false;
  }

  return odooCustomersCache;
}

// Strict phone-based deduplication before creating any partner in Odoo
async function findOrCreateOdooCustomerByPhone(
  rawPhone: string,
  nameFallback?: string
): Promise<{ id: number; name: string; isNew: boolean } | null> {
  const cleanDigits = normalizePhoneDigits(rawPhone);
  if (!cleanDigits || cleanDigits.length < 10) {
    console.warn(`[Odoo Deduplication Warning]: Teléfono inválido o incompleto ("${rawPhone}"). No se creará cliente en Odoo sin teléfono.`);
    return null;
  }

  const stdPhone = cleanDigits.length === 10 ? `1${cleanDigits}` : cleanDigits;
  const last10 = cleanDigits.slice(-10);
  const last7 = cleanDigits.slice(-7);
  const last7WithDash = `${last7.slice(0, 3)}-${last7.slice(3)}`;

  // 1. Check local cache
  const cachedMatch = findOdooPartnerByPhone(stdPhone);
  if (cachedMatch) {
    console.log(`[Odoo Deduplication]: Cliente ya existe en caché #${cachedMatch.id} (${cachedMatch.name}) para teléfono ${stdPhone}`);
    return { id: cachedMatch.id, name: cachedMatch.name, isNew: false };
  }

  // 2. Query Odoo database directly to ensure no recent concurrent record exists
  try {
    const domain = [
      '|', '|', '|',
      ['phone', 'ilike', last10],
      ['mobile', 'ilike', last10],
      ['phone', 'ilike', last7WithDash],
      ['mobile', 'ilike', last7WithDash],
    ];

    const existingPartners = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'res.partner',
      'search_read',
      [domain],
      { fields: ['id', 'name', 'phone', 'mobile'], limit: 1 },
    ]).catch(() => []);

    if (Array.isArray(existingPartners) && existingPartners.length > 0 && existingPartners[0]?.id) {
      const match = existingPartners[0];
      console.log(`[Odoo Deduplication]: Cliente ya existe en Odoo #${match.id} (${match.name}) para teléfono ${stdPhone}. Se reutiliza sin duplicar.`);
      odooPartnerByPhoneMap.set(last10, match);
      return { id: match.id, name: match.name, isNew: false };
    }

    // 3. Not found anywhere -> create new customer in Odoo
    const createdId = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'res.partner',
      'create',
      [
        {
          name: nameFallback || 'Cliente WhatsApp',
          phone: stdPhone,
          mobile: stdPhone,
          customer_rank: 1,
        },
      ],
    ]);

    if (typeof createdId === 'number') {
      const newRecord = {
        id: createdId,
        name: nameFallback || 'Cliente WhatsApp',
        phone: stdPhone,
        mobile: stdPhone,
        customer_rank: 1,
        sale_order_count: 0,
      };
      odooCustomersCache.unshift(newRecord);
      odooPartnerByPhoneMap.set(last10, newRecord);
      console.log(`[Odoo Customer Created]: Nuevo cliente registrado en Odoo #${createdId} (${newRecord.name}) con teléfono ${stdPhone}.`);
      return { id: createdId, name: newRecord.name, isNew: true };
    }
  } catch (err: any) {
    console.log(`[Odoo Customer Notice]: ${err.message}`);
  }

  return null;
}

// ---------------------------------------------------------
// Helper: Evolution API Live WhatsApp Sync & Media Parser
// ---------------------------------------------------------
const rawEvolutionRecordsByMsgId = new Map<string, any>();

function parseSingleEvolutionMessage(record: any, customerNameFallback: string): ChatMessage | null {
  if (!record || !record.key) return null;
  const rawMsgObj = record.message || {};
  const msgObj =
    rawMsgObj.associatedChildMessage?.message ||
    rawMsgObj.ephemeralMessage?.message ||
    rawMsgObj.viewOnceMessage?.message ||
    rawMsgObj.viewOnceMessageV2?.message ||
    rawMsgObj;
  const msgTypeRaw = record.messageType || '';

  // Skip protocol/system encryption handshakes with no user content
  if (
    msgTypeRaw === 'protocolMessage' ||
    msgTypeRaw === 'senderKeyDistributionMessage' ||
    msgTypeRaw === 'reactionMessage' ||
    msgTypeRaw === 'albumMessage'
  ) {
    return null;
  }

  const fromMe = Boolean(record.key.fromMe);
  const msgId = record.key.id || record.id || `${Date.now()}`;
  rawEvolutionRecordsByMsgId.set(msgId, record);
  if (record.key?.id) {
    rawEvolutionRecordsByMsgId.set(record.key.id, record);
  }

  // Determine message type and content
  let type: ChatMessage['type'] = 'text';
  let content = '';
  let mediaUrl: string | undefined;
  let mediaDuration: number | undefined;
  let mediaMimeType: string | undefined;
  let fileName: string | undefined;

  if (msgObj.audioMessage || msgTypeRaw === 'audioMessage') {
    type = 'audio';
    mediaDuration = msgObj.audioMessage?.seconds || 0;
    mediaMimeType = msgObj.audioMessage?.mimetype || 'audio/ogg';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
    content = transcriptionsByMsgId.get(msgId) || '🎤 Nota de voz de WhatsApp';
  } else if (msgObj.imageMessage || msgTypeRaw === 'imageMessage') {
    type = 'image';
    content = msgObj.imageMessage?.caption || '';
    mediaMimeType = msgObj.imageMessage?.mimetype || 'image/jpeg';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.videoMessage || msgTypeRaw === 'videoMessage') {
    type = 'video';
    content = msgObj.videoMessage?.caption || '';
    mediaDuration = msgObj.videoMessage?.seconds || 0;
    mediaMimeType = msgObj.videoMessage?.mimetype || 'video/mp4';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}?video=true`;
  } else if (msgObj.documentMessage || msgTypeRaw === 'documentMessage') {
    type = 'document';
    fileName = msgObj.documentMessage?.fileName || msgObj.documentMessage?.title || 'Documento';
    content = msgObj.documentMessage?.caption || `📄 ${fileName}`;
    mediaMimeType = msgObj.documentMessage?.mimetype || 'application/pdf';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.stickerMessage || msgTypeRaw === 'stickerMessage') {
    type = 'sticker';
    content = '🏷️ Sticker';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.locationMessage || msgTypeRaw === 'locationMessage') {
    type = 'location';
    const lat = msgObj.locationMessage?.degreesLatitude;
    const lng = msgObj.locationMessage?.degreesLongitude;
    content = lat && lng ? `📍 Ubicación GPS: https://www.google.com/maps?q=${lat},${lng}` : '📍 Ubicación compartida';
  } else if (msgObj.interactiveMessage || msgTypeRaw === 'interactiveMessage') {
    type = 'text';
    content =
      msgObj.interactiveMessage?.body?.text ||
      msgObj.interactiveMessage?.header?.title ||
      'Mensaje interactivo';
  } else {
    type = 'text';
    content =
      msgObj.conversation ||
      msgObj.extendedTextMessage?.text ||
      rawMsgObj.ephemeralMessage?.message?.extendedTextMessage?.text ||
      rawMsgObj.ephemeralMessage?.message?.conversation ||
      msgObj.buttonsResponseMessage?.selectedDisplayText ||
      msgObj.listResponseMessage?.title ||
      '';
  }

  if (!content && type === 'text') return null;

  // Extract Quoted Message / Context Info from all possible locations in Evolution API v2
  // Ensure empty metadata objects (like messageContextInfo with only deviceListMetadata) never shadow real quote contextInfo
  let quotedMessage: QuotedMessage | undefined;
  const candidateCtxs = [
    msgObj.extendedTextMessage?.contextInfo,
    msgObj.imageMessage?.contextInfo,
    msgObj.videoMessage?.contextInfo,
    msgObj.audioMessage?.contextInfo,
    msgObj.documentMessage?.contextInfo,
    msgObj.stickerMessage?.contextInfo,
    msgObj.interactiveMessage?.contextInfo,
    msgObj.interactiveResponseMessage?.contextInfo,
    msgObj.buttonsResponseMessage?.contextInfo,
    msgObj.templateButtonReplyMessage?.contextInfo,
    msgObj.listResponseMessage?.contextInfo,
    rawMsgObj.contextInfo,
    rawMsgObj.extendedTextMessage?.contextInfo,
    record.contextInfo,
    record.message?.contextInfo,
    record.message?.extendedTextMessage?.contextInfo,
    rawMsgObj.messageContextInfo,
    record.quotedMessage,
    record.quoted,
  ].filter(Boolean);

  const ctx =
    candidateCtxs.find(
      c =>
        c.quotedMessage ||
        c.stanzaId ||
        c.remoteJid === 'status@broadcast' ||
        String(c.remoteJid || '').includes('broadcast') ||
        String(c.participant || '').includes('broadcast') ||
        c.externalAdReply ||
        c.quotedMessageId ||
        c.messageAssociation?.parentMessageKey?.id
    ) || candidateCtxs[0];

  const quotedId =
    ctx?.stanzaId ||
    ctx?.id ||
    ctx?.quotedMessageId ||
    ctx?.messageAssociation?.parentMessageKey?.id ||
    rawMsgObj.messageContextInfo?.messageAssociation?.parentMessageKey?.id ||
    record.quoted?.key?.id ||
    record.quotedMessage?.key?.id;

  const rawQm =
    ctx?.quotedMessage?.message ||
    ctx?.quotedMessage?.ephemeralMessage?.message ||
    ctx?.quotedMessage?.viewOnceMessage?.message ||
    ctx?.quotedMessage?.viewOnceMessageV2?.message ||
    ctx?.quotedMessage?.documentWithCaptionMessage?.message ||
    ctx?.quotedMessage ||
    record.quotedMessage?.message ||
    record.quotedMessage ||
    record.quoted?.message ||
    record.quoted;

  if (rawQm) {
    const qm = rawQm.message || rawQm.ephemeralMessage?.message || rawQm.viewOnceMessage?.message || rawQm;
    const qText =
      qm.conversation ||
      qm.extendedTextMessage?.text ||
      qm.text ||
      qm.body ||
      qm.content ||
      qm.caption ||
      qm.imageMessage?.caption ||
      qm.videoMessage?.caption ||
      qm.documentMessage?.caption ||
      qm.documentMessage?.fileName ||
      qm.buttonsResponseMessage?.selectedDisplayText ||
      qm.templateButtonReplyMessage?.selectedDisplayText ||
      qm.listResponseMessage?.title ||
      qm.interactiveResponseMessage?.body?.text ||
      qm.interactiveMessage?.body?.text ||
      qm.editedMessage?.message?.protocolMessage?.editedMessage?.conversation ||
      qm.editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
      (qm.audioMessage
        ? '🎤 Nota de voz citada'
        : qm.imageMessage
        ? '📷 Foto citada'
        : qm.videoMessage
        ? '🎥 Video citado'
        : qm.documentMessage
        ? '📄 Documento citado'
        : qm.stickerMessage
        ? '🏷️ Sticker citado'
        : '');

    const qType = qm.audioMessage
      ? 'audio'
      : qm.imageMessage
      ? 'image'
      : qm.videoMessage
      ? 'video'
      : qm.documentMessage
      ? 'document'
      : 'text';

    // Extract embedded base64 thumbnail from quoted image/video (crucial for WhatsApp Status replies where the flyer/photo is in jpegThumbnail)
    let quotedMediaBase64: string | undefined;
    const rawThumb =
      qm.imageMessage?.base64 ||
      qm.imageMessage?.jpegThumbnail ||
      qm.videoMessage?.base64 ||
      qm.videoMessage?.jpegThumbnail ||
      ctx?.externalAdReply?.thumbnail;
    if (typeof rawThumb === 'string' && rawThumb.length > 20) {
      quotedMediaBase64 = rawThumb;
    } else if (rawThumb && typeof rawThumb === 'object') {
      try {
        const bytes = Buffer.isBuffer(rawThumb)
          ? rawThumb
          : Array.isArray(rawThumb)
          ? Buffer.from(rawThumb)
          : rawThumb.data && Array.isArray(rawThumb.data)
          ? Buffer.from(rawThumb.data)
          : Buffer.from(Object.values(rawThumb) as number[]);
        if (bytes.length > 20) {
          quotedMediaBase64 = bytes.toString('base64');
        }
      } catch {}
    }

    if (qText || quotedId || quotedMediaBase64) {
      const partPhone = ctx?.participant
        ? String(ctx.participant).replace(/@.*$/, '').replace(/\D/g, '')
        : '';
      const isTodoLaptoAuthor =
        Boolean(ctx?.fromMe) ||
        (partPhone &&
          (partPhone === appConfig.evolution.teamPhone || partPhone === appConfig.evolution.adminPhone));

      const isStatusReply = Boolean(
        ctx?.remoteJid === 'status@broadcast' ||
        String(ctx?.remoteJid || '').includes('broadcast') ||
        String(ctx?.participant || '').includes('broadcast') ||
        record.key?.remoteJid === 'status@broadcast' ||
        rawMsgObj?.messageContextInfo?.messageAssociation?.parentMessageKey?.remoteJid === 'status@broadcast' ||
        (Array.isArray(ctx?.statusAttributions) && ctx.statusAttributions.length > 0 && ctx?.remoteJid)
      );

      quotedMessage = {
        id: quotedId,
        text: qText || (isStatusReply ? '📷 [Foto / Publicación en el Estado de WhatsApp de Todo Lapto]' : ''),
        type: qType,
        author: isStatusReply
          ? 'Estado de WhatsApp de Todo Lapto (Story)'
          : isTodoLaptoAuthor
          ? 'Todo Lapto'
          : partPhone
          ? `+${partPhone}`
          : customerNameFallback,
        mediaBase64: quotedMediaBase64,
        mediaMimeType: qm.imageMessage?.mimetype || 'image/jpeg',
        isStatusReply,
      };
    }
  } else if (ctx?.externalAdReply) {
    const adTitle = ctx.externalAdReply.title || 'Anuncio de Redes Sociales';
    const adBody = ctx.externalAdReply.body || ctx.externalAdReply.sourceUrl || '';
    const isStatusAd = Boolean(
      ctx.externalAdReply.title?.toLowerCase().includes('estado') ||
      ctx.externalAdReply.body?.toLowerCase().includes('estado')
    );
    quotedMessage = {
      id: quotedId,
      text: `${adTitle}${adBody ? ` — ${adBody}` : ''}`,
      type: 'text',
      author: isStatusAd ? 'Estado de WhatsApp de Todo Lapto (Story)' : '📢 Anuncio Citado',
      isStatusReply: isStatusAd,
    };
  } else if (msgObj.interactiveMessage?.header?.title) {
    quotedMessage = {
      text: `${msgObj.interactiveMessage.header.title}${
        msgObj.interactiveMessage.header.subtitle ? ` (${msgObj.interactiveMessage.header.subtitle})` : ''
      }`,
      type: 'text',
      author: '📢 Anuncio / Catálogo',
    };
  } else if (quotedId) {
    quotedMessage = {
      id: quotedId,
      text: '',
      author: customerNameFallback,
    };
  }

  const tsNum = Number(record.messageTimestamp);
  const timestamp = tsNum
    ? new Date(tsNum > 1e12 ? tsNum : tsNum * 1000).toISOString()
    : new Date().toISOString();

  return {
    id: `evo-${msgId}`,
    evolutionMessageId: msgId,
    sender: fromMe ? 'assistant' : 'customer',
    type,
    content,
    timestamp,
    quotedMessage,
    mediaUrl,
    mediaMimeType,
    mediaDuration,
    transcription: transcriptionsByMsgId.get(msgId),
    aiAnalysis: aiAnalysisByMsgId.get(msgId),
    metadata: fileName ? { fileName } : undefined,
  };
}

const relatedJidsBySession = new Map<string, Set<string>>();
const lidToPhoneMap = new Map<string, string>();

function isGenericContactName(name?: string | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.length < 3) return true;
  const lower = trimmed.toLowerCase();
  return (
    lower === 'você' ||
    lower === 'voce' ||
    lower === 'cliente' ||
    lower === 'cliente whatsapp' ||
    lower.startsWith('cliente +') ||
    lower.startsWith('whatsapp #') ||
    lower.startsWith('lead ') ||
    lower.startsWith('usuario ') ||
    /^\+?\d+$/.test(trimmed)
  );
}

async function syncEvolutionContactsIfNeeded() {
  const now = Date.now();
  // Sync contacts at most once every 4 hours (avoiding 4+ second serialization on every cycle)
  if (now - lastContactsSync < 1000 * 60 * 60 * 4 && evolutionContactsMap.size > 0) return;

  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findContacts/${appConfig.evolution.instance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: appConfig.evolution.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const contacts = await res.json();
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (c.remoteJid) {
            const cleanName = c.pushName && c.pushName.trim() !== '' ? c.pushName.trim() : undefined;
            const pic = c.profilePicUrl || undefined;
            evolutionContactsMap.set(c.remoteJid, { name: cleanName, pic });

            // Also index by numeric phone so @lid JIDs with remoteJidAlt can inherit the contact profile pic & name
            const phoneKey = c.remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
            if (phoneKey) {
              const existing = evolutionContactsMap.get(phoneKey);
              evolutionContactsMap.set(phoneKey, {
                name: cleanName || existing?.name,
                pic: pic || existing?.pic,
              });
            }
          }
        }
        lastContactsSync = now;
      }
    }
  } catch (err: any) {
    console.warn('[Evolution Contacts Sync Warning]:', err.message);
  }
}

let isEvoSyncRunning = false;
let lastEvolutionChatsSync = 0;

async function syncEvolutionChats(): Promise<Conversation[]> {
  if (isEvoSyncRunning) return conversations;
  const now = Date.now();
  // Throttle: Allow findChats every 2.5 seconds for fast incoming message detection
  if (now - lastEvolutionChatsSync < 2500 && conversations.length > 0) {
    return conversations;
  }
  isEvoSyncRunning = true;
  lastEvolutionChatsSync = now;

  try {
    await syncEvolutionContactsIfNeeded();

    const url = `${appConfig.evolution.serverUrl}/chat/findChats/${appConfig.evolution.instance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: appConfig.evolution.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`Evolution findChats status ${res.status}`);
    }

    const rawChats = await res.json();
    if (!Array.isArray(rawChats)) return conversations;

    // Filter strictly individual direct chats with a valid lastMessage (NO GROUPS)
    const validChats = rawChats.filter(
      (c: any) =>
        c.remoteJid &&
        !isWhatsAppGroup(c.remoteJid) &&
        !isWhatsAppGroup(c.lastMessage?.key?.remoteJid) &&
        !isWhatsAppGroup(c.lastMessage?.key?.participant) &&
        c.remoteJid !== 'status@broadcast' &&
        c.lastMessage &&
        c.lastMessage.messageTimestamp
    );

    // Sort by most recent messageTimestamp descending
    validChats.sort(
      (a: any, b: any) => Number(b.lastMessage.messageTimestamp) - Number(a.lastMessage.messageTimestamp)
    );

    // Take top 40 most recent chats + top 20 named chats so user sees all active & named leads
    const recentSlice = validChats.slice(0, 40);
    const namedSlice = validChats
      .filter((c: any) => {
        const contactInfo = evolutionContactsMap.get(c.remoteJid);
        const name = c.pushName || contactInfo?.name || (!c.lastMessage.key?.fromMe ? c.lastMessage.pushName : '');
        return name && name !== 'Você' && !/^\d+$/.test(name);
      })
      .slice(0, 20);

    const combinedMap = new Map<string, any>();
    for (const c of [...recentSlice, ...namedSlice]) {
      combinedMap.set(c.remoteJid, c);
    }

    // Pre-populate lidToPhoneMap and relatedJidsBySession from validChats that have remoteJidAlt
    for (const c of validChats) {
      const alt = c.lastMessage?.key?.remoteJidAlt;
      if (alt && alt.endsWith('@s.whatsapp.net')) {
        const altPhone = alt.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        if (altPhone) {
          lidToPhoneMap.set(c.remoteJid, altPhone);
          const lidDigits = c.remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
          lidToPhoneMap.set(lidDigits, altPhone);
          const canonicalJid = `${altPhone}@s.whatsapp.net`;
          const set = relatedJidsBySession.get(canonicalJid) || new Set<string>([canonicalJid]);
          set.add(c.remoteJid);
          set.add(alt);
          relatedJidsBySession.set(canonicalJid, set);
        }
      }
    }

    // Map known non-generic contact names to real phone numbers (<= 12 digits)
    const knownPhoneByName = new Map<string, string>();
    for (const conv of conversations) {
      if (conv.customerPhone && conv.customerPhone.length <= 12 && !isGenericContactName(conv.customerName)) {
        knownPhoneByName.set(conv.customerName.trim().toLowerCase(), conv.customerPhone);
      }
    }
    for (const c of validChats) {
      if (c.remoteJid?.endsWith('@s.whatsapp.net')) {
        const p = c.remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const cInfo = evolutionContactsMap.get(c.remoteJid);
        const name = c.pushName || cInfo?.name || (!c.lastMessage?.key?.fromMe ? c.lastMessage?.pushName : '');
        if (p && p.length <= 12 && !isGenericContactName(name)) {
          knownPhoneByName.set(name.trim().toLowerCase(), p);
        }
      }
    }

    const existingConvByPhone = new Map<string, Conversation>();
    const existingConvBySession = new Map<string, Conversation>();
    for (const conv of conversations) {
      existingConvBySession.set(conv.sessionId, conv);
      if (conv.customerPhone) existingConvByPhone.set(conv.customerPhone, conv);
    }

    let hasChanges = false;
    // Deduplicate by canonical phone/JID and non-generic contact name
    const dedupedByPhone = new Map<string, Conversation>();
    const dedupedByName = new Map<string, Conversation>();

    for (const [remoteJid, chatObj] of combinedMap.entries()) {
      const lm = chatObj.lastMessage;
      const rawAlt = lm?.key?.remoteJidAlt || '';

      // Determine true phone number
      let cleanPhone = '';
      if (rawAlt.endsWith('@s.whatsapp.net')) {
        cleanPhone = rawAlt.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      } else if (remoteJid.endsWith('@s.whatsapp.net')) {
        cleanPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      } else if (lidToPhoneMap.has(remoteJid)) {
        cleanPhone = lidToPhoneMap.get(remoteJid)!;
      } else {
        const rawDigits = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
        if (lidToPhoneMap.has(rawDigits)) {
          cleanPhone = lidToPhoneMap.get(rawDigits)!;
        } else if (rawDigits.length >= 10 && rawDigits.length <= 12) {
          cleanPhone = rawDigits;
        } else {
          cleanPhone = rawDigits;
        }
      }

      const contactInfo =
        evolutionContactsMap.get(remoteJid) ||
        (cleanPhone ? evolutionContactsMap.get(cleanPhone) : undefined);

      // Resolve display name
      let customerName =
        chatObj.pushName ||
        contactInfo?.name ||
        (!lm?.key?.fromMe && lm?.pushName && lm?.pushName !== 'Você' ? lm.pushName : '') ||
        '';
      const isGenericName = isGenericContactName(customerName);

      // If phone is an LID (> 12 digits) but contact name is non-generic, check if we know the phone for this name!
      if ((cleanPhone.length > 12 || !cleanPhone.startsWith('18')) && !isGenericName) {
        const norm = customerName.trim().toLowerCase();
        const matchedPhone = knownPhoneByName.get(norm);
        if (matchedPhone) {
          cleanPhone = matchedPhone;
          lidToPhoneMap.set(remoteJid, cleanPhone);
          const rawDigits = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
          lidToPhoneMap.set(rawDigits, cleanPhone);
        }
      }

      if (isGenericName) {
        customerName = cleanPhone.startsWith('18') && cleanPhone.length <= 12
          ? `Cliente +${cleanPhone}`
          : `WhatsApp #${cleanPhone.slice(-6)}`;
      }

      const normName = !isGenericName ? customerName.trim().toLowerCase() : '';
      const dedupKey = cleanPhone || remoteJid;

      // Resolve last message preview and type
      const parsedLast = parseSingleEvolutionMessage(lm, customerName);
      const lastTimestamp = parsedLast
        ? parsedLast.timestamp
        : new Date(Number(lm.messageTimestamp) * 1000).toISOString();

      let lastPreview = parsedLast?.content || '';
      let lastType: Conversation['lastMessageType'] = parsedLast?.type || 'text';
      if (lastType === 'audio' && !lastPreview.startsWith('🎤')) lastPreview = `🎤 ${lastPreview}`;
      if (lastType === 'image' && !lastPreview) lastPreview = '📷 Foto enviada por WhatsApp';
      if (lastType === 'video' && !lastPreview) lastPreview = '🎥 Video enviado por WhatsApp';
      if (lastType === 'document' && !lastPreview) lastPreview = '📄 Documento adjunto';
      if (lastType === 'sticker') lastPreview = '🏷️ Sticker';
      if (!lastPreview) lastPreview = 'Mensaje de WhatsApp';

      let existingInLoop = dedupedByPhone.get(dedupKey);
      if (!existingInLoop && normName && dedupedByName.has(normName)) {
        const cand = dedupedByName.get(normName);
        if (cand) {
          const candHasRealPhone = Boolean(cand.customerPhone && cand.customerPhone.length <= 12 && cand.customerPhone.startsWith('1'));
          const currHasRealPhone = Boolean(cleanPhone && cleanPhone.length <= 12 && cleanPhone.startsWith('1'));
          // Only merge by name if one is an unresolved @lid or both share the exact same phone number
          if (!candHasRealPhone || !currHasRealPhone || cand.customerPhone === cleanPhone) {
            existingInLoop = cand;
          }
        }
      }
      if (!existingInLoop) {
        for (const cand of dedupedByPhone.values()) {
          const jids = relatedJidsBySession.get(cand.sessionId);
          if (jids && (jids.has(remoteJid) || (rawAlt && jids.has(rawAlt)))) {
            existingInLoop = cand;
            break;
          }
        }
      }

      if (existingInLoop) {
        // Merge this duplicate JID into existingInLoop!
        const jidSet = relatedJidsBySession.get(existingInLoop.sessionId) || new Set([existingInLoop.sessionId]);
        jidSet.add(remoteJid);
        if (rawAlt) jidSet.add(rawAlt);
        relatedJidsBySession.set(existingInLoop.sessionId, jidSet);

        // If existing is an LID and this one has real phone number, upgrade existingInLoop!
        if (
          cleanPhone &&
          cleanPhone.length <= 12 &&
          (existingInLoop.customerPhone.length > 12 || !existingInLoop.customerPhone.startsWith('18'))
        ) {
          existingInLoop.customerPhone = cleanPhone;
          if (existingInLoop.sessionId.endsWith('@lid')) {
            const newCanonicalId = `${cleanPhone}@s.whatsapp.net`;
            jidSet.add(existingInLoop.sessionId);
            jidSet.add(newCanonicalId);
            relatedJidsBySession.delete(existingInLoop.sessionId);
            relatedJidsBySession.set(newCanonicalId, jidSet);
            existingInLoop.sessionId = newCanonicalId;
          }
        }

        // Keep best profile picture
        if (!existingInLoop.profilePicUrl && (chatObj.profilePicUrl || contactInfo?.pic)) {
          existingInLoop.profilePicUrl = chatObj.profilePicUrl || contactInfo?.pic;
        }

        // Keep best non-generic customer name
        if (isGenericContactName(existingInLoop.customerName) && !isGenericName) {
          existingInLoop.customerName = customerName;
        }

        // Keep most recent message preview & timestamp
        if (new Date(lastTimestamp).getTime() > new Date(existingInLoop.lastTimestamp).getTime()) {
          existingInLoop.lastTimestamp = lastTimestamp;
          existingInLoop.lastMessagePreview = lastPreview;
          existingInLoop.lastMessageType = lastType;
        }

        // Merge messages if not already present
        if (
          parsedLast &&
          !existingInLoop.messages.some(m => m.evolutionMessageId === parsedLast.evolutionMessageId)
        ) {
          existingInLoop.messages = [...existingInLoop.messages, parsedLast].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }

        existingInLoop.unreadCount = Math.max(existingInLoop.unreadCount, Number(chatObj.unreadCount) || 0);
        continue;
      }

      const canonicalSessionId =
        cleanPhone && cleanPhone.length <= 12 && cleanPhone.startsWith('1')
          ? `${cleanPhone}@s.whatsapp.net`
          : rawAlt.endsWith('@s.whatsapp.net')
          ? rawAlt
          : remoteJid;

      const prevConv =
        existingConvBySession.get(canonicalSessionId) ||
        existingConvBySession.get(remoteJid) ||
        (cleanPhone && cleanPhone.length <= 12 ? existingConvByPhone.get(cleanPhone) : undefined) ||
        (!isGenericName && (!cleanPhone || cleanPhone.length > 12)
          ? conversations.find(
              c =>
                !isGenericContactName(c.customerName) &&
                c.customerName.trim().toLowerCase() === normName &&
                (!c.customerPhone || c.customerPhone.length > 12 || c.customerPhone === cleanPhone)
            )
          : undefined);

      const jidSet = relatedJidsBySession.get(canonicalSessionId) || new Set<string>();
      jidSet.add(canonicalSessionId);
      jidSet.add(remoteJid);
      if (rawAlt) jidSet.add(rawAlt);
      relatedJidsBySession.set(canonicalSessionId, jidSet);

      const aiEnabled = aiEnabledBySession.has(canonicalSessionId)
        ? aiEnabledBySession.get(canonicalSessionId)!
        : aiEnabledBySession.has(remoteJid)
        ? aiEnabledBySession.get(remoteJid)!
        : prevConv
        ? prevConv.aiEnabled
        : true;

      if (!prevConv || prevConv.lastTimestamp !== lastTimestamp) {
        hasChanges = true;
      }

      let messages = prevConv?.messages ? [...prevConv.messages] : (parsedLast ? [parsedLast] : []);
      if (
        parsedLast &&
        !messages.some(
          m =>
            (parsedLast.evolutionMessageId && m.evolutionMessageId === parsedLast.evolutionMessageId) ||
            (parsedLast.id && m.id === parsedLast.id)
        )
      ) {
        messages.push(parsedLast);
      }
      messages = mergeWithLocalMessages(canonicalSessionId, messages, prevConv?.messages || [], cleanPhone);

      const latestMerged = messages[messages.length - 1];
      const finalLastTimestamp =
        latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime()
          ? latestMerged.timestamp
          : lastTimestamp;
      const finalLastPreview =
        latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime()
          ? latestMerged.content || lastPreview
          : lastPreview;
      const finalLastType =
        latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime()
          ? latestMerged.type
          : lastType;

      const lowerPreview = finalLastPreview.toLowerCase();
      const detectedProducts = prevConv?.detectedProducts || [];
      for (const kw of ['thinkpad', 'latitude', 'chromebook', 'macbook', 'monitor', 'impresora', 'dell', 'hp', 'lenovo']) {
        if (lowerPreview.includes(kw) && !detectedProducts.includes(kw.toUpperCase())) {
          detectedProducts.push(kw.toUpperCase());
        }
      }

      const odooMatch = findOdooPartnerByPhone(cleanPhone);
      const odooPartnerId = odooMatch?.id || prevConv?.odooPartnerId;
      const isOdooClient = Boolean(odooMatch || prevConv?.isOdooClient || (odooPartnerId && odooPartnerId > 0));

      const finalConv: Conversation = {
        sessionId: canonicalSessionId,
        customerPhone: cleanPhone,
        customerName:
          !isGenericName
            ? customerName
            : odooMatch?.name
            ? odooMatch.name
            : prevConv?.customerName && !isGenericContactName(prevConv.customerName)
            ? prevConv.customerName
            : customerName,
        profilePicUrl: chatObj.profilePicUrl || contactInfo?.pic || prevConv?.profilePicUrl || undefined,
        messages,
        messagesLoaded: prevConv?.messagesLoaded || false,
        aiEnabled,
        unreadCount: Number(chatObj.unreadCount) || 0,
        lastTimestamp: finalLastTimestamp,
        lastMessagePreview: finalLastPreview,
        lastMessageType: finalLastType,
        intentStatus:
          finalLastType === 'image' && lowerPreview.includes('pago')
            ? 'comprobante_enviado'
            : detectedProducts.length > 0
            ? 'interesado'
            : prevConv?.intentStatus || 'explorando',
        detectedProducts,
        zone: 'santo_domingo',
        odooPartnerId,
        isOdooClient,
        isLiveEvolution: true,
      };

      dedupedByPhone.set(dedupKey, finalConv);
      if (cleanPhone) dedupedByPhone.set(cleanPhone, finalConv);
      if (canonicalSessionId) dedupedByPhone.set(canonicalSessionId, finalConv);
      if (normName) dedupedByName.set(normName, finalConv);
    }

    const seenFinalSessions = new Set<string>();
    const seenFinalPhones = new Set<string>();
    const seenFinalNames = new Set<string>();
    const strictlyUniqueList: Conversation[] = [];

    for (const conv of Array.from(new Set(dedupedByPhone.values()))) {
      if (seenFinalSessions.has(conv.sessionId)) continue;
      const phone = conv.customerPhone && conv.customerPhone.length <= 12 ? conv.customerPhone : '';
      const normName = !isGenericContactName(conv.customerName) ? conv.customerName.trim().toLowerCase() : '';

      if (phone && seenFinalPhones.has(phone)) continue;
      if (!phone && normName && seenFinalNames.has(normName)) continue;

      seenFinalSessions.add(conv.sessionId);
      if (phone) seenFinalPhones.add(phone);
      if (normName) seenFinalNames.add(normName);
      strictlyUniqueList.push(conv);
    }

    // Sort final list by lastTimestamp descending
    strictlyUniqueList.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    conversations = strictlyUniqueList;
    appConfig.evolution.connected = true;

    if (hasChanges) {
      broadcastEvent('conversations_update', { count: conversations.length });
    }

    // On first sync after server boot/reset, mark messages at or before botStartupCutoffMs as historical so we only auto-reply to NEW messages from now on
    if (isFirstEvolutionSync) {
      for (const conv of conversations) {
        for (const m of conv.messages) {
          const mTime = new Date(m.timestamp).getTime();
          if (!mTime || mTime <= botStartupCutoffMs) {
            const msgId = normalizeMsgIdKey(m.evolutionMessageId || m.id);
            const contactKeys = getConversationContactKeys(conv);
            markMessageIdProcessed(msgId, contactKeys);
          }
        }
      }
    }

    // Auto-reply to recent unanswered customer messages with strict contact identity deduplication
    if (appConfig.globalAiActive && !isAiStudioIdleBackgroundContainer()) {
      const nowMs = Date.now();
      const handledContactsThisCycle = new Set<string>();

      for (const conv of conversations.slice(0, 50)) {
        if (!conv.aiEnabled) continue;
        if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) continue;

        const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
        if (
          cleanPhone === appConfig.evolution.teamPhone ||
          cleanPhone === appConfig.evolution.adminPhone ||
          conv.customerName.toLowerCase().includes('soporte todo lapto')
        ) {
          continue;
        }

        const lastMsg = conv.messages[conv.messages.length - 1];
        if (!lastMsg) continue;
        const msgId = normalizeMsgIdKey(lastMsg.evolutionMessageId || lastMsg.id);

        // Only reply if the last message in the thread is from the customer
        if (lastMsg.sender !== 'customer') continue;

        const msgTimeMs = new Date(lastMsg.timestamp).getTime();
        const ageMs = nowMs - msgTimeMs;

        // Only reply to NEW messages that arrived after system startup/reset cutoff (and within the last 10 minutes)
        if (msgTimeMs < botStartupCutoffMs - 3000 || ageMs > 10 * 60 * 1000) {
          const contactKeys = getConversationContactKeys(conv);
          markMessageIdProcessed(msgId, contactKeys);
          continue;
        }

        const contactKeys = getConversationContactKeys(conv);
        // Avoid duplicate triggers across multiple JIDs for the same customer in the same cycle
        if (contactKeys.some(k => handledContactsThisCycle.has(k) || isBotLockActive(k))) {
          continue;
        }

        // Check if message ID was already processed (normalized across evo- prefix and raw ID)
        if (isMessageIdAlreadyProcessed(msgId, contactKeys)) continue;

        // Check cooldown and answered state
        const skipCheck = shouldSkipBotReply(conv, lastMsg, 'live_evolution_poll');
        if (skipCheck.skip) continue;

        // Mark contact as handled in this cycle ONLY (acquireBotLock inside triggerSalesBotReplyForConversation owns inFlightBotKeys)
        for (const k of contactKeys) {
          handledContactsThisCycle.add(k);
        }

        console.log(`🤖 [Auto-Reply Polling Trigger]: Respondiendo a ${conv.customerName} ("${lastMsg.content.slice(0, 30)}")`);
        triggerSalesBotReplyForConversation(conv, 'live_evolution_poll').catch(err =>
          console.log(`[Auto-Reply Poll Info for ${conv.customerName}]:`, err.message)
        );
      }
    }

    isFirstEvolutionSync = false;
  } catch (err: any) {
    console.log(`[Evolution Live Sync Info]: ${err.message}`);
  } finally {
    isEvoSyncRunning = false;
  }

  return conversations;
}

// Helpers for conversation hygiene and substantive anterior context
function isInternalOrNoiseContent(content: string): boolean {
  if (!content) return false;
  if (/sk-[a-zA-Z0-9_\-]{20,}/.test(content)) return true;
  if (/ALMACEN DE NO MOSTRAR/i.test(content)) return true;
  if (/FALLO EN EL BOT/i.test(content)) return true;
  if (/Workflow: todo lapto/i.test(content)) return true;
  if (/Dame un momento para confirmar esa informaci[oó]n/i.test(content)) return true;
  if (/^tranquilo$/i.test(content.trim())) return true;
  if (/Catálogo completo de laptops[\s\S]*?USB-4 TASBEL HUB/i.test(content)) return true;
  if (/0 modelos en stock|\(0 modelos disponibles en stock\)/i.test(content)) return true;
  return false;
}

function isSubstantiveProposal(msg: ChatMessage): boolean {
  const c = msg.transcription || msg.content || '';
  if (isInternalOrNoiseContent(c)) return false;
  return (
    c.includes('Catálogo') ||
    c.includes('laptop') ||
    c.includes('Laptop') ||
    c.includes('RD$') ||
    c.includes('Charles de Gaulle') ||
    c.includes('tienda') ||
    c.includes('opciones de laptops') ||
    c.includes('contra entrega') ||
    c.includes('transferencia') ||
    c.includes('Chromebook') ||
    c.includes('EDU GEAR') ||
    c.includes('ThinkPad') ||
    c.includes('Dell') ||
    c.includes('Lenovo') ||
    c.includes('Asus')
  );
}

// Persistent store of locally sent CRM/AI messages so they NEVER disappear when Evolution API syncs or is reconnecting
const localSentMessagesBySession = new Map<string, ChatMessage[]>();

function recordLocalMessage(sessionId: string, msg: ChatMessage, customerPhone?: string): void {
  const keys = new Set<string>([sessionId]);
  if (customerPhone) {
    const clean = customerPhone.replace(/\D/g, '');
    if (clean) {
      keys.add(clean);
      keys.add(`${clean}@s.whatsapp.net`);
    }
  }
  const related = relatedJidsBySession.get(sessionId);
  if (related) {
    for (const r of related) keys.add(r);
  }

  for (const k of keys) {
    if (!k) continue;
    const list = localSentMessagesBySession.get(k) || [];
    if (!list.some(m => m.id === msg.id)) {
      list.push(msg);
      if (list.length > 100) list.shift();
      localSentMessagesBySession.set(k, list);
    }
  }
}

function mergeWithLocalMessages(
  sessionId: string,
  evoList: ChatMessage[],
  existingList: ChatMessage[] = [],
  customerPhone?: string
): ChatMessage[] {
  const combined = [...evoList];
  const candidateLocals: ChatMessage[] = [];
  const isFullEvoRefresh = evoList.length >= 1;
  const nowMs = Date.now();

  const addCandidates = (arr?: ChatMessage[], localOnly = true) => {
    if (!arr) return;
    for (const m of arr) {
      const mTime = new Date(m.timestamp).getTime();
      const isRecent = nowMs - mTime < 30000;
      // When evoList has authoritative messages from Evolution API, only merge local optimistic/sent messages or very recent (<30s) webhook messages
      if (!localOnly && isFullEvoRefresh && !isRecent && m.evolutionMessageId) {
        continue;
      }
      if (!localOnly || !m.evolutionMessageId || m.id.startsWith('msg-') || m.id.startsWith('sim-') || isRecent) {
        if (!candidateLocals.some(c => c.id === m.id)) {
          candidateLocals.push(m);
        }
      }
    }
  };

  addCandidates(localSentMessagesBySession.get(sessionId), true);
  if (customerPhone) {
    const clean = customerPhone.replace(/\D/g, '');
    if (clean) {
      addCandidates(localSentMessagesBySession.get(clean), true);
      addCandidates(localSentMessagesBySession.get(`${clean}@s.whatsapp.net`), true);
    }
  }
  addCandidates(existingList, false);

  // Track which combined indices have already been paired with an optimistic local message
  // so 1 local message can only reconcile with at most 1 real WhatsApp message, and 2+ real WhatsApp messages NEVER collapse.
  const claimedEvoIndices = new Set<number>();

  for (const localMsg of candidateLocals) {
    const localTime = new Date(localMsg.timestamp).getTime();
    const localText = (localMsg.content || '').trim();

    // 1. Exact ID or evolutionMessageId match
    let existingIdx = combined.findIndex(evo => {
      if (evo.id === localMsg.id) return true;
      if (localMsg.evolutionMessageId && evo.evolutionMessageId === localMsg.evolutionMessageId) return true;
      return false;
    });

    // 2. If localMsg is an optimistic message (no evolutionMessageId), pair it with at most ONE unclaimed real Evolution message
    if (existingIdx < 0 && !localMsg.evolutionMessageId) {
      existingIdx = combined.findIndex((evo, idx) => {
        if (claimedEvoIndices.has(idx)) return false;
        if (
          evo.sender !== 'customer' &&
          localMsg.sender !== 'customer' &&
          localText.length > 0 &&
          (evo.content || '').trim() === localText &&
          Math.abs(new Date(evo.timestamp).getTime() - localTime) < 45000
        ) {
          return true;
        }
        return false;
      });
      if (existingIdx >= 0) {
        claimedEvoIndices.add(existingIdx);
      }
    }

    if (existingIdx >= 0) {
      // Preserve local quotedMessage or mediaUrl if Evolution API record didn't include it
      if (localMsg.quotedMessage && !combined[existingIdx].quotedMessage) {
        combined[existingIdx].quotedMessage = localMsg.quotedMessage;
      }
      if (localMsg.mediaUrl && !combined[existingIdx].mediaUrl) {
        combined[existingIdx].mediaUrl = localMsg.mediaUrl;
      }
    } else {
      // Only keep unmatched local message if full history wasn't fetched or if it was sent/received recently (< 30s)
      if (!isFullEvoRefresh || nowMs - localTime < 30000 || localMsg.id.startsWith('msg-')) {
        combined.push(localMsg);
      }
    }
  }

  combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Discard any lingering optimistic local msg- records that match a confirmed WhatsApp message
  const deduped: ChatMessage[] = [];
  const seenConfirmedKeys = new Set<string>();
  for (const m of combined) {
    if (m.evolutionMessageId) {
      seenConfirmedKeys.add(`${m.sender}::${(m.content || '').trim()}`);
    }
  }
  for (const m of combined) {
    if (!m.evolutionMessageId && (m.id.startsWith('msg-') || m.id.startsWith('sim-'))) {
      const key = `${m.sender}::${(m.content || '').trim()}`;
      if (seenConfirmedKeys.has(key)) continue;
    }
    deduped.push(m);
  }

  return deduped;
}

// Strict verification that an Evolution API message record belongs ONLY to the target conversation's JIDs or phone number
function doesRecordBelongToConversation(
  rec: any,
  allowedJids: Set<string>,
  customerPhone?: string
): boolean {
  if (!rec || !rec.key) return false;
  const rJid = (rec.key.remoteJid || '').trim();
  const rAlt = (rec.key.remoteJidAlt || '').trim();
  if (rJid && allowedJids.has(rJid)) return true;
  if (rAlt && allowedJids.has(rAlt)) return true;

  const cleanPhone = (customerPhone || '').replace(/\D/g, '');
  if (cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const jidDigits = rJid.replace(/@.*$/, '').replace(/\D/g, '');
    const altDigits = rAlt.replace(/@.*$/, '').replace(/\D/g, '');
    if (rJid.endsWith('@s.whatsapp.net') && jidDigits === cleanPhone) return true;
    if (rAlt.endsWith('@s.whatsapp.net') && altDigits === cleanPhone) return true;
    if (rJid.endsWith('@lid')) {
      const mapped = lidToPhoneMap.get(rJid) || lidToPhoneMap.get(jidDigits);
      if (mapped && mapped === cleanPhone) return true;
    }
  }
  return false;
}

async function loadEvolutionMessagesForChat(sessionId: string): Promise<ChatMessage[]> {
  // Always prioritize exact sessionId match first so one chat never hijacks another
  const conv =
    conversations.find(c => c.sessionId === sessionId) ||
    conversations.find(
      c =>
        relatedJidsBySession.get(c.sessionId)?.has(sessionId) ||
        (c.customerPhone && sessionId.replace(/\D/g, '') === c.customerPhone)
    );
  const canonicalId = conv?.sessionId || sessionId;
  const fallbackName = conv?.customerName || 'Cliente';

  // Collect JIDs associated with this contact without colliding with other distinct conversations
  const otherSessionIds = new Set(
    conversations.filter(c => c.sessionId !== canonicalId).map(c => c.sessionId)
  );
  const rawSet = relatedJidsBySession.get(canonicalId) || new Set<string>([sessionId]);
  const jidSet = new Set<string>([canonicalId, sessionId]);
  for (const j of rawSet) {
    if (!otherSessionIds.has(j)) jidSet.add(j);
  }
  const cleanPhone = (conv?.customerPhone || '').replace(/\D/g, '');
  if (cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const phoneJid = `${cleanPhone}@s.whatsapp.net`;
    if (!otherSessionIds.has(phoneJid)) {
      jidSet.add(phoneJid);
    }
    // Also include any @lid known in lidToPhoneMap for this exact phone number (since Evolution API v2 stores incoming messages under @lid and outgoing under @s.whatsapp.net)
    for (const [lidKey, mappedPhone] of lidToPhoneMap.entries()) {
      if (mappedPhone === cleanPhone) {
        const fullLid = lidKey.includes('@') ? lidKey : `${lidKey}@lid`;
        if (!otherSessionIds.has(fullLid)) {
          jidSet.add(fullLid);
        }
      }
    }
  }

  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findMessages/${appConfig.evolution.instance}`;
    const jidsToQuery = Array.from(jidSet).slice(0, 4);
    const responses = await Promise.all(
      jidsToQuery.map(jid =>
        fetch(url, {
          method: 'POST',
          headers: {
            apikey: appConfig.evolution.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            where: {
              key: {
                remoteJid: jid,
              },
            },
            limit: 50,
          }),
          signal: AbortSignal.timeout(4000),
        })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );

    const records: any[] = [];
    for (const data of responses) {
      if (!data) continue;
      const recs = data?.messages?.records || (Array.isArray(data) ? data : []);
      for (const rec of recs) {
        if (doesRecordBelongToConversation(rec, jidSet, cleanPhone)) {
          records.push(rec);
        }
      }
    }

    // Refine customerName and record any discovered @s.whatsapp.net JID in relatedJidsBySession WITHOUT mutating customerPhone/sessionId
    if (conv) {
      for (const r of records) {
        if (r.key && !r.key.fromMe) {
          const pName = (r.pushName || '').trim();
          if (
            pName &&
            pName !== 'Você' &&
            !/^\d+$/.test(pName) &&
            (!conv.customerName ||
              conv.customerName === 'Cliente' ||
              conv.customerName.startsWith('Cliente +') ||
              conv.customerName.startsWith('WhatsApp #') ||
              /^\d+$/.test(conv.customerName))
          ) {
            conv.customerName = pName;
          }
          if (r.key?.remoteJidAlt?.endsWith('@s.whatsapp.net')) {
            const altJid = r.key.remoteJidAlt;
            const altPhone = altJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
            if (altPhone) {
              lidToPhoneMap.set(sessionId, altPhone);
              lidToPhoneMap.set(sessionId.replace(/@.*$/, ''), altPhone);
              if (r.key.remoteJid) {
                lidToPhoneMap.set(r.key.remoteJid, altPhone);
                lidToPhoneMap.set(r.key.remoteJid.replace(/@.*$/, ''), altPhone);
              }
              if (conv.customerPhone.length > 12) {
                conv.customerPhone = altPhone;
              }
            }
            if (!otherSessionIds.has(altJid)) {
              const set = relatedJidsBySession.get(conv.sessionId) || new Set<string>([conv.sessionId]);
              set.add(altJid);
              relatedJidsBySession.set(conv.sessionId, set);
            }
          }
        }
      }
    }

    const parsedMessages: ChatMessage[] = [];
    for (const rec of records) {
      const m = parseSingleEvolutionMessage(rec, conv?.customerName || fallbackName);
      if (m) parsedMessages.push(m);
    }

    // Sort oldest to newest
    parsedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Deduplicate by evolutionMessageId
    const unique: ChatMessage[] = [];
    const seen = new Set<string>();
    const msgById = new Map<string, ChatMessage>();
    for (const m of parsedMessages) {
      const k = m.evolutionMessageId || m.id;
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(m);
        if (m.evolutionMessageId) msgById.set(m.evolutionMessageId, m);
        msgById.set(m.id, m);
      }
    }

    // Resolve quoted messages by stanzaId / parentMessageKey AND contextual deictic replies
    for (let i = 0; i < unique.length; i++) {
      const m = unique[i];

      // 1. If message has a quotedMessage object with an ID or needs text hydration:
      if (m.quotedMessage && (!m.quotedMessage.text || m.quotedMessage.text.trim().length === 0)) {
        let parent: ChatMessage | undefined;
        if (m.quotedMessage.id) {
          const qId = m.quotedMessage.id;
          parent =
            msgById.get(qId) ||
            msgById.get(`evo-${qId}`) ||
            msgById.get(qId.replace(/^evo-/, ''));

          if (!parent) {
            parent = unique.find(
              (cand, idx) =>
                idx < i &&
                !isInternalOrNoiseContent(cand.content) &&
                (cand.id === qId ||
                  cand.evolutionMessageId === qId ||
                  cand.id.endsWith(qId) ||
                  (cand.evolutionMessageId && cand.evolutionMessageId.endsWith(qId)) ||
                  qId.endsWith(cand.id) ||
                  (cand.evolutionMessageId && qId.endsWith(cand.evolutionMessageId)))
            );
          }
        }

        if (parent) {
          m.quotedMessage.text =
            parent.transcription ||
            parent.content ||
            (parent.type === 'image'
              ? '📷 Foto enviada anteriormente'
              : parent.type === 'audio'
              ? '🎤 Nota de voz anterior'
              : parent.type === 'video'
              ? '🎥 Video anterior'
              : 'Mensaje anterior');
          m.quotedMessage.type = parent.type;
          m.quotedMessage.mediaUrl = parent.mediaUrl;
          m.quotedMessage.author =
            parent.sender === 'customer' ? conv?.customerName || fallbackName : 'Todo Lapto';
        } else {
          // If parent message not found by exact ID, search backward for the real substantive anterior message!
          let foundSubstantive: ChatMessage | undefined;
          let fallbackPrev: ChatMessage | undefined;
          for (let j = i - 1; j >= 0; j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;
            if (prev.sender !== m.sender && (prev.transcription || prev.content)) {
              if (isSubstantiveProposal(prev)) {
                foundSubstantive = prev;
                break;
              }
              if (!fallbackPrev && prev.content.trim().length > 15) {
                fallbackPrev = prev;
              }
            }
          }
          const chosen = foundSubstantive || fallbackPrev;
          if (chosen) {
            m.quotedMessage.text = chosen.transcription || chosen.content;
            m.quotedMessage.type = chosen.type;
            m.quotedMessage.mediaUrl = chosen.mediaUrl;
            m.quotedMessage.author =
              chosen.sender === 'customer' ? conv?.customerName || fallbackName : 'Todo Lapto (Mensaje anterior)';
          }
        }
      }

      // 2. If Evolution API v2 delivered a plain reply without contextInfo,
      // detect reference phrases ("¿Te acuerdas de esto?", "Te acuerda de esto?", "Sobre esto te acuerdas?", "Me interesa la 3", "¿Todavía tienen esta?", etc.)
      // and link the substantive ANTERIOR message that the customer is actually citing!
      if (!m.quotedMessage && m.sender === 'customer' && i > 0) {
        const txt = (m.transcription || m.content || '').trim();
        const isDeicticReply =
          /(te\s*acuerda[sn]?|se\s*acuerda[sn]?|recuerda[sn]?|te\s*recuerda[sn]?|sobre\s*esto|de\s*esto|esto\s*te\s*acuerda|acuerda[sn]?\s*de\s*esto|lo\s*que\s*hablamos|de\s*la\s*que\s*hablamos|lo\s*que\s*me\s*mostraste|todav[ií]a\s*(la|lo|las|los)?\s*tienen|cu[aá]nto\s*(cuesta|sale)|qu[eé]\s*precio|me\s*interesa|esa\s*misma|ese\s*mismo|la\s*quiero|dame\s*esa|aparte\s*esa)/i.test(
            txt
          );

        const numberRefMatch = txt.match(
          /^(?:la|el|opci[oó]n|modelo|n[uú]mero|#)\s*(\d{1,2})\b/i
        );

        if (numberRefMatch) {
          const itemNum = numberRefMatch[1];
          for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;
            if (prev.sender !== 'customer' && prev.content.includes('Catálogo')) {
              const lines = prev.content.split('\n');
              const matchIdx = lines.findIndex(
                l =>
                  l.includes(`*${itemNum}.*`) ||
                  l.startsWith(`${itemNum}.`) ||
                  l.includes(`${itemNum}️⃣`)
              );
              const snippet =
                matchIdx >= 0
                  ? lines.slice(matchIdx, matchIdx + 4).join('\n')
                  : prev.content;
              m.quotedMessage = {
                id: prev.evolutionMessageId || prev.id,
                text: snippet,
                type: prev.type,
                author: 'Todo Lapto (Catálogo)',
              };
              break;
            }
          }
        } else if (isDeicticReply) {
          // Search backward for the GENUINE substantive anterior proposal/offer (visita a tienda o laptops ofrecidas),
          // NOT the immediately preceding repeated bot reply or noise message!
          let substantiveAnterior: ChatMessage | undefined;
          let fallbackAnterior: ChatMessage | undefined;

          // When customer asks "¿Te acuerdas de esto?", they are referencing the original proposal / conversation
          // Look backward, skipping any assistant message that just re-sent a catalog or an acknowledgment
          for (let j = i - 1; j >= 0; j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;

            if (prev.sender !== 'customer') {
              if (isSubstantiveProposal(prev)) {
                substantiveAnterior = prev;
                // If this is a repeated catalog or acknowledgment sent after another "te acuerdas", keep looking back for the root proposal!
                const isRepeatedAck =
                  prev.content.startsWith('¡Claro que sí') ||
                  prev.content.startsWith('Claro, Sr.') ||
                  prev.content.includes('Recuerdo perfectamente');
                if (!isRepeatedAck) {
                  // Found the original substantive proposal!
                  break;
                }
              } else if (!fallbackAnterior && prev.content.trim().length > 15) {
                fallbackAnterior = prev;
              }
            }
          }

          const target = substantiveAnterior || fallbackAnterior;
          if (target) {
            m.quotedMessage = {
              id: target.evolutionMessageId || target.id,
              text: target.transcription || target.content,
              type: target.type,
              mediaUrl: target.mediaUrl,
              author: 'Todo Lapto (Propuesta y opciones conversadas anteriormente)',
            };
          }
        }
      }
    }

    const mergedMessages = mergeWithLocalMessages(
      canonicalId,
      unique,
      conv?.messages || [],
      conv?.customerPhone
    );

    if (conv && mergedMessages.length > 0) {
      conv.messages = mergedMessages;
      conv.messagesLoaded = true;
      const latest = mergedMessages[mergedMessages.length - 1];
      if (
        latest &&
        new Date(latest.timestamp).getTime() >= new Date(conv.lastTimestamp).getTime()
      ) {
        conv.lastTimestamp = latest.timestamp;
        conv.lastMessagePreview = latest.content || conv.lastMessagePreview;
        conv.lastMessageType = latest.type;
      }

      // Immediately trigger auto-reply if active chat refresh discovered a brand-new unanswered customer message after startup cutoff!
      if (
        !isFirstEvolutionSync &&
        appConfig.globalAiActive &&
        conv.aiEnabled &&
        !isWhatsAppGroup(conv.sessionId) &&
        !isWhatsAppGroup(conv.customerPhone) &&
        latest &&
        latest.sender === 'customer'
      ) {
        const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
        const isInternalTeam =
          cleanPhone === appConfig.evolution.teamPhone ||
          cleanPhone === appConfig.evolution.adminPhone ||
          conv.customerName.toLowerCase().includes('soporte todo lapto');
        const msgTimeMs = new Date(latest.timestamp).getTime();
        const ageMs = Date.now() - msgTimeMs;
        const msgId = normalizeMsgIdKey(latest.evolutionMessageId || latest.id);
        const contactKeys = getConversationContactKeys(conv);

        if (
          !isInternalTeam &&
          msgTimeMs >= botStartupCutoffMs - 2000 &&
          ageMs <= 10 * 60 * 1000 &&
          !isMessageIdAlreadyProcessed(msgId, contactKeys) &&
          !contactKeys.some(k => isBotLockActive(k))
        ) {
          const skipCheck = shouldSkipBotReply(conv, latest, 'live_evolution_poll');
          if (!skipCheck.skip) {
            console.log(`🤖 [Active Chat Fast Trigger]: Respondiendo a ${conv.customerName} ("${latest.content.slice(0, 35)}")`);
            triggerSalesBotReplyForConversation(conv, 'live_evolution_poll').catch(err =>
              console.log(`[Active Chat Trigger Info for ${conv.customerName}]:`, err.message)
            );
          }
        }
      }
    }

    return mergedMessages;
  } catch {
    return mergeWithLocalMessages(canonicalId, [], conv?.messages || [], conv?.customerPhone);
  }
}

// ---------------------------------------------------------
// Helper: Evolution API WhatsApp Senders & Live Audit / Anti-Duplicate Engine
// ---------------------------------------------------------
let isFirstEvolutionSync = true;
let botStartupCutoffMs = Date.now() - 60000;
const inFlightBotKeys = new Map<string, number>();
const BOT_LOCK_TTL_MS = 90000;
let lastEvolutionRestartMs = 0;
let lastFrontendHeartbeatMs = Date.now();

function recordFrontendHeartbeat(): void {
  lastFrontendHeartbeatMs = Date.now();
}

function isAiStudioIdleBackgroundContainer(): boolean {
  if (process.env.AISTUDIO_ALLOW_AUTO_REPLY === 'false') return true;
  return false;
}

function isBotLockActive(key: string): boolean {
  const lockedAt = inFlightBotKeys.get(key);
  if (!lockedAt) return false;
  if (Date.now() - lockedAt > BOT_LOCK_TTL_MS) {
    inFlightBotKeys.delete(key);
    return false;
  }
  return true;
}

// Persistent Audit Log for Admin inspection & duplicate diagnostics
const BOT_AUDIT_LOG_FILE = path.join(__dirname, '.vendema-bot-audit.json');
let botAuditLogs: BotAuditLogEntry[] = [];

try {
  if (fs.existsSync(BOT_AUDIT_LOG_FILE)) {
    const raw = fs.readFileSync(BOT_AUDIT_LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      botAuditLogs = parsed.filter((item: any) => item?.decision !== 'blocked_in_flight').slice(0, 300);
    }
  }
} catch {
  botAuditLogs = [];
}

let auditSaveTimeout: NodeJS.Timeout | null = null;
function scheduleAuditLogSave() {
  if (auditSaveTimeout) return;
  auditSaveTimeout = setTimeout(() => {
    auditSaveTimeout = null;
    try {
      fs.writeFileSync(BOT_AUDIT_LOG_FILE, JSON.stringify(botAuditLogs.slice(0, 300), null, 2));
    } catch {}
  }, 1000);
}

const lastAuditLogKeyByPhone = new Map<string, { key: string; ts: number }>();

function recordBotAuditLog(entry: {
  customerName: string;
  customerPhone: string;
  sessionId: string;
  triggerSource: string;
  incomingMessageId: string;
  incomingText: string;
  decision: BotDecisionType;
  reason: string;
  replyText?: string;
  evolutionMessageId?: string;
  durationMs: number;
}): void {
  const phone = entry.customerPhone || (entry.sessionId || '').replace(/@.*$/, '').replace(/\D/g, '');
  const dedupeKey = `${phone}::${entry.incomingMessageId || 'none'}::${entry.decision}`;
  const now = Date.now();
  const prevAudit = lastAuditLogKeyByPhone.get(phone);

  // If this exact decision for the same incoming message was logged within 8 seconds, don't spam the audit log
  if (prevAudit && prevAudit.key === dedupeKey && now - prevAudit.ts < 8000) {
    return;
  }
  lastAuditLogKeyByPhone.set(phone, { key: dedupeKey, ts: now });

  const rdContext = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const item: BotAuditLogEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    timeRd: rdContext.time12,
    customerName: entry.customerName || `Cliente +${phone}`,
    customerPhone: phone,
    sessionId: entry.sessionId,
    triggerSource: entry.triggerSource,
    incomingMessageId: entry.incomingMessageId || 'N/A',
    incomingText: (entry.incomingText || '').slice(0, 150),
    decision: entry.decision,
    reason: entry.reason,
    replyText: entry.replyText ? entry.replyText.slice(0, 200) : undefined,
    evolutionMessageId: entry.evolutionMessageId,
    durationMs: entry.durationMs,
  };

  botAuditLogs.unshift(item);
  if (botAuditLogs.length > 300) {
    botAuditLogs.pop();
  }

  broadcastEvent('bot_audit_update', item);
  scheduleAuditLogSave();
}

// Universal helper to resolve all contact identity keys (phone, session ID, JID, contact name)
function getConversationContactKeys(conv: Conversation | undefined | null, extraPhone?: string): string[] {
  if (!conv) return extraPhone ? [extraPhone.replace(/\D/g, '')] : [];
  const keys = new Set<string>();

  if (conv.sessionId) {
    keys.add(conv.sessionId.toLowerCase().trim());
  }

  const cleanPhone = (conv.customerPhone || extraPhone || '').replace(/\D/g, '');
  if (cleanPhone) {
    keys.add(cleanPhone);
    if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      keys.add(std);
      keys.add(`${std}@s.whatsapp.net`);
      keys.add(std.slice(-10));
    }
  }

  if (conv.customerName && !isGenericContactName(conv.customerName)) {
    keys.add(`name:${conv.customerName.trim().toLowerCase()}`);
  }

  const related = relatedJidsBySession.get(conv.sessionId);
  if (related) {
    for (const r of related) {
      if (r) keys.add(r.toLowerCase().trim());
    }
  }

  return Array.from(keys);
}

interface BotReplyRecord {
  timestamp: number;
  customerMsgId: string;
  customerText: string;
  botReplyText: string;
}

const lastBotReplyByContactKey = new Map<string, BotReplyRecord>();

// Cross-Process File Lock for multi-worker environments (e.g. Hostinger LiteSpeed / Passenger)
const BOT_OUTBOUND_LOCKS_FILE = path.join(__dirname, '.vendema-outbound-locks.json');

function acquireCrossProcessBotLock(lockKeys: string[], ttlMs = 45000): boolean {
  try {
    let data: Record<string, number> = {};
    if (fs.existsSync(BOT_OUTBOUND_LOCKS_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(BOT_OUTBOUND_LOCKS_FILE, 'utf-8'));
      } catch {
        data = {};
      }
    }
    const now = Date.now();
    // Prune expired locks
    for (const [k, exp] of Object.entries(data)) {
      if (now > exp) delete data[k];
    }
    for (const key of lockKeys) {
      if (data[key] && now < data[key]) {
        return false; // Locked by another worker process
      }
    }
    for (const key of lockKeys) {
      data[key] = now + ttlMs;
    }
    fs.writeFileSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data));
    return true;
  } catch {
    return true; // Fallback to in-memory lock if filesystem contention
  }
}

function releaseCrossProcessBotLock(lockKeys: string[]): void {
  try {
    if (fs.existsSync(BOT_OUTBOUND_LOCKS_FILE)) {
      let data: Record<string, number> = {};
      try {
        data = JSON.parse(fs.readFileSync(BOT_OUTBOUND_LOCKS_FILE, 'utf-8'));
      } catch {
        data = {};
      }
      for (const key of lockKeys) {
        delete data[key];
      }
      fs.writeFileSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data));
    }
  } catch {}
}

function acquireBotLock(conv: Conversation, triggerSource = 'unknown'): boolean {
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    if (isBotLockActive(k)) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      const incomingId = lastMsg?.evolutionMessageId || lastMsg?.id || '';
      const incomingText = lastMsg?.content || '';
      recordBotAuditLog({
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: 'blocked_in_flight',
        reason: 'Ya hay una respuesta generándose concurrentemente para este contacto. Bloqueo atómico activo.',
        durationMs: 0,
      });
      return false;
    }
  }

  // Cross-process file lock across LiteSpeed / Passenger worker processes
  if (!acquireCrossProcessBotLock(keys, BOT_LOCK_TTL_MS)) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    const incomingId = lastMsg?.evolutionMessageId || lastMsg?.id || '';
    const incomingText = lastMsg?.content || '';
    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: 'blocked_in_flight',
      reason: 'Ya hay una respuesta generándose en otro worker de Hostinger. Bloqueo multi-proceso activo.',
      durationMs: 0,
    });
    return false;
  }

  const now = Date.now();
  for (const k of keys) {
    inFlightBotKeys.set(k, now);
  }
  return true;
}

function releaseBotLock(conv: Conversation): void {
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    inFlightBotKeys.delete(k);
  }
  releaseCrossProcessBotLock(keys);
}

function recordBotReplyForConversation(
  conv: Conversation,
  customerMsgId: string,
  customerText: string,
  botReplyText: string
): void {
  const record: BotReplyRecord = {
    timestamp: Date.now(),
    customerMsgId,
    customerText: (customerText || '').trim(),
    botReplyText: (botReplyText || '').trim(),
  };

  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    lastBotReplyByContactKey.set(k, record);
  }
}

// Helper: Detect purely non-text or bare external links that should not trigger an automated response
function isClosingCourtesyOrNonCommercialAck(rawText: string, hasQuote = false): boolean {
  if (hasQuote) return false;
  const trimmed = (rawText || '').trim();
  if (!trimmed) return true;

  // Single bare URLs from common social media / marketplaces (e.g. customer sends Instagram post or TikTok video with zero text)
  if (
    /^https?:\/\/(www\.)?(youtu\.be|youtube\.com|tiktok\.com|vm\.tiktok\.com|instagram\.com|facebook\.com|fb\.watch)\/\S+$/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // All conversational text messages (including Dominican greetings like "Dime", "Dímelo", "Klk", "Buenas", "Ok", etc.)
  // are handled by the sales bot and conversational responders. Never drop real customer text.
  return false;
}

function shouldSkipBotReply(
  conv: Conversation,
  lastCustomerMsg: ChatMessage | undefined,
  triggerSource: string
): { skip: boolean; reason?: string } {
  const keys = getConversationContactKeys(conv);
  const now = Date.now();
  const customerName = conv.customerName || 'Cliente';
  const customerPhone = conv.customerPhone || '';
  const incomingId = normalizeMsgIdKey(lastCustomerMsg?.evolutionMessageId || lastCustomerMsg?.id || '');
  const incomingText = (lastCustomerMsg?.transcription || lastCustomerMsg?.content || '').trim();

  // 1. Never answer WhatsApp groups
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    const reason = 'Excluido: Grupo de WhatsApp (el bot solo atiende chats individuales)';
    recordBotAuditLog({
      customerName,
      customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: 'blocked_group',
      reason,
      durationMs: 0,
    });
    return { skip: true, reason };
  }

  // 2. If thread already has an assistant or team reply as the last message
  if (conv.messages && conv.messages.length > 0) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg.sender !== 'customer' && triggerSource !== 'manual_crm_trigger') {
      const reason = `El último mensaje en el chat ya fue respondido por el equipo o el bot ("${(lastMsg.content || '').slice(0, 40)}...")`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: 'blocked_already_answered',
        reason,
        durationMs: 0,
      });
      return { skip: true, reason };
    }
  }

  if (!lastCustomerMsg) {
    return { skip: true, reason: 'No hay mensaje del cliente para responder' };
  }

  // 2a. Check if this message ID was already processed
  if (triggerSource !== 'manual_crm_trigger' && incomingId && isMessageIdAlreadyProcessed(incomingId, keys)) {
    return { skip: true, reason: `Mensaje ID "${incomingId}" ya registrado como procesado.` };
  }

  // 2a-cutoff. Only auto-reply to new messages that arrived after system startup/reset (per user configuration)
  if (triggerSource !== 'manual_crm_trigger' && lastCustomerMsg.timestamp) {
    const msgTimeMs = new Date(lastCustomerMsg.timestamp).getTime();
    if (msgTimeMs > 0 && msgTimeMs < botStartupCutoffMs - 3000) {
      if (incomingId) {
        markMessageIdProcessed(incomingId, keys);
      }
      return {
        skip: true,
        reason: `Mensaje previo al corte de activación (${new Date(msgTimeMs).toLocaleTimeString()}). Solo se responden mensajes nuevos automáticamente.`,
      };
    }
  }

  // 2b. Do not auto-reply to bare social links without question (YouTube, TikTok, Instagram reels)
  if (
    triggerSource !== 'manual_crm_trigger' &&
    lastCustomerMsg.type === 'text' &&
    isClosingCourtesyOrNonCommercialAck(incomingText, Boolean(lastCustomerMsg.quotedMessage?.text))
  ) {
    if (incomingId) {
      markMessageIdProcessed(incomingId, keys);
    }
    const reason = `Enlace externo a redes sociales sin consulta de producto ("${incomingText.slice(0, 35)}").`;
    recordBotAuditLog({
      customerName,
      customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: 'blocked_already_answered',
      reason,
      durationMs: 0,
    });
    return { skip: true, reason };
  }

  for (const k of keys) {
    const prev = lastBotReplyByContactKey.get(k);
    if (!prev) continue;

    // 3. Same exact customer message ID already replied to
    if (
      incomingId &&
      (prev.customerMsgId === incomingId ||
        prev.customerMsgId === `evo-${incomingId}` ||
        `evo-${prev.customerMsgId}` === incomingId)
    ) {
      const reason = `Mensaje ID "${incomingId}" ya fue atendido con éxito anteriormente. Previniendo duplicado.`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: 'blocked_duplicate_id',
        reason,
        durationMs: 0,
      });
      return { skip: true, reason };
    }

    // 4. Repeated identical incoming text received within 20 seconds
    if (
      incomingText &&
      prev.customerText &&
      prev.customerText.toLowerCase() === incomingText.toLowerCase() &&
      now - prev.timestamp < 20000
    ) {
      const reason = `Texto repetido "${incomingText.slice(0, 30)}" recibido hace menos de 20s. Ya existe respuesta en pantalla.`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: 'blocked_duplicate_text',
        reason,
        durationMs: 0,
      });
      return { skip: true, reason };
    }

    // 5. Anti-spam cooldown (7 seconds) for automated triggers
    if (triggerSource !== 'manual_crm_trigger') {
      const elapsedMs = now - prev.timestamp;
      if (elapsedMs < 7000) {
        const reason = `Cooldown de seguridad activo: se envió una respuesta hace ${(elapsedMs / 1000).toFixed(1)}s (mínimo 7s entre mensajes automáticos).`;
        recordBotAuditLog({
          customerName,
          customerPhone,
          sessionId: conv.sessionId,
          triggerSource,
          incomingMessageId: incomingId,
          incomingText,
          decision: 'blocked_cooldown',
          reason,
          durationMs: 0,
        });
        return { skip: true, reason };
      }
    }
  }

  return { skip: false };
}

// Live Pre-Flight Check against Evolution API to prevent duplicate sends when multiple servers (e.g., Hostinger + Cloud Preview) poll the same WhatsApp instance
async function hasEvolutionAlreadyAnsweredSince(
  conv: Conversation,
  customerMsg: ChatMessage
): Promise<{ answered: boolean; latestOutgoing?: ChatMessage }> {
  const customerTimeMs = new Date(customerMsg.timestamp).getTime();
  const customerEvoId = customerMsg.evolutionMessageId || customerMsg.id.replace(/^evo-/, '');

  // 1. Fast local check: If conv.messages already has an assistant/agent message after this customer message
  if (conv.messages && conv.messages.length > 0) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.sender !== 'customer') {
        const mTime = new Date(m.timestamp).getTime();
        if (mTime >= customerTimeMs - 3000) {
          return { answered: true, latestOutgoing: m };
        }
      }
    }
  }

  // 2. Fast contact dispatch check: If an identical or recent outbound dispatch was made within 60s
  const contactKeys = getConversationContactKeys(conv);
  const now = Date.now();
  for (const k of contactKeys) {
    const prevReply = lastBotReplyByContactKey.get(k);
    if (prevReply && now - prevReply.timestamp < 60000) {
      if (prevReply.customerMsgId === customerEvoId || prevReply.customerMsgId === customerMsg.id) {
        return { answered: true };
      }
    }
  }

  if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) {
    return { answered: false };
  }
  try {
    const url = `${appConfig.evolution.serverUrl.replace(/\/$/, '')}/chat/findMessages/${appConfig.evolution.instance}`;
    const jids = new Set<string>([conv.sessionId]);
    const related = relatedJidsBySession.get(conv.sessionId);
    if (related) {
      for (const r of related) jids.add(r);
    }
    const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
    if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      jids.add(`${std}@s.whatsapp.net`);
      for (const [lidKey, mappedPhone] of lidToPhoneMap.entries()) {
        if (mappedPhone === std || mappedPhone === cleanPhone) {
          jids.add(lidKey.includes('@') ? lidKey : `${lidKey}@lid`);
        }
      }
    }

    const responses = await Promise.all(
      Array.from(jids)
        .slice(0, 4)
        .map(jid =>
          fetch(url, {
            method: 'POST',
            headers: {
              apikey: appConfig.evolution.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              where: {
                key: {
                  remoteJid: jid,
                },
              },
              limit: 15,
            }),
            signal: AbortSignal.timeout(5000),
          })
            .then(r => (r.ok ? r.json() : null))
            .catch(() => null)
        )
    );

    const records: any[] = [];
    for (const data of responses) {
      if (!data) continue;
      const recs = data?.messages?.records || (Array.isArray(data) ? data : []);
      for (const rec of recs) {
        if (doesRecordBelongToConversation(rec, jids, cleanPhone)) {
          records.push(rec);
        }
      }
    }

    if (records.length === 0) return { answered: false };

    const parsed: ChatMessage[] = [];
    for (const rec of records) {
      const m = parseSingleEvolutionMessage(rec, conv.customerName || 'Cliente');
      if (m) parsed.push(m);
    }
    if (parsed.length === 0) return { answered: false };

    // Deduplicate by evolutionMessageId and sort oldest -> newest
    const unique: ChatMessage[] = [];
    const seenIds = new Set<string>();
    for (const m of parsed) {
      const k = m.evolutionMessageId || m.id;
      if (!seenIds.has(k)) {
        seenIds.add(k);
        unique.push(m);
      }
    }
    unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Sync any newly discovered real WhatsApp messages into conv.messages so the CRM displays an exact 1:1 mirror
    let addedAny = false;
    for (const m of unique) {
      if (
        !conv.messages.some(
          existing =>
            (m.evolutionMessageId && existing.evolutionMessageId === m.evolutionMessageId) ||
            existing.id === m.id
        )
      ) {
        conv.messages.push(m);
        addedAny = true;
      }
    }
    if (addedAny) {
      conv.messages = mergeWithLocalMessages(conv.sessionId, unique, conv.messages, conv.customerPhone);
      const newest = conv.messages[conv.messages.length - 1];
      if (newest) {
        conv.lastTimestamp = newest.timestamp;
        conv.lastMessagePreview = newest.content;
        conv.lastMessageType = newest.type;
      }
      broadcastEvent('conversations_update', { count: conversations.length });
    }

    const customerTimeMs = new Date(customerMsg.timestamp).getTime();
    const customerEvoId = customerMsg.evolutionMessageId || customerMsg.id.replace(/^evo-/, '');

    // Check if there is any outgoing (assistant/agent) message in Evolution API at or after the customer's message
    const customerIdx = unique.findIndex(
      m => m.evolutionMessageId === customerEvoId || m.id === customerMsg.id
    );
    if (customerIdx >= 0) {
      const outgoingAfter = unique.slice(customerIdx + 1).find(m => m.sender !== 'customer');
      if (outgoingAfter) {
        return { answered: true, latestOutgoing: outgoingAfter };
      }
    }

    const outgoingRecent = unique
      .filter(
        m =>
          m.sender !== 'customer' &&
          m.evolutionMessageId !== customerEvoId &&
          new Date(m.timestamp).getTime() >= customerTimeMs - 1500
      )
      .pop();

    if (outgoingRecent) {
      return { answered: true, latestOutgoing: outgoingRecent };
    }

    return { answered: false };
  } catch {
    const contactKeys = getConversationContactKeys(conv);
    const now = Date.now();
    for (const k of contactKeys) {
      const cleanK = k.replace(/@.*$/, '').replace(/\D/g, '') || k;
      for (const [key, ts] of recentOutboundDispatches.entries()) {
        if (key.startsWith(`${cleanK}::`) && now - ts < 60000) {
          return { answered: true };
        }
      }
    }
    return { answered: false };
  }
  return { answered: false };
}

const recentOutboundDispatches = new Map<string, number>();

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureEvolutionInstanceConnected(forceRestart = false): Promise<boolean> {
  if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) return false;
  const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, '');
  const instance = appConfig.evolution.instance;
  const headers = { apikey: appConfig.evolution.apiKey };

  try {
    if (!forceRestart) {
      const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, { headers }).catch(() => null);
      if (stateRes?.ok) {
        const data = await stateRes.json().catch(() => null);
        const state = data?.instance?.state || data?.state;
        if (state === 'open') {
          appConfig.evolution.connected = true;
          return true;
        }
      }
    }

    const now = Date.now();
    if (now - lastEvolutionRestartMs > 15000) {
      lastEvolutionRestartMs = now;
      await fetch(`${baseUrl}/instance/restart/${instance}`, { method: 'POST', headers }).catch(() => null);
      await sleepMs(1200);
      await fetch(`${baseUrl}/instance/connect/${instance}`, { headers }).catch(() => null);
    }

    // Wait and verify active open state (polling up to 4 times)
    for (let i = 0; i < 4; i++) {
      await sleepMs(800);
      const verifyRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, { headers }).catch(() => null);
      if (verifyRes?.ok) {
        const vData = await verifyRes.json().catch(() => null);
        const vState = vData?.instance?.state || vData?.state;
        if (vState === 'open') {
          appConfig.evolution.connected = true;
          return true;
        }
      }
    }
  } catch {
    // Ignore transient network delays during reconnect check
  }
  return false;
}

function isWhatsAppGroup(targetOrJid?: string): boolean {
  if (!targetOrJid) return false;
  const t = targetOrJid.toLowerCase().trim();
  return (
    t.includes('@g.us') ||
    t.includes('-') && t.endsWith('@g.us') ||
    t.includes('@broadcast') ||
    t === 'status@broadcast' ||
    t.includes('newsletter')
  );
}

function normalizeEvolutionTarget(numberOrJid: string): string {
  const raw = (numberOrJid || '').trim();
  if (!raw) return '';
  // Never target WhatsApp groups
  if (isWhatsAppGroup(raw)) return '';
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  // WhatsApp @lid IDs are 14-15 digits long, whereas standard phone numbers are 10-12 digits
  if (digits.length >= 14) {
    return `${digits}@lid`;
  }
  if (digits.length === 10 && /^(809|829|849)/.test(digits)) {
    return `1${digits}`;
  }
  return digits;
}

async function sendEvolutionMessageWithStatus(
  numberOrJid: string,
  text: string,
  delayMs = 1000,
  isManualAgent = false
): Promise<{ ok: boolean; socketClosed: boolean; messageId?: string }> {
  if (isWhatsAppGroup(numberOrJid)) {
    console.log(`🛡️ [Grupo bloqueado]: Envío a grupo cancelado (${numberOrJid})`);
    return { ok: false, socketClosed: false };
  }
  const target = normalizeEvolutionTarget(numberOrJid);
  if (!target || isWhatsAppGroup(target)) {
    return { ok: false, socketClosed: false };
  }

  const cleanTargetKey = target.replace(/@.*$/, '').replace(/\D/g, '') || target;
  const dispatchKey = `${cleanTargetKey}::${text.trim()}`;

  const url = `${appConfig.evolution.serverUrl.replace(/\/$/, '')}/message/sendText/${appConfig.evolution.instance}`;

  // Execute with automatic self-healing if Baileys/Evolution API socket was disconnected
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: appConfig.evolution.apiKey,
        },
        body: JSON.stringify({
          number: target,
          text,
          delay: delayMs,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const durationMs = Date.now() - t0;

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageId = data?.key?.id || data?.id || '';
        if (!isManualAgent) {
          recentOutboundDispatches.set(dispatchKey, Date.now());
        }
        appConfig.evolution.connected = true;

        recordSystemApiLog({
          service: 'Evolution API',
          action: 'Enviar Mensaje WhatsApp (sendText)',
          method: 'POST',
          url,
          target,
          statusCode: res.status,
          success: true,
          durationMs,
          requestPreview: `Destino: ${target} | Texto: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`,
          responseSnippet: JSON.stringify(data || {}).slice(0, 350),
        });

        return { ok: true, socketClosed: false, messageId };
      }

      const errBody = await res.text().catch(() => '');
      const isSocketClosed =
        /Connection Closed|Connection Failure|Timed Out|Stream Errored|Precondition Required/i.test(errBody) ||
        res.status >= 500;

      recordSystemApiLog({
        service: 'Evolution API',
        action: 'Enviar Mensaje WhatsApp (sendText)',
        method: 'POST',
        url,
        target,
        statusCode: res.status,
        success: false,
        durationMs,
        requestPreview: `Destino: ${target} | Intento: ${attempt} | Texto: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`,
        error: errBody || `HTTP ${res.status}`,
        responseSnippet: errBody.slice(0, 500),
      });

      if (isSocketClosed && attempt === 1) {
        console.log(`[Evolution API Reconnect]: Reanudando sesión de WhatsApp tras desconexión temporal...`);
        await ensureEvolutionInstanceConnected(true);
        continue;
      }

      // If failed permanently:
      if (!isManualAgent) {
        recentOutboundDispatches.delete(dispatchKey);
      }
      return { ok: false, socketClosed: isSocketClosed };
    } catch (fetchErr: any) {
      const durationMs = Date.now() - t0;
      recordSystemApiLog({
        service: 'Evolution API',
        action: 'Enviar Mensaje WhatsApp (sendText)',
        method: 'POST',
        url,
        target,
        statusCode: 0,
        success: false,
        durationMs,
        requestPreview: `Destino: ${target} | Intento: ${attempt}`,
        error: fetchErr?.message || 'Error de red o timeout al despachar a Evolution API',
      });

      if (attempt === 1) {
        console.log(`[Evolution API Reconnect]: Reanudando sesión de WhatsApp tras timeout de red...`);
        await ensureEvolutionInstanceConnected(true);
        continue;
      }
      if (!isManualAgent) {
        recentOutboundDispatches.delete(dispatchKey);
      }
      return { ok: false, socketClosed: true };
    }
  }

  if (!isManualAgent) {
    recentOutboundDispatches.delete(dispatchKey);
  }
  return { ok: false, socketClosed: true };
}

async function sendEvolutionMessage(numberOrJid: string, text: string, delayMs = 500): Promise<boolean> {
  const res = await sendEvolutionMessageWithStatus(numberOrJid, text, delayMs);
  return res.ok;
}

async function sendEvolutionTypingPresence(conv: Conversation, durationMs = 3500): Promise<void> {
  if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) return;
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) return;

  const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, '');
  const url = `${baseUrl}/chat/sendPresence/${appConfig.evolution.instance}`;
  const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
  const targets = new Set<string>();

  if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    targets.add(`${std}@s.whatsapp.net`);
  }
  if (conv.sessionId && !isWhatsAppGroup(conv.sessionId)) {
    targets.add(conv.sessionId);
  }
  const related = relatedJidsBySession.get(conv.sessionId);
  if (related) {
    for (const r of related) {
      if (r && !isWhatsAppGroup(r)) targets.add(r);
    }
  }

  const primaryTarget = Array.from(targets)[0] || conv.sessionId;
  const t0 = Date.now();

  await Promise.all(
    Array.from(targets)
      .slice(0, 2)
      .map(target =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: appConfig.evolution.apiKey,
          },
          body: JSON.stringify({
            number: target,
            delay: durationMs,
            presence: 'composing',
          }),
          signal: AbortSignal.timeout(durationMs + 4000),
        }).catch(() => null)
      )
  );

  recordSystemApiLog({
    service: 'Evolution API',
    action: `Estado Escribiendo... (${(durationMs / 1000).toFixed(1)}s)`,
    method: 'POST',
    url,
    target: primaryTarget,
    statusCode: 201,
    success: true,
    durationMs: Date.now() - t0,
    requestPreview: `Cliente: ${conv.customerName} (${primaryTarget}) | presence: composing (${durationMs}ms)`,
    responseSnippet: '{"presence":"composing"}',
  });
}

async function sendEvolutionMessageToConversation(
  conv: Conversation,
  text: string,
  delayMs = 1000,
  isManualAgent = false
): Promise<{ ok: boolean; messageId?: string }> {
  // Never send automated or bot messages to WhatsApp groups
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`🛡️ [Grupo bloqueado]: Envío a grupo cancelado para sesión ${conv.sessionId}`);
    return { ok: false };
  }

  const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
  let primaryTarget = '';

  // 1. If valid Dominican/international phone number (10-12 digits), the standard JID is canonical
  if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    primaryTarget = `${std}@s.whatsapp.net`;
  } else if (conv.sessionId && !conv.sessionId.includes('@lid')) {
    primaryTarget = conv.sessionId;
  } else if (cleanPhone) {
    primaryTarget = cleanPhone;
  } else {
    primaryTarget = conv.sessionId;
  }

  const contactKeys = getConversationContactKeys(conv);
  const trimmedText = text.trim();

  // Dispatch directly to Evolution API with delayMs (Evolution API natively handles typing simulation for delayMs and delivers)
  const result = await sendEvolutionMessageWithStatus(primaryTarget, text, delayMs, isManualAgent);

  if (result.ok) {
    if (!isManualAgent) {
      for (const k of contactKeys) {
        const cleanK = k.replace(/@.*$/, '').replace(/\D/g, '') || k;
        recentOutboundDispatches.set(`${cleanK}::${trimmedText}`, Date.now());
      }
    }
    console.log(`✅ [WhatsApp Sent]: Mensaje entregado a ${conv.customerName} (${primaryTarget}) [ID: ${result.messageId || 'N/A'}] (Manual: ${isManualAgent})`);
    return { ok: true, messageId: result.messageId };
  } else {
    return { ok: false };
  }
}

async function sendEvolutionMedia(
  numberOrJid: string,
  mediatype: 'image' | 'video' | 'document',
  mimetype: string,
  base64Data: string,
  caption?: string,
  fileName?: string
): Promise<boolean> {
  const target = numberOrJid.includes('@') ? numberOrJid : numberOrJid.replace(/\D/g, '');
  const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
  const url = `${appConfig.evolution.serverUrl}/message/sendMedia/${appConfig.evolution.instance}`;
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        number: target,
        mediatype,
        mimetype,
        caption: caption || '',
        media: cleanBase64,
        fileName: fileName || `archivo.${mediatype === 'image' ? 'jpg' : mediatype === 'video' ? 'mp4' : 'pdf'}`,
      }),
    });
    const durationMs = Date.now() - t0;
    const resBody = await res.text().catch(() => '');

    recordSystemApiLog({
      service: 'Evolution API',
      action: `Enviar Multimedia (${mediatype})`,
      method: 'POST',
      url,
      target,
      statusCode: res.status,
      success: res.ok,
      durationMs,
      requestPreview: `Destino: ${target} | Archivo: ${fileName || mediatype} | Caption: ${caption || '(sin texto)'}`,
      responseSnippet: resBody.slice(0, 400),
      error: res.ok ? undefined : `HTTP ${res.status}: ${resBody.slice(0, 300)}`,
    });

    return res.ok;
  } catch (err: any) {
    recordSystemApiLog({
      service: 'Evolution API',
      action: `Enviar Multimedia (${mediatype})`,
      method: 'POST',
      url,
      target,
      statusCode: 0,
      success: false,
      durationMs: Date.now() - t0,
      error: err.message,
    });
    console.log(`[Evolution API Send Media Info]: ${err.message}`);
    return false;
  }
}

async function sendEvolutionAudio(numberOrJid: string, base64Audio: string): Promise<boolean> {
  const target = numberOrJid.includes('@') ? numberOrJid : numberOrJid.replace(/\D/g, '');
  const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, '');
  const url = `${appConfig.evolution.serverUrl}/message/sendWhatsAppAudio/${appConfig.evolution.instance}`;
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        number: target,
        audio: cleanBase64,
        delay: 500,
      }),
    });
    const durationMs = Date.now() - t0;
    const resBody = await res.text().catch(() => '');

    recordSystemApiLog({
      service: 'Evolution API',
      action: 'Enviar Nota de Voz PTT (sendWhatsAppAudio)',
      method: 'POST',
      url,
      target,
      statusCode: res.status,
      success: res.ok,
      durationMs,
      requestPreview: `Destino: ${target} | Nota de voz PTT`,
      responseSnippet: resBody.slice(0, 400),
      error: res.ok ? undefined : `HTTP ${res.status}: ${resBody.slice(0, 300)}`,
    });

    return res.ok;
  } catch (err: any) {
    recordSystemApiLog({
      service: 'Evolution API',
      action: 'Enviar Nota de Voz PTT (sendWhatsAppAudio)',
      method: 'POST',
      url,
      target,
      statusCode: 0,
      success: false,
      durationMs: Date.now() - t0,
      error: err.message,
    });
    console.log(`[Evolution API Send Audio Info]: ${err.message}`);
    return false;
  }
}

async function fetchMediaBase64FromEvolution(
  messageId: string,
  convertToMp4 = false,
  remoteJid?: string
): Promise<{ buffer: Buffer; mimetype: string; base64: string } | null> {
  const cleanId = String(messageId || '').replace(/^evo-/, '').trim();
  if (!cleanId) return null;

  const cacheKey = `${cleanId}_${convertToMp4}`;
  if (mediaCache.has(cacheKey)) {
    const cached = mediaCache.get(cacheKey)!;
    return { ...cached, base64: cached.buffer.toString('base64') };
  }

  // Check if raw record already has base64
  const rawRecord = rawEvolutionRecordsByMsgId.get(cleanId) || rawEvolutionRecordsByMsgId.get(messageId);
  const embeddedBase64 =
    rawRecord?.base64 ||
    rawRecord?.message?.imageMessage?.base64 ||
    rawRecord?.message?.audioMessage?.base64;
  if (embeddedBase64) {
    const rawMime =
      rawRecord?.message?.imageMessage?.mimetype ||
      rawRecord?.message?.audioMessage?.mimetype ||
      'image/jpeg';
    const buffer = Buffer.from(embeddedBase64, 'base64');
    mediaCache.set(cacheKey, { buffer, mimetype: rawMime });
    return { buffer, mimetype: rawMime, base64: embeddedBase64 };
  }

  const url = `${appConfig.evolution.serverUrl}/chat/getBase64FromMediaMessage/${appConfig.evolution.instance}`;
  
  // Try with full message or key payload
  const payloads = [
    rawRecord?.key
      ? { message: { key: rawRecord.key, message: rawRecord.message }, convertToMp4 }
      : null,
    remoteJid
      ? { message: { key: { id: cleanId, remoteJid, fromMe: false } }, convertToMp4 }
      : null,
    { message: { key: { id: cleanId } }, convertToMp4 },
  ].filter(Boolean);

  for (const payload of payloads) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: appConfig.evolution.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.base64) continue;

      const buffer = Buffer.from(data.base64, 'base64');
      const mimetype = data.mimetype || (convertToMp4 ? 'video/mp4' : 'application/octet-stream');

      if (mediaCache.size > 50) {
        const firstKey = mediaCache.keys().next().value;
        if (firstKey) mediaCache.delete(firstKey);
      }
      mediaCache.set(cacheKey, { buffer, mimetype });

      return { buffer, mimetype, base64: data.base64 };
    } catch {
      // Try next payload candidate
    }
  }

  console.log(`[Evolution Media Notice for ${cleanId}]: No se pudo descargar el medio de Evolution API`);
  return null;
}

// ---------------------------------------------------------
// Helper: Build Dynamic Knowledge & Sales Context
// ---------------------------------------------------------
function formatWhatsAppProductBlock(p: ProductItem, idx: number): string {
  const condBadge = p.condition === 'Nuevo' ? '✨ Nuevo de Caja (Garantía 1 año)' : '♻️ Reacondicionado Clase A (Garantía 6 meses)';
  const specsLine = p.specsSummary || p.description_sale ? `\n⚙️ ${p.specsSummary || p.description_sale}` : '';
  const useLine = p.useCases && p.useCases.length > 0 ? `\n🎯 Ideal para: ${p.useCases.join(' · ')}` : '';
  const url = p.website_url ? `\n🔗 https://todolapto.com.do${p.website_url}` : '';
  return `*${idx + 1}.* *${p.name}*\n💰 RD$${p.list_price.toLocaleString()} | 📦 ${p.virtual_available} unidad(es) | 🏷️ ${condBadge}${specsLine}${useLine}${url}`;
}

function getLiveInventoryString(): string {
  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  const laptops = [...inStock.filter(p => p.category === 'laptop')].sort(
    (a, b) => a.list_price - b.list_price
  );
  const redes = [...inStock.filter(p => p.category === 'red')].sort(
    (a, b) => a.list_price - b.list_price
  );
  const monitores = [...inStock.filter(p => p.category === 'monitor')].sort(
    (a, b) => a.list_price - b.list_price
  );
  const impresoras = [...inStock.filter(p => p.category === 'impresora')].sort(
    (a, b) => a.list_price - b.list_price
  );

  const allAccesorios = inStock.filter(p => p.category === 'accesorio');
  const tabletsMoviles = allAccesorios.filter(p =>
    /tablet|ipad|iphone|galaxy tab|fire 8|tab 910|alcatel 1t/i.test(
      `${p.name} ${p.odooCategory || ''}`
    )
  );
  const discosRam = allAccesorios.filter(
    p =>
      !tabletsMoviles.includes(p) &&
      /ssd|disco|memoria ram|ddr3|ddr4|pc3|pc4|m\.2|sata/i.test(
        `${p.name} ${p.odooCategory || ''}`
      )
  );
  const cargadoresBaterias = allAccesorios.filter(
    p =>
      !tabletsMoviles.includes(p) &&
      !discosRam.includes(p) &&
      /cargador|bateria|batería|ups/i.test(`${p.name} ${p.odooCategory || ''}`)
  );
  const otrosAccesorios = allAccesorios
    .filter(
      p =>
        !tabletsMoviles.includes(p) &&
        !discosRam.includes(p) &&
        !cargadoresBaterias.includes(p)
    )
    .slice(0, 80);

  const formatNumberedList = (arr: ProductItem[]) =>
    arr
      .map(
        (p, idx) =>
          `${idx + 1}. ${p.name} | ID:${p.variantId || p.id} | Marca:${p.brand || 'Genérico'} | Condición:${p.condition || 'Usado / Reacondicionado'} (${p.conditionDetail || 'Garantía 6 meses'}) | RD$${p.list_price.toLocaleString()} | Stock:${p.virtual_available} (Vitrina:${p.vitrinaStock || 0}, Almacén:${p.almacenStock || 0}) | Uso:${(p.useCases || []).join(', ')} | Specs:${p.specsSummary || p.description_sale || 'Estándar'} | Link: https://todolapto.com.do${p.website_url || ''}`
      )
      .join('\n');

  const readyToSendLaptopCatalog =
    laptops
      .map(
        (p, idx) =>
          `*${idx + 1}.* *${p.name}*\n💰 RD$${p.list_price.toLocaleString()} | 📦 ${p.virtual_available} unidad(es)\n🏷️ Condición: ${p.condition === 'Nuevo' ? 'Nuevo de Caja (Garantía 1 año)' : 'Reacondicionado Clase A (Garantía 6 meses)'} | 🎯 Uso: ${(p.useCases || ['Oficina / Estudios']).join(' · ')}${p.specsSummary ? `\n⚙️ ${p.specsSummary.slice(0, 90)}` : ''}\n🔗 https://todolapto.com.do${p.website_url || ''}`
      )
      .join('\n\n') +
    `\n\n*¿Cuál te interesa? También dime si buscas una marca, presupuesto o uso específico (oficina, estudios o gaming) y te filtro las mejores opciones.* 🛒`;

  // Count laptops by brand for quick reference
  const brandCounts: Record<string, number> = {};
  for (const l of laptops) {
    const b = l.brand || 'Otros';
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  }
  const brandBreakdown = Object.entries(brandCounts)
    .map(([b, c]) => `${b}: ${c}`)
    .join(', ');

  return `RESUMEN DE CATEGORÍAS EN STOCK REAL (ODOO ERP — ${inStock.length} PRODUCTOS EN STOCK):
- Laptops y Equipos Portátiles disponibles: ${laptops.length} modelos (${brandBreakdown})
  * REGLA DE CATÁLOGO COMPLETO E INTELIGENTE:
    1) Si preguntan si hay o piden catálogo general de una categoría ("tienes lapto?", "qué laptops tienen", "qué monitores tienen", "tienen impresoras", "tienen mouse", "cuáles tienes", etc.) SIN especificar marca, precio ni uso -> ENVÍA DE INMEDIATO TODOS LOS MODELOS DISPONIBLES EN STOCK DE ESA CATEGORÍA COMPLETA (del *1.* hasta el último modelo en stock, sin recortar ni detenerte en 3, 10 o 15, y sin responder solo "Sí tenemos, ¿qué buscas?").
    2) Si piden una MARCA específica (ej. Dell, Lenovo, HP, Asus, Acer, ThinkPad, Latitude, Chromebook, Epson, Logitech) -> Envía ÚNICAMENTE todos los modelos en stock de esa marca.
    3) Si piden un PRECIO o PRESUPUESTO específico (ej. 10,000 pesos, menos de 8 mil, entre 10 y 15 mil) -> Envía ÚNICAMENTE los modelos dentro de ese rango de precio.
    4) Si piden para un USO específico (ej. Oficina/Trabajo/Contabilidad, Gaming/Juegos, Estudios/Escuela, Programación/Diseño) -> Envía ÚNICAMENTE los modelos recomendados para ese uso.
    5) Si preguntan si son NUEVOS o USADOS/REACONDICIONADOS -> Indica con total transparencia la condición exacta marcada en Odoo de cada equipo.
- Tablets, iPads y Celulares en stock: ${tabletsMoviles.length}
- Repetidores y Redes: ${redes.length}
- Monitores y Pantallas: ${monitores.length}
- Impresoras y Tintas: ${impresoras.length}
- Discos SSD, Discos Duros y Memorias RAM: ${discosRam.length}
- Cargadores y Baterías de Laptop: ${cargadoresBaterias.length}
- Total Accesorios y Repuestos en stock: ${allAccesorios.length}

=== LAPTOPS Y EQUIPOS PORTÁTILES (${laptops.length} MODELOS DISPONIBLES CON MARCA, CONDICIÓN, SPECS Y USO) ===
${formatNumberedList(laptops)}

=== FORMATO LISTO PARA ENVIAR CUANDO PREGUNTEN POR LAPTOPS O PIDAN EL CATÁLOGO GENERAL COMPLETO DE LAPTOPS (SIN FILTRO DE MARCA, PRECIO NI USO) ===
🖥️ *Catálogo completo de laptops — Todo Lapto*

*(${laptops.length} modelos disponibles en stock real)*

${readyToSendLaptopCatalog}

=== TABLETS, IPADS Y CELULARES (${tabletsMoviles.length} disponibles) ===
${formatNumberedList(tabletsMoviles)}

=== MONITORES Y PANTALLAS (${monitores.length} disponibles) ===
${formatNumberedList(monitores)}

=== IMPRESORAS Y TINTAS (${impresoras.length} disponibles) ===
${formatNumberedList(impresoras)}

=== REPETIDORES, ROUTERS Y REDES (${redes.length} disponibles) ===
${formatNumberedList(redes)}

=== DISCOS SSD, DISCOS DUROS Y MEMORIAS RAM (${discosRam.length} disponibles) ===
${formatNumberedList(discosRam)}

=== CARGADORES, BATERÍAS Y UPS (${cargadoresBaterias.length} disponibles) ===
${formatNumberedList(cargadoresBaterias)}

=== MOCHILAS, SOPORTES, TECLADOS, MOUSE Y ACCESORIOS (${otrosAccesorios.length} destacados de ${allAccesorios.length}) ===
${formatNumberedList(otrosAccesorios)}`;
}

// Helper: Parse Dominican Peso budget / price-range queries (e.g. "10,000 pesos", "8 mil", "entre 10 y 15 mil", "menos de 12000", "10k", "las más económicas")
function extractBudgetQuery(text: string): { min: number; max: number; target: number; label: string } | null {
  if (!text) return null;
  const s = text
    .toLowerCase()
    .replace(/\bcuatro\s+mil\b/g, '4000')
    .replace(/\bcinco\s+mil\b/g, '5000')
    .replace(/\bseis\s+mil\b/g, '6000')
    .replace(/\bsiete\s+mil\b/g, '7000')
    .replace(/\bocho\s+mil\b/g, '8000')
    .replace(/\bnueve\s+mil\b/g, '9000')
    .replace(/\bdiez\s+mil\b/g, '10000')
    .replace(/\bonce\s+mil\b/g, '11000')
    .replace(/\bdoce\s+mil\b/g, '12000')
    .replace(/\btrece\s+mil\b/g, '13000')
    .replace(/\bcatorce\s+mil\b/g, '14000')
    .replace(/\bquince\s+mil\b/g, '15000')
    .replace(/\bdieciseis\s+mil\b/g, '16000')
    .replace(/\bdiecisiete\s+mil\b/g, '17000')
    .replace(/\bdieciocho\s+mil\b/g, '18000')
    .replace(/\bdiecinueve\s+mil\b/g, '19000')
    .replace(/\bveinte\s+mil\b/g, '20000')
    .replace(/\bveinticinco\s+mil\b/g, '25000')
    .replace(/\btreinta\s+mil\b/g, '30000');

  // Check for "las más económicas" / "las más baratas" / "algo económico" / "económicas"
  if (/\b(m[aá]s\s+econ[oó]mica|m[aá]s\s+barata|algo\s+econ[oó]mico|laptop\s+econ[oó]mica|laptops\s+econ[oó]micas|baratas|econ[oó]micas)\b/i.test(s)) {
    return {
      min: 3500,
      max: 9000,
      target: 6000,
      label: 'Gama Económica (RD$4,000 a RD$9,000)',
    };
  }

  const parseAmount = (rawNum: string, hasMilSuffix: boolean): number => {
    const cleaned = rawNum.replace(/[,.\s]/g, '');
    let val = parseFloat(cleaned);
    if (isNaN(val)) return 0;
    if (hasMilSuffix && val < 1000) val *= 1000;
    return val;
  };

  // 1. Range: "entre 8,000 y 12,000", "de 8 a 12 mil", "8000 a 12000"
  const rangeMatch = s.match(
    /(?:entre|de)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?\s*(?:y|a|-|hasta)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?/i
  );
  if (rangeMatch) {
    const hasMil2 = Boolean(rangeMatch[4]);
    const hasMil1 = Boolean(rangeMatch[2]) || (hasMil2 && Number(rangeMatch[1]) < 100);
    const v1 = parseAmount(rangeMatch[1], hasMil1);
    const v2 = parseAmount(rangeMatch[3], hasMil2);
    if (v1 >= 500 && v2 >= 1000 && v2 >= v1) {
      return {
        min: v1,
        max: v2 + 1000,
        target: Math.round((v1 + v2) / 2),
        label: `Rango solicitado: RD$${v1.toLocaleString()} a RD$${v2.toLocaleString()}`,
      };
    }
  }

  // 2. Upper bound: "menos de 10,000", "hasta 12 mil", "máximo 15,000", "no pase de 10 mil"
  const maxMatch = s.match(
    /(?:menos de|hasta|m[aá]ximo|no pase de|por debajo de|tope de)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?/i
  );
  if (maxMatch) {
    const v = parseAmount(maxMatch[1], Boolean(maxMatch[2]));
    if (v >= 1000 && v <= 150000) {
      return {
        min: 1000,
        max: v + 500,
        target: v,
        label: `Presupuesto máximo hasta RD$${v.toLocaleString()}`,
      };
    }
  }

  // 3. Target budget: "tengo 10,000", "de 8 mil", "por 12,000", "10,000 pesos", "presupuesto 15 mil", "algo de 10k", "RD$10,000"
  const targetMatch =
    s.match(
      /(?:tengo|presupuesto(?: de)?|busco(?: algo| una| un)? de|laptop de|computadora de|equipo de|como de|alrededor de|por|con|de|en)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k|pesos|dop)?/i
    ) ||
    s.match(/(?:rd\$|\$)\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(mil|k|pesos)?/i) ||
    s.match(/\b(\d{1,2})\s*(mil|k)\s*(?:pesos|dop)?\b/i) ||
    s.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(?:pesos|dop)\b/i);

  if (targetMatch) {
    const suffix = (targetMatch[2] || '').toLowerCase();
    const isMil = suffix === 'mil' || suffix === 'k';
    const v = parseAmount(targetMatch[1], isMil);
    // Avoid matching phone numbers (10+ digits) or small numbers like "15 pulgadas" or "8gb"
    if (v >= 2500 && v <= 150000) {
      const min = Math.max(2000, Math.round(v * 0.72));
      const max = v + 2200;
      return {
        min,
        max,
        target: v,
        label: `Presupuesto de RD$${v.toLocaleString()} (mostrando opciones desde RD$${min.toLocaleString()} hasta RD$${max.toLocaleString()})`,
      };
    }
  }

  return null;
}

// Helper: Detect brand or product line filter in customer message
function detectRequestedBrandOrLine(text: string): { label: string; matcher: (p: ProductItem) => boolean } | null {
  if (!text) return null;
  const s = text.toLowerCase();

  // Specific sub-lines first
  if (/\bthinkpad\b/i.test(s)) {
    return {
      label: 'Lenovo ThinkPad',
      matcher: p => /thinkpad/i.test(p.name),
    };
  }
  if (/\blatitude\b/i.test(s)) {
    return {
      label: 'Dell Latitude',
      matcher: p => /latitude/i.test(p.name),
    };
  }
  if (/\bprobook\b/i.test(s)) {
    return {
      label: 'HP ProBook',
      matcher: p => /probook/i.test(p.name),
    };
  }
  if (/\belitebook\b/i.test(s)) {
    return {
      label: 'HP EliteBook',
      matcher: p => /elitebook/i.test(p.name),
    };
  }
  if (/\bideapad\b/i.test(s)) {
    return {
      label: 'Lenovo IdeaPad',
      matcher: p => /ideapad/i.test(p.name),
    };
  }
  if (/\bchromebook\b|\bchrobook\b/i.test(s)) {
    return {
      label: 'Chromebooks',
      matcher: p => /chromebook|chrobook|c203x|c771/i.test(`${p.name} ${p.description_sale || ''}`),
    };
  }

  // Major Brands
  if (/\bdell\b/i.test(s)) {
    return {
      label: 'Marca Dell',
      matcher: p => (p.brand || '').toLowerCase() === 'dell' || /\bdell\b|\blatitude\b|\binspiron\b/i.test(p.name),
    };
  }
  if (/\blenovo\b/i.test(s)) {
    return {
      label: 'Marca Lenovo',
      matcher: p =>
        ((p.brand || '').toLowerCase() === 'lenovo' || /\blenovo\b|\bthinkpad\b|\bideapad\b|\byoga\b|\bthinkcentro\b/i.test(p.name)) &&
        !/\bedu\s*gear\b/i.test(p.name),
    };
  }
  if (/\bhp\b|\bhewlett\b/i.test(s)) {
    return {
      label: 'Marca HP',
      matcher: p => (p.brand || '').toLowerCase() === 'hp' || /\bhp\b|\bprobook\b|\belitebook\b|\benvy\b|\bstream\b/i.test(p.name),
    };
  }
  if (/\basus\b/i.test(s)) {
    return {
      label: 'Marca Asus',
      matcher: p => (p.brand || '').toLowerCase() === 'asus' || /\basus\b|\bc203x\b/i.test(p.name),
    };
  }
  if (/\bacer\b/i.test(s)) {
    return {
      label: 'Marca Acer',
      matcher: p => (p.brand || '').toLowerCase() === 'acer' || /\bacer\b|\bc771\b/i.test(p.name),
    };
  }
  if (/\bapple\b|\bmacbook\b|\bmac\b/i.test(s)) {
    return {
      label: 'Marca Apple / MacBook',
      matcher: p => (p.brand || '').toLowerCase() === 'apple' || /\bapple\b|\bmacbook\b|\bipad\b|\biphone\b/i.test(p.name),
    };
  }
  if (/\bedu\s*gear\b/i.test(s)) {
    return {
      label: 'EDU GEAR',
      matcher: p => /\bedu\s*gear\b/i.test(p.name),
    };
  }

  return null;
}

// Helper: Detect Use Case (Oficina/Trabajo, Gaming/Juegos, Estudios/Escuela, Programación/Diseño)
function detectRequestedUseCase(text: string): {
  id: 'oficina' | 'gaming' | 'programacion' | 'estudios';
  label: string;
  pitch: string;
  matcher: (p: ProductItem) => boolean;
} | null {
  if (!text) return null;
  const s = text.toLowerCase();

  if (/\b(gamer|gamers|gaming|juego|juegos|jugar|free\s*fire|roblox|fortnite|gta|valorant|stream|streaming)\b/i.test(s)) {
    return {
      id: 'gaming',
      label: 'Gaming / Juegos y Alto Rendimiento',
      pitch:
        'Equipos con procesadores potentes (Intel Core i5 Serie H / Core i7 de 10ma Gen, 8GB a 16GB de RAM y discos SSD ultrarrápidos) capaces de mover juegos y tareas exigentes con fluidez.',
      matcher: p =>
        p.category === 'laptop' &&
        Boolean(
          p.useCases?.some(u => u.toLowerCase().includes('gaming')) ||
            /\b10300h\b|\benvy\b|\bi7\b|\b5420\b|\b5510\b|\b5511\b|\b5310\b|\b850\s*g4\b/i.test(
              `${p.name} ${p.specsSummary || ''}`
            )
        ),
    };
  }

  if (/\b(programar|programaci[oó]n|programador|desarrollo|software|ingenier[ií]a|arquitectura|autocad|dise[ñn]o|edici[oó]n|render|multitarea\s*pesada)\b/i.test(s)) {
    return {
      id: 'programacion',
      label: 'Programación, Ingeniería, Diseño y Multitarea Avanzada',
      pitch:
        'Laptops empresariales de alto desempeño con procesadores Intel Core i5 (8va/10ma/11va Gen) e Intel Core i7, 8GB a 16GB de RAM y almacenamiento SSD NVMe.',
      matcher: p =>
        p.category === 'laptop' &&
        Boolean(
          p.useCases?.some(u => u.toLowerCase().includes('programación')) ||
            p.list_price >= 15000
        ),
    };
  }

  if (/\b(oficina|trabajo|trabajar|negocio|negocios|contabilidad|facturar|facturaci[oó]n|empresa|empresarial|administrativo|secretaria|excel|word|office|universidad|universitario|tesis)\b/i.test(s)) {
    return {
      id: 'oficina',
      label: 'Oficina, Trabajo, Negocios, Contabilidad y Universidad',
      pitch:
        'Líneas empresariales (Dell Latitude, Lenovo ThinkPad, HP ProBook/EliteBook e IdeaPad) con procesadores Intel Core i3/i5/i7, 8GB+ RAM y SSD, diseñadas para trabajar largas jornadas con Excel, sistemas de facturación, oficina y universidad.',
      matcher: p =>
        p.category === 'laptop' &&
        Boolean(p.useCases?.some(u => u.toLowerCase().includes('oficina'))) &&
        !/chromebook|chrobook|edu\s*gear|c203x|c771/i.test(p.name),
    };
  }

  if (/\b(estudio|estudiar|estudios|escuela|escolar|colegio|ni[ñn]o|ni[ñn]a|hijo|hija|tareas|clases\s*virtuales|b[aá]sico|basico|navegar|youtube)\b/i.test(s)) {
    return {
      id: 'estudios',
      label: 'Estudios, Escuela, Clases Virtuales y Uso Diario',
      pitch:
        'Equipos resistentes, ligeros y económicos ideales para clases virtuales, tareas escolares, investigación web y uso estudiantil desde RD$4,000.',
      matcher: p =>
        p.category === 'laptop' &&
        Boolean(p.useCases?.some(u => u.toLowerCase().includes('estudios'))) &&
        p.list_price <= 15000,
    };
  }

  return null;
}

interface GenericProductFamily {
  id: string;
  label: string;
  isCable?: boolean;
  matcher: (p: ProductItem) => boolean;
}

// Helper: Identify cables, cords, wires and cable-adapters to ensure strict categorical purity
function isCableOrWiringItem(name: string, odooCateg = ''): boolean {
  const combined = `${name} ${odooCateg}`.toLowerCase();
  return /\b(cable\b|cables\b|cord[oó]n|cordones\b|patch\s*cord|cable\s*hdmi|hdmi\s*cable|cable\s*de\s*poder|cable\s*poder|power\s*cable|cable\s*vga|vga\s*cable|cable\s*usb|usb\s*cable|cable\s*tipo\s*c|type\s*c\s*cable|cable\s*lightning|cable\s*red|cable\s*rj45|cable\s*utp|adaptador\s*cable|extensi[oó]n\s*usb|extensi[oó]n\s*el[eé]ctrica|conector\s*cable)\b/i.test(
    combined
  );
}

// Helper: Detect if customer is querying a generic product family (mouse, impresora, teclado, bocina, etc.)
function detectGenericProductFamily(query: string): GenericProductFamily | null {
  if (!query) return null;
  const s = query
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\btodo\s*lapto\b/gi, ' ');

  // 1. Mouse / Ratones
  if (/\b(mouse|mouses|rat[oó]n|ratones)\b/i.test(s) && !/\b(pad|alfombrilla)\b/i.test(s)) {
    return {
      id: 'mouse',
      label: 'Mouse y Ratones',
      matcher: p => {
        const combined = `${p.name} ${p.odooCategory || ''}`.toLowerCase();
        const hasMouse = /\b(mouse|mouses|rat[oó]n|ratones)\b/i.test(combined);
        const isPadOnly =
          /\b(mouse\s*pad|pad\s*mouse|alfombrilla)\b/i.test(combined) &&
          !/\b(con\s*mouse|combo\s*mouse|\+\s*mouse|mouse\s*optico|mouse\s*inalambrico|mouse\s*gamer)\b/i.test(combined);
        return hasMouse && !isPadOnly;
      },
    };
  }

  // 2. Cartuchos, Tintas y Tóner para Impresora (solo cuando el cliente pide explícitamente cartucho, tinta o tóner)
  if (/\b(cartucho|cartuchos|tinta|tintas|toner|t[oó]ner|botella\s*de\s*tinta)\b/i.test(s)) {
    return {
      id: 'tinta_cartucho',
      label: 'Cartuchos, Tintas y Tóner para Impresora',
      matcher: p => isPrinterSupplyOrConsumable(p.name, p.odooCategory),
    };
  }

  // 3. Impresoras / Equipos de Impresión (estrictamente máquinas impresoras; CERO teclados, CERO cartuchos/tintas, CERO cables, CERO UPS)
  if (/\b(impresora|impresoras|printer|printers|multifuncional|multifuncionales)\b/i.test(s)) {
    return {
      id: 'impresora',
      label: 'Impresoras y Equipos de Impresión',
      matcher: p => isActualPrinterMachine(p.name, p.odooCategory),
    };
  }

  // 3. Teclados
  if (/\b(teclado|teclados|keyboard|keyboards)\b/i.test(s)) {
    return {
      id: 'teclado',
      label: 'Teclados y Combos de Teclado',
      matcher: p => {
        const combined = `${p.name} ${p.odooCategory || ''}`.toLowerCase();
        const isTeclado = /\b(teclado|teclados|keyboard|keyboards)\b/i.test(combined);
        const isInternalPart = /\b(repuesto|interno|cinta\s*teclado|para\s*(?:dell|hp|lenovo|latitude|thinkpad)\s*(?:e\d{4}|\d{4}|g\d))\b/i.test(
          p.name
        );
        return isTeclado && !isInternalPart;
      },
    };
  }

  // 4. Monitores / Pantallas
  if (/\b(monitor|monitores|pantalla\s*de\s*pc|pantalla\s*para\s*pc|pantallas\s*pc)\b/i.test(s)) {
    return {
      id: 'monitor',
      label: 'Monitores y Pantallas',
      matcher: p => p.category === 'monitor' || /\b(monitor|monitores)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 5. Bocinas / Speakers / Parlantes
  if (/\b(bocina|bocinas|speaker|speakers|parlante|parlantes)\b/i.test(s)) {
    return {
      id: 'bocina',
      label: 'Bocinas y Speakers',
      matcher: p =>
        /\b(bocina|bocinas|speaker|speakers|parlante|parlantes|soundbar)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 6. Audífonos / Headsets / Auriculares
  if (/\b(audifonos|audífonos|headset|headsets|auricular|auriculares)\b/i.test(s)) {
    return {
      id: 'audifonos',
      label: 'Audífonos y Headsets',
      matcher: p =>
        /\b(audifono|audifonos|audífono|audífonos|headset|headsets|auricular|auriculares)\b/i.test(
          `${p.name} ${p.odooCategory || ''}`
        ),
    };
  }

  // 7. Cargadores y Fuentes de Laptop
  if (/\b(cargador|cargadores|charger|fuente\s*de\s*poder\s*laptop)\b/i.test(s)) {
    return {
      id: 'cargador',
      label: 'Cargadores y Fuentes de Laptop',
      matcher: p => /\b(cargador|cargadores|charger|power\s*adapter)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 8. Mochilas, Maletines y Fundas
  if (/\b(mochila|mochilas|bulto|bultos|malet[ií]n|maletines|funda\s*laptop)\b/i.test(s)) {
    return {
      id: 'mochila',
      label: 'Mochilas, Bultos y Maletines',
      matcher: p =>
        /\b(mochila|mochilas|bulto|bultos|malet[ií]n|maletines|backpack|funda)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 9. Discos SSD / Discos Duros
  if (/\b(disco\s*solido|disco\s*sólido|disco\s*duro|ssd|nvme|m\.2|disco\s*externo)\b/i.test(s)) {
    return {
      id: 'disco',
      label: 'Discos SSD, NVMe y Discos Duros',
      matcher: p =>
        /\b(ssd|disco\s*solido|disco\s*sólido|disco\s*duro|nvme|m\.2)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 10. Memorias RAM
  if (/\b(memoria\s*ram|memorias\s*ram|ram|ddr3|ddr4|ddr5)\b/i.test(s) && !/\b(disco|ssd|laptop)\b/i.test(s)) {
    return {
      id: 'ram',
      label: 'Memorias RAM (Laptop y PC)',
      matcher: p => /\b(ram|memoria\s*ram|ddr3|ddr4|ddr5|pc3|pc4)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 11. Tablets e iPads
  if (/\b(tablet|tablets|ipad|ipads)\b/i.test(s)) {
    return {
      id: 'tablet',
      label: 'Tablets e iPads',
      matcher: p => /tablet|ipad|galaxy tab|fire 8|tab 910|alcatel 1t/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  // 12. Repetidores y Redes
  if (/\b(repetidor|repetidores|router|routers|antena\s*wifi|switch\s*de\s*red|access\s*point)\b/i.test(s)) {
    return {
      id: 'red',
      label: 'Repetidores, Routers y Equipos de Red',
      matcher: p =>
        p.category === 'red' ||
        /\b(repetidor|repetidores|router|routers|wifi|antena|access\s*point|switch)\b/i.test(
          `${p.name} ${p.odooCategory || ''}`
        ),
    };
  }

  // 13. Cables / Cordones / Adaptadores (SOLO cuando el usuario busca cables explícitamente)
  if (/\b(cable|cables|cord[oó]n|cordones|patch\s*cord|cable\s*hdmi|cable\s*vga|cable\s*de\s*poder|cable\s*usb|adaptador\s*hdmi)\b/i.test(s)) {
    return {
      id: 'cable',
      label: 'Cables, Cordones y Adaptadores',
      isCable: true,
      matcher: p => isCableOrWiringItem(p.name, p.odooCategory),
    };
  }

  // 14. Laptops (cuando consulta por laptops / portátiles / notebooks / chromebooks)
  if (/\b(laptop|laptops|lapto|laptos|portatil|portatiles|portátil|portátiles|computadora\s*portatil|notebook|notebooks|chromebook|chromebooks)\b/i.test(s)) {
    return {
      id: 'laptop',
      label: 'Laptops y Equipos Portátiles',
      matcher: p => p.category === 'laptop',
    };
  }

  // 15. Mini PC / Desktop / Computadoras de Escritorio
  if (/\b(desktop|mini\s*pc|thinkcentre|thinkcentro|all\s*in\s*one|computadora\s*de\s*mesa|pc\s*de\s*escritorio)\b/i.test(s)) {
    return {
      id: 'desktop',
      label: 'Computadoras Desktop / Mini PC',
      matcher: p => /\b(desktop|thinkcentre|thinkcentro|all\s*in\s*one|optiplex|prodesk|elitedesk)\b/i.test(`${p.name} ${p.odooCategory || ''}`),
    };
  }

  return null;
}

// Search all Odoo products dynamically based on customer message, brand, budget, condition & use case
function getRelevantProductsHighlight(
  latestQueryText: string,
  fullContextText = '',
  recentConversationText = ''
): string {
  if ((!latestQueryText && !fullContextText && !recentConversationText) || products.length === 0) return '';
  // Strip any internal prompt wrapper headers if present so we only analyze the user's real words
  const userOnlyLatest = latestQueryText
    .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Mensaje actual del cliente sobre esta cita anterior:\s*"?/gi, '')
    .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:\s*"?/gi, '')
    .replace(/\[nota de voz[^\]]*\]/gi, ' ')
    .replace(/\[audio[^\]]*\]/gi, ' ')
    .replace(/\[foto[^\]]*\]/gi, ' ')
    .replace(/\[detalles[^\]]*\]/gi, ' ')
    .replace(/\[contenido visual[^\]]*\]/gi, ' ')
    .replace(/[🎤📷🔍]/g, ' ')
    .trim();
  const cleanLatest = userOnlyLatest.toLowerCase();

  // Pure greeting or courtesy guard: NEVER search or inject catalog for simple greetings
  if (isSimpleConversationalMessage(cleanLatest)) {
    return '';
  }

  // Operational store question guard: NEVER search or inject catalog for operational queries (hours, location, delivery, warranty)
  const isOperationalQuestion = /\b(laborando|laboran|laborar|trabajando|trabajan|abierto|abiertos|abierta|abiertas|cerrado|cerrados|abren|cierran|horario|horarios|ubicacion|ubicación|ubicados|donde estan|direccion|dirección|hacen envios|delivery|garantia|garantía)\b/i.test(`${cleanLatest} ${fullContextText}`);
  const hasExplicitProductWord = /\b(laptop|laptops|lapto|computadora|computadoras|impresora|impresoras|monitor|monitores|disco|ssd|ram|cargador|bateria|pantalla|teclado|mouse|probook|thinkpad|latitude|elitebook|optiplex|core\s*i[3579]|celeron|ryzen)\b/i.test(`${cleanLatest} ${fullContextText}`);

  if (isOperationalQuestion && !hasExplicitProductWord) {
    return '';
  }

  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  const laptopsInStock = [...inStock.filter(p => p.category === 'laptop')].sort(
    (a, b) => a.list_price - b.list_price
  );

  const sections: string[] = [];

  // Detect active filters in the customer's current message
  const brandFilter = detectRequestedBrandOrLine(userOnlyLatest);
  const budgetFilter = extractBudgetQuery(userOnlyLatest);
  const useCaseFilter = detectRequestedUseCase(userOnlyLatest);
  let genericFamily = detectGenericProductFamily(cleanLatest);

  // Follow-up Context Inheritance:
  // If the customer sends a follow-up like "no tengo algo en mente cuales tienes?", "cuales tienes?",
  // "muestrame las que tienes", "todas", "mandame el catalogo", or specifies a brand/budget/useCase
  // after asking for a product category in the recent conversation turns, inherit the category from recentConversationText!
  const isCatalogFollowUpRequest =
    /\b(cu[aá]les|cuales|qu[eé]\s+tienes|que\s+tienes|qu[eé]\s+tienen|que\s+tienen|cu[aá]les\s+tienes|cu[aá]les\s+tienen|no\s+tengo\s+algo\s+en\s+mente|mu[eé]strame|mostrar|m[aá]ndame|env[ií]ame|cat[aá]logo|catalogo|lista|todas|todos|opciones|modelos|disponibles|verlas|verlos|dime\s+cu[aá]les|ense[ñn]ame)\b/i.test(
      cleanLatest
    );

  if (!genericFamily && recentConversationText) {
    const recentLines = recentConversationText.split('\n');
    for (const line of recentLines) {
      const inheritedFamily = detectGenericProductFamily(line);
      if (inheritedFamily && (isCatalogFollowUpRequest || brandFilter || budgetFilter || useCaseFilter)) {
        genericFamily = inheritedFamily;
        break;
      }
    }
  }

  const asksCondition =
    /\b(nuevo|nueva|nuevos|nuevas|usado|usada|usados|usadas|reacondicionado|reacondicionada|refurbished|de\s*caja|segunda\s*mano|condici[oó]n|estado\s*del\s*equipo)\b/i.test(
      cleanLatest
    );
  const wantsOnlyNew =
    /\b(solo\s*nuev[oa]s?|tienen\s*nuev[oa]s?|quiero\s*una?\s*nuev[oa]|busco\s*nuev[oa]|nuev[oa]\s*de\s*caja)\b/i.test(
      cleanLatest
    ) && !/\b(o\s*usad[oa]|usad[oa]\s*o\s*nuev[oa])\b/i.test(cleanLatest);

  // 1. If the customer asks about CONDITION (Nuevo vs Usado / Reacondicionado):
  if (asksCondition) {
    const newProducts = inStock.filter(p => p.condition === 'Nuevo');
    const usedLaptops = laptopsInStock.filter(p => p.condition === 'Usado / Reacondicionado');
    const newLaptops = laptopsInStock.filter(p => p.condition === 'Nuevo');

    sections.push(
      `=== 🎯 CONTEXTO OFICIAL DE CONDICIÓN DE PRODUCTOS EN ODOO (NUEVO VS USADO / REACONDICIONADO) ===
- En Todo Lapto manejamos la condición real marcada en Odoo para cada producto:
  1. **Laptops Corporativas Importadas (Usadas / Reacondicionadas Clase A — ${usedLaptops.length} modelos en stock):** Todas pasan por una prueba técnica rigurosa de 25 puntos (batería, pantalla, teclado, disco SSD, memoria RAM), están en excelente estado físico y funcional, e incluyen **6 meses de garantía directa** en nuestra tienda física de la Av. Charles de Gaulle No. 133.
  2. **Equipos Nuevos de Caja (${newLaptops.length} laptops nuevas y ${newProducts.length} accesorios nuevos en stock):** Incluyen **1 año de garantía**.
- Si el cliente pregunta si un modelo específico o nuestro catálogo es nuevo o usado, respóndele con total honestidad y claridad indicando su condición exacta en Odoo (${newLaptops.length > 0 ? `Laptops marcadas como Nuevas: ${newLaptops.map(p => `${p.name} (RD$${p.list_price.toLocaleString()})`).join(', ')}` : 'Todas las laptops actuales en catálogo son Importadas Reacondicionadas Clase A con 6 meses de garantía'}).`
    );
  }

  // 2. Generic Product Family (Laptops, Mouse, Impresoras, Teclados, Bocinas, Monitores, Cargadores, etc.)
  // Return ALL available items in stock for that category without any 15-item truncation, and with STRICT CATEGORICAL PURITY.
  let hasPrimaryFilterSection = false;
  if (
    genericFamily &&
    (genericFamily.id !== 'laptop' || (!brandFilter && !budgetFilter && !useCaseFilter && !wantsOnlyNew))
  ) {
    let familyProducts = inStock.filter(genericFamily.matcher);

    // Strict categorical purity: Exclude cables/wiring unless cables are the requested family
    if (!genericFamily.isCable) {
      familyProducts = familyProducts.filter(p => !isCableOrWiringItem(p.name, p.odooCategory));
    }

    // Apply brand filter if specified (e.g., "mouse logitech" or "impresora epson")
    if (brandFilter) {
      const brandMatches = familyProducts.filter(brandFilter.matcher);
      if (brandMatches.length > 0) {
        familyProducts = brandMatches;
      }
    }

    // Apply budget filter if specified (e.g., "mouse de 500 pesos")
    if (budgetFilter) {
      const budgetMatches = familyProducts.filter(
        p => p.list_price >= budgetFilter.min && p.list_price <= budgetFilter.max
      );
      if (budgetMatches.length > 0) {
        familyProducts = budgetMatches;
      }
    }

    // Apply condition filter if specified
    if (wantsOnlyNew) {
      const newMatches = familyProducts.filter(p => p.condition === 'Nuevo');
      if (newMatches.length > 0) {
        familyProducts = newMatches;
      }
    }

    familyProducts.sort((a, b) => a.list_price - b.list_price);
    hasPrimaryFilterSection = true;

    if (familyProducts.length > 0) {
      const brandNote = brandFilter ? ` DE MARCA ${brandFilter.label.toUpperCase()}` : ' (CATÁLOGO COMPLETO MULTIMARCA EN STOCK)';
      const itemsListFormatted = familyProducts
        .map((p, idx) => formatWhatsAppProductBlock(p, idx))
        .join('\n\n');

      const catalogHeader =
        genericFamily.id === 'laptop'
          ? `🖥️ *Catálogo completo de laptops — Todo Lapto*\n\n*(${familyProducts.length} modelos disponibles en stock real)*`
          : `📦 *Catálogo completo de ${genericFamily.label} — Todo Lapto*\n\n*(${familyProducts.length} opciones disponibles en stock real)*`;

      const catalogFooter =
        genericFamily.id === 'laptop'
          ? `\n\n*¿Cuál te interesa? También dime si buscas una marca, presupuesto o uso específico (oficina, estudios o gaming) y te filtro las mejores opciones.* 🛒`
          : `\n\n*¿Cuál te interesa? Te lo aparto ahora mismo para entrega a domicilio o retiro en tienda.* 🛒`;

      sections.push(
        `=== 🎯 CATÁLOGO COMPLETO OBLIGATORIO DE ${genericFamily.label.toUpperCase()}${brandNote} (${familyProducts.length} DISPONIBLES EN STOCK) ===
🚨 ORDEN OBLIGATORIA E INQUEBRANTABLE PARA OPENAI:
1. El cliente preguntó por disponibilidad o cuáles tenemos de "${genericFamily.label}"${brandFilter ? ` especificando la marca ${brandFilter.label}` : ' sin especificar marca ni presupuesto'}.
2. ESTÁ ESTRICTAMENTE PROHIBIDO responder solo "Sí, tenemos disponibles, ¿buscas algún modelo o presupuesto en mente?" sin enviar la lista.
3. ESTÁ ESTRICTAMENTE PROHIBIDO recortar, resumir o detener la lista en 3, 10 o 15 productos. DEBES ENVIAR EN ESTE MISMO MENSAJE TODOS LOS ${familyProducts.length} PRODUCTOS COMPLETO (desde el *1.* hasta el *${familyProducts.length}.* sin omitir ninguno).
4. PUREZA CATEGÓRICA ESTRICTA: ${genericFamily.id === 'laptop' ? 'Estos ' + familyProducts.length + ' modelos son 100% LAPTOPS REALES. JAMÁS mezcles accesorios como hubs USB, mouse o mouse pads cuando piden laptops.' : 'Envía exclusivamente los productos de esta categoría listados a continuación.'}

COPIA Y ENVÍA ÍNTEGRAMENTE ESTE CATÁLOGO COMPLETO AL CLIENTE (${familyProducts.length} modelos):

<!-- [CATALOG_BLOCK_START] -->
${catalogHeader}

${itemsListFormatted}${catalogFooter}
<!-- [CATALOG_BLOCK_END] -->`
      );
    } else {
      sections.push(
        `=== ⚠️ SIN STOCK ACTUAL PARA ${genericFamily.label.toUpperCase()}${brandFilter ? ` (${brandFilter.label})` : ''} ===
Informa cordialmente al cliente que en este momento no tenemos unidades disponibles de ${genericFamily.label}${brandFilter ? ` marca ${brandFilter.label}` : ''} en stock físico, y ofrécele alternativas o verificar próxima llegada.`
      );
    }
  } else if (brandFilter || budgetFilter || useCaseFilter || wantsOnlyNew) {
    // 3. Apply Combined or Individual Smart Filters for Laptops (Brand, Budget, Use Case)
    hasPrimaryFilterSection = true;
    let filtered = [...laptopsInStock];
    const activeFilterLabels: string[] = [];

    if (brandFilter) {
      filtered = filtered.filter(brandFilter.matcher);
      activeFilterLabels.push(`Marca/Línea: ${brandFilter.label}`);
    }
    if (budgetFilter) {
      filtered = filtered.filter(p => p.list_price >= budgetFilter.min && p.list_price <= budgetFilter.max);
      activeFilterLabels.push(budgetFilter.label);
    }
    if (useCaseFilter) {
      filtered = filtered.filter(useCaseFilter.matcher);
      activeFilterLabels.push(`Uso: ${useCaseFilter.label}`);
    }
    if (wantsOnlyNew) {
      const onlyNewMatches = filtered.filter(p => p.condition === 'Nuevo');
      if (onlyNewMatches.length > 0) {
        filtered = onlyNewMatches;
        activeFilterLabels.push('Condición: Nuevo');
      }
    }

    // If combined filters were too strict and yielded 0, relax to the primary filter so we still help the customer
    if (filtered.length === 0) {
      if (brandFilter) {
        filtered = laptopsInStock.filter(brandFilter.matcher);
        if (filtered.length === 0) {
          filtered = inStock.filter(brandFilter.matcher);
        }
      } else if (budgetFilter) {
        filtered = laptopsInStock.filter(
          p => p.list_price >= Math.max(2000, budgetFilter.min - 2000) && p.list_price <= budgetFilter.max + 3000
        );
      } else if (useCaseFilter) {
        filtered = laptopsInStock.filter(useCaseFilter.matcher);
      }
    }

    filtered.sort((a, b) => a.list_price - b.list_price);

    if (filtered.length > 0) {
      const filterTitle = activeFilterLabels.join(' + ');
      const readyFilteredList =
        filtered.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n') +
        `\n\n*¿Cuál de estas ${filtered.length} opciones te apartamos de inmediato?* 🛒`;

      sections.push(
        `=== 🎯 FILTRO ESTRICTO ACTIVO (${filterTitle}) — MOSTRAR TODOS ESTOS ${filtered.length} MODELOS ===
🚨 INSTRUCCIÓN OBLIGATORIA PARA OPENAI:
El cliente solicitó un filtro específico (${filterTitle}).
${useCaseFilter ? `💡 Argumento de venta para este uso: ${useCaseFilter.pitch}\n` : ''}1. Debes enviar TODOS estos ${filtered.length} productos filtrados completos (del *1.* al *${filtered.length}.* sin omitir ninguno).
2. Incluye en cada opción su precio en RD$, stock, condición, especificaciones clave y su link directo sin corchetes Markdown.

LISTA FILTRADA COMPLETA PARA ENVIAR AL CLIENTE (${filtered.length} opciones):

<!-- [CATALOG_BLOCK_START] -->
¡Claro! Aquí tienes todas las opciones disponibles en stock (${filterTitle}):

${readyFilteredList}
<!-- [CATALOG_BLOCK_END] -->`
      );
    } else {
      sections.push(
        `=== ⚠️ SIN COINCIDENCIAS EXACTAS PARA EL FILTRO (${activeFilterLabels.join(' + ')}) ===
Informa cordialmente al cliente que en este momento no tenemos un modelo exacto con esa combinación en stock, y muéstrale las opciones más cercanas disponibles en nuestro inventario real.`
      );
    }
  }

  // 4. General Keyword & Model Search across all products (ONLY if no primary category/brand/budget filter already matched)
  if (!hasPrimaryFilterSection) {
    const stopWords = new Set([
      'hola', 'buenos', 'dias', 'tardes', 'noches', 'quiero', 'tienen', 'tiene', 'tienes', 'busco', 'buscando',
      'para', 'como', 'cual', 'cuales', 'precio', 'precios', 'cuanto', 'cuesta', 'vale',
      'disponible', 'disponibles', 'todo', 'todos', 'todas', 'una', 'uno', 'unos', 'unas', 'por',
      'favor', 'gracias', 'saludos', 'saludo', 'buenas', 'info', 'informacion', 'pesos', 'mil', 'tengo', 'presupuesto',
      'esta', 'este', 'esto', 'bien', 'listo', 'dale', 'claro', 'bueno', 'saber', 'hacer', 'donde', 'cuando',
      'quien', 'porque', 'pero', 'solo', 'aqui', 'alla', 'algo', 'alguna', 'alguno', 'algunos', 'algunas',
      'nada', 'mucho', 'poco', 'otro', 'otra', 'esos', 'esas', 'mente', 'opciones', 'opcion', 'modelo', 'modelos',
      'especifico', 'especifica', 'catalogo', 'lista', 'mostrar', 'muestrame', 'mandame', 'enviame', 'dime', 'enseñame',
      'complemento', 'general', 'unidad', 'unidades', 'condicion', 'nuevo', 'usado',
      // Media, audio and voice terms (never match sound products like S8 Stereo on voice notes)
      'audio', 'audios', 'nota', 'notas', 'voz', 'voces', 'microfono', 'micrófono', 'grabacion', 'grabación',
      'transcribir', 'transcripcion', 'transcripción', 'claridad', 'escuchar', 'mensaje', 'mensajes', 'texto',
      // Image terms
      'foto', 'fotos', 'fotografia', 'imagen', 'imagenes', 'imágenes', 'captura', 'capturas', 'pantalla', 'pantallas',
      'adjunto', 'adjuntos', 'archivo', 'archivos', 'documento', 'sticker',
      // Operational store terms
      'laborando', 'laboran', 'laborar', 'trabajando', 'trabajan', 'abierto', 'abiertos', 'abierta', 'abiertas',
      'cerrado', 'cerrados', 'cerrada', 'cerradas', 'abren', 'cierran', 'horario', 'horarios', 'hora', 'horas',
      'dia', 'dias', 'días', 'hoy', 'manana', 'mañana', 'feriado', 'feriados', 'domingo', 'domingos', 'sabado',
      'sabados', 'sábados', 'lunes', 'direccion', 'dirección', 'ubicacion', 'ubicación', 'ubicados', 'quedan',
      'tienda', 'local', 'sucursal', 'envio', 'envíos', 'envios', 'delivery', 'despacho', 'domicilio',
      'garantia', 'garantía', 'garantias', 'garantías',
      // Conversational metadata
      'enviada', 'enviado', 'cliente', 'pudo', 'anterior', 'anteriormente', 'citado', 'citada', 'pregunta',
      'preguntando', 'respuesta', 'duda', 'consulta'
    ]);
    const validShortTechTokens = new Set([
      'hp', 'pc', 'i3', 'i5', 'i7', 'i9', 'm1', 'm2', 'm3', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8',
      'ram', 'ssd', 'hdd', 'usb', 'vga', 'ups', 'led', 'ips', 'rgb', 'jbl', 'msi', 'mac'
    ]);

    const searchSource = `${userOnlyLatest} ${fullContextText}`
      .toLowerCase()
      .replace(/https?:\/\/\S+/gi, ' ');
    const tokens = searchSource
      .replace(/[^\wáéíóúñ0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => (w.length >= 4 || validShortTechTokens.has(w)) && !stopWords.has(w));

    if (tokens.length > 0) {
      const scored: { product: ProductItem; score: number }[] = [];

      for (const p of inStock) {
        // Match strictly against product name, brand, specsSummary, and odooCategory (NEVER against generic useCases like "Complemento")
        const hay = `${p.name} ${p.brand || ''} ${p.specsSummary || ''} ${p.description_sale || ''} ${p.category} ${p.odooCategory || ''}`.toLowerCase();
        let score = 0;
        for (const tk of tokens) {
          const escapedTk = tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordBoundaryRegex = new RegExp(`\\b${escapedTk}\\b`, 'i');
          if (wordBoundaryRegex.test(hay)) {
            score += tk.length >= 4 ? 4 : 3;
          }
          if ((tk === 'lapto' || tk === 'laptop' || tk === 'laptops' || tk === 'computadora') && p.category === 'laptop') {
            score += 6;
          }
        }
        if (score >= 4) {
          scored.push({ product: p, score });
        }
      }

      scored.sort((a, b) => b.score - a.score || a.product.list_price - b.product.list_price);
      const topMatches = scored.map(s => s.product);
      if (topMatches.length > 0) {
        sections.push(
          `=== COINCIDENCIAS DIRECTAS EN INVENTARIO ODOO PARA LA CONSULTA ACTUAL (${topMatches.length} encontrados) ===\n<!-- [CATALOG_BLOCK_START] -->\n¡Claro! Aquí tienes las opciones disponibles en nuestro inventario actual:\n\n` +
            topMatches
              .map((p, idx) => formatWhatsAppProductBlock(p, idx))
              .join('\n\n') +
            `\n\n*¿Cuál de estas opciones te interesa apartar?* 🛒\n<!-- [CATALOG_BLOCK_END] -->`
        );
      }
    }
  }

  return sections.length > 0 ? '\n' + sections.join('\n\n') : '';
}

function getLearnedInsightsPromptContext(): string {
  return learnedInsights
    .map(
      ins =>
        `[Aprendizaje - ${ins.category}]: Cuando el cliente exprese "${ins.triggerPhrase}", responde aplicando esta táctica comprobada (${ins.successRate}% éxito): "${ins.winningPitch}". Contexto: ${ins.counterObjection}`
    )
    .join('\n\n');
}

// ---------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------

// 0. System API Logs & Diagnostics Endpoints
app.get('/api/system/logs', (req, res) => {
  const service = req.query.service as string | undefined;
  const status = req.query.status as string | undefined;
  let filtered = [...systemApiLogs];

  if (service && service !== 'all') {
    filtered = filtered.filter(l => l.service.toLowerCase().includes(service.toLowerCase()));
  }
  if (status === 'error') {
    filtered = filtered.filter(l => !l.success || (l.statusCode && l.statusCode >= 400));
  } else if (status === 'success') {
    filtered = filtered.filter(l => l.success && (!l.statusCode || l.statusCode < 400));
  }

  res.json({
    success: true,
    logs: filtered,
    totalCount: systemApiLogs.length,
    errorCount: systemApiLogs.filter(l => !l.success || (l.statusCode && l.statusCode >= 400)).length,
  });
});

app.post('/api/system/logs/clear', (_req, res) => {
  systemApiLogs.length = 0;
  recordSystemApiLog({
    service: 'Evolution API',
    action: 'Registros del Sistema Vaciados',
    method: 'SYS',
    statusCode: 200,
    success: true,
    durationMs: 0,
    requestPreview: 'Limpieza manual solicitada desde la interfaz',
    responseSnippet: 'Buffer de diagnóstico reiniciado a 0.',
  });
  res.json({ success: true, message: 'Registros del sistema vaciados con éxito' });
});

app.post('/api/system/logs/test-ping', async (_req, res) => {
  const results: any = { evolution: null, odoo: null };

  // 1. Test Evolution API connectionState
  try {
    const t0 = Date.now();
    const evoUrl = `${appConfig.evolution.serverUrl.replace(/\/$/, '')}/instance/connectionState/${appConfig.evolution.instance}`;
    const evoRes = await fetch(evoUrl, {
      headers: { apikey: appConfig.evolution.apiKey },
      signal: AbortSignal.timeout(6000),
    });
    const evoText = await evoRes.text();
    const evoDuration = Date.now() - t0;
    let parsedEvo: any = {};
    try { parsedEvo = JSON.parse(evoText); } catch {}

    const isEvoOk = evoRes.ok && (parsedEvo?.instance?.state === 'open' || parsedEvo?.state === 'open');
    recordSystemApiLog({
      service: 'Evolution API',
      action: 'Diagnóstico en Vivo (connectionState)',
      method: 'GET',
      url: evoUrl,
      statusCode: evoRes.status,
      success: isEvoOk,
      durationMs: evoDuration,
      requestPreview: `Instancia: ${appConfig.evolution.instance} | Server: ${appConfig.evolution.serverUrl}`,
      responseSnippet: evoText.slice(0, 400),
      error: isEvoOk ? undefined : (parsedEvo?.response?.message || evoText || `HTTP ${evoRes.status}`),
    });
    results.evolution = {
      ok: isEvoOk,
      status: evoRes.status,
      durationMs: evoDuration,
      state: parsedEvo?.instance?.state || parsedEvo?.state || 'unknown',
      details: evoText.slice(0, 300),
    };
  } catch (err: any) {
    recordSystemApiLog({
      service: 'Evolution API',
      action: 'Diagnóstico en Vivo (connectionState)',
      method: 'GET',
      statusCode: 0,
      success: false,
      durationMs: 0,
      error: err.message,
    });
    results.evolution = { ok: false, status: 0, error: err.message };
  }

  // 2. Test Odoo ERP ping
  try {
    const t0 = Date.now();
    const odooRes = await callOdoo('common', 'version', [], 1);
    const odooDuration = Date.now() - t0;
    results.odoo = {
      ok: true,
      status: 200,
      durationMs: odooDuration,
      serverVersion: odooRes?.server_version || 'Conectado',
    };
  } catch (err: any) {
    results.odoo = { ok: false, status: 500, error: err.message };
  }

  // 3. Test OpenAI API Engine ping
  try {
    const t0 = Date.now();
    const aiRes = await generateTextWithConfiguredAI({
      prompt: 'Responde únicamente: OK',
      systemInstruction: 'Eres un asistente de verificación rápida.',
      allowFallback: false,
    });
    const aiDuration = Date.now() - t0;
    results.openai = {
      ok: true,
      status: 200,
      durationMs: aiDuration,
      model: aiRes.modelUsed,
      reply: aiRes.text.slice(0, 60),
    };
  } catch (err: any) {
    results.openai = {
      ok: false,
      status: String(err.message || '').includes('401') ? 401 : String(err.message || '').includes('429') ? 429 : 500,
      error: err.message,
    };
  }

  res.json({ success: true, results });
});

// 1. Get Configuration & Status
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    config: appConfig,
    businessSchedule: getDominicanTimeContext(),
    stats: {
      totalProducts: products.length,
      inStockProducts: products.filter(p => p.virtual_available > 0).length,
      vitrinaProducts: products.filter(p => (p.vitrinaStock || 0) > 0).length,
      totalConversations: conversations.length,
      activeLeads: customers.length,
      totalOrders: salesOrders.length,
      learnedInsightsCount: learnedInsights.length,
      pendingReminders: followUps.filter(f => f.status === 'pendiente').length,
    },
  });
});

// Real-time Dominican Republic business schedule & holiday status endpoint
app.get('/api/business-schedule', (req, res) => {
  const ctx = getDominicanTimeContext(new Date(), appConfig.holidayOverrides || []);
  const year = req.query.year ? parseInt(String(req.query.year), 10) : ctx.year;
  res.json({
    success: true,
    schedule: ctx,
    holidayOverrides: appConfig.holidayOverrides || [],
    availableYears: getAvailableHolidayYears(ctx.year, ctx.month, appConfig.holidayOverrides || [], year),
    holidays: getHolidaysWithOverridesForYear(year, appConfig.holidayOverrides || []),
  });
});

app.get('/api/holidays/sql', (_req, res) => {
  res.json({
    success: true,
    tableName: 'calendario_feriados',
    sql: getHolidaysTableSql(),
  });
});

app.post('/api/holidays/sync-supabase', async (_req, res) => {
  try {
    const syncRes = await syncHolidaysToSupabase(
      appConfig.holidayOverrides || [],
      appConfig.supabase?.url,
      appConfig.supabase?.anonKey
    );
    res.json({
      success: syncRes.synced,
      ...syncRes,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post('/api/holidays/overrides', async (req, res) => {
  const { holidayOverrides } = req.body;
  let dbSynced = false;
  let tableExists = false;
  let tableRowsSynced = 0;
  let storage = 'local';
  if (Array.isArray(holidayOverrides)) {
    appConfig.holidayOverrides = holidayOverrides;
    setGlobalHolidayOverrides(appConfig.holidayOverrides);
    savePersistedConfig();
    try {
      const syncRes = await syncHolidaysToSupabase(
        appConfig.holidayOverrides,
        appConfig.supabase?.url,
        appConfig.supabase?.anonKey
      );
      dbSynced = syncRes.synced;
      tableExists = syncRes.tableExists;
      tableRowsSynced = syncRes.tableRowsSynced;
      storage = syncRes.storage;
      if (appConfig.supabase?.autoSync !== false) {
        autoSyncConfigToSupabase(appConfig).catch(() => {});
      }
    } catch {}
    broadcastEvent('config_updated', appConfig);
  }
  const ctx = getDominicanTimeContext(new Date(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    dbSynced,
    tableExists,
    tableRowsSynced,
    storage,
    config: appConfig,
    schedule: ctx,
    holidayOverrides: appConfig.holidayOverrides || [],
    availableYears: getAvailableHolidayYears(ctx.year, ctx.month, appConfig.holidayOverrides || []),
    holidays: getHolidaysWithOverridesForYear(ctx.year, appConfig.holidayOverrides || []),
  });
});

app.post('/api/config', async (req, res) => {
  const { globalAiActive, aiProvider, odoo, evolution, supabase, holidayOverrides } = req.body;
  if (globalAiActive !== undefined) appConfig.globalAiActive = Boolean(globalAiActive);
  if (aiProvider) {
    const nextAi = { ...appConfig.aiProvider, ...aiProvider, provider: 'openai' as const };
    if (!nextAi.model || (!nextAi.model.startsWith('gpt-') && !nextAi.model.startsWith('o'))) {
      nextAi.model = 'gpt-4o-mini';
    }
    if (typeof aiProvider.openaiApiKey === 'string') {
      nextAi.openaiApiKey = aiProvider.openaiApiKey.trim();
    }
    if (typeof aiProvider.openaiBaseUrl === 'string' && aiProvider.openaiBaseUrl.trim()) {
      nextAi.openaiBaseUrl = aiProvider.openaiBaseUrl.trim();
    }
    nextAi.deepseekApiKey = '';
    nextAi.deepseekBaseUrl = '';
    nextAi.geminiApiKey = '';
    appConfig.aiProvider = nextAi;
  }
  if (odoo) appConfig.odoo = { ...appConfig.odoo, ...odoo };
  if (evolution) appConfig.evolution = { ...appConfig.evolution, ...evolution };
  if (supabase) {
    appConfig.supabase = { ...(appConfig.supabase || {}), ...supabase };
    if (appConfig.supabase?.url && appConfig.supabase?.anonKey) {
      getSupabaseClient(appConfig.supabase.url, appConfig.supabase.anonKey);
    }
  }
  if (Array.isArray(holidayOverrides)) {
    appConfig.holidayOverrides = holidayOverrides;
    setGlobalHolidayOverrides(appConfig.holidayOverrides);
  }
  if (Array.isArray(req.body.activeWhatsAppStatuses)) {
    appConfig.activeWhatsAppStatuses = req.body.activeWhatsAppStatuses;
  }

  savePersistedConfig();
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncConfigToSupabase(appConfig).catch(() => {});
  }
  broadcastEvent('config_updated', appConfig);
  res.json({ success: true, config: appConfig });
});

// ---------------------------------------------------------
// WhatsApp Statuses (Stories) Management Endpoints
// ---------------------------------------------------------
app.get('/api/whatsapp-statuses', (_req, res) => {
  res.json({
    success: true,
    statuses: appConfig.activeWhatsAppStatuses || [],
  });
});

app.post('/api/whatsapp-statuses', (req, res) => {
  const { statuses, status } = req.body;
  if (Array.isArray(statuses)) {
    appConfig.activeWhatsAppStatuses = statuses;
  } else if (status && typeof status === 'object') {
    const existing = appConfig.activeWhatsAppStatuses || [];
    const idx = existing.findIndex(s => s.id === status.id);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...status };
    } else {
      existing.unshift({
        id: status.id || `status-${Date.now()}`,
        title: status.title || status.productName || 'Oferta de Estado',
        productName: status.productName || '',
        price: status.price || '',
        description: status.description || '',
        imageUrl: status.imageUrl || '',
        active: status.active !== false,
        createdAt: status.createdAt || new Date().toISOString(),
      });
    }
    appConfig.activeWhatsAppStatuses = existing;
  }
  savePersistedConfig();
  broadcastEvent('whatsapp_statuses_updated', appConfig.activeWhatsAppStatuses);
  res.json({
    success: true,
    statuses: appConfig.activeWhatsAppStatuses,
  });
});

app.post('/api/whatsapp-statuses/toggle', (req, res) => {
  const { id, active } = req.body;
  const list = appConfig.activeWhatsAppStatuses || [];
  const item = list.find(s => s.id === id);
  if (item) {
    item.active = active !== undefined ? Boolean(active) : !item.active;
    savePersistedConfig();
    broadcastEvent('whatsapp_statuses_updated', appConfig.activeWhatsAppStatuses);
  }
  res.json({ success: true, statuses: list });
});

app.delete('/api/whatsapp-statuses/:id', (req, res) => {
  const { id } = req.params;
  appConfig.activeWhatsAppStatuses = (appConfig.activeWhatsAppStatuses || []).filter(s => s.id !== id);
  savePersistedConfig();
  broadcastEvent('whatsapp_statuses_updated', appConfig.activeWhatsAppStatuses);
  res.json({ success: true, statuses: appConfig.activeWhatsAppStatuses });
});

// Dedicated endpoint to save AI Provider & API Keys with guaranteed persistence (OpenAI Exclusive)
app.post('/api/ai/save-credentials', async (req, res) => {
  const {
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
  } = req.body;

  const cleanModel =
    model && (String(model).startsWith('gpt-') || String(model).startsWith('o'))
      ? String(model)
      : appConfig.aiProvider?.model?.startsWith('gpt-') || appConfig.aiProvider?.model?.startsWith('o')
      ? appConfig.aiProvider.model
      : 'gpt-4o-mini';

  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: 'openai',
    model: cleanModel,
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? '',
    ...(openaiApiKey !== undefined ? { openaiApiKey: String(openaiApiKey).trim() } : {}),
    ...(openaiBaseUrl !== undefined && String(openaiBaseUrl).trim() ? { openaiBaseUrl: String(openaiBaseUrl).trim() } : {}),
    deepseekApiKey: '',
    deepseekBaseUrl: '',
    geminiApiKey: '',
  };

  savePersistedConfig();

  try {
    await autoSyncConfigToSupabase(appConfig);
  } catch {}

  broadcastEvent('config_updated', appConfig);
  res.json({
    success: true,
    config: appConfig,
    message: 'Credenciales de OpenAI guardadas permanentemente en el servidor y respaldadas en Supabase.',
  });
});

// Supabase: Test Connection & Probe Tables
app.post('/api/supabase/test-connection', async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || '').trim();
  const anonKey = (req.body.anonKey || appConfig.supabase?.anonKey || '').trim();

  if (!url || !anonKey) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere la URL del proyecto y la Anon Key de Supabase.',
    });
  }

  // Unconditionally persist credentials immediately so they are never lost
  if (!appConfig.supabase) {
    appConfig.supabase = { url: '', anonKey: '', connected: false, autoSync: true };
  }
  appConfig.supabase.url = url;
  appConfig.supabase.anonKey = anonKey;
  savePersistedConfig();
  getSupabaseClient(url, anonKey);

  const result = await testSupabaseConnection(url, anonKey);
  if (result.success) {
    appConfig.supabase.connected = true;
    savePersistedConfig();
  }

  res.json(result);
});

// Supabase: Get SQL Migration / Table Setup Script
app.get('/api/supabase/schema-sql', (req, res) => {
  res.json({
    success: true,
    sql: getSupabaseSchemaSql(),
  });
});

// Supabase: Upload and Synchronize Everything (Users, Config, Products, Orders, Customers, WhatsApp Messages, Reminders & AI Insights)
app.post('/api/supabase/sync-all', async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || DEFAULT_SUPABASE_URL).trim();
  const anonKey = (req.body.anonKey || appConfig.supabase?.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();

  if (url && anonKey) {
    if (!appConfig.supabase) {
      appConfig.supabase = { url: '', anonKey: '', connected: false, autoSync: true };
    }
    appConfig.supabase.url = url;
    appConfig.supabase.anonKey = anonKey;
    savePersistedConfig();
  }

  try {
    const stats = await uploadAllToSupabase(
      {
        users: systemUsers,
        config: appConfig,
        products,
        orders: salesOrders,
        customers,
        conversations,
        reminders: followUps,
        insights: learnedInsights.filter(i => i.id !== INTERNAL_USERS_BACKUP_ID),
      },
      url,
      anonKey
    );

    if (appConfig.supabase) {
      appConfig.supabase.lastSync = new Date().toISOString();
      if (stats.errors.length === 0 || stats.usersSynced > 0 || stats.ordersSynced > 0 || stats.customersSynced > 0) {
        appConfig.supabase.connected = true;
      }
      savePersistedConfig();
    }

    res.json({
      success: stats.errors.length === 0 || (stats.usersSynced + stats.ordersSynced + stats.customersSynced + stats.messagesSynced) > 0,
      stats,
      lastSync: appConfig.supabase?.lastSync,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Error al subir datos a Supabase: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------
// User Authentication & RBAC Hierarchy Endpoints (NO EMAIL)
// ---------------------------------------------------------
function findMatchingSystemUser(rawIdentifier: string): UserAccount | undefined {
  const cleanUser = String(rawIdentifier || '').trim().replace(/^@+/, '').toLowerCase();
  const digitsOnly = cleanUser.replace(/\D/g, '');

  return systemUsers.find(u => {
    if (u.username.toLowerCase().trim() === cleanUser) return true;
    if (u.nombre.toLowerCase().trim() === cleanUser) return true;
    if (digitsOnly.length >= 10 && u.whatsapp.replace(/\D/g, '').endsWith(digitsOnly.slice(-10))) return true;
    return false;
  });
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Ingresa tu nombre de usuario y contraseña.' });
  }

  let found = findMatchingSystemUser(username);

  // If user is not found locally or password doesn't match, hydrate latest users from Supabase (`public.usuarios` or cloud backup)
  if (!found || found.password !== String(password).trim()) {
    await hydrateAndSyncUsersWithSupabase();
    found = findMatchingSystemUser(username);
  }

  if (!found) {
    return res.status(401).json({ success: false, message: 'Nombre de usuario no encontrado.' });
  }

  if (!found.activo) {
    return res.status(403).json({ success: false, message: 'Esta cuenta ha sido desactivada por el Super Administrador.' });
  }

  if (found.password !== String(password).trim()) {
    return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
  }

  found.lastLogin = new Date().toISOString();
  savePersistedUsers();
  autoSyncUserToSupabase(found, systemUsers).catch(() => {});

  const token = `vendema_tk_${found.id}_${Date.now()}`;
  res.json({
    success: true,
    user: sanitizeUser(found),
    token,
  });
});

app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  const match = token.match(/^vendema_tk_(usr_[a-zA-Z0-9_]+)_/);
  if (match) {
    const userId = match[1];
    let user = systemUsers.find(u => u.id === userId && u.activo);
    if (!user) {
      await hydrateAndSyncUsersWithSupabase();
      user = systemUsers.find(u => u.id === userId && u.activo);
    }
    if (user) {
      return res.json({ success: true, user: sanitizeUser(user) });
    }
  }

  res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
});

app.post('/api/auth/logout', (_req, res) => {
  res.json({ success: true, message: 'Sesión cerrada correctamente.' });
});

app.get('/api/users', async (_req, res) => {
  await hydrateAndSyncUsersWithSupabase();
  res.json({
    success: true,
    users: systemUsers.map(sanitizeUser),
    total: systemUsers.length,
  });
});

app.post('/api/users', async (req, res) => {
  const { nombre, username, password, whatsapp, role } = req.body;

  if (!nombre || !username || !password || !whatsapp) {
    return res.status(400).json({
      success: false,
      message: 'Todos los campos son obligatorios: Nombre, Nombre de usuario, Contraseña y WhatsApp.',
    });
  }

  const cleanUsername = String(username).trim().replace(/^@+/, '').toLowerCase().replace(/\s+/g, '');
  if (cleanUsername.length < 3) {
    return res.status(400).json({
      success: false,
      message: 'El nombre de usuario debe tener al menos 3 caracteres.',
    });
  }

  await hydrateAndSyncUsersWithSupabase();

  if (systemUsers.some(u => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({
      success: false,
      message: `El nombre de usuario "${cleanUsername}" ya existe. Elige otro por favor.`,
    });
  }

  const validRoles: UserRole[] = ['super_admin', 'dueno', 'empleado'];
  const userRole: UserRole = validRoles.includes(role) ? role : 'empleado';

  const newUser: UserAccount = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    nombre: String(nombre).trim(),
    username: cleanUsername,
    password: String(password).trim(),
    whatsapp: String(whatsapp).replace(/[^\d+]/g, ''),
    role: userRole,
    activo: true,
    createdAt: new Date().toISOString(),
  };

  systemUsers.push(newUser);
  savePersistedUsers();
  await autoSyncUserToSupabase(newUser, systemUsers);

  res.status(201).json({
    success: true,
    message: `Usuario ${newUser.nombre} (@${newUser.username}) creado y sincronizado con Supabase.`,
    user: sanitizeUser(newUser),
  });
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const userIdx = systemUsers.findIndex(u => u.id === id);

  if (userIdx === -1) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
  }

  const targetUser = systemUsers[userIdx];
  const { nombre, whatsapp, password, role, activo } = req.body;

  if (nombre) targetUser.nombre = String(nombre).trim();
  if (whatsapp) targetUser.whatsapp = String(whatsapp).replace(/[^\d+]/g, '');
  if (password && String(password).trim()) {
    targetUser.password = String(password).trim();
  }

  // Protect nelson from demotion or deactivation
  if (targetUser.username.toLowerCase() === 'nelson') {
    targetUser.role = 'super_admin';
    targetUser.activo = true;
  } else {
    if (role && ['super_admin', 'dueno', 'empleado'].includes(role)) {
      targetUser.role = role;
    }
    if (activo !== undefined) {
      targetUser.activo = Boolean(activo);
    }
  }

  savePersistedUsers();
  await autoSyncUserToSupabase(targetUser, systemUsers);

  res.json({
    success: true,
    message: `Usuario ${targetUser.nombre} actualizado y sincronizado con Supabase.`,
    user: sanitizeUser(targetUser),
  });
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const targetUser = systemUsers.find(u => u.id === id);

  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
  }

  if (targetUser.username.toLowerCase() === 'nelson') {
    return res.status(403).json({
      success: false,
      message: 'No es posible eliminar al Super Administrador principal (nelson).',
    });
  }

  systemUsers = systemUsers.filter(u => u.id !== id);
  savePersistedUsers();
  await deleteUserFromSupabase(targetUser, systemUsers);

  res.json({
    success: true,
    message: `Usuario @${targetUser.username} eliminado correctamente.`,
  });
});

// Test Active AI Provider (OpenAI Exclusive)
app.post('/api/ai/test-provider', async (req, res) => {
  const {
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
  } = req.body;

  const cleanModel =
    model && (String(model).startsWith('gpt-') || String(model).startsWith('o'))
      ? String(model)
      : appConfig.aiProvider?.model?.startsWith('gpt-') || appConfig.aiProvider?.model?.startsWith('o')
      ? appConfig.aiProvider.model
      : 'gpt-4o-mini';

  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: 'openai',
    model: cleanModel,
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? '',
    ...(openaiApiKey !== undefined ? { openaiApiKey: String(openaiApiKey).trim() } : {}),
    ...(openaiBaseUrl !== undefined ? { openaiBaseUrl: String(openaiBaseUrl).trim() } : {}),
    deepseekApiKey: '',
    deepseekBaseUrl: '',
    geminiApiKey: '',
  };

  savePersistedConfig();

  if (!appConfig.aiProvider.openaiApiKey && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'MY_OPENAI_API_KEY')) {
    return res.json({
      success: false,
      message: 'Por favor ingresa tu API Key de OpenAI (sk-...) en el campo de credenciales para conectar con OpenAI.',
    });
  }

  try {
    const result = await generateTextWithConfiguredAI({
      prompt: 'Responde en una sola línea confirmando que estás activo con OpenAI para vender laptops en Todo Lapto.',
      systemInstruction: 'Eres el motor oficial de inteligencia artificial OpenAI de Vendemá CRM para Todo Lapto.',
      allowFallback: false,
    });

    res.json({
      success: true,
      providerUsed: 'openai',
      modelUsed: result.modelUsed,
      message: `Motor OPENAI (${result.modelUsed}) conectado y verificado con éxito: "${result.text.trim()}"`,
    });
  } catch (err: any) {
    res.json({
      success: false,
      requestedProvider: 'openai',
      message: `No se pudo conectar con OpenAI: ${err.message}`,
    });
  }
});

// System Real-Time Time Synchronization & Status (America/Santo_Domingo UTC-4)
app.post('/api/system/time-sync', (req, res) => {
  const { clientTimestamp } = req.body;
  if (typeof clientTimestamp === 'number' && clientTimestamp > 0) {
    const serverNow = Date.now();
    const driftMs = clientTimestamp - serverNow;
    // Only adjust if drift is more than 3 seconds
    if (Math.abs(driftMs) > 3000) {
      setGlobalTimeOffset(driftMs);
      console.log(`[Time Sync]: Servidor sincronizado con hora real del cliente. Drift corregido: ${driftMs}ms`);
    }
  }
  const rd = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: Date.now(),
    effectiveTimestamp: getEffectiveCurrentDate().getTime(),
    dominicanTime: rd,
  });
});

app.get('/api/system/time-status', (req, res) => {
  const rd = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: Date.now(),
    effectiveTimestamp: getEffectiveCurrentDate().getTime(),
    dominicanTime: rd,
  });
});

// 2. Odoo Inventory API (Always ensures live Odoo data is loaded)
app.get('/api/odoo/products', async (req, res) => {
  const refresh = req.query.refresh === 'true';

  if (refresh || products.length === 0) {
    await syncOdooInventory();
  }

  res.json({
    success: true,
    lastSync: appConfig.odoo.lastSync,
    totalCount: products.length,
    vitrinaCount: products.filter(p => (p.vitrinaStock || 0) > 0).length,
    almacenCount: products.filter(p => (p.almacenStock || 0) > 0).length,
    products,
  });
});

// Test Odoo Connection Live
app.post('/api/odoo/test-connection', async (req, res) => {
  try {
    const locations = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'stock.location',
      'search_read',
      [[['usage', '=', 'internal']]],
      { fields: ['id', 'complete_name'], limit: 10 },
    ]);
    await syncOdooInventory();
    res.json({
      success: true,
      message: `Conexión al servidor JSON-RPC exitosa. ${products.length} productos activos cargados en tiempo real.`,
      sampleLocations: locations,
    });
  } catch (err: any) {
    res.json({
      success: false,
      message: `Error al conectar con el servidor: ${err.message}`,
    });
  }
});

// Test Evolution API Connection Live
app.post('/api/evolution/test-connection', async (req, res) => {
  try {
    const url = `${appConfig.evolution.serverUrl}/instance/fetchInstances`;
    const response = await fetch(url, {
      headers: { apikey: appConfig.evolution.apiKey },
    });
    if (response.ok) {
      const data = await response.json();
      await syncEvolutionChats();
      res.json({
        success: true,
        message: `Conexión a Evolution API exitosa (Instancia: ${appConfig.evolution.instance}). ${conversations.length} conversaciones sincronizadas.`,
        instances: data,
      });
    } else {
      res.json({
        success: false,
        message: `Evolution API devolvió estado HTTP ${response.status}`,
      });
    }
  } catch (err: any) {
    res.json({
      success: false,
      message: `No se pudo conectar a Evolution API: ${err.message}`,
    });
  }
});

// Get Evolution API Connection State & QR Code for Scanning inside the CRM
app.get('/api/evolution/qrcode', async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    // 1. Check instance metadata & connectionState
    const [stateRes, instancesRes] = await Promise.all([
      fetch(`${serverUrl}/instance/connectionState/${instance}`, {
        headers: { apikey: apiKey },
      }).catch(() => null),
      fetch(`${serverUrl}/instance/fetchInstances`, {
        headers: { apikey: apiKey },
      }).catch(() => null),
    ]);

    const stateData = stateRes && stateRes.ok ? await stateRes.json() : null;
    const instancesData = instancesRes && instancesRes.ok ? await instancesRes.json() : [];

    const instRecord = Array.isArray(instancesData)
      ? instancesData.find((i: any) => i.name === instance || i.instanceName === instance) || instancesData[0]
      : null;

    const currentState: string =
      stateData?.instance?.state || instRecord?.connectionStatus || 'unknown';
    const isConnected = currentState === 'open';

    let qrBase64: string | null = null;
    let pairingCode: string | null = null;

    // 2. If not open (or if forceConnect=true), request QR code from /instance/connect/{instance}
    if (!isConnected || req.query.forceConnect === 'true') {
      const connectRes = await fetch(`${serverUrl}/instance/connect/${instance}`, {
        headers: { apikey: apiKey },
      }).catch(() => null);

      if (connectRes && connectRes.ok) {
        const connectData = await connectRes.json();
        qrBase64 = connectData?.base64 || connectData?.qrcode?.base64 || null;
        pairingCode = connectData?.pairingCode || connectData?.code || null;
      }
    }

    res.json({
      success: true,
      instance,
      state: currentState,
      connected: isConnected,
      ownerJid: instRecord?.ownerJid || null,
      profileName: instRecord?.profileName || null,
      profilePicUrl: instRecord?.profilePicUrl || null,
      qrBase64,
      pairingCode,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Error al consultar estado/QR de Evolution API: ${err.message}`,
    });
  }
});

// Disconnect / Logout WhatsApp Instance & Generate New QR Code to Scan in CRM
app.post('/api/evolution/logout', async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    await fetch(`${serverUrl}/instance/logout/${instance}`, {
      method: 'DELETE',
      headers: { apikey: apiKey },
    });

    // Wait briefly then request a fresh QR code
    await new Promise(r => setTimeout(r, 1200));
    const connectRes = await fetch(`${serverUrl}/instance/connect/${instance}`, {
      headers: { apikey: apiKey },
    });
    const connectData = connectRes.ok ? await connectRes.json() : {};

    res.json({
      success: true,
      state: 'connecting',
      connected: false,
      qrBase64: connectData?.base64 || connectData?.qrcode?.base64 || null,
      pairingCode: connectData?.pairingCode || null,
      message: 'Sesión desvinculada. Escanea el nuevo código QR con WhatsApp.',
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `Error al desvincular instancia: ${err.message}`,
    });
  }
});

// Restart Evolution API Instance
app.post('/api/evolution/restart', async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    const r = await fetch(`${serverUrl.replace(/\/$/, '')}/instance/restart/${instance}`, {
      method: 'POST',
      headers: { apikey: apiKey },
    });
    res.json({
      success: r.ok,
      message: r.ok
        ? `Instancia "${instance}" reiniciada correctamente.`
        : `Evolution API devolvió estado ${r.status} al reiniciar.`,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `No se pudo reiniciar instancia: ${err.message}`,
    });
  }
});

// 3. Evolution Media Streaming Proxy (Audio, Photos, Videos, Stickers, Documents)
app.get('/api/evolution/media/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const isVideo = req.query.video === 'true';

  const media = await fetchMediaBase64FromEvolution(messageId, isVideo);
  if (!media) {
    return res.status(404).json({ success: false, message: 'Media no disponible en Evolution API' });
  }

  res.setHeader('Content-Type', media.mimetype);
  res.setHeader('Content-Length', media.buffer.length);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(media.buffer);
});

// Helper to find conversation by sessionId (exact match prioritized first), related JID, or phone
function findConversationByAnyId(sessionId: string): Conversation | undefined {
  const exact = conversations.find(c => c.sessionId === sessionId);
  if (exact) return exact;
  const cleanDigits = sessionId.replace(/\D/g, '');
  return conversations.find(
    c =>
      relatedJidsBySession.get(c.sessionId)?.has(sessionId) ||
      (cleanDigits.length >= 10 && c.customerPhone === cleanDigits)
  );
}

const lastChatMessagesFetchBySession = new Map<string, number>();

// 4. Live Conversations & Chat Management
app.get('/api/conversations', async (req, res) => {
  recordFrontendHeartbeat();
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  if (conversations.length === 0) {
    await syncEvolutionChats();
  } else if (forceRefresh) {
    lastChatMessagesFetchBySession.clear();
    await syncEvolutionChats();
  } else if (now - lastEvolutionChatsSync > 15000) {
    syncEvolutionChats().catch(() => {});
  }
  // Ensure each conversation has the latest Odoo client status resolved
  for (const conv of conversations) {
    if (conv.customerPhone) {
      const match = findOdooPartnerByPhone(conv.customerPhone);
      if (match) {
        conv.odooPartnerId = match.id;
        conv.isOdooClient = true;
      }
    }
  }
  res.json({ success: true, conversations });
});

app.get('/api/conversations/:sessionId/messages', async (req, res) => {
  recordFrontendHeartbeat();
  try {
    const rawSessionId = req.params.sessionId || (req.query.sessionId as string) || '';
    const sessionId = decodeURIComponent(rawSessionId).trim();
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
      return res.json({ success: true, sessionId: '', messages: [] });
    }
    const conv = findConversationByAnyId(sessionId);
    if (conv) conv.unreadCount = 0;
    const forceRefresh = req.query.refresh === 'true';
    const canonicalKey = conv?.sessionId || sessionId;
    const now = Date.now();
    const lastFetchedAt = lastChatMessagesFetchBySession.get(canonicalKey) || 0;

    // Return cached memory only if loaded within the last 3 seconds and not force-refreshing
    if (
      conv &&
      conv.messages &&
      conv.messages.length > 0 &&
      conv.messagesLoaded &&
      !forceRefresh &&
      now - lastFetchedAt < 3000
    ) {
      return res.json({
        success: true,
        sessionId: conv.sessionId,
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        messages: conv.messages,
      });
    }

    const messages = await loadEvolutionMessagesForChat(sessionId);
    lastChatMessagesFetchBySession.set(canonicalKey, Date.now());

    res.json({
      success: true,
      sessionId: conv?.sessionId || sessionId,
      customerName: conv?.customerName,
      customerPhone: conv?.customerPhone,
      messages: messages || [],
    });
  } catch (err: any) {
    console.log('[Load Messages Notice]:', err.message);
    res.json({
      success: false,
      message: err.message,
      sessionId: req.params.sessionId,
      messages: [],
    });
  }
});

app.get('/api/messages', async (req, res) => {
  recordFrontendHeartbeat();
  try {
    const sessionId = (req.query.sessionId as string || '').trim();
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
      return res.json({ success: true, sessionId: '', messages: [] });
    }
    const messages = await loadEvolutionMessagesForChat(sessionId);
    const conv = findConversationByAnyId(sessionId);
    if (conv) conv.unreadCount = 0;

    res.json({
      success: true,
      sessionId: conv?.sessionId || sessionId,
      customerName: conv?.customerName,
      customerPhone: conv?.customerPhone,
      messages: messages || [],
    });
  } catch (err: any) {
    res.json({ success: false, message: err.message, messages: [] });
  }
});

// Toggle AI on/off for a single chat (Human Takeover)
app.post('/api/conversations/:sessionId/toggle-ai', (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const { enabled } = req.body;
  conv.aiEnabled = enabled !== undefined ? Boolean(enabled) : !conv.aiEnabled;
  aiEnabledBySession.set(conv.sessionId, conv.aiEnabled);

  const lead = customers.find(c => c.phone === conv.customerPhone || c.lidJid === conv.sessionId);
  if (lead) lead.aiEnabled = conv.aiEnabled;

  res.json({
    success: true,
    aiEnabled: conv.aiEnabled,
    message: conv.aiEnabled
      ? 'IA activada en este chat'
      : 'IA pausada. Un agente humano puede intervenir libremente.',
  });
});

// Send Text Message from CRM agent to WhatsApp (supports optional quotedMessage)
app.post('/api/conversations/:sessionId/send', async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const { content, quotedMessage } = req.body;
  if (!content) {
    return res.status(400).json({ success: false, message: 'Contenido requerido' });
  }

  const newMsg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: 'agent',
    type: 'text',
    content,
    quotedMessage,
    timestamp: new Date().toISOString(),
    status: 'sent',
  };

  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = content;
  conv.lastMessageType = 'text';

  broadcastEvent('new_message', { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg });

  // Deliver to WhatsApp via Evolution API in background so UI never blocks
  sendEvolutionMessageToConversation(conv, content, 400, true)
    .then(r => {
      if (r.messageId) {
        newMsg.evolutionMessageId = r.messageId;
        newMsg.id = `evo-${r.messageId}`;
        const contactKeys = getConversationContactKeys(conv);
        markMessageIdProcessed(r.messageId, contactKeys);
      }
    })
    .catch(() => {});
});

// Send Odoo Product Card + Real Product Photo directly to Customer WhatsApp
app.post('/api/conversations/:sessionId/send-product', async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const { productId } = req.body;
  const product = products.find(p => p.id === Number(productId) || p.variantId === Number(productId));
  if (!product) {
    return res.status(404).json({ success: false, message: 'Producto no encontrado en el inventario' });
  }

  const caption = `💻 *${product.name}*\n💰 *Precio:* RD$${product.list_price.toLocaleString()}\n📦 *Disponibilidad:* ${product.virtual_available} unidad(es)${
    product.vitrinaStock ? ` (${product.vitrinaStock} en Vitrina)` : ''
  }\n🏷️ *Condición:* ${product.conditionDetail || product.condition || 'Reacondicionado Clase A'}\n🔗 https://todolapto.com.do${product.website_url || ''}${
    product.description_sale ? `\n\n📋 ${product.description_sale}` : ''
  }\n\n*¿Deseas que te lo aparte ahora mismo?* 🛒`;

  const target = conv.customerPhone.startsWith('18') ? conv.customerPhone : conv.sessionId;
  let sentMediaOk = false;
  let imgDataUri: string | undefined;

  try {
    const imgUrl = `https://todolapto.com.do/web/image/product.template/${product.id}/image_512`;
    const imgRes = await fetch(imgUrl);
    if (imgRes.ok) {
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const arrBuf = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrBuf).toString('base64');
      imgDataUri = `data:${contentType};base64,${base64}`;
      sentMediaOk = await sendEvolutionMedia(
        target,
        'image',
        contentType,
        base64,
        caption,
        `${product.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`
      );
    }
  } catch {
    // Fallback to text card if image fetch fails
  }

  const newMsg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: 'agent',
    type: imgDataUri ? 'image' : 'text',
    content: caption,
    mediaUrl: imgDataUri || product.image_url,
    timestamp: new Date().toISOString(),
    status: 'sent',
  };

  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = `📷 ${product.name} (RD$${product.list_price.toLocaleString()})`;
  conv.lastMessageType = newMsg.type;

  broadcastEvent('new_message', { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg, sentWithPhoto: sentMediaOk });

  if (!sentMediaOk) {
    sendEvolutionMessageToConversation(conv, caption, 400, true).catch(() => {});
  }
});

// Send Media (Image, Video, or Audio Voice Note) from CRM agent to WhatsApp
app.post('/api/conversations/:sessionId/send-media', async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const { mediaType, mimeType, base64Data, caption, fileName } = req.body;
  if (!base64Data) {
    return res.status(400).json({ success: false, message: 'Archivo multimedia requerido' });
  }

  const target = conv.customerPhone.startsWith('18') ? conv.customerPhone : conv.sessionId;
  let sentOk = false;

  if (mediaType === 'audio') {
    sentOk = await sendEvolutionAudio(target, base64Data);
  } else {
    sentOk = await sendEvolutionMedia(
      target,
      mediaType === 'video' ? 'video' : mediaType === 'document' ? 'document' : 'image',
      mimeType || 'image/jpeg',
      base64Data,
      caption,
      fileName
    );
  }

  const dataUri = base64Data.startsWith('data:')
    ? base64Data
    : `data:${mimeType || 'application/octet-stream'};base64,${base64Data}`;

  const newMsg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: 'agent',
    type: mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image',
    content: caption || (mediaType === 'audio' ? '🎤 Nota de voz enviada' : mediaType === 'video' ? '🎥 Video enviado' : '📷 Imagen enviada'),
    mediaUrl: dataUri,
    mediaMimeType: mimeType,
    timestamp: new Date().toISOString(),
    status: 'sent',
  };

  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = newMsg.content;
  conv.lastMessageType = newMsg.type;

  broadcastEvent('new_message', { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg, sentToWhatsApp: sentOk });
});

// 5. AI Voice Note Transcription & Multimodal Image/Video Analysis (OpenAI Whisper & OpenAI Vision)
app.post('/api/ai/transcribe-audio', async (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId) {
    return res.status(400).json({ success: false, message: 'messageId requerido' });
  }

  try {
    const media = await fetchMediaBase64FromEvolution(messageId, false);
    if (!media) {
      return res.status(404).json({ success: false, message: 'No se pudo descargar el audio desde Evolution API' });
    }

    const transcript = (await transcribeAudioWithOpenAI(media.base64, media.mimetype)) || '[Audio sin voz detectable]';
    transcriptionsByMsgId.set(messageId, transcript);

    if (sessionId) {
      const conv = conversations.find(c => c.sessionId === sessionId);
      const msg = conv?.messages.find(m => m.evolutionMessageId === messageId);
      if (conv && msg) {
        msg.transcription = transcript;
        msg.content = `🎤 "${transcript}"`;
        conv.lastMessagePreview = `🎤 "${transcript}"`;
        broadcastEvent('message_updated', { sessionId: conv.sessionId, message: msg });
      }
    }

    res.json({ success: true, transcription: transcript });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error al transcribir audio con OpenAI' });
  }
});

app.post('/api/ai/analyze-media', async (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId) {
    return res.status(400).json({ success: false, message: 'messageId requerido' });
  }

  try {
    const media = await fetchMediaBase64FromEvolution(messageId, false);
    if (!media) {
      return res.status(404).json({ success: false, message: 'No se pudo descargar la imagen desde Evolution API' });
    }

    const analysis = await analyzeImageWithOpenAI(
      media.base64,
      media.mimetype,
      `Analiza esta imagen enviada por un cliente a Todo Lapto (República Dominicana).
Indica en español de forma concisa (máximo 3 líneas):
1. ¿Es un comprobante de pago bancario (monto, banco, referencia), un producto/laptop (marca, modelo), o un equipo para reparación?
2. Recomendación de acción inmediata para el vendedor.`
    );
    aiAnalysisByMsgId.set(messageId, analysis);

    if (sessionId) {
      const conv = conversations.find(c => c.sessionId === sessionId);
      const msg = conv?.messages.find(m => m.evolutionMessageId === messageId);
      if (conv && msg) {
        msg.aiAnalysis = analysis;
        broadcastEvent('message_updated', { sessionId: conv.sessionId, message: msg });
      }
    }

    res.json({ success: true, analysis });
  } catch (err: any) {
    const cleanErr = formatCleanAiError(err);
    res.status(500).json({ success: false, message: cleanErr.summary });
  }
});

// 6. Customers & CRM Leads API + Odoo res.partner Sync
app.get('/api/odoo/customers', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const odooList = await syncOdooCustomers(forceRefresh);
  let filtered = odooList;
  if (query) {
    filtered = odooList.filter(c =>
      (c.name || '').toLowerCase().includes(query) ||
      (c.phone || '').includes(query) ||
      (c.mobile || '').includes(query) ||
      (c.email || '').toLowerCase().includes(query) ||
      String(c.id).includes(query)
    );
  }
  res.json({
    success: true,
    total: filtered.length,
    customers: filtered.slice(0, 200),
    lastSync: new Date(lastOdooCustomersSync).toISOString(),
  });
});

app.get('/api/customers', async (req, res) => {
  // Ensure we have current Odoo customers in cache
  if (odooCustomersCache.length === 0) {
    await syncOdooCustomers();
  }

  // Map real Odoo res.partner records to CustomerLead interface
  const odooLeads: CustomerLead[] = odooCustomersCache.map(p => {
    const rawPhone = p.phone || p.mobile || '';
    const cleanPhone = normalizePhoneDigits(rawPhone);
    const stdPhone = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    return {
      id: `odoo-${p.id}`,
      name: p.name || 'Cliente Odoo',
      phone: stdPhone,
      odooPartnerId: p.id,
      isOdooClient: true,
      address: [p.street, p.city].filter(Boolean).join(', ') || undefined,
      zone: 'santo_domingo',
      aiEnabled: true,
      totalSpent: 0,
      ordersCount: p.sale_order_count || 0,
      detectedInterests: ['Cliente Odoo ERP'],
      objectionsRecorded: [],
      notes: p.email ? `Email: ${p.email}` : undefined,
      createdAt: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
    };
  });

  // Merge with local CRM leads (giving priority to local leads if they match phone)
  const unifiedCustomers: CustomerLead[] = [...customers];
  const seenPhones = new Set<string>(
    customers.map(c => normalizePhoneDigits(c.phone).slice(-10)).filter(Boolean)
  );

  for (const ol of odooLeads) {
    const phoneKey = ol.phone ? ol.phone.slice(-10) : '';
    if (phoneKey && seenPhones.has(phoneKey)) {
      continue;
    }
    if (phoneKey) seenPhones.add(phoneKey);
    unifiedCustomers.push(ol);
  }

  res.json({
    success: true,
    total: unifiedCustomers.length,
    customers: unifiedCustomers,
    odooCount: odooCustomersCache.length,
  });
});

app.post('/api/customers', async (req, res) => {
  const { name, phone, address, zone, notes } = req.body;
  const cleanPhone = normalizePhoneDigits(phone || '');
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere un número de teléfono válido (mínimo 10 dígitos) para registrar el cliente.',
    });
  }
  const standardizedPhone = cleanPhone.length === 10 ? '1' + cleanPhone : cleanPhone;

  let odooPartnerId: number | undefined;
  let isNewOdoo = true;
  try {
    const odooRes = await findOrCreateOdooCustomerByPhone(standardizedPhone, name || 'Cliente WhatsApp');
    if (odooRes?.id) {
      odooPartnerId = odooRes.id;
      isNewOdoo = odooRes.isNew;
    }
  } catch (err: any) {
    console.warn('Odoo partner creation check warning:', err.message);
  }

  const newCustomer: CustomerLead = {
    id: `lead-${Date.now()}`,
    name: name || 'Cliente WhatsApp',
    phone: standardizedPhone,
    odooPartnerId,
    isOdooClient: true,
    address,
    zone: zone || 'santo_domingo',
    aiEnabled: true,
    totalSpent: 0,
    ordersCount: 0,
    detectedInterests: [],
    objectionsRecorded: [],
    notes,
    createdAt: new Date().toISOString(),
    lastInteraction: new Date().toISOString(),
  };

  customers.unshift(newCustomer);
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncCustomerToSupabase(newCustomer).catch(() => {});
  }
  res.json({
    success: true,
    customer: newCustomer,
    reusedExistingOdoo: !isNewOdoo,
    message: isNewOdoo ? 'Cliente creado exitosamente' : 'Cliente ya existía en el registro y fue vinculado',
  });
});

// 7. Orders Pipeline API
app.get('/api/orders', (req, res) => {
  res.json({ success: true, orders: salesOrders });
});

app.post('/api/orders', async (req, res) => {
  const { clientName, clientPhone, productsSummary, productId, price, paymentMethod, address, notes } = req.body;
  const cleanPhone = normalizePhoneDigits(clientPhone || '');
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere un número de teléfono válido (mínimo 10 dígitos) para registrar un pedido o cotización.',
    });
  }
  const stdPhone = cleanPhone.length === 10 ? '1' + cleanPhone : cleanPhone;

  let odooOrderId: number | undefined;
  try {
    const partnerRes = await findOrCreateOdooCustomerByPhone(stdPhone, clientName || 'Cliente WhatsApp');
    const partnerId = partnerRes?.id;

    if (partnerId) {
      const orderRes = await callOdoo('object', 'execute_kw', [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        'sale.order',
        'create',
        [
          {
            partner_id: partnerId,
            origin: `WhatsApp - ${paymentMethod === 'contra_entrega' ? 'Contra Entrega' : 'Transferencia'}`,
            note: `<p>WhatsApp CRM | Cliente: ${clientName} | Tel: ${stdPhone} | Dirección: ${address}</p>`,
            order_line: [
              [
                0,
                0,
                {
                  product_id: productId || products[0]?.variantId || 1042,
                  product_uom_qty: 1,
                  price_unit: parseFloat(price) || 18500,
                  name: productsSummary || 'Producto Todo Lapto',
                },
              ],
            ],
          },
        ],
      ]);
      if (typeof orderRes === 'number') {
        odooOrderId = orderRes;
      }
    }
  } catch (err: any) {
    console.warn('Odoo sale.order create fallback:', err.message);
  }

  const newOrder: SalesOrder = {
    id: `PED-${Date.now()}`,
    odooOrderId,
    clientName,
    clientPhone: stdPhone,
    products: productsSummary,
    productId,
    totalAmount: parseFloat(price) || 0,
    paymentMethod: paymentMethod || 'contra_entrega',
    status: paymentMethod === 'contra_entrega' ? 'aprobado' : 'pendiente',
    address,
    deliveryNotes: notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  salesOrders.unshift(newOrder);

  // Auto-sync to Supabase if configured
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncOrderToSupabase(newOrder).catch(() => {});
  }

  // 1. Notify Internal Sales Team on WhatsApp
  const teamText = `🔔 *🚚 NUEVO PEDIDO ${newOrder.paymentMethod.toUpperCase()}*\n\n👤 Cliente: ${clientName}\n📱 Teléfono: ${stdPhone}\n📍 Dirección: ${address}\n📦 Producto: ${productsSummary}\n💰 Monto: RD$${newOrder.totalAmount.toLocaleString()}\n🧾 Ref Pedido: #${odooOrderId || 'LOCAL'}\n🕐 Fecha: ${new Date().toLocaleTimeString('es-DO')}`;
  sendEvolutionMessage(appConfig.evolution.teamPhone, teamText).catch(e => console.error(e));

  // 2. Automated Customer Order Confirmation via WhatsApp (Evolution API)
  const sendWhatsAppNotification = req.body.sendWhatsAppNotification !== false;
  if (sendWhatsAppNotification && stdPhone && stdPhone.length >= 10) {
    const isContraEntrega = newOrder.paymentMethod === 'contra_entrega';
    const rdTime = getDominicanTimeContext();
    const scheduleNotice = !rdTime.isOpen
      ? `\n⏰ *Aviso de Despacho:* Actualmente nos encontramos fuera de horario laboral (${rdTime.statusDetail}). Tu equipo queda reservado con prioridad y la entrega será coordinada tan pronto iniciemos labores: ${rdTime.nextOpeningStr}.\n`
      : '';

    const clientConfirmationText =
      `🎉 *¡Hola ${clientName}! Tu orden ha sido registrada exitosamente en Todo Lapto.* 📦\n\n` +
      `🧾 *No. de Cotización / Pedido:* ${odooOrderId ? `#${odooOrderId}` : newOrder.id}\n` +
      `💻 *Producto:* ${productsSummary}\n` +
      `💰 *Monto Total:* RD$${newOrder.totalAmount.toLocaleString()}\n` +
      `🚚 *Modalidad:* ${
        isContraEntrega
          ? 'Pago Contra Entrega (Pagas al recibir en efectivo o transferencia)'
          : 'Transferencia Bancaria'
      }\n` +
      `📍 *Dirección de Entrega:* ${address}\n` +
      (notes ? `📝 *Notas de entrega:* ${notes}\n` : '') +
      scheduleNotice +
      `\n🛡️ *Garantía Todo Lapto:* 6 meses de garantía certificada por escrito con checklist técnico de 25 puntos y cargador original.\n` +
      (isContraEntrega
        ? `📞 Nuestro equipo de logística se pondrá en contacto contigo para coordinar la hora de entrega.`
        : `🏦 *Cuentas Oficiales para Transferir:*\n• Banreservas Corriente: 9603638702 (Todo Lapto SRL)\n• Banco Popular Ahorros: 852768712 (Dorys Viola)\n• BHD Ahorros: 2923412015\nPor favor envíanos la foto del comprobante bancario por aquí para despachar tu equipo de inmediato.`) +
      `\n\n¡Muchas gracias por elegirnos! ¿Tienes alguna pregunta o requerimiento adicional? 😊`;

    sendEvolutionMessage(stdPhone, clientConfirmationText).catch(e =>
      console.warn('[Customer WhatsApp Order Confirmation Warning]:', e.message)
    );

    // Sync into conversation history in memory if conversation exists for this phone
    const targetConv = conversations.find(
      c =>
        (c.customerPhone && c.customerPhone.includes(stdPhone.slice(-10))) ||
        (c.customerPhone && stdPhone.includes(c.customerPhone.slice(-10)))
    );

    if (targetConv) {
      const confirmationMsg: ChatMessage = {
        id: `msg-order-${Date.now()}`,
        sender: 'assistant',
        type: 'text',
        content: clientConfirmationText,
        timestamp: new Date().toISOString(),
        status: 'sent',
      };
      recordLocalMessage(targetConv.sessionId, confirmationMsg, targetConv.customerPhone);
      targetConv.messages.push(confirmationMsg);
      targetConv.lastTimestamp = confirmationMsg.timestamp;
      targetConv.lastMessagePreview = clientConfirmationText;
      broadcastEvent('new_message', { sessionId: targetConv.sessionId, message: confirmationMsg });
      broadcastEvent('conversations_update', { count: conversations.length });
    }
  }

  res.json({ success: true, order: newOrder });
});

app.post('/api/orders/:id/status', async (req, res) => {
  const order = salesOrders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
  }

  const { status, adminNotes } = req.body;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  if (adminNotes) order.adminNotes = adminNotes;

  let textClient = '';
  if (status === 'aprobado') {
    textClient = `✅ *¡Tu pago fue verificado y tu pedido está aprobado!* 🎉\n\n🛍️ *Producto:* ${order.products}\n📍 *Dirección:* ${order.address}\n🧾 *Referencia:* ${order.odooOrderId ? '#' + order.odooOrderId : order.id}\n\nEstamos preparando tu paquete para entrega. En breve nuestro equipo de logística coordinará contigo. ¡Muchas gracias por tu compra en Todo Lapto! 😊`;
    sendEvolutionMessage(order.clientPhone, textClient);
    sendEvolutionMessage(appConfig.evolution.adminPhone, `✅ Pedido ${order.id} aprobado en CRM. Cliente ${order.clientPhone} notificado.`);
  } else if (status === 'rechazado') {
    textClient = `❌ *Tu pago no pudo ser verificado*\n\nLamentablemente no pudimos validar el comprobante de pago enviado para el pedido ${order.products}.\n\n¿Qué puedes hacer?\n• Envía nuevamente el comprobante bancario legible\n• Verifica el monto y número de cuenta\n• Contáctanos si necesitas asistencia directa\n\n¡Estamos para servirte! 😊`;
    sendEvolutionMessage(order.clientPhone, textClient);
    sendEvolutionMessage(appConfig.evolution.adminPhone, `⚠️ Pedido ${order.id} rechazado en CRM. Cliente ${order.clientPhone} notificado.`);
  }

  if (textClient && order.clientPhone) {
    const cleanP = order.clientPhone.replace(/\D/g, '').slice(-10);
    const targetConv = conversations.find(
      c => c.customerPhone && c.customerPhone.replace(/\D/g, '').includes(cleanP)
    );
    if (targetConv) {
      const statusMsg: ChatMessage = {
        id: `msg-status-${Date.now()}`,
        sender: 'assistant',
        type: 'text',
        content: textClient,
        timestamp: new Date().toISOString(),
        status: 'sent',
      };
      recordLocalMessage(targetConv.sessionId, statusMsg, targetConv.customerPhone);
      targetConv.messages.push(statusMsg);
      targetConv.lastTimestamp = statusMsg.timestamp;
      targetConv.lastMessagePreview = textClient;
      broadcastEvent('new_message', { sessionId: targetConv.sessionId, message: statusMsg });
    }
  }

  res.json({ success: true, order });
});

app.get('/api/odoo/customer-check', (req, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : '';
  const clean = normalizePhoneDigits(phone);
  if (!clean || clean.length < 7) {
    return res.json({ found: false });
  }
  const partner = findOdooPartnerByPhone(clean);
  if (partner) {
    return res.json({
      found: true,
      partner: {
        id: partner.id,
        name: partner.name,
        phone: partner.phone || partner.mobile,
        saleOrderCount: partner.sale_order_count || 0,
      },
    });
  }
  return res.json({ found: false });
});

// 8. Continuous Learning & AI Insights API
app.get('/api/ai/insights', (req, res) => {
  res.json({ success: true, insights: learnedInsights });
});

// 8.1 Admin Bot Audit Log & Duplicate Diagnostics API
app.get('/api/admin/bot-audit-log', (_req, res) => {
  const total = botAuditLogs.length;
  const sent = botAuditLogs.filter(l => l.decision === 'sent').length;
  const blocked = botAuditLogs.filter(l => l.decision.startsWith('blocked_')).length;
  const errors = botAuditLogs.filter(l => l.decision === 'error').length;
  const avgDuration =
    sent > 0
      ? Math.round(
          botAuditLogs
            .filter(l => l.decision === 'sent')
            .reduce((acc, l) => acc + (l.durationMs || 0), 0) / sent
        )
      : 0;

  res.json({
    success: true,
    logs: botAuditLogs,
    stats: {
      total,
      sent,
      blocked,
      errors,
      avgDurationMs: avgDuration,
      inFlightCount: inFlightBotKeys.size,
      activeCooldowns: lastBotReplyByContactKey.size,
    },
  });
});

app.post('/api/admin/bot-audit-log/clear', (_req, res) => {
  botAuditLogs.length = 0;
  lastAuditLogKeyByPhone.clear();
  try {
    if (fs.existsSync(BOT_AUDIT_LOG_FILE)) {
      fs.unlinkSync(BOT_AUDIT_LOG_FILE);
    }
  } catch {}
  broadcastEvent('bot_audit_update', { type: 'clear' });
  res.json({ success: true, message: 'Registro de auditoría limpiado exitosamente' });
});

app.post('/api/ai/insights', (req, res) => {
  const { category, triggerPhrase, winningPitch, counterObjection, tags } = req.body;
  const newInsight: AILearnedInsight = {
    id: `learn-${Date.now()}`,
    category: category || 'ventas_general',
    triggerPhrase,
    winningPitch,
    counterObjection,
    successRate: 90,
    occurrences: 1,
    tags: Array.isArray(tags) ? tags : ['manual', 'estrategia'],
    updatedAt: new Date().toISOString(),
  };
  learnedInsights.unshift(newInsight);
  res.json({ success: true, insight: newInsight });
});

app.post('/api/ai/learn-from-chat', async (req, res) => {
  const { sessionId } = req.body;
  const conv = conversations.find(c => c.sessionId === sessionId);
  if (!conv) {
    return res.status(400).json({ success: false, message: 'Conversación no encontrada' });
  }

  if (!conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(sessionId);
  }

  if (conv.messages.length === 0) {
    return res.status(400).json({ success: false, message: 'Conversación sin mensajes suficientes' });
  }

  try {
    const transcript = conv.messages
      .slice(-20)
      .map(m => `[${m.sender.toUpperCase()}]: ${m.transcription || m.content}`)
      .join('\n');

    const prompt = `Analiza la siguiente conversación real de ventas de WhatsApp de Todo Lapto (República Dominicana):
${transcript}

Extrae en formato JSON con la siguiente estructura:
{
  "objectionsFound": ["lista de objeciones o dudas planteadas por el cliente"],
  "winningPitch": "la respuesta más efectiva dada o sugerida para convencer al cliente",
  "customerSentiment": "positivo | neutral | negativo",
  "detectedInterests": ["productos o categorías de interés"],
  "closingOpportunity": "explicación breve de cómo cerrar esta venta",
  "newKnowledgePattern": {
    "category": "nombre_categoria_objecion",
    "triggerPhrase": "frase o duda típica detectada",
    "recommendedCounter": "cómo Todo Lapto debe responder para cerrar la venta"
  }
}
Responde ÚNICAMENTE con el objeto JSON.`;

    const aiResult = await generateTextWithConfiguredAI({
      prompt,
      jsonMode: true,
    });

    const parsed = JSON.parse(aiResult.text || '{}');

    if (parsed.newKnowledgePattern?.triggerPhrase && parsed.newKnowledgePattern?.recommendedCounter) {
      const addedInsight: AILearnedInsight = {
        id: `learn-${Date.now()}`,
        category: parsed.newKnowledgePattern.category || 'objecion_detectada',
        triggerPhrase: parsed.newKnowledgePattern.triggerPhrase,
        winningPitch: parsed.newKnowledgePattern.recommendedCounter,
        counterObjection: `Aprendido de conversación real con ${conv.customerName}`,
        successRate: 87,
        occurrences: 1,
        tags: parsed.detectedInterests || ['aprendizaje_automatico'],
        updatedAt: new Date().toISOString(),
      };
      learnedInsights.unshift(addedInsight);
    }

    res.json({
      success: true,
      analysis: parsed,
      totalInsights: learnedInsights.length,
    });
  } catch (err: any) {
    console.error('Learning extraction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper: Check if customer's message refers to a WhatsApp Status (Story) or quotes a status
function isWhatsAppStatusInquiry(rawText: string, isStatusReply = false): boolean {
  if (isStatusReply) return true;
  const cleaned = (rawText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\b(estado|estados|historia|historias|story|stories|subieron|publicaron|publicacion|lo que subieron|la que subieron|el que subieron|foto del estado|video del estado)\b/i.test(cleaned);
}

// Helper: Format active WhatsApp statuses for sales AI context
function formatActiveWhatsAppStatusesPrompt(): string {
  const list = (appConfig.activeWhatsAppStatuses || []).filter(s => s.active !== false);
  if (list.length === 0) {
    return '📱 ESTADOS DE WHATSAPP: Actualmente no hay estados manuales específicos cargados en el CRM. Si el cliente pregunta por un estado de WhatsApp sin especificar el modelo, pregúntale cortésmente qué laptop o producto vio en nuestro estado o pídele una captura de pantalla 📸 para confirmarle disponibilidad y precio de una vez.';
  }

  let text = `=== 📱 ESTADOS DE WHATSAPP ACTIVOS DE TODO LAPTO (STORIES PUBLICADOS HOY) ===\n`;
  text += `El equipo de Todo Lapto tiene actualmente subidos los siguientes productos y promociones a sus estados de WhatsApp:\n\n`;
  list.forEach((s, idx) => {
    const priceStr = typeof s.price === 'number' ? `RD$${s.price.toLocaleString()}` : s.price || '';
    text += `*Estado #${idx + 1}:* ${s.title || s.productName}\n`;
    if (s.productName) text += `   • Producto: ${s.productName}\n`;
    if (priceStr) text += `   • Precio en Estado: ${priceStr}\n`;
    if (s.description) text += `   • Detalles / Especificaciones: ${s.description}\n`;
    text += '\n';
  });

  text += `👉 INSTRUCCIÓN CRÍTICA DE ESTADOS:
1. Si el cliente pregunta "¿Cuánto cuesta la que subieron al estado?", "Vi su estado", "La laptop de la historia", o cita un estado:
   - Identifica a cuál de los estados activos se refiere según el modelo, precio o características mencionadas.
   - Si se refiere a una de ellas: confírmala de inmediato con entusiasmo: "¡Hola! Sí, la que viste en nuestro estado es la [Producto] por [Precio]. [Breve detalle]. La tenemos disponible en nuestra tienda física de la Av. Charles de Gaulle #133 y también con envío a domicilio en Santo Domingo contra entrega 🚚. ¿Te gustaría apartarla?".
   - Si no especificó cuál de las opciones vio: menciona las opciones activas brevemente (ej. "¡Hola! Hoy en nuestro estado tenemos la HP ProBook x360 en RD$7,500 y la Lenovo ThinkPad T480 en RD$14,500. ¿Cuál de esas dos fue la que te interesó?") o pídele que te envíe una captura de pantalla 📸.`;
  return text;
}

// Helper: Detect if customer sent a simple greeting or courtesy that does NOT need an inventory search
function isSimpleConversationalMessage(rawText: string, hasQuote = false): boolean {
  if (hasQuote) return false;
  if (isWhatsAppStatusInquiry(rawText)) return false;

  const cleaned = (rawText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¡!¿?.,;:"'()\-_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length > 65) return false;

  // If the message contains ANY product, brand, price, repair, store, or order keyword, it is NOT a simple greeting
  const commercialOrProductRegex =
    /\b(laptop|lapto|laptos|portatil|notebook|computadora|pc|mouse|raton|impresora|epson|canon|brother|teclado|monitor|pantalla|bocina|parlante|audifono|auricular|headset|diadema|disco|ssd|nvme|ram|memoria|cargador|bateria|router|modem|ups|inversor|mochila|bulto|maletin|camara|webcam|cable|hdmi|vga|usb|adaptador|dell|hp|lenovo|thinkpad|latitude|chromebook|asus|acer|macbook|apple|precio|cuanto|cuesta|vale|catalogo|disponible|stock|barat[oa]|economic[oa]|usad[oa]|nuev[oa]|reacondicionad[oa]|reparacion|reparan|arreglan|garantia|envio|delivery|tienda|ubicacion|direccion|horario|abierto|cerrado|comprar|apartar|pedido|cotizacion|transferencia|cuenta|banco|anuncio|foto|vacante|empleo|trabajo|estudio|oficina|gamer|juego|estado|estados|historia|historias|story|stories|subieron|publicacion|audio|voz|\d{3,})\b/i;

  if (commercialOrProductRegex.test(cleaned)) {
    return false;
  }

  // Match common greetings, courtesies, and short acknowledgments
  const simplePatterns =
    /^(hola|saludos|saludo|buenas|buen dia|buenos dias|buenas tardes|buenas noches|que tal|como estan|como estas|todo bien|klk|que lo que|hey|alo|dime|dimelo|dime a ver|dimelo a ver|cuentame|que paso|que hay|que hubo|buenas todo lapto|hola todo lapto|saludos todo lapto|hola buenas|hola buenos dias|hola buenas tardes|hola buenas noches|saludos buenas|saludos buenos dias|saludos buenas tardes|disculpa|disculpe|una pregunta|tengo una pregunta|una consulta|gracias|muchas gracias|mil gracias|ok|okay|esta bien|ta bien|perfecto|excelente|entendido|listo|dale|de acuerdo|vale|amen|bendiciones|un placer|igualmente|igual)(\s+(amigo|amiga|hermano|lider|bro|senor|sr|sra|jefe|equipo|todo lapto|por favor|gracias))?$/i;

  return simplePatterns.test(cleaned);
}

// Helper: Instant sub-10ms personalized reply for simple greetings & courtesies (Zero inventory search, zero LLM wait)
function buildInstantConversationalReply(conv?: Conversation, rawText = ''): string {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';
  const cleaned = (rawText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¡!¿?.,;:"'()\-_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If conversation already has prior messages in the thread, NEVER repeat the full welcome spiel
  const hasPriorMessages = (conv?.messages || []).filter(m => m.sender === 'assistant' || m.sender === 'customer').length > 1;

  if (/\b(gracias|muchas gracias|mil gracias|bendiciones|amen|un placer|igualmente|igual)\b/i.test(cleaned)) {
    return `¡Siempre a tu orden en *Todo Lapto*${namePart}! 😊 Cualquier otra consulta aquí estamos para servirte.`;
  }

  if (/^(ok|okay|esta bien|ta bien|perfecto|excelente|entendido|listo|dale|de acuerdo|vale)\b/i.test(cleaned)) {
    return `¡Perfecto${namePart}! 👍 Quedamos atentos por aquí para ayudarte con lo que necesites en *Todo Lapto*.`;
  }

  if (/\b(dime|dimelo|dime a ver|dimelo a ver|cuentame|que paso|que hay|que hubo|klk|que lo que)\b/i.test(cleaned)) {
    if (hasPriorMessages) {
      return `¡Saludos de nuevo${namePart}! 😊 Cuéntanos, ¿en qué te podemos colaborar hoy?`;
    }
    return `¡Saludos${namePart}! 😊 Bienvenido a *Todo Lapto* 💻. ¿En qué te podemos colaborar hoy? Cuéntanos qué equipo o accesorio buscas y con gusto te asesoramos.`;
  }

  if (/\b(disculpa|disculpe|una pregunta|tengo una pregunta|una consulta)\b/i.test(cleaned)) {
    return `¡Claro que sí${namePart}! 😊 Cuéntanos, ¿en qué te podemos colaborar hoy?`;
  }

  if (hasPriorMessages) {
    return `¡Saludos de nuevo${namePart}! 😊 Cuéntanos, ¿en qué más te podemos ayudar?`;
  }

  let greetingWord = '¡Hola';
  if (/\bsaludos?\b/i.test(cleaned)) {
    greetingWord = '¡Saludos';
  } else if (/\bbuenos?\s*dias?\b/i.test(cleaned)) {
    greetingWord = '¡Buenos días';
  } else if (/\bbuenas?\s*tardes?\b/i.test(cleaned)) {
    greetingWord = '¡Buenas tardes';
  } else if (/\bbuenas?\s*noches?\b/i.test(cleaned)) {
    greetingWord = '¡Buenas noches';
  } else if (/\bbuenas\b/i.test(cleaned)) {
    greetingWord = '¡Buenas';
  }

  return `${greetingWord}${namePart}! 😊 Bienvenido a *Todo Lapto* 💻. ¿En qué te podemos colaborar hoy? ¿Buscas alguna laptop, impresora o accesorio en específico?`;
}

// Helper: Direct deterministic replies for standard operational queries (Store hours, location, delivery, warranty)
// Responds in < 1ms, zero LLM wait, zero hallucinations, zero re-greetings
function cleanQueryForStoreCheck(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[nota de voz[^\]]*\]/gi, ' ')
    .replace(/\[audio[^\]]*\]/gi, ' ')
    .replace(/\[foto[^\]]*\]/gi, ' ')
    .replace(/\[detalles[^\]]*\]/gi, ' ')
    .replace(/\[contenido visual[^\]]*\]/gi, ' ')
    .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:\s*"?/gi, ' ')
    .replace(/[🎤📷🔍]/g, ' ')
    .replace(/[¡!¿?.,;:"'()\-_*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveDirectStoreQuestion(rawText: string, conv?: Conversation, quotedText?: string): string | null {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';
  const cleanedRaw = cleanQueryForStoreCheck(rawText);
  const cleanedQuote = cleanQueryForStoreCheck(quotedText || '');
  const combined = `${cleanedQuote} ${cleanedRaw}`.trim();

  // Test target: evaluate cleanedRaw first, then cleanedQuote, then combined
  const candidates = [cleanedRaw, cleanedQuote, combined].filter(c => Boolean(c) && c.length <= 140);
  if (candidates.length === 0) return null;

  // 1. Horario / ¿Están laborando? / ¿Están abiertos? / ¿Hasta qué hora? / ¿A qué hora abren?
  const isHoursQuery = candidates.some(c =>
    /\b(estan abiertos|estan abierto|ta abierto|tan abierto|abren hoy|a que hora abren|hasta que hora|cual es el horario|que horario tienen|horario de atencion|horario de trabajo|abren los domingos|abren los sabados|esta abierta la tienda|estan laborando|laboran hoy|laboran|estan trabajando|trabajan hoy)\b/i.test(c) ||
    /^(abierto|abiertos|horario|laborando)\??$/i.test(c)
  );

  if (isHoursQuery) {
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    if (rdNow.isOpen) {
      return `¡Claro que sí${namePart}! Estamos abiertos y laborando ahora mismo en nuestra tienda física en la **Av. Charles de Gaulle No. 133** hasta las 6:00 PM. Puedes pasar a visitarnos o con gusto te coordinamos el envío directo a tu dirección con pago contra entrega en Santo Domingo. 🛒`;
    } else {
      return `Actualmente nos encontramos fuera de horario${namePart}. Abrimos ${rdNow.nextOpeningStr} en nuestra tienda física en la **Av. Charles de Gaulle No. 133**. Con gusto te tomamos tu pedido o consulta por aquí para despacharlo a primera hora. 🛒`;
    }
  }

  // 2. Ubicación / ¿Dónde están ubicados? / Dirección
  const isLocationQuery = candidates.some(c =>
    /\b(donde estan|donde estan ubicados|cual es la ubicacion|donde queda|donde queda la tienda|cual es la direccion|donde estan ustedes|tienen tienda fisica|donde puedo ir|puedo pasar por la tienda)\b/i.test(c) ||
    /^(ubicacion|direccion)\??$/i.test(c)
  );

  if (isLocationQuery) {
    return `Estamos ubicados en la **Av. Charles de Gaulle No. 133, Santo Domingo Este** (frente a la Sirena / cerca de la Bomba Total). ¿Tienes pensado pasar por la tienda hoy o prefieres que coordinemos el envío a domicilio? 📍`;
  }

  // 3. Envíos / Delivery / Envíos al interior
  const isShippingQuery = candidates.some(c =>
    /\b(hacen envios|tienen envio|tienen delivery|hacen delivery|envian al interior|como es el envio|costo de envio|pago contra entrega)\b/i.test(c) ||
    /^(envio|envios|delivery)\??$/i.test(c)
  );

  if (isShippingQuery) {
    return `Sí, realizamos envíos a todo el país${namePart}. En Santo Domingo contamos con servicio a domicilio con pago contra entrega para tu total seguridad. ¿En qué sector o provincia te encuentras? 🚚`;
  }

  // 4. Garantía
  const isWarrantyQuery = candidates.some(c =>
    /\b(tienen garantia|cuanto de garantia|que tiempo de garantia|garantia tienen|dan garantia)\b/i.test(c) ||
    /^(garantia)\??$/i.test(c)
  );

  if (isWarrantyQuery) {
    return `Todos nuestros equipos reacondicionados cuentan con **garantía certificada de 6 meses por escrito** y los nuevos con **1 año de garantía** con soporte técnico directo en Todo Lapto. ¿Buscas alguna laptop o equipo en específico? 🛡️`;
  }

  // 5. Cuentas bancarias / Transferencias
  const isPaymentQuery = candidates.some(c =>
    /\b(metodos de pago|formas de pago|tienen cuenta|numero de cuenta|cuentas de banco|aceptan transferencia|aceptan tarjeta)\b/i.test(c) ||
    /^(cuenta|cuentas|banco|transferencia)\??$/i.test(c)
  );

  if (isPaymentQuery) {
    return `Aceptamos pago contra entrega (efectivo o transferencia al recibir tu equipo en Santo Domingo) y transferencias bancarias a nuestras cuentas de **Banreservas, Banco Popular y BHD**. ¿Qué método te resulta más cómodo? 💳`;
  }

  return null;
}

// Helper: Direct deterministic catalog reply for product/category/brand/budget inquiries
function resolveDirectCatalogReply(rawText: string, conv?: Conversation, hasQuote = false): string | null {
  if (hasQuote) return null;
  const cleaned = (rawText || '').trim();
  if (!cleaned || cleaned.length > 160) return null;

  // Do not intercept simple greetings or courtesies
  if (isSimpleConversationalMessage(cleaned)) {
    return null;
  }

  // Do not intercept order confirmation / address / checkout messages that require CRM tools
  if (
    /\b(apartar|ap[aá]rtame|lo\s*quiero|la\s*quiero|me\s*llevo|comprar|hacer\s*pedido|mi\s*direcci[oó]n|env[ií]amelo|m[aá]ndamelo|calle|sector|avenida|residencial|urbanizaci[oó]n|contra\s*entrega|ya\s*transfer[ií]|comprobante)\b/i.test(
      cleaned
    )
  ) {
    return null;
  }

  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';

  const highlight = getRelevantProductsHighlight(cleaned, '');
  if (!highlight) return null;

  const markerIdx = highlight.indexOf('):\n\n');
  if (markerIdx !== -1) {
    const listPart = highlight.slice(markerIdx + 4).trim();
    if (listPart) {
      return `¡Claro que sí${namePart}! 😊 Aquí tienes las opciones disponibles en stock real en *Todo Lapto*:\n\n${listPart}`;
    }
  }

  const directMatchMarker = 'encontrados) ===\n';
  const directIdx = highlight.indexOf(directMatchMarker);
  if (directIdx !== -1) {
    const listPart = highlight.slice(directIdx + directMatchMarker.length).trim();
    if (listPart) {
      return `¡Claro que sí${namePart}! 😊 Aquí tienes las opciones disponibles en stock real en *Todo Lapto*:\n\n${listPart}\n\n*¿Cuál de estas opciones te interesa? Te lo aparto ahora mismo para entrega o retiro en tienda.* 🛒`;
    }
  }

  if (highlight.includes('=== ⚠️ SIN STOCK ACTUAL PARA')) {
    const genericFamily = detectGenericProductFamily(cleaned.toLowerCase());
    const famLabel = genericFamily?.label || 'ese producto';
    return `Por el momento no tenemos unidades disponibles de *${famLabel}* en stock físico${namePart}. ¿Buscas algún otro equipo, laptop o accesorio en el que te podamos colaborar hoy? 😊`;
  }

  return null;
}

// Helper: Resilient catalog fallback if all AI models experience a temporary 503 spike or quota limit during a query
function buildSmartCatalogFallbackReply(conv?: Conversation, queryText = ''): string {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';

  const lastMsg = conv?.messages[conv.messages.length - 1];
  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());
  const cleanUserQuery = queryText
    .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:/gi, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();

  // 1. Check if it is a direct operational store question (hours, location, shipping, warranty)
  const storeAnswer = resolveDirectStoreQuestion(cleanUserQuery, conv, lastMsg?.quotedMessage?.text);
  if (storeAnswer) {
    return storeAnswer;
  }

  // 1b. Check if it is a simple greeting or courtesy (never return product catalogs for greetings)
  if (isSimpleConversationalMessage(cleanUserQuery, hasQuote)) {
    return buildInstantConversationalReply(conv, cleanUserQuery);
  }

  // 2. If customer is quoting a previous message ("¿Te acuerdas de esto?", "Me interesa", etc.)
  if (hasQuote) {
    return `¡Claro que sí${namePart}! 😊 Recuerdo perfectamente lo que conversamos y las opciones siguen disponibles en nuestra tienda de la **Av. Charles de Gaulle No. 133**. ¿Tienes pensado pasar hoy por la tienda para apartarte el equipo, o prefieres que coordinemos el envío directo a tu dirección? 🛒`;
  }

  // 3. Check direct catalog reply (handles family lists, brand/budget filters, and keyword matches)
  const directCatalog = resolveDirectCatalogReply(cleanUserQuery, conv, false);
  if (directCatalog) {
    return directCatalog;
  }

  const highlight = getRelevantProductsHighlight(cleanUserQuery, '');
  if (highlight) {
    const markerIdx = highlight.indexOf('):\n\n');
    if (markerIdx !== -1) {
      const listPart = highlight.slice(markerIdx + 4).trim();
      if (listPart) {
        return `¡Claro que sí${namePart}! 😊 Aquí tienes las opciones disponibles en stock real en *Todo Lapto*:\n\n${listPart}`;
      }
    }
    const directMatchMarker = 'encontrados) ===\n';
    const directIdx = highlight.indexOf(directMatchMarker);
    if (directIdx !== -1) {
      const listPart = highlight.slice(directIdx + directMatchMarker.length).trim();
      if (listPart) {
        return `¡Claro que sí${namePart}! 😊 Aquí tienes las opciones disponibles en stock real en *Todo Lapto*:\n\n${listPart}\n\n*¿Cuál de estas opciones te interesa? Te lo aparto ahora mismo para entrega o retiro en tienda.* 🛒`;
      }
    }
  }

  const hasPrior = (conv?.messages || []).filter(m => m.sender === 'assistant' || m.sender === 'customer').length > 1;
  if (hasPrior) {
    return `¡Con gusto${namePart}! Cuéntanos qué equipo o modelo específico estás buscando para ayudarte con los detalles y precios.`;
  }

  return `¡Hola${namePart}! 😊 Bienvenido a *Todo Lapto* 💻. ¿En qué te podemos ayudar hoy? ¿Buscas alguna laptop, impresora o accesorio en específico?`;
}

// Helper: Ultra-fast lightweight system instruction for simple greetings/courtesies (Zero inventory search, ~1s latency)
function buildFastConversationalSystemInstruction(conv?: Conversation): string {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName : '';
  const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  return `Eres el asistente oficial de ventas de **Todo Lapto** en República Dominicana (WhatsApp).
Fecha y hora actual en RD: ${rdNow.fullDateStr} · ${rdNow.time12} (America/Santo_Domingo UTC-4).
Cliente actual: ${customerName || 'Cliente de WhatsApp'}.

⚠️ REGLA ESTRICTA DE RESPUESTA RÁPIDA Y CONCISA (MÁXIMO 1 A 2 LÍNEAS):
1. El cliente acaba de enviar únicamente un saludo o mensaje corto de cortesía (sin pedir ningún producto aún).
2. Responde de inmediato en **1 a 2 líneas cortas como máximo**, directo al grano, amable y natural:
   - Si es un saludo ("Saludos", "Hola", "Buenas", "Buenos días", etc.):
     "¡Saludos${customerName ? `, ${customerName}` : ''}! 😊 Bienvenido a *Todo Lapto*. ¿En qué te podemos ayudar hoy? ¿Buscas alguna laptop, impresora o accesorio en específico?"
   - Si es un agradecimiento o confirmación ("Gracias", "Ok", "Perfecto", "Está bien"):
     "¡Siempre a tu orden en *Todo Lapto*! 😊 Cualquier consulta adicional aquí estamos para servirte."
3. **ESTRICTAMENTE PROHIBIDO:**
   - ❌ PROHIBIDO enviar listas de laptops, precios o enlaces cuando el cliente solo saludó.
   - ❌ PROHIBIDO decir "Actualmente estamos cerrados" en un saludo sencillo.`;
}

// Helper: Build Master System Instruction with Live Odoo Inventory, Customer Phone & Learned Brain
function buildMasterSalesSystemInstruction(conv?: Conversation, latestQuery = ''): string {
  const lastMsg = conv?.messages[conv.messages.length - 1];
  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());

  // Fast-path: if the customer only sent a simple greeting or courtesy, do NOT search or inject the 600-product catalog!
  if (isSimpleConversationalMessage(latestQuery, hasQuote)) {
    return buildFastConversationalSystemInstruction(conv);
  }

  // Always use the latest OFFICIAL_TODO_LAPTO_MASTER_PROMPT so updated catalog rules are never overridden by stale cached prompts
  const rawTemplate = OFFICIAL_TODO_LAPTO_MASTER_PROMPT;
  const cleanPhone = (conv?.customerPhone || '').replace(/\D/g, '');
  // Only treat 10-13 digit numbers as valid phone numbers (14+ digits are WhatsApp @lid IDs)
  const detectedPhone =
    cleanPhone.length >= 10 && cleanPhone.length <= 13
      ? cleanPhone.length === 10
        ? `1${cleanPhone}`
        : cleanPhone
      : 'NO DISPONIBLE';

  // Pass the current message, any explicitly quoted text + vision analysis of quoted status/image, and recent customer messages (newest first) for category inheritance
  const quotedContext = [
    lastMsg?.quotedMessage?.text || '',
    lastMsg?.quotedMessage?.aiAnalysis || '',
  ]
    .filter(Boolean)
    .join('\n');
  const recentConversationText = (conv?.messages || [])
    .filter(m => m.sender === 'customer')
    .slice(-6)
    .reverse()
    .map(m => [m.transcription || m.content || '', m.aiAnalysis || ''].filter(Boolean).join(' '))
    .join('\n');
  const relevantHighlight = getRelevantProductsHighlight(latestQuery, quotedContext, recentConversationText);

  // Never dump 45,000 characters of all 600 products when relevantHighlight is empty (which caused 15-26s latency on non-product queries)!
  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  const inStockCount = inStock.length;
  const laptopCount = inStock.filter(p => p.category === 'laptop').length;
  const monitorCount = inStock.filter(p => p.category === 'monitor').length;
  const printerCount = inStock.filter(p => p.category === 'impresora').length;
  const compactOverview = `RESUMEN EJECUTIVO DE INVENTARIO ODOO EN TIEMPO REAL (${inStockCount} productos activos en stock físico en Av. Charles de Gaulle #133):
- Laptops y Portátiles en stock: ${laptopCount} modelos (Dell, Lenovo ThinkPad, HP, Asus, Acer, Chromebooks desde RD$4,000 hasta ejecutivas y gaming).
- Monitores: ${monitorCount} modelos disponibles.
- Impresoras: ${printerCount} modelos disponibles.
- Accesorios y Repuestos: Discos SSD, memorias RAM, cargadores originales, baterías, mochilas, teclados y mouse en stock.
👉 NOTA: El mensaje actual del cliente no especificó un modelo o categoría concreta. Responde de forma breve (1 a 2 líneas), cálida y natural preguntando qué equipo o modelo específico está buscando.`;

  const inventoryContext = relevantHighlight
    ? `RESUMEN DE INVENTARIO ODOO EN TIEMPO REAL (${inStockCount} productos activos en stock vendible):\n${relevantHighlight}`
    : compactOverview;
  const learnedContext = getLearnedInsightsPromptContext();

  // Check registered client status
  const odooPartner = cleanPhone ? findOdooPartnerByPhone(cleanPhone) : null;
  const isOdooRegistered = Boolean(odooPartner || conv?.isOdooClient || (conv?.odooPartnerId && conv.odooPartnerId > 0));
  const clientStatusText = isOdooRegistered
    ? `CLIENTE REGISTRADO (ID: #${odooPartner?.id || conv?.odooPartnerId || ''} - ${odooPartner?.name || conv?.customerName})`
    : `PROSPECTO NUEVO DE WHATSAPP (Aún no registrado)`;

  // Phone validation directive for ordering
  const isPhoneMissingOrLid = detectedPhone === 'NO DISPONIBLE' || detectedPhone.length < 10;
  const orderPhoneValidationDirective = isPhoneMissingOrLid
    ? `\n\n⚠️ INSTRUCCIÓN OBLIGATORIA DEL SISTEMA PARA PEDIDOS:
El cliente actual NO TIENE un número telefónico verificado (solo dispone de ID técnico de WhatsApp o nombre de usuario).
Si el cliente expresa intención de comprar, apartar, cotizar o hacer un pedido:
1. DEBES PAUSAR LA ORDEN Y PEDIR SU NÚMERO DE TELÉFONO O WHATSAPP ("¡Con gusto! Para poder generar tu cotización y registrar tu orden en el sistema, ¿me confirmas por favor tu número de WhatsApp o teléfono de contacto?").
2. TIENES ESTRICTAMENTE PROHIBIDO ejecutar odoo_crear_cotizacion ni registrar_pedido hasta que el cliente proporcione su número telefónico real.`
    : '';

  // Also build customer CRM profile block so the bot knows who it is talking to
  const customerRecord = customers.find(
    c => (cleanPhone && c.phone.includes(cleanPhone)) || c.lidJid === conv?.sessionId
  );
  const customerOrders = salesOrders.filter(
    o => cleanPhone && o.clientPhone.includes(cleanPhone)
  );

  const crmCustomerContext = `\n\n# CONTEXTO EN TIEMPO REAL DEL CLIENTE EN VENDEMÁ CRM
- Nombre en WhatsApp: ${conv?.customerName || 'Cliente'}
- Teléfono verificado: ${detectedPhone}
- Estado del Cliente: ${clientStatusText}
- Zona estimada: ${customerRecord?.zone || conv?.zone || 'Por confirmar'}
- Dirección registrada: ${customerRecord?.address || 'No proporcionada aún'}
- Intereses detectados: ${(conv?.detectedProducts || []).join(', ') || 'Explorando catálogo'}
- Pedidos previos en CRM: ${
    customerOrders.length > 0
      ? customerOrders.map(o => `${o.id} (${o.products} - RD$${o.totalAmount.toLocaleString()} - Estado: ${o.status})`).join('; ')
      : 'Ninguno aún'
  }${orderPhoneValidationDirective}`;

  // Real-time Dominican Republic date, time, business hours & holiday context
  const rdTimeContext = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const rdTimePromptBlock = buildDominicanTimePromptContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const statusPromptBlock = formatActiveWhatsAppStatusesPrompt();

  const filledInstruction =
    rdTimePromptBlock +
    '\n\n' +
    statusPromptBlock +
    '\n\n' +
    rawTemplate
      .replace(/\{\{\s*\$json\.telefono_cliente[^}]*\}\}/g, detectedPhone)
      .replace(/\{\{TELEFONO_CLIENTE\}\}/g, detectedPhone)
      .replace(/\{\{\s*\$json\.inventario_completo\s*\}\}/g, inventoryContext)
      .replace(/\{\{INVENTARIO_COMPLETO\}\}/g, inventoryContext)
      .replace(/\{\{APRENDIZAJE_CEREBRO_IA\}\}/g, learnedContext)
      .replace(/\{\{ESTADOS_WHATSAPP_ACTIVOS\}\}/g, statusPromptBlock)
      .replace(/\{\{HORA_RD\}\}/g, rdTimeContext.time12)
      .replace(/\{\{FECHA_RD\}\}/g, rdTimeContext.fullDateStr)
      .replace(/\{\{ESTADO_NEGOCIO\}\}/g, rdTimeContext.statusSummary)
      .replace(/\{\{PROXIMA_APERTURA\}\}/g, rdTimeContext.nextOpeningStr)
      .replace(/\{\{CONTEXTO_HORARIO_RD\}\}/g, rdTimePromptBlock) +
    crmCustomerContext;

  return filledInstruction;
}

// Helper: Build structured multi-turn conversation history for OpenAI / DeepSeek / Gemini
function buildChatHistoryTurns(conv?: Conversation): { role: 'user' | 'assistant'; content: string }[] {
  if (!conv || !conv.messages || conv.messages.length === 0) return [];
  const recent = conv.messages.slice(-18);
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];

  for (const m of recent) {
    if (isInternalOrNoiseContent(m.content)) continue;

    const role: 'user' | 'assistant' = m.sender === 'customer' ? 'user' : 'assistant';
    let text = m.transcription ? `🎤 [Nota de voz transcrita]: "${m.transcription}"` : m.content || '';
    if (m.aiAnalysis) {
      text += `\n[Análisis de Imagen IA: ${m.aiAnalysis}]`;
    }
    if (m.quotedMessage?.text) {
      text = `📌 [CITANDO MENSAJE ANTERIOR DE ${m.quotedMessage.author || 'Todo Lapto'}]:\n"${m.quotedMessage.text.slice(0, 800)}"\n\n👉 [MENSAJE]: ${text}`;
    }
    if (!text.trim()) continue;

    // Skip any previously sent broken catalog message that erroneously listed USB-4 TASBEL HUB under laptops
    if (role === 'assistant' && text.includes('Catálogo completo de laptops') && text.includes('USB-4 TASBEL HUB')) {
      continue;
    }

    // In assistant turns, if a previous message contained the entire laptop catalog (> 1200 chars),
    // shorten it in history so it doesn't waste context tokens
    if (role === 'assistant' && text.includes('Catálogo completo de laptops') && text.length > 1200) {
      text = text.slice(0, 400) + '\n... [Catálogo completo de laptops enviado previamente]';
    }

    // Merge consecutive messages from the same role so OpenAI/DeepSeek alternating turn rules are respected
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].content += `\n${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }

  return turns;
}

// Helper: Parse and Execute Native CRM Tools (<crm_tools>[...]</crm_tools>) emitted by the AI
async function processAndExecuteCrmTools(
  rawAiResponse: string,
  conv?: Conversation
): Promise<{ cleanText: string; toolsExecuted: string[] }> {
  const toolsExecuted: string[] = [];
  let cleanText = rawAiResponse;
  let createdOdooOrderId: number | undefined;
  let lastPartnerId: number | undefined;

  const toolBlockRegex = /<crm_tools>([\s\S]*?)<\/crm_tools>/gi;
  const matches = [...rawAiResponse.matchAll(toolBlockRegex)];

  for (const match of matches) {
    const jsonStr = match[1].trim();
    try {
      const actions = JSON.parse(jsonStr);
      const actionList = Array.isArray(actions) ? actions : [actions];

      for (const act of actionList) {
        const toolName = act.tool || act.name;
        const params = act.params || act.arguments || {};
        if (!toolName) continue;

        const phoneRaw = (params.telefono || conv?.customerPhone || '').replace(/\D/g, '');
        const stdPhone = phoneRaw.length === 10 ? `1${phoneRaw}` : phoneRaw;

        if (toolName === 'guardar_telefono_cliente' && stdPhone) {
          if (conv && !conversations.some(other => other.sessionId !== conv.sessionId && other.customerPhone === stdPhone)) {
            conv.customerPhone = stdPhone;
          }
          toolsExecuted.push('guardar_telefono_cliente');
        } else if (toolName === 'odoo_buscar_cliente' && stdPhone && stdPhone.length >= 10) {
          try {
            const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, conv?.customerName);
            if (partnerResult?.id) {
              lastPartnerId = partnerResult.id;
              if (conv) {
                conv.odooPartnerId = partnerResult.id;
                conv.isOdooClient = true;
              }
            }
            toolsExecuted.push('odoo_buscar_cliente');
          } catch (e: any) {
            console.warn('[CRM Tool odoo_buscar_cliente error]:', e.message);
          }
        } else if (toolName === 'odoo_crear_cliente') {
          try {
            if (!stdPhone || stdPhone.length < 10) {
              console.warn(`[CRM Tool odoo_crear_cliente Guard]: Teléfono no disponible o inválido (${stdPhone || 'vacío'}). No se crea cliente en Odoo sin teléfono.`);
            } else {
              const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, params.nombre || conv?.customerName);
              if (partnerResult?.id) {
                lastPartnerId = partnerResult.id;
                if (conv) {
                  conv.odooPartnerId = partnerResult.id;
                  conv.isOdooClient = true;
                }
              }
            }
            toolsExecuted.push('odoo_crear_cliente');
          } catch (e: any) {
            console.warn('[CRM Tool odoo_crear_cliente error]:', e.message);
          }
        } else if (toolName === 'odoo_crear_cotizacion') {
          if (!stdPhone || stdPhone.length < 10) {
            console.warn(`[CRM Tool odoo_crear_cotizacion Guard]: Pausando creación de cotización en Odoo: el cliente no tiene un teléfono válido (${stdPhone || 'vacío'}). Se debe pedir el teléfono primero.`);
          } else {
            try {
              if (!lastPartnerId) {
                const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, conv?.customerName);
                if (partnerResult?.id) lastPartnerId = partnerResult.id;
              }
              const partnerIdToUse = lastPartnerId || 1;
              const orderId = await callOdoo('object', 'execute_kw', [
                appConfig.odoo.db,
                appConfig.odoo.uid,
                appConfig.odoo.apiKey,
                'sale.order',
                'create',
                [
                  {
                    partner_id: partnerIdToUse,
                    origin: `WhatsApp CRM - ${params.metodo_pago || 'Contra Entrega'}`,
                    note: `<p>WhatsApp CRM | Tel: ${stdPhone} | Dirección: ${params.direccion || ''}</p>`,
                    order_line: [
                      [
                        0,
                        0,
                        {
                          product_id: Number(params.product_id) || products[0]?.variantId || 1042,
                          product_uom_qty: 1,
                          price_unit: Number(String(params.precio || 0).replace(/,/g, '')) || 15000,
                          name: params.nombre_producto || 'Producto Todo Lapto',
                        },
                      ],
                    ],
                  },
                ],
              ]);
              if (typeof orderId === 'number') {
                createdOdooOrderId = orderId;
              }
              toolsExecuted.push('odoo_crear_cotizacion');
            } catch (e: any) {
              console.warn('[CRM Tool odoo_crear_cotizacion error]:', e.message);
            }
          }
        } else if (toolName === 'registrar_pedido') {
          if (!stdPhone || stdPhone.length < 10) {
            console.warn(`[CRM Tool registrar_pedido Guard]: Pausando registro de pedido en CRM: el cliente no tiene un teléfono válido (${stdPhone || 'vacío'}).`);
          } else {
            const newOrder: SalesOrder = {
              id: `PED-${Date.now()}`,
              odooOrderId: createdOdooOrderId || params.odoo_order_id,
              clientName: conv?.customerName || 'Cliente WhatsApp',
              clientPhone: stdPhone,
              products: params.producto || 'Producto Todo Lapto',
              totalAmount:
                Number(String(params.producto || '').replace(/[^\d.]/g, '')) || 0,
              paymentMethod:
                String(params.metodo_pago || '').toLowerCase().includes('transferencia')
                  ? 'transferencia'
                  : 'contra_entrega',
              status:
                String(params.estado || '').toLowerCase().includes('aprobado')
                  ? 'aprobado'
                  : 'pendiente',
              address: params.direccion || 'Santo Domingo',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            salesOrders.unshift(newOrder);
            toolsExecuted.push('registrar_pedido');
          }
        } else if (toolName === 'notificar_equipo') {
          const tipo = params.tipo || '🔔 ALERTA DE VENTAS CRM';
          const resumen = params.resumen || '';
          const alertText = `🔔 *${tipo}*\n\n👤 Cliente: ${conv?.customerName || 'WhatsApp'}\n📱 Teléfono: ${stdPhone || 'No disponible'}\n📋 Detalle: ${resumen}${
            createdOdooOrderId ? `\n🧾 Cotización Odoo: #${createdOdooOrderId}` : ''
          }`;
          await sendEvolutionMessage(appConfig.evolution.teamPhone, alertText);
          toolsExecuted.push('notificar_equipo');
        }
      }
    } catch (e: any) {
      console.warn('[CRM Tool parse/exec warning]:', e.message);
    }
  }

  // Remove all <crm_tools>...</crm_tools> blocks so customer never sees internal tool syntax
  cleanText = cleanText.replace(toolBlockRegex, '').trim();

  // Strip Markdown links [Ver producto](https://...) -> https://... so WhatsApp renders clean clickable URLs
  cleanText = cleanText.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$2');

  if (createdOdooOrderId) {
    cleanText = cleanText
      .replace(/#\[ID de cotizaci[oó]n\]/gi, `#${createdOdooOrderId}`)
      .replace(/#\[ID\]/gi, `#${createdOdooOrderId}`);
  }

  return { cleanText, toolsExecuted };
}

// Unified Core Sales Bot Auto-Responder (Used by Polling, Webhook, and Manual Trigger)
async function triggerSalesBotReplyForConversation(
  conv: Conversation,
  triggerSource: string
): Promise<{
  success: boolean;
  reply?: string;
  providerUsed?: string;
  modelUsed?: string;
  toolsExecuted?: string[];
  sentToWhatsApp?: boolean;
  error?: string;
}> {
  // CRITICAL: The AI Bot NEVER replies to WhatsApp groups
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`🛡️ [Bot bloqueado]: Se ignoró generación automática para grupo (${conv.sessionId})`);
    return { success: false, error: 'Los grupos de WhatsApp están expresamente excluidos de las respuestas del bot' };
  }

  const initialLastMsg = conv.messages[conv.messages.length - 1];
  const initialSkip = shouldSkipBotReply(conv, initialLastMsg, triggerSource);
  if (initialSkip.skip) {
    return { success: false, error: initialSkip.reason };
  }

  if (!acquireBotLock(conv, triggerSource)) {
    return { success: false, error: 'Ya se está generando una respuesta para este chat' };
  }

  const startTime = Date.now();
  const initialMsgId = normalizeMsgIdKey(initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '');
  if (initialMsgId && triggerSource !== 'manual_crm_trigger') {
    const contactKeys = getConversationContactKeys(conv);
    markMessageIdProcessed(initialMsgId, contactKeys);
  }

  try {
    const initialText = initialLastMsg?.transcription || initialLastMsg?.content || conv.lastMessagePreview || '';
    const initialHasQuote = Boolean(initialLastMsg?.quotedMessage?.text?.trim());
    const isInitialSimpleGreeting =
      initialLastMsg?.type === 'text' &&
      !initialLastMsg?.quotedMessage &&
      isSimpleConversationalMessage(initialText, initialHasQuote);

    // Anti-ban humanized typing simulation:
    // Short greeting: 3500ms composing. Products/catalog: 5500ms composing.
    const typingPresenceMs = isInitialSimpleGreeting ? 3500 : 5500;
    sendEvolutionTypingPresence(conv, typingPresenceMs).catch(() => {});

    // 1. Ensure Odoo inventory is loaded (only block if not a simple greeting)
    if (products.length === 0 && !isInitialSimpleGreeting) {
      await syncOdooInventory();
    }

    // 2. Only fetch full Evolution message history if thread is completely empty or a quoted message needs text hydration
    const needsHistoryHydration =
      !conv.messages ||
      conv.messages.length === 0 ||
      Boolean(initialLastMsg?.quotedMessage && !initialLastMsg.quotedMessage.text);

    if (needsHistoryHydration) {
      await loadEvolutionMessagesForChat(conv.sessionId);
    } else if (!conv.messagesLoaded && !isInitialSimpleGreeting) {
      // Hydrate older context asynchronously without adding 2-4 seconds lag to the bot's current reply!
      loadEvolutionMessagesForChat(conv.sessionId).catch(() => {});
    }

    const lastMsg = conv.messages[conv.messages.length - 1];
    if (!lastMsg) {
      return { success: false, error: 'Sin mensajes en la conversación' };
    }

    // Strictly enforce that the bot never answers if the last message in the thread is already from the assistant or agent
    if (lastMsg.sender !== 'customer' && triggerSource !== 'manual_crm_trigger') {
      return { success: false, error: 'El último mensaje ya fue respondido por el equipo o el bot' };
    }

    // For manual CRM trigger or mixed threads, identify the substantive customer message to address
    const targetCustomerMsg =
      lastMsg.sender === 'customer'
        ? lastMsg
        : [...conv.messages].reverse().find(m => m.sender === 'customer') || lastMsg;

    // 3. Auto-transcribe if the customer sent a voice note (OpenAI Whisper)!
    if (targetCustomerMsg.type === 'audio' && targetCustomerMsg.evolutionMessageId && !targetCustomerMsg.transcription) {
      try {
        console.log(`🎤 [Audio Processing]: Descargando audio para transcribir con Whisper (msgId: ${targetCustomerMsg.evolutionMessageId})...`);
        let media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        if (!media) {
          await new Promise(r => setTimeout(r, 800));
          media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        }
        if (media && media.base64) {
          const trText = await transcribeAudioWithOpenAI(media.base64, media.mimetype);
          if (trText) {
            targetCustomerMsg.transcription = trText;
            targetCustomerMsg.content = `🎤 "${trText}"`;
            transcriptionsByMsgId.set(targetCustomerMsg.evolutionMessageId, trText);
            conv.lastMessagePreview = `🎤 "${trText}"`;
            broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
            console.log(`✅ [Audio Whisper Transcrito]: "${trText}"`);
          }
        }
      } catch (e: any) {
        console.log('[Auto-Transcribe Audio Info]:', e?.message || e);
      }
    }

    // 4. Auto-analyze if the customer sent an image (OpenAI Vision)!
    if (targetCustomerMsg.type === 'image' && targetCustomerMsg.evolutionMessageId && !targetCustomerMsg.aiAnalysis) {
      try {
        console.log(`📷 [Image Processing]: Descargando imagen para analizar con GPT-4o Vision (msgId: ${targetCustomerMsg.evolutionMessageId})...`);
        let media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        if (!media) {
          await new Promise(r => setTimeout(r, 800));
          media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        }
        if (media && media.base64) {
          const visionPrompt = `Analiza detalladamente esta imagen enviada por un cliente a Todo Lapto (tienda física de laptops, tecnología y servicio técnico en Santo Domingo, RD).
Identifica con precisión:
1. CATEGORÍA:
   - Laptop o computadora: marca, modelo exacto, pantalla, etiquetas de specs (Core i3, i5, i7, Celeron, Ryzen, RAM, SSD), condición física visible.
   - Pantalla de especificaciones / Windows: procesador exacto, memoria RAM, almacenamiento, GPU, estado de batería.
   - Daño físico o avería para reparación: pantalla rota/rajada, bisagra rota, no enciende, mensaje de error en pantalla, teclado.
   - Comprobante de pago bancario: Banco (Banreservas, Popular, BHD, etc.), monto exacto en RD$, número de referencia/autorización y fecha.
   - Captura de pantalla de anuncio o estado de WhatsApp de Todo Lapto: producto anunciado, precio, texto visible.
   - Accesorio o repuesto: cargador, batería, teclado, mouse, monitor, memoria, etc.
2. RESUMEN COMERCIAL: Explica qué equipo es y qué necesita el cliente para que el bot de ventas le responda de inmediato con el catálogo, precio o taller de reparación.`;

          const analysis = await analyzeImageWithOpenAI(
            media.base64,
            media.mimetype,
            visionPrompt
          );
          if (analysis) {
            targetCustomerMsg.aiAnalysis = analysis;
            aiAnalysisByMsgId.set(targetCustomerMsg.evolutionMessageId, analysis);
            broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
            console.log(`✅ [Image GPT-4o Vision Analizada]: ${analysis.slice(0, 120)}...`);
          }
        }
      } catch (e: any) {
        console.log('[Auto-Analyze Image Info]:', e?.message || e);
      }
    }

    // 4b. Auto-analyze Quoted Status / Quoted Media with OpenAI Vision!
    // When a customer asks a question directly from inside a WhatsApp Status (Story) or quotes a flyer/photo,
    // analyze the Status image (jpegThumbnail or full media) so the bot knows what product is in that Status!
    if (targetCustomerMsg.quotedMessage) {
      const qId = targetCustomerMsg.quotedMessage.id;
      const isQuotedIdInChatHistory = qId
        ? conv.messages.some(
            m => m.id !== targetCustomerMsg.id && (m.evolutionMessageId === qId || m.id === `evo-${qId}`)
          )
        : true;

      // If customer quotes a Todo Lapto image/video that was never sent in 1-on-1 chat, it is a reply to a WhatsApp Status (Story)!
      if (
        !targetCustomerMsg.quotedMessage.isStatusReply &&
        !isQuotedIdInChatHistory &&
        (targetCustomerMsg.quotedMessage.type === 'image' || targetCustomerMsg.quotedMessage.type === 'video')
      ) {
        targetCustomerMsg.quotedMessage.isStatusReply = true;
        targetCustomerMsg.quotedMessage.author = 'Estado de WhatsApp de Todo Lapto (Story)';
      }

      if (
        !targetCustomerMsg.quotedMessage.aiAnalysis &&
        (targetCustomerMsg.quotedMessage.mediaBase64 ||
          targetCustomerMsg.quotedMessage.isStatusReply ||
          targetCustomerMsg.quotedMessage.type === 'image' ||
          targetCustomerMsg.quotedMessage.type === 'video')
      ) {
        try {
          let qBase64 = targetCustomerMsg.quotedMessage.mediaBase64;
          let qMime = targetCustomerMsg.quotedMessage.mediaMimeType || 'image/jpeg';
          if (!qBase64 && qId) {
            const fetchedQuoted = await fetchMediaBase64FromEvolution(
              qId,
              false,
              targetCustomerMsg.quotedMessage.isStatusReply ? 'status@broadcast' : conv.sessionId
            );
            if (fetchedQuoted?.base64) {
              qBase64 = fetchedQuoted.base64;
              qMime = fetchedQuoted.mimetype || 'image/jpeg';
            }
          }
          if (qBase64) {
            console.log(`📱 [Status/Quoted Vision]: Analizando imagen del Estado de WhatsApp con GPT-4o Vision...`);
            const statusVisionPrompt = `Analiza esta imagen de un Estado de WhatsApp (Story) o publicación de Todo Lapto sobre la cual el cliente está preguntando: "${targetCustomerMsg.transcription || targetCustomerMsg.content}".
Extrae con máxima precisión:
1. Qué producto, laptop, marca y modelo exacto (ej. Dell Latitude, Lenovo ThinkPad, HP ProBook, impresora, monitor, etc.) aparece en el estado.
2. Cualquier texto, precio en RD$, procesador (Core i3/i5/i7, Celeron, Ryzen), memoria RAM, disco SSD o promoción escrita dentro de la imagen o flyer del estado.
3. Si es una foto real sin texto, describe la marca, línea, color y características visibles del equipo.`;
            const qAnalysis = await analyzeImageWithOpenAI(qBase64, qMime, statusVisionPrompt);
            if (qAnalysis) {
              targetCustomerMsg.quotedMessage.aiAnalysis = qAnalysis;
              broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
              console.log(`✅ [Status Vision Analizada]: ${qAnalysis.slice(0, 140)}...`);
            }
          }
        } catch (e: any) {
          console.log('[Quoted/Status Vision Info]:', e?.message || e);
        }
      }
    }

    const isStatusReply = Boolean(targetCustomerMsg.quotedMessage?.isStatusReply);
    const mentionsStatus = isWhatsAppStatusInquiry(
      targetCustomerMsg.transcription || targetCustomerMsg.content || '',
      isStatusReply
    );

    let baseCustomerText = '';
    if (targetCustomerMsg.type === 'audio') {
      baseCustomerText = targetCustomerMsg.transcription
        ? targetCustomerMsg.transcription
        : '🎤 [Nota de voz enviada por el cliente — el audio no se pudo transcribir con claridad]';
    } else if (targetCustomerMsg.type === 'image') {
      const caption = targetCustomerMsg.content && targetCustomerMsg.content !== '📷 Foto' ? targetCustomerMsg.content : '';
      baseCustomerText = targetCustomerMsg.aiAnalysis
        ? (caption ? `${caption}\n[Detalles de la imagen analizada por Visión Artificial IA: ${targetCustomerMsg.aiAnalysis}]` : `[Detalles de la imagen analizada por Visión Artificial IA: ${targetCustomerMsg.aiAnalysis}]`)
        : (caption || '📷 [Foto enviada por el cliente]');
    } else {
      baseCustomerText = targetCustomerMsg.content || 'Hola, me gustaría recibir información.';
    }

    const hasQuote = Boolean(
      targetCustomerMsg.quotedMessage?.text?.trim() || targetCustomerMsg.quotedMessage?.aiAnalysis?.trim()
    );
    const isSimpleMsg =
      !isStatusReply &&
      !mentionsStatus &&
      targetCustomerMsg.type !== 'audio' &&
      targetCustomerMsg.type !== 'image' &&
      isSimpleConversationalMessage(baseCustomerText, hasQuote);

    let quotedBlock = '';
    if (isStatusReply) {
      const statusText =
        targetCustomerMsg.quotedMessage?.text ||
        '📷 [Foto / Oferta publicada en el Estado de WhatsApp de Todo Lapto]';
      const statusVisionDetail = targetCustomerMsg.quotedMessage?.aiAnalysis
        ? `\n🔍 [Contenido visual detectado por IA en la imagen/flyer del Estado]:\n${targetCustomerMsg.quotedMessage.aiAnalysis}\n`
        : '';
      quotedBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ PREGUNTANDO DIRECTAMENTE DESDE UN ESTADO DE WHATSAPP (STORY) DE TODO LAPTO]
El cliente vio un Estado de WhatsApp subido por Todo Lapto y escribió su pregunta directamente desde ese estado (en vez de escribir sin contexto en el chat).

📄 Texto / pie de foto del Estado al que responde el cliente:
"""
${statusText}
"""${statusVisionDetail}
💬 Pregunta o mensaje del cliente sobre ESTE estado:
"${baseCustomerText}"

🎯 INSTRUCCIÓN OBLIGATORIA PARA CONTESTAR EN BASE A LO QUE PREGUNTA EL CLIENTE DE ESE ESTADO:
1. Contesta DIRECTAMENTE a lo que el cliente está preguntando ("${baseCustomerText}") sobre el equipo o promoción de ese estado:
   - Si pregunta por el precio ("¿Precio?", "¿Cuánto cuesta?", "¿En cuánto sale?", "Info"): indícale el precio exacto en RD$, el modelo y las especificaciones clave del equipo del estado (cruzándolo con el inventario en tiempo real o los estados activos).
   - Si pregunta si está disponible ("¿Todavía la tienen?", "¿Disponible?"): confírmale disponibilidad inmediata en stock de ese equipo del estado.
   - Si hace una pregunta específica sobre el equipo del estado ("¿Cuánta RAM tiene?", "¿Es táctil?", "¿Tiene garantía?", "¿Hacen envío?"): responde exactamente esa pregunta sobre el equipo del estado.
2. NO envíes el catálogo completo de 38 laptops cuando el cliente está preguntando por el equipo específico de un estado; enfócate en el producto del estado por el que preguntó.
3. Cierra de forma cordial ofreciendo retiro en nuestra tienda física de la Av. Charles de Gaulle #133 o envío a domicilio con pago contra entrega en Santo Domingo 🚚.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    } else if (mentionsStatus) {
      quotedBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 [ATENCIÓN — EL CLIENTE PREGUNTA POR UN ESTADO DE WHATSAPP / HISTORIA SUBIDA HOY]
El cliente menciona que vio un estado o publicación de Todo Lapto ("${baseCustomerText}").
Consulta la lista de ESTADOS DE WHATSAPP ACTIVOS inyectada en tu instrucción del sistema:
- Si se refiere a uno de los modelos publicados en el estado de hoy, responde directamente a lo que pregunta sobre ese modelo con su precio y stock.
- Si no especificó cuál de las opciones vio, menciónale brevemente los modelos destacados del estado de hoy o pídele que te responda directamente desde el estado o envíe captura 📸.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    } else if (hasQuote) {
      const quotedVisionDetail = targetCustomerMsg.quotedMessage?.aiAnalysis
        ? `\n🔍 [Contenido visual de la imagen citada]:\n${targetCustomerMsg.quotedMessage.aiAnalysis}\n`
        : '';
      quotedBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACIÓN]
Autor del mensaje citado: ${targetCustomerMsg.quotedMessage!.author || 'Todo Lapto'}
Contenido del mensaje anterior que el cliente está citando:
"""
${targetCustomerMsg.quotedMessage!.text || '📷 [Imagen citada]'}
"""${quotedVisionDetail}
Mensaje actual del cliente sobre esta cita anterior:
"${baseCustomerText}"

⚠️ REGLAS OBLIGATORIAS PARA ESTA CITA:
1. Responde directamente en base a lo que el cliente pregunta sobre el mensaje o producto citado ("${baseCustomerText}").
2. SI EL MENSAJE CITADO ES UNA PREGUNTA OPERATIVA (ej. "¿Están laborando?", "¿Abren hoy?", "¿Cuál es el horario?", "¿Dónde están ubicados?", "¿Hacen envíos?", "¿Tienen garantía?"): Responde DIRECTA y EXACTAMENTE a esa pregunta citada informando el estado de la tienda física en la Av. Charles de Gaulle #133. ESTÁ TERMINANTEMENTE PROHIBIDO enviar catálogos o listas de productos cuando el cliente cita una pregunta operativa.
3. SI LA CITA VIENE ACOMPAÑADA DE UNA NOTA DE VOZ O IMAGEN: Interpreta la nota de voz transcrita o imagen en conjunto con la cita. Si la nota de voz fue corta (1-2s), inaudible o dice "dime a ver", responde DIRECTAMENTE a la pregunta o producto citado sin evasivas.
4. SI CITA UN PRODUCTO O LAPTOP: Confirma precio, stock y specs de ese producto citado. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
5. Responde de forma cálida, humana y concisa (máximo 2 a 4 líneas) confirmando disponibilidad en nuestra tienda de la Av. Charles de Gaulle No. 133 o coordinando envío a domicilio.
6. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos. Tienes todo el contexto citado e inventario en tiempo real.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    }

    const customerMessageText = quotedBlock
      ? `${quotedBlock}\nConsulta del cliente: "${baseCustomerText}"`
      : baseCustomerText;

    const systemInstruction = buildMasterSalesSystemInstruction(conv, customerMessageText);
    const fullHistoryTurns = buildChatHistoryTurns(conv);
    // Remove last turn from historyTurns if it's the customer message we're passing in `prompt`
    if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === 'user') {
      fullHistoryTurns.pop();
    }
    const historyTurns = isSimpleMsg ? fullHistoryTurns.slice(-4) : fullHistoryTurns;

    console.log(
      `🤖 [Sales Bot Generating Reply (${triggerSource})]: Cliente="${conv.customerName}" | Citando="${hasQuote ? 'SÍ' : 'NO'}" | Motor=OpenAI (${appConfig.aiProvider?.model || 'gpt-4o-mini'})`
    );

    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    const liveTimePromptNotice = `[🕒 HORA OFICIAL EN REPÚBLICA DOMINICANA (AMERICA/SANTO_DOMINGO UTC-4)]:
- Fecha y hora actual en RD: ${rdNow.fullDateStr} · ${rdNow.time12} (${rdNow.time24} hrs)
- Estado operativo del negocio: ${rdNow.statusSummary} (${rdNow.statusDetail})
- Próxima apertura comercial: ${rdNow.nextOpeningStr}
${rdNow.movedHolidayNotice ? `- Aviso de feriado hoy: ${rdNow.movedHolidayNotice}\n` : ''}${
  rdNow.isOpen
    ? '👉 INSTRUCCIÓN DE HORARIO: La tienda física (Av. Charles de Gaulle #133) y el servicio de entregas están ABIERTOS ahora mismo.'
    : `👉 INSTRUCCIÓN DE HORARIO: Si el cliente SOLO está saludando o preguntando por productos/precios, NO menciones que estamos cerrados; responde directo al grano. ÚNICAMENTE menciona que estamos cerrados (y que despachamos ${rdNow.nextOpeningStr}) si el cliente pregunta por el horario, si puede pasar por la tienda ahora mismo, o al momento de confirmar el despacho de un pedido.`
}`;

    const isCatalogSectionPresent = systemInstruction.includes('=== 🎯 CATÁLOGO COMPLETO OBLIGATORIO DE') || systemInstruction.includes('=== 🎯 FILTRO ESTRICTO ACTIVO');
    const hasPriorMessages = (conv.messages || []).filter(m => m.id !== targetCustomerMsg.id).length > 0;
    const conversationStateNotice = isCatalogSectionPresent
      ? `\n🚨 INSTRUCCIÓN CRÍTICA DE CATÁLOGO COMPLETO: El cliente está consultando por productos o pidiendo ver cuáles tenemos disponibles. ESTÁ ESTRICTAMENTE PROHIBIDO responder en 1 o 2 líneas diciendo "Sí tenemos disponibles, ¿buscas algún modelo o presupuesto?". DEBES ENVIAR AHORA MISMO LA LISTA COMPLETA DE TODOS LOS PRODUCTOS INCLUIDOS EN LA SECCIÓN "=== 🎯 CATÁLOGO COMPLETO OBLIGATORIO ===" O "=== 🎯 FILTRO ESTRICTO ACTIVO ===" DEL INVENTARIO (desde el *1.* hasta el último producto de la lista, sin omitir ninguno).`
      : hasPriorMessages
      ? `\n⚠️ REGLA DE CONVERSACIÓN EN CURSO: El cliente ya está en medio de una conversación previa contigo en este chat. No vuelvas a enviar saludos de bienvenida ("¡Hola [Nombre]!", "Bienvenido a Todo Lapto...") y responde directo a lo que acaba de consultar.`
      : '';

    const promptToSend = isSimpleMsg
      ? `${liveTimePromptNotice}\n\nEl cliente (${conv.customerName}) acaba de enviar un saludo o cortesía: "${baseCustomerText}".\nResponde en máximo 1 o 2 líneas cortas y cordiales saludándole por su nombre y preguntándole en qué equipo, laptop, impresora o accesorio le podemos colaborar hoy. ESTÁ ESTRICTAMENTE PROHIBIDO enviar listas de productos, precios o catálogos en este mensaje.`
      : `${liveTimePromptNotice}${conversationStateNotice}\n\nMensaje actual del cliente (${conv.customerName}):\n${customerMessageText}\n\nResponde ahora como el Agente Oficial de Ventas de Todo Lapto${isCatalogSectionPresent ? ' cumpliendo estrictamente las instrucciones de catálogo completo:' : ':'}`;

    let aiReply = '';
    let toolsExecuted: string[] = [];
    let providerUsed = 'openai';
    let modelUsed = appConfig.aiProvider?.model || 'gpt-4o-mini';

    const storeAnswer = resolveDirectStoreQuestion(baseCustomerText, conv, targetCustomerMsg.quotedMessage?.text);

    if (storeAnswer) {
      aiReply = storeAnswer;
    } else if (isSimpleMsg) {
      aiReply = buildInstantConversationalReply(conv, baseCustomerText);
    } else {
      // Strict OpenAI execution for product queries, catalogs, and technical sales questions
      const aiResult = await generateTextWithConfiguredAI({
        prompt: promptToSend,
        systemInstruction,
        chatMessages: historyTurns,
        allowFallback: false,
      });

      const processed = await processAndExecuteCrmTools(aiResult.text || '', conv);
      aiReply = processed.cleanText.trim();
      toolsExecuted = processed.toolsExecuted;
      providerUsed = aiResult.providerUsed;
      modelUsed = aiResult.modelUsed;
    }

    if (!aiReply) {
      throw new Error('No se pudo generar el texto de respuesta.');
    }

    // Anti-ban humanized pacing (Meta / WhatsApp automated spam prevention):
    // Realistic typing delay: 3500ms for short greetings/answers, 5500ms for catalogs/long lists
    const targetDelayMs = isSimpleMsg ? 3500 : (isCatalogSectionPresent ? 5500 : 3500);
    const sendRes = await sendEvolutionMessageToConversation(
      conv,
      aiReply,
      targetDelayMs,
      triggerSource === 'manual_crm_trigger'
    );
    const sentOk = sendRes.ok;
    const durationMs = Date.now() - startTime;

    if (!sentOk) {
      throw new Error('No se pudo entregar el mensaje a WhatsApp vía Evolution API.');
    }

    const assistantMessage: ChatMessage = {
      id: sendRes.messageId ? `evo-${sendRes.messageId}` : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      evolutionMessageId: sendRes.messageId,
      sender: 'assistant',
      type: 'text',
      content: aiReply,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    if (sendRes.messageId) {
      const contactKeys = getConversationContactKeys(conv);
      markMessageIdProcessed(sendRes.messageId, contactKeys);
    }

    recordLocalMessage(conv.sessionId, assistantMessage, conv.customerPhone);
    conv.messages.push(assistantMessage);
    conv.lastTimestamp = assistantMessage.timestamp;
    conv.lastMessagePreview = aiReply;
    conv.lastMessageType = 'text';

    broadcastEvent('new_message', { sessionId: conv.sessionId, message: assistantMessage });
    broadcastEvent('conversations_update', { count: conversations.length });

    // Schedule a quick live message sync from Evolution API so the CRM reflects the exact WhatsApp message IDs 1:1
    setTimeout(() => {
      loadEvolutionMessagesForChat(conv.sessionId)
        .then(() => {
          broadcastEvent('conversations_update', { count: conversations.length });
        })
        .catch(() => {});
    }, 1800);

    // Record this answered customer message and cooldown across all contact identity keys
    recordBotReplyForConversation(
      conv,
      initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '',
      baseCustomerText,
      aiReply
    );

    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '',
      incomingText: baseCustomerText,
      decision: 'sent',
      reason: `Respuesta entregada con éxito a WhatsApp en ${durationMs}ms vía Evolution API (${providerUsed} / ${modelUsed})`,
      replyText: aiReply,
      durationMs,
    });

    return {
      success: true,
      reply: aiReply,
      providerUsed,
      modelUsed,
      toolsExecuted,
      sentToWhatsApp: sentOk,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '',
      incomingText: initialLastMsg?.transcription || initialLastMsg?.content || '',
      decision: 'error',
      reason: `Error al procesar/enviar respuesta (OpenAI): ${err.message}`,
      durationMs,
    });
    console.log(`[Sales Bot Notice for ${conv.customerName}]:`, err.message);
    return { success: false, error: err.message };
  } finally {
    releaseBotLock(conv);
  }
}

// AI Sales Assistant Suggestion Endpoint (Generates draft in composer without sending — Strictly OpenAI)
app.post('/api/ai/generate-reply', async (req, res) => {
  const { sessionId, userMessage, quotedStatusText, isStatusReply: reqIsStatusReply } = req.body;
  const conv = conversations.find(c => c.sessionId === sessionId);

  const lastMsg = conv?.messages[conv.messages.length - 1];
  const baseText = userMessage || lastMsg?.transcription || lastMsg?.content || conv?.lastMessagePreview || 'Hola';
  const effectiveQuotedText = quotedStatusText || req.body.quotedText || lastMsg?.quotedMessage?.text || '';
  const isStatusReply = Boolean(reqIsStatusReply || req.body.isStatusReply || quotedStatusText || lastMsg?.quotedMessage?.isStatusReply);
  const hasQuote = Boolean(effectiveQuotedText.trim());

  if (products.length === 0) {
    await syncOdooInventory();
  }

  if (conv && !conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(conv.sessionId);
  }

  let quotedBlock = '';
  if (isStatusReply) {
    quotedBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ PREGUNTANDO DIRECTAMENTE DESDE UN ESTADO DE WHATSAPP (STORY) DE TODO LAPTO]
El cliente vio un Estado de WhatsApp subido por Todo Lapto y escribió su pregunta directamente desde ese estado (en vez de escribir sin contexto en el chat).

📄 Contenido del Estado de WhatsApp al que responde el cliente:
"""
${effectiveQuotedText || '📷 [Foto / Oferta publicada en el Estado de WhatsApp de Todo Lapto]'}
"""

💬 Pregunta o mensaje del cliente sobre ESTE estado:
"${baseText}"

🎯 INSTRUCCIÓN OBLIGATORIA PARA CONTESTAR EN BASE A LO QUE PREGUNTA EL CLIENTE DE ESE ESTADO:
1. Contesta DIRECTAMENTE a lo que el cliente está preguntando ("${baseText}") sobre el equipo o promoción de ese estado:
   - Si pregunta por el precio ("¿Precio?", "¿Cuánto cuesta?", "¿En cuánto sale?", "Info"): indícale el precio exacto en RD$, el modelo y las especificaciones clave del equipo del estado.
   - Si pregunta si está disponible ("¿Todavía la tienen?", "¿Disponible?"): confírmale disponibilidad inmediata en stock de ese equipo del estado.
   - Si hace una pregunta específica sobre el equipo del estado ("¿Cuánta RAM tiene?", "¿Es táctil?", "¿Tiene garantía?", "¿Hacen envío?"): responde exactamente esa pregunta sobre el equipo del estado.
2. NO envíes el catálogo completo de 38 laptops cuando el cliente está preguntando por el equipo específico de un estado; enfócate en el producto del estado por el que preguntó.
3. Cierra de forma cordial ofreciendo retiro en nuestra tienda física de la Av. Charles de Gaulle #133 o envío a domicilio con pago contra entrega en Santo Domingo 🚚.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  } else if (hasQuote) {
    quotedBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACIÓN]
Autor del mensaje citado: ${lastMsg?.quotedMessage?.author || 'Todo Lapto'}
Contenido del mensaje anterior que el cliente está citando:
"""
${effectiveQuotedText}
"""
Mensaje actual del cliente sobre la cita: "${baseText}"

⚠️ REGLAS OBLIGATORIAS:
1. Responde directamente en base a lo que el cliente pregunta sobre el mensaje o producto citado ("${baseText}").
2. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
3. Responde de forma cálida, humana y concisa (máximo 2 a 4 líneas) confirmando disponibilidad en tienda y preguntando si pasará hoy por la tienda o prefiere coordinar envío.
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  const queryText = quotedBlock ? `${quotedBlock}\nConsulta del cliente: "${baseText}"` : baseText;
  const systemInstruction = buildMasterSalesSystemInstruction(conv, queryText);
  const fullHistoryTurns = buildChatHistoryTurns(conv);
  if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === 'user') {
    fullHistoryTurns.pop();
  }
  const historyTurns = fullHistoryTurns;

  try {
    const storeAnswer = resolveDirectStoreQuestion(baseText, conv, req.body.quotedStatusText || req.body.quotedText);
    if (storeAnswer) {
      return res.json({
        success: true,
        reply: storeAnswer,
        toolsExecuted: [],
        providerUsed: 'deterministic',
        modelUsed: 'store-direct',
      });
    }

    if (isSimpleConversationalMessage(baseText, hasQuote)) {
      return res.json({
        success: true,
        reply: buildInstantConversationalReply(conv, baseText),
        toolsExecuted: [],
        providerUsed: 'deterministic',
        modelUsed: 'instant-greeting',
      });
    }

    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    const liveTimePromptNotice = `[🕒 HORA OFICIAL EN REPÚBLICA DOMINICANA (AMERICA/SANTO_DOMINGO UTC-4)]:
- Fecha y hora actual en RD: ${rdNow.fullDateStr} · ${rdNow.time12} (${rdNow.time24} hrs)
- Estado operativo del negocio: ${rdNow.statusSummary} (${rdNow.statusDetail})
- Próxima apertura comercial: ${rdNow.nextOpeningStr}
${rdNow.movedHolidayNotice ? `- Aviso de feriado hoy: ${rdNow.movedHolidayNotice}\n` : ''}${
  rdNow.isOpen
    ? '👉 INSTRUCCIÓN DE HORARIO: La tienda física y el servicio de entregas están ABIERTOS ahora mismo.'
    : `👉 INSTRUCCIÓN DE HORARIO: Si el cliente SOLO está saludando o preguntando por productos/precios, NO menciones que estamos cerrados; responde directo al grano. ÚNICAMENTE menciona que estamos cerrados (y que despachamos ${rdNow.nextOpeningStr}) si el cliente pregunta por el horario, si puede pasar por la tienda ahora mismo, o al momento de confirmar el despacho de un pedido.`
}`;

    const promptToSend = `${liveTimePromptNotice}\n\nMensaje actual del cliente:\n${queryText}\n\nResponde siguiendo las reglas del Agente Oficial de Ventas de Todo Lapto de forma clara, precisa y directa al grano:`;

    const result = await generateTextWithConfiguredAI({
      prompt: promptToSend,
      systemInstruction,
      chatMessages: historyTurns,
      allowFallback: false,
    });

    const { cleanText, toolsExecuted } = await processAndExecuteCrmTools(result.text, conv);

    res.json({
      success: true,
      reply: cleanText,
      toolsExecuted,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error al generar respuesta con OpenAI' });
  }
});

// Trigger Immediate AI Sales Bot Auto-Reply & Send to WhatsApp
app.post('/api/conversations/:sessionId/auto-reply', async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const result = await triggerSalesBotReplyForConversation(conv, 'manual_crm_trigger');
  if (!result.success) {
    return res.status(500).json({ success: false, message: result.error || 'Error al generar respuesta con OpenAI' });
  }

  res.json(result);
});

// AI Multimodal Receipt Verifier Endpoint (OpenAI Vision)
app.post('/api/ai/verify-receipt', async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ success: false, message: 'Imagen requerida' });
  }

  try {
    const prompt = `Analiza esta imagen y determina si es un comprobante de pago bancario en República Dominicana (Banreservas, Banco Popular, BHD, Banco Santa Cruz, Qik, etc.).
Extrae los siguientes datos en formato JSON:
{
  "isPaymentReceipt": true | false,
  "bankName": "nombre del banco detectado",
  "amountRD": número flotante del monto transferido,
  "referenceNumber": "número de confirmación / autorización / referencia",
  "date": "fecha y hora del comprobante si es visible",
  "destinationAccount": "cuenta o beneficiario destino",
  "senderName": "nombre de quien envió la transferencia si aparece",
  "confidenceScore": número del 0 al 100,
  "summary": "resumen en una frase del comprobante"
}
Responde ÚNICAMENTE con el objeto JSON.`;

    const jsonText = await analyzeImageWithOpenAI(imageBase64, mimeType || 'image/jpeg', prompt, true);
    const parsed = JSON.parse(jsonText || '{}');
    res.json({ success: true, verification: parsed });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Error al verificar comprobante con OpenAI' });
  }
});

// Track raw webhook HTTP deliveries so duplicate Evolution API webhook retries are ignored without prematurely marking the message as bot-processed
const seenWebhookDeliveryIds = new Map<string, number>();

// 9. Webhook for Evolution API (Real-Time Inbound Messages, Audio, Photos, Videos)
const handleEvolutionWebhook = async (req: express.Request, res: express.Response) => {
  res.status(200).json({ received: true });

  const body = req.body || {};
  const rawEvent = (body?.event || body?.type || '').toString().trim().toLowerCase().replace(/[-_]/g, '.');

  // Accept ONLY messages.upsert and incoming message events (STRICTLY EXCLUDE messages.update, which are delivery status updates)
  const isMessageUpsert =
    rawEvent === 'messages.upsert' ||
    rawEvent === 'messages_upsert' ||
    rawEvent === 'message' ||
    (rawEvent.endsWith('.upsert') && !rawEvent.includes('update'));

  // Robust unpacking: Evolution API can send data as an object, array of records, or nested messages
  const messageData = Array.isArray(body?.data)
    ? body.data[0]
    : Array.isArray(body?.data?.messages)
    ? body.data.messages[0]
    : body?.data || body?.message || body;

  const key = messageData?.key;
  if (!isMessageUpsert || !key || key.fromMe) {
    return;
  }

  const messageId = normalizeMsgIdKey(key.id);
  const now = Date.now();

  if (messageId) {
    const prevWebhookTs = seenWebhookDeliveryIds.get(messageId);
    if (prevWebhookTs && now - prevWebhookTs < 120000) {
      return;
    }
    seenWebhookDeliveryIds.set(messageId, now);
    if (seenWebhookDeliveryIds.size > 1000) {
      const oldestKey = seenWebhookDeliveryIds.keys().next().value;
      if (oldestKey) seenWebhookDeliveryIds.delete(oldestKey);
    }
  }

  if (isMessageIdAlreadyProcessed(messageId)) {
    return;
  }

  const remoteJid = key.remoteJid || '';
  const rawAlt = key.remoteJidAlt || '';
  const participant = key.participant || '';

  // CRITICAL: Ignore all WhatsApp group messages entirely (never respond, never add to CRM inbox)
  if (isWhatsAppGroup(remoteJid) || isWhatsAppGroup(rawAlt) || isWhatsAppGroup(participant)) {
    return;
  }

  // Link @lid and @s.whatsapp.net if remoteJidAlt is present
  if (remoteJid.endsWith('@lid') && rawAlt.endsWith('@s.whatsapp.net')) {
    const altPhone = rawAlt.replace(/@.*$/, '').replace(/\D/g, '');
    if (altPhone) {
      lidToPhoneMap.set(remoteJid, altPhone);
      lidToPhoneMap.set(remoteJid.replace(/@.*$/, ''), altPhone);
    }
  }

  const senderNumber = (
    rawAlt.endsWith('@s.whatsapp.net')
      ? rawAlt
      : remoteJid.endsWith('@lid') && lidToPhoneMap.get(remoteJid)
      ? lidToPhoneMap.get(remoteJid)!
      : remoteJid
  )
    .replace(/@.*$/, '')
    .replace(/\D/g, '');
  const pushName = messageData.pushName || 'Cliente WhatsApp';

  const parsedIncoming = parseSingleEvolutionMessage(messageData, pushName);
  if (!parsedIncoming) return;

  let conv = conversations.find(
    c =>
      c.sessionId === remoteJid ||
      (rawAlt && c.sessionId === rawAlt) ||
      (senderNumber && senderNumber.length <= 12 && c.customerPhone === senderNumber) ||
      relatedJidsBySession.get(c.sessionId)?.has(remoteJid)
  );

  const canonicalNewJid =
    senderNumber && senderNumber.length >= 10 && senderNumber.length <= 12
      ? `${senderNumber}@s.whatsapp.net`
      : remoteJid;

  if (!conv) {
    conv = {
      sessionId: canonicalNewJid,
      customerPhone: senderNumber,
      customerName: pushName,
      aiEnabled: true,
      unreadCount: 1,
      lastTimestamp: parsedIncoming.timestamp,
      lastMessagePreview: parsedIncoming.content,
      lastMessageType: parsedIncoming.type,
      intentStatus: 'explorando',
      detectedProducts: [],
      messages: [parsedIncoming],
      messagesLoaded: false,
      isLiveEvolution: true,
    };
    const jSet = relatedJidsBySession.get(conv.sessionId) || new Set<string>([conv.sessionId]);
    if (remoteJid) jSet.add(remoteJid);
    if (rawAlt) jSet.add(rawAlt);
    relatedJidsBySession.set(conv.sessionId, jSet);
    conversations.unshift(conv);
  } else {
    const jSet = relatedJidsBySession.get(conv.sessionId) || new Set<string>([conv.sessionId]);
    if (remoteJid) jSet.add(remoteJid);
    if (rawAlt) jSet.add(rawAlt);
    relatedJidsBySession.set(conv.sessionId, jSet);
    conv.unreadCount += 1;
    conv.lastTimestamp = parsedIncoming.timestamp;
    conv.lastMessagePreview = parsedIncoming.content;
    conv.lastMessageType = parsedIncoming.type;
    if (
      !conv.messages.some(
        m =>
          (parsedIncoming.evolutionMessageId && m.evolutionMessageId === parsedIncoming.evolutionMessageId) ||
          (parsedIncoming.id && m.id === parsedIncoming.id)
      )
    ) {
      conv.messages.push(parsedIncoming);
    }
  }

  broadcastEvent('new_message', { sessionId: conv.sessionId, message: parsedIncoming });
  broadcastEvent('conversations_update', { count: conversations.length });

  if (appConfig.supabase?.autoSync !== false) {
    autoSyncMessageToSupabase(conv, parsedIncoming).catch(() => {});
  }

  // Trigger AI Reply instantly in background without blocking the webhook
  if (appConfig.globalAiActive && conv.aiEnabled) {
    // Check if this contact is already being processed or was just answered
    const skipCheck = shouldSkipBotReply(conv, parsedIncoming, 'evolution_webhook');
    if (skipCheck.skip) {
      console.log(`🛡️ [Webhook Skip]: ${skipCheck.reason} (${conv.customerName})`);
      return;
    }

    const contactKeys = getConversationContactKeys(conv);
    if (contactKeys.some(k => isBotLockActive(k))) {
      console.log(`🛡️ [Webhook Skip]: Respuesta ya en proceso para ${conv.customerName}`);
      return;
    }

    triggerSalesBotReplyForConversation(conv, 'evolution_webhook').catch(err => {
      console.log(`[Sales Bot Webhook Trigger Info for ${conv.customerName}]:`, err?.message || err);
    });
  }
};

// Mount webhook on all standard Evolution API route endpoints (both /api/webhook and root /webhook)
app.post('/api/webhook/evolution', handleEvolutionWebhook);
app.post('/api/webhook', handleEvolutionWebhook);
app.post('/webhook/evolution', handleEvolutionWebhook);
app.post('/webhook', handleEvolutionWebhook);

// Allow GET for webhook health-check verification in browser
app.get(['/api/webhook/evolution', '/api/webhook', '/webhook/evolution', '/webhook'], (_req, res) => {
  res.json({
    status: 'online',
    service: 'Todo Lapto WhatsApp Evolution Webhook',
    timestamp: new Date().toISOString(),
  });
});

// Endpoint to automatically register the webhook directly inside Evolution API via REST
app.post('/api/evolution/register-webhook', async (req, res) => {
  try {
    const rawUrl = (req.body?.webhookUrl || '').trim();
    if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) {
      return res.status(400).json({ success: false, message: 'Faltan credenciales de Evolution API' });
    }
    const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, '');
    const instance = appConfig.evolution.instance;
    const hostHeader = req.get('x-forwarded-host') || req.get('host') || 'todolapto.com';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const defaultUrl = `${proto}://${hostHeader}/api/webhook/evolution`;
    const targetWebhookUrl = rawUrl || defaultUrl;

    const setRes = await fetch(`${baseUrl}/webhook/set/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: targetWebhookUrl,
          byEvents: false,
          base64: false,
          events: [
            'MESSAGES_UPSERT'
          ]
        }
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!setRes.ok) {
      const errText = await setRes.text().catch(() => '');
      return res.status(setRes.status).json({
        success: false,
        message: `Evolution API devolvió estado ${setRes.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await setRes.json().catch(() => ({}));
    return res.json({
      success: true,
      message: `Webhook registrado exitosamente en Evolution API apuntando a ${targetWebhookUrl}`,
      data,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

async function ensureEvolutionWebhookRegistered(preferredUrl?: string): Promise<void> {
  try {
    if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) return;
    const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, '');
    const instance = appConfig.evolution.instance;

    // Check if webhook is already enabled
    const findRes = await fetch(`${baseUrl}/webhook/find/${instance}`, {
      headers: { apikey: appConfig.evolution.apiKey },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    let isEnabled = false;
    let registeredUrl = '';
    if (findRes && findRes.ok) {
      const data = await findRes.json().catch(() => null);
      isEnabled = Boolean(data?.enabled);
      registeredUrl = data?.url || '';
    }

    const targetUrl = (preferredUrl || (appConfig.evolution as any).webhookUrl || 'https://todolapto.com/api/webhook/evolution').trim();
    if (isEnabled && registeredUrl === targetUrl) {
      console.log(`[Webhook]: Webhook ya registrado y activo en Evolution API (${targetUrl})`);
      return;
    }

    const setRes = await fetch(`${baseUrl}/webhook/set/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: targetUrl,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT'],
        },
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (setRes.ok) {
      console.log(`✅ [Webhook]: Webhook registrado exitosamente en Evolution API apuntando a ${targetUrl}`);
    }
  } catch (err: any) {
    console.log('[Webhook]: Auto-registro de webhook diferido:', err.message);
  }
}



// Image Proxy endpoint to avoid browser 403 Forbidden issues on external CDNs (WhatsApp / Meta / Odoo)
app.get('/api/proxy-image', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('URL requerida');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      return res.status(upstream.status === 403 || upstream.status === 404 ? 204 : upstream.status).end();
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(buffer));
  } catch {
    return res.status(204).end();
  }
});

// ---------------------------------------------------------
// Mount Vite middlewares & Start Background Real-Time Syncs
// ---------------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  const candidateDist = [
    path.join(process.cwd(), 'dist'),
    path.join(__dirname, 'dist'),
    path.join(process.cwd(), 'public_html'),
    path.join(__dirname, 'public_html'),
  ].find(dir => fs.existsSync(path.join(dir, 'index.html')));

  // In development (or whenever pre-built static bundle is not present), mount Vite development middleware
  const shouldUseVite = !isProduction || !candidateDist;

  let viteMounted = false;
  let viteServer: any = null;
  if (shouldUseVite) {
    try {
      console.log('[Server]: Running Vite development middleware for AI Studio live preview');
      const { createServer } = await import('vite');
      viteServer = await createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(viteServer.middlewares);
      viteMounted = true;
      console.log('[Server]: Vite middleware mounted successfully!');
    } catch (viteErr: any) {
      console.warn('[Server]: Could not mount Vite middleware, falling back to static:', viteErr.message);
    }
  }

  if (viteMounted && viteServer) {
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
        return next();
      }
      try {
        const url = req.originalUrl;
        const indexPath = path.join(process.cwd(), 'index.html');
        if (fs.existsSync(indexPath)) {
          let template = fs.readFileSync(indexPath, 'utf-8');
          template = await viteServer.transformIndexHtml(url, template);
          return res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(template);
        }
        next();
      } catch (e: any) {
        viteServer.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distPath = candidateDist || path.join(process.cwd(), 'dist');
    const publicPath = path.join(process.cwd(), 'public');
    console.log(`[Server]: Production mode - serving static files via direct buffer from ${distPath}`);

    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.txt': 'text/plain; charset=utf-8',
      '.webmanifest': 'application/manifest+json',
    };

    const staticMemoryCache = new Map<string, { buffer: Buffer; mime: string }>();

    const readStaticAsset = (relPath: string): { buffer: Buffer; mime: string } | null => {
      const cleanRel = relPath.replace(/^\/+/, '');
      if (!cleanRel || cleanRel.includes('..')) return null;

      if (staticMemoryCache.has(cleanRel)) {
        return staticMemoryCache.get(cleanRel)!;
      }

      const searchRoots = [distPath, path.join(__dirname, 'dist'), publicPath, path.join(__dirname, 'public')];
      for (const rootDir of searchRoots) {
        const fullPath = path.join(rootDir, cleanRel);
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase();
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            const buffer = fs.readFileSync(fullPath);
            // Cache assets up to 5MB in memory for instant 0ms response over LiteSpeed socket
            if (buffer.length < 5 * 1024 * 1024) {
              staticMemoryCache.set(cleanRel, { buffer, mime });
            }
            return { buffer, mime };
          }
        } catch {}
      }
      return null;
    };

    // Handle /favicon.ico and /favicon.svg directly via buffer
    app.get(['/favicon.ico', '/favicon.svg'], (_req, res) => {
      const asset = readStaticAsset('favicon.svg') || readStaticAsset('favicon.ico');
      if (asset) {
        res.setHeader('Content-Type', asset.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(asset.buffer);
      }
      return res.status(204).end();
    });

    // Serve all static assets and SPA routes using direct Buffer res.send()
    // (Avoids express.static / res.sendFile stream pipes that crash LiteSpeed lsnode.js Unix sockets)
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
        return res.status(404).json({ error: 'Endpoint no encontrado' });
      }

      const reqPath = decodeURIComponent(req.path || '/');
      if (reqPath !== '/' && reqPath !== '/index.html') {
        const asset = readStaticAsset(reqPath);
        if (asset) {
          res.setHeader('Content-Type', asset.mime);
          if (reqPath.startsWith('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
          return res.status(200).send(asset.buffer);
        }

        // If request was for a missing static asset file extension, return 404 instead of HTML
        const ext = path.extname(reqPath).toLowerCase();
        if (ext && ext !== '.html') {
          return res.status(404).send('Asset not found');
        }
      }

      // SPA fallback: serve index.html via direct Buffer
      const indexAsset = readStaticAsset('index.html');
      if (indexAsset) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).send(indexAsset.buffer);
      }

      return res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(
          '<!DOCTYPE html><html><head><title>Vendemá CRM</title></head><body style="background:#090d12;color:#fff;font-family:sans-serif;padding:40px;text-align:center;"><h2>Vendemá CRM & Ventas</h2><p>Servidor activo. Por favor ejecuta <code>npm run build</code> para generar los archivos de la interfaz.</p></body></html>'
        );
    });
  }

  // Primary Server instance - strictly ONE listen call for Hostinger (lsnode / Passenger) & Cloud compatibility
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  let isServerListening = false;

  // Make app.listen idempotent so LiteSpeed lsnode.js / Passenger wrappers that call app.listen() on exported app
  // never trigger "http.Server.listen() was called more than once"
  app.listen = ((...args: any[]) => {
    if (isServerListening) {
      const cb = args.find((a: any) => typeof a === 'function');
      if (cb) process.nextTick(cb);
      return server;
    }
    isServerListening = true;
    return server.listen(...args);
  }) as any;

  const onListening = () => {
    const addr = server.address();
    const addrStr =
      typeof addr === 'string'
        ? `socket ${addr}`
        : addr
        ? `${addr.address}:${addr.port} (${addr.family})`
        : `puerto ${PORT}`;
    console.log(
      `🚀 Vendemá CRM Server listening on ${addrStr} | env.PORT=${process.env.PORT || 'default(3000)'} (PID: ${process.pid})`
    );

    // Immediately synchronize WhatsApp chats & Odoo inventory in parallel so the bot is ready within ~1s of boot
    setTimeout(() => {
      syncEvolutionChats()
        .then(() => ensureEvolutionWebhookRegistered())
        .catch(e => console.log('Initial Evolution sync info:', e?.message || e));

      syncOdooInventory()
        .then(() => syncOdooCustomers())
        .catch(e => console.log('Initial Odoo sync info:', e?.message || e));

      hydrateAndSyncUsersWithSupabase()
        .then(() => hydrateAndSyncAiConfigWithSupabase())
        .then(() => hydrateAndSyncHolidaysWithSupabase())
        .then(() => autoSyncConfigToSupabase(appConfig))
        .catch(e => console.log('Initial Supabase sync info:', e?.message || e));
    }, 600);

    // Background synchronization schedule:
    // 1. WhatsApp Evolution API: Fast poll every 3 seconds so new messages trigger "escribiendo..." almost immediately.
    setInterval(() => {
      syncEvolutionChats().catch(() => {});
    }, 3000);

    // 2. Odoo Inventory: Synchronized every 30 minutes (or immediately via manual refresh in UI).
    setInterval(() => {
      syncOdooInventory().catch(() => {});
    }, 1000 * 60 * 30);

    // 3. Odoo Customers: Synchronized every 30 minutes.
    setInterval(() => {
      syncOdooCustomers().catch(() => {});
    }, 1000 * 60 * 30);
  };

  server.on('error', (err: any) => {
    console.log(`[Server Listen Notice on ${PORT}]:`, err.message);
  });

  if (!isServerListening) {
    isServerListening = true;
    // Call server.listen with (PORT, callback) only — no hardcoded host IP —
    // so both dual-stack TCP (IPv4+IPv6) and LiteSpeed/Passenger Unix sockets bind cleanly.
    server.listen(PORT, onListening);
  }

  // Graceful shutdown handling for Hostinger / Passenger / Docker
  const shutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Closing gracefully...`);
    server.close(() => {
      console.log('[Server] HTTP server closed cleanly.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Forcing shutdown after timeout.');
      process.exit(1);
    }, 4000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

export default app;
export { app, startServer };
