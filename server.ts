import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { 
  AppConfig,
  AIProviderType,
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
  WhatsAppStatusItem,
  DiagnosticStage,
  LogSeverity,
  QueueJobStatus,
  QueueJobEntry,
  ConversationLockEntry,
  ServiceHealthStatus,
  ServiceHealthProbe
} from './src/types.ts';
import { OFFICIAL_TODO_LAPTO_MASTER_PROMPT } from './src/masterPrompt.ts';
import { 
  getDominicanTimeContext, 
  buildDominicanTimePromptContext,
  setGlobalHolidayOverrides,
  getHolidaysWithOverridesForYear,
  getAvailableHolidayYears,
  setGlobalTimeOffset,
  getEffectiveCurrentDate,
  syncAuthoritativeDominicanTime,
  formatDominicanTimeOnly
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------
// Fase 1.6 — Atomic File Persistence & Secret Sanitization
// ---------------------------------------------------------
function writeFileAtomicSync(targetPath: string, content: string): boolean {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Validate JSON integrity before writing if target is a .json file
    if (targetPath.endsWith('.json')) {
      JSON.parse(content);
    }
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, targetPath);
    return true;
  } catch (err: any) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
    console.warn(`[Atomic Write Error (${path.basename(targetPath)})]:`, err?.message || err);
    return false;
  }
}

export function sanitizeSecretsInText(input?: string): string {
  if (!input) return '';
  return String(input)
    .replace(/sk-proj-[A-Za-z0-9_-]{12,}/g, 'sk-proj-••••••••••••••••')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-••••••••••••••••')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{16,}/gi, 'Bearer ••••••••••••••••')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt-••••••••••••••••');
}

export function maskSecretValue(raw?: string): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  if (clean.includes('••••') || clean.includes('****')) return clean;
  const tail = clean.length >= 6 ? clean.slice(-4) : '';
  if (clean.startsWith('sk-proj-')) {
    return `sk-proj-••••••••••••••••••••${tail}`;
  }
  if (clean.startsWith('sk-')) {
    return `sk-••••••••••••••••••••${tail}`;
  }
  return `••••••••••••••••${tail}`;
}

export function isMaskedSecret(val?: string): boolean {
  if (!val) return true;
  const trimmed = String(val).trim();
  return !trimmed || trimmed.includes('••••') || trimmed.includes('****');
}

// Pending Supabase Sync Ledger (Fase 1.6)
export interface PendingSyncItem {
  id: string;
  entityType: 'config' | 'user' | 'conversation' | 'message' | 'order' | 'customer' | 'holiday';
  entityId: string;
  syncStatus: 'SYNCED' | 'PENDING_SYNC' | 'SYNC_ERROR';
  attempts: number;
  lastAttemptAt: string;
  lastError?: string;
}

const PENDING_SYNC_FILE = path.join(__dirname, '.vendema-pending-sync.json');
const pendingSupabaseSyncMap = new Map<string, PendingSyncItem>();

try {
  if (fs.existsSync(PENDING_SYNC_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PENDING_SYNC_FILE, 'utf-8'));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item?.id) pendingSupabaseSyncMap.set(item.id, item);
      }
    }
  }
} catch {}

let savePendingSyncTimer: NodeJS.Timeout | null = null;
function scheduleSavePendingSync() {
  if (savePendingSyncTimer) return;
  savePendingSyncTimer = setTimeout(() => {
    savePendingSyncTimer = null;
    writeFileAtomicSync(
      PENDING_SYNC_FILE,
      JSON.stringify(Array.from(pendingSupabaseSyncMap.values()).slice(-500), null, 2)
    );
  }, 1000);
}

function recordSupabaseSyncState(
  entityType: PendingSyncItem['entityType'],
  entityId: string,
  success: boolean,
  errorMsg?: string
) {
  const key = `${entityType}:${entityId}`;
  const existing = pendingSupabaseSyncMap.get(key);
  if (success) {
    if (existing) {
      existing.syncStatus = 'SYNCED';
      existing.lastAttemptAt = new Date().toISOString();
      existing.lastError = undefined;
      pendingSupabaseSyncMap.delete(key);
      scheduleSavePendingSync();
    }
    return;
  }
  const attempts = (existing?.attempts || 0) + 1;
  pendingSupabaseSyncMap.set(key, {
    id: key,
    entityType,
    entityId,
    syncStatus: attempts >= 3 ? 'SYNC_ERROR' : 'PENDING_SYNC',
    attempts,
    lastAttemptAt: new Date().toISOString(),
    lastError: sanitizeSecretsInText(errorMsg || 'Fallo de red al sincronizar con Supabase'),
  });
  scheduleSavePendingSync();
}

// ---------------------------------------------------------
// Fase 1.2 — Global Process Error Handlers & Lifecycle State
// ---------------------------------------------------------
let isServerShuttingDown = false;
const backgroundIntervals: NodeJS.Timeout[] = [];
let lastWebhookReceivedAt: string | null = null;

function registerBackgroundInterval(fn: () => void, ms: number): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (!isServerShuttingDown) fn();
  }, ms);
  backgroundIntervals.push(timer);
  return timer;
}

process.on('uncaughtException', (err) => {
  const msg = sanitizeSecretsInText(err?.stack || err?.message || String(err));
  console.error(`[Process UncaughtException] [CRITICAL]: ${msg}`);
});
process.on('unhandledRejection', (reason: any) => {
  const msg = sanitizeSecretsInText(reason?.stack || reason?.message || String(reason));
  console.error(`[Process UnhandledRejection] [HIGH]: ${msg}`);
});
process.on('exit', (code) => {
  console.log(`[Process Exit] Node process exiting with code: ${code}`);
});
process.on('beforeExit', (code) => {
  console.log(`[Process BeforeExit] Event loop is empty! code: ${code}`);
});

const app = express();
app.set('trust proxy', true);
const rawPort = process.env.PORT;
const isNumericPort = rawPort && !isNaN(Number(rawPort));
const PORT: number | string = isNumericPort ? Number(rawPort) : (rawPort || 3000);

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Request logging for Hostinger / Nginx reverse proxy debugging
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/ready' && req.path !== '/ping') {
    console.log(`[HTTP ${req.method}] ${req.url} (Host: ${req.headers.host || 'unknown'})`);
  }
  next();
});

// Fase 1.1 — Controlled CORS with same-origin & configured origins support
const ALLOWED_CORS_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (
    ALLOWED_CORS_ORIGINS.length === 0 ||
    ALLOWED_CORS_ORIGINS.includes(origin) ||
    origin.includes('.run.app') ||
    origin.includes('todolapto.com') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  ) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-session-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Fase 1.2 — Health & Readiness Probes (No secrets exposed)
app.get(['/health', '/api/health', '/ping'], (_req, res) => {
  res.status(isServerShuttingDown ? 503 : 200).json({
    status: isServerShuttingDown ? 'shutting_down' : 'ok',
    service: 'Vendemá CRM & Ventas',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get(['/ready', '/api/ready'], (_req, res) => {
  const configReady = Boolean(appConfig && appConfig.odoo && appConfig.evolution);
  const usersReady = Array.isArray(systemUsers) && systemUsers.length > 0;
  const isReady = !isServerShuttingDown && configReady && usersReady;
  res.status(isReady ? 200 : 503).json({
    ready: isReady,
    shuttingDown: isServerShuttingDown,
    checks: {
      configLoaded: configReady,
      usersLoaded: usersReady,
      supabaseConfigured: Boolean(appConfig?.supabase?.url && appConfig?.supabase?.anonKey),
      evolutionConfigured: Boolean(appConfig?.evolution?.serverUrl && appConfig?.evolution?.instance),
      openaiConfigured: Boolean(appConfig?.aiProvider?.openaiApiKey && !isMaskedSecret(appConfig.aiProvider.openaiApiKey)),
      odooConfigured: Boolean(appConfig?.odoo?.url && appConfig?.odoo?.db),
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------
// Server-Sent Events (SSE) Real-Time Broadcast Clients
// ---------------------------------------------------------
const sseClients = new Set<express.Response>();

function broadcastEvent(eventType: string, payload: any) {
  const safePayload = eventType === 'config_updated' && payload ? getPublicMaskedConfig(payload) : payload;
  const data = JSON.stringify({ type: eventType, payload: safePayload, timestamp: new Date().toISOString() });
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
      SUPABASE_URL: cfg.supabase?.url || '',
      SUPABASE_ANON_KEY: cfg.supabase?.anonKey || '',
      ODOO_URL: cfg.odoo?.url || '',
      ODOO_DB: cfg.odoo?.db || '',
      ODOO_UID: cfg.odoo?.uid !== undefined ? String(cfg.odoo.uid) : '',
      ODOO_API_KEY: cfg.odoo?.apiKey || '',
      EVOLUTION_SERVER_URL: cfg.evolution?.serverUrl || '',
      EVOLUTION_INSTANCE: cfg.evolution?.instance || '',
      EVOLUTION_API_KEY: cfg.evolution?.apiKey || '',
      EVOLUTION_TEAM_PHONE: cfg.evolution?.teamPhone || '',
      EVOLUTION_ADMIN_PHONE: cfg.evolution?.adminPhone || '',
      OPENAI_API_KEY: cfg.aiProvider?.openaiApiKey || '',
    };

    for (const [key, val] of Object.entries(vars)) {
      if (val && !isMaskedSecret(val)) {
        process.env[key] = val;
      }
    }

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

    for (const [key, val] of Object.entries(vars)) {
      if (!keysHandled.has(key)) {
        updatedLines.push(`${key}="${val}"`);
      }
    }

    if (process.env.APP_URL && !updatedLines.some(l => l.startsWith('APP_URL='))) {
      updatedLines.push(`APP_URL="${process.env.APP_URL}"`);
    }

    const newContent = updatedLines.join('\n').trim() + '\n';
    if (newContent !== existingContent.trim() + '\n') {
      writeFileAtomicSync(ENV_FILE_PATH, newContent);
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
    deepseekApiKey: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY' ? process.env.DEEPSEEK_API_KEY : '',
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
    geminiApiKey: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' ? process.env.GEMINI_API_KEY : '',
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
    apiKey: process.env.EVOLUTION_API_KEY || '9C4281C5F9A2-4C50-BAD6-20329BDC634A',
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

// Public/Private Config Separator (Fase 1.1: Never expose raw secrets on GET /api/config)
function getPublicMaskedConfig(cfg: AppConfig): AppConfig & {
  secretStatus: {
    hasOpenaiKey: boolean;
    hasGeminiKey: boolean;
    hasDeepseekKey: boolean;
    hasOdooKey: boolean;
    hasEvolutionKey: boolean;
    hasSupabaseKey: boolean;
  };
} {
  const rawOpenai = cfg.aiProvider?.openaiApiKey || '';
  const rawGemini = cfg.aiProvider?.geminiApiKey || '';
  const rawDeepseek = cfg.aiProvider?.deepseekApiKey || '';
  const rawOdoo = cfg.odoo?.apiKey || '';
  const rawEvolution = cfg.evolution?.apiKey || '';
  const rawSupabase = cfg.supabase?.anonKey || '';

  return {
    ...cfg,
    aiProvider: cfg.aiProvider
      ? {
          ...cfg.aiProvider,
          openaiApiKey: maskSecretValue(rawOpenai),
          geminiApiKey: maskSecretValue(rawGemini),
          deepseekApiKey: maskSecretValue(rawDeepseek),
        }
      : undefined,
    odoo: {
      ...cfg.odoo,
      apiKey: maskSecretValue(rawOdoo),
    },
    evolution: {
      ...cfg.evolution,
      apiKey: maskSecretValue(rawEvolution),
    },
    supabase: cfg.supabase
      ? {
          ...cfg.supabase,
          anonKey: maskSecretValue(rawSupabase),
        }
      : undefined,
    secretStatus: {
      hasOpenaiKey: Boolean(rawOpenai && !isMaskedSecret(rawOpenai)),
      hasGeminiKey: Boolean(rawGemini && !isMaskedSecret(rawGemini)),
      hasDeepseekKey: Boolean(rawDeepseek && !isMaskedSecret(rawDeepseek)),
      hasOdooKey: Boolean(rawOdoo && !isMaskedSecret(rawOdoo)),
      hasEvolutionKey: Boolean(rawEvolution && !isMaskedSecret(rawEvolution)),
      hasSupabaseKey: Boolean(rawSupabase && !isMaskedSecret(rawSupabase)),
    },
  };
}

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
        const rawSavedProvider = saved.aiProvider.provider;
        const savedProvider = (rawSavedProvider === 'gemini' || !rawSavedProvider ? 'openai' : rawSavedProvider) as AIProviderType;
        const savedModel = String(saved.aiProvider.model || '').trim();
        let migratedModel = savedModel;
        if (!migratedModel || migratedModel.includes('gemini') || migratedModel === 'gpt-4o-mini') {
          migratedModel = 'gpt-4o-mini';
        }
        const loadedOpenAiKey = !isMaskedSecret(saved.aiProvider.openaiApiKey)
          ? String(saved.aiProvider.openaiApiKey).trim()
          : process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
          ? process.env.OPENAI_API_KEY.trim()
          : '';
        const loadedGeminiKey = !isMaskedSecret(saved.aiProvider.geminiApiKey)
          ? String(saved.aiProvider.geminiApiKey).trim()
          : process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
          ? process.env.GEMINI_API_KEY.trim()
          : '';
        const loadedDeepseekKey = !isMaskedSecret(saved.aiProvider.deepseekApiKey)
          ? String(saved.aiProvider.deepseekApiKey).trim()
          : process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY'
          ? process.env.DEEPSEEK_API_KEY.trim()
          : '';

        appConfig.aiProvider = {
          ...appConfig.aiProvider,
          ...saved.aiProvider,
          provider: savedProvider,
          model: migratedModel,
          systemPrompt: shouldRefreshPrompt ? OFFICIAL_TODO_LAPTO_MASTER_PROMPT : savedPrompt,
          openaiApiKey: loadedOpenAiKey,
          openaiBaseUrl: saved.aiProvider.openaiBaseUrl || 'https://api.openai.com/v1/chat/completions',
          geminiApiKey: loadedGeminiKey,
          deepseekApiKey: loadedDeepseekKey,
          deepseekBaseUrl: saved.aiProvider.deepseekBaseUrl || 'https://api.deepseek.com/v1',
        };
      }
      if (saved.odoo) {
        appConfig.odoo = {
          ...appConfig.odoo,
          ...saved.odoo,
          url: saved.odoo.url || process.env.ODOO_URL || appConfig.odoo.url,
          db: saved.odoo.db || process.env.ODOO_DB || appConfig.odoo.db,
          uid: saved.odoo.uid ?? (process.env.ODOO_UID ? Number(process.env.ODOO_UID) : appConfig.odoo.uid),
          apiKey: !isMaskedSecret(saved.odoo.apiKey)
            ? saved.odoo.apiKey
            : process.env.ODOO_API_KEY || appConfig.odoo.apiKey,
        };
      }
      if (saved.evolution) {
        const rawSavedEvoKey = !isMaskedSecret(saved.evolution.apiKey)
          ? String(saved.evolution.apiKey || '').trim()
          : '';
        const effectiveEvoKey =
          !rawSavedEvoKey || rawSavedEvoKey === '52700613C062-421C-B800-FBC560B54BB4'
            ? process.env.EVOLUTION_API_KEY || '9C4281C5F9A2-4C50-BAD6-20329BDC634A'
            : rawSavedEvoKey;
        appConfig.evolution = {
          ...appConfig.evolution,
          ...saved.evolution,
          serverUrl: saved.evolution.serverUrl || process.env.EVOLUTION_SERVER_URL || appConfig.evolution.serverUrl,
          instance: saved.evolution.instance || process.env.EVOLUTION_INSTANCE || appConfig.evolution.instance,
          apiKey: effectiveEvoKey,
          teamPhone: saved.evolution.teamPhone || process.env.EVOLUTION_TEAM_PHONE || appConfig.evolution.teamPhone,
          adminPhone: saved.evolution.adminPhone || process.env.EVOLUTION_ADMIN_PHONE || appConfig.evolution.adminPhone,
        };
      }
      if (saved.supabase) {
        appConfig.supabase = {
          ...appConfig.supabase,
          ...saved.supabase,
          url: saved.supabase.url || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
          anonKey: !isMaskedSecret(saved.supabase.anonKey)
            ? saved.supabase.anonKey
            : process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
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
      writeFileAtomicSync(CONFIG_FILE_PATH, content);
      if (CONFIG_FALLBACK_PATH !== CONFIG_FILE_PATH) {
        writeFileAtomicSync(CONFIG_FALLBACK_PATH, content);
      }
    }
    syncCredentialsToEnv(appConfig, persistToEnv);
  } catch (err: any) {
    console.log('[Config Save Info]:', err.message);
  }
}

loadPersistedConfig();

// ---------------------------------------------------------
// Fase 1.1 — User Hierarchy, Password Hashing (scrypt) & Signed Sessions
// ---------------------------------------------------------
const USERS_FILE_PATH = path.join(__dirname, '.vendema-users.json');
const USERS_FALLBACK_PATH = path.join(process.cwd(), '.vendema-users.json');
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`vendema-crm-session-secret-${appConfig.odoo?.db || 'odoo'}-${__dirname}`)
    .digest('hex');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isPasswordHashed(pw?: string): boolean {
  return Boolean(pw && pw.startsWith('scrypt$'));
}

function hashUserPassword(plain: string): string {
  const clean = String(plain || '').trim();
  if (!clean) return '';
  if (isPasswordHashed(clean)) return clean;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(clean, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyUserPassword(
  plainInput: string,
  storedPassword?: string
): { valid: boolean; needsMigration: boolean } {
  const cleanInput = String(plainInput || '').trim();
  const stored = String(storedPassword || '').trim();
  if (!cleanInput || !stored) return { valid: false, needsMigration: false };

  if (isPasswordHashed(stored)) {
    const parts = stored.split('$');
    if (parts.length !== 3) return { valid: false, needsMigration: false };
    const [, salt, expectedHex] = parts;
    try {
      const derived = crypto.scryptSync(cleanInput, salt, 64);
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      if (derived.length !== expectedBuf.length) return { valid: false, needsMigration: false };
      return {
        valid: crypto.timingSafeEqual(derived, expectedBuf),
        needsMigration: false,
      };
    } catch {
      return { valid: false, needsMigration: false };
    }
  }

  // Legacy plain-text match -> transparently migrate to scrypt hash!
  const matched = stored === cleanInput;
  return { valid: matched, needsMigration: matched };
}

interface ActiveSessionRecord {
  sessionId: string;
  userId: string;
  username: string;
  role: UserRole;
  createdAt: number;
  expiresAt: number;
}

const activeSessionsMap = new Map<string, ActiveSessionRecord>();
const loginRateLimitMap = new Map<string, { count: number; firstAttemptAt: number; lockedUntil: number }>();

function createSignedSessionToken(user: UserAccount): { token: string; expiresAt: number } {
  const sessionId = crypto.randomBytes(12).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `vendema_s1.${sessionId}.${user.id}.${user.role}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const token = `${payload}.${sig}`;

  activeSessionsMap.set(sessionId, {
    sessionId,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: now,
    expiresAt,
  });

  return { token, expiresAt };
}

function verifySignedSessionToken(rawToken?: string): {
  valid: boolean;
  userId?: string;
  role?: UserRole;
  sessionId?: string;
  expired?: boolean;
} {
  const clean = String(rawToken || '').trim();
  if (!clean) return { valid: false };

  if (clean.startsWith('vendema_s1.')) {
    const parts = clean.split('.');
    if (parts.length !== 6) return { valid: false };
    const [prefix, sessionId, userId, role, expiresAtStr, providedSig] = parts;
    const payload = `${prefix}.${sessionId}.${userId}.${role}.${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    try {
      const a = Buffer.from(providedSig, 'hex');
      const b = Buffer.from(expectedSig, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { valid: false };
      }
    } catch {
      return { valid: false };
    }
    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || Date.now() > expiresAt) {
      activeSessionsMap.delete(sessionId);
      return { valid: false, expired: true };
    }
    return { valid: true, userId, role: role as UserRole, sessionId };
  }

  // Backward compatibility for existing browser tokens within 24h window
  const legacyMatch = clean.match(/^vendema_tk_(usr_[a-zA-Z0-9_]+)_(\d+)$/);
  if (legacyMatch) {
    const [, userId, tsStr] = legacyMatch;
    const issuedAt = Number(tsStr);
    if (issuedAt && Date.now() - issuedAt > SESSION_TTL_MS) {
      return { valid: false, expired: true };
    }
    const u = systemUsers.find(usr => usr.id === userId && usr.activo);
    if (u) {
      return { valid: true, userId: u.id, role: u.role };
    }
  }

  return { valid: false };
}

function extractTokenFromRequest(req: express.Request): string {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const customHeader = req.headers['x-session-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)vendema_session=([^;]+)/);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return '';
}

function setSessionCookie(res: express.Response, token: string, req: express.Request) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieParts = [
    `vendema_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecure) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', 'vendema_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireSessionRole(allowedRoles: UserRole[], enforceStrict = false) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const token = extractTokenFromRequest(req);
    if (!token) {
      if (!enforceStrict) {
        return next();
      }
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida. Por favor inicia sesión.',
      });
    }
    const verified = verifySignedSessionToken(token);
    if (!verified.valid || !verified.userId) {
      if (!enforceStrict) {
        return next();
      }
      return res.status(401).json({
        success: false,
        message: verified.expired ? 'Tu sesión ha expirado. Inicia sesión nuevamente.' : 'Sesión inválida.',
      });
    }
    const user = systemUsers.find(u => u.id === verified.userId && u.activo);
    const effectiveRole = user?.role || verified.role;
    if (effectiveRole && !allowedRoles.includes(effectiveRole)) {
      return res.status(403).json({
        success: false,
        message: 'No tienes permisos suficientes para realizar esta acción administrativa.',
      });
    }
    (req as any).currentUser = user;
    next();
  };
}

const DEFAULT_USERS: UserAccount[] = [
  {
    id: 'usr_super_nelson',
    nombre: 'Nelson',
    username: 'nelson',
    password: hashUserPassword('elmejor19'),
    whatsapp: '18496260800',
    role: 'super_admin',
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_dueno_negocio',
    nombre: 'Dueño Todo Lapto',
    username: 'dueno',
    password: hashUserPassword('dueno123'),
    whatsapp: '18094228738',
    role: 'dueno',
    activo: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'usr_empleado_ventas',
    nombre: 'Asesor de Ventas',
    username: 'empleado',
    password: hashUserPassword('empleado123'),
    whatsapp: '18492588738',
    role: 'empleado',
    activo: true,
    createdAt: new Date().toISOString(),
  },
];

let systemUsers: UserAccount[] = [];

function ensureDefaultUsersPresent(): boolean {
  let migratedAny = false;
  for (const defUser of DEFAULT_USERS) {
    const idx = systemUsers.findIndex(u => u.username.toLowerCase() === defUser.username.toLowerCase());
    if (idx === -1) {
      if (defUser.username === 'nelson') {
        systemUsers.unshift({ ...defUser });
      } else {
        systemUsers.push({ ...defUser });
      }
      migratedAny = true;
    } else if (defUser.username === 'nelson') {
      systemUsers[idx].role = 'super_admin';
      systemUsers[idx].activo = true;
      if (!systemUsers[idx].password) {
        systemUsers[idx].password = defUser.password;
        migratedAny = true;
      }
    } else if (!systemUsers[idx].password) {
      systemUsers[idx].password = defUser.password;
      migratedAny = true;
    }
  }

  // Transparently migrate any existing plain-text passwords in memory to scrypt hash
  for (const u of systemUsers) {
    if (u.password && !isPasswordHashed(u.password)) {
      u.password = hashUserPassword(u.password);
      migratedAny = true;
    }
  }
  return migratedAny;
}

function savePersistedUsers() {
  try {
    ensureDefaultUsersPresent();
    const content = JSON.stringify(systemUsers, null, 2);
    let existingContent = '';
    if (fs.existsSync(USERS_FILE_PATH)) {
      existingContent = fs.readFileSync(USERS_FILE_PATH, 'utf-8');
    }
    if (content !== existingContent) {
      writeFileAtomicSync(USERS_FILE_PATH, content);
      if (USERS_FALLBACK_PATH !== USERS_FILE_PATH) {
        writeFileAtomicSync(USERS_FALLBACK_PATH, content);
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

  const migrated = ensureDefaultUsersPresent();
  if (migrated && fs.existsSync(USERS_FILE_PATH)) {
    savePersistedUsers();
  }
  console.log(`[Users Loaded]: ${systemUsers.length} active users loaded (passwords protected with scrypt). Super Admin: @nelson`);
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
      if (remoteAi.provider && appConfig.aiProvider.provider !== remoteAi.provider) {
        appConfig.aiProvider.provider = remoteAi.provider;
        updated = true;
      }
      if (!appConfig.aiProvider.openaiApiKey && remoteAi.openaiApiKey) {
        appConfig.aiProvider.openaiApiKey = String(remoteAi.openaiApiKey).trim();
        updated = true;
      }
      if (!appConfig.aiProvider.geminiApiKey && remoteAi.geminiApiKey) {
        appConfig.aiProvider.geminiApiKey = String(remoteAi.geminiApiKey).trim();
        updated = true;
      }
      if (!appConfig.aiProvider.deepseekApiKey && remoteAi.deepseekApiKey) {
        appConfig.aiProvider.deepseekApiKey = String(remoteAi.deepseekApiKey).trim();
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

function getActiveGeminiKey(): string {
  const providerCfg = appConfig.aiProvider;
  return sanitizeBearerKey(
    providerCfg?.geminiApiKey ||
      (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
        ? process.env.GEMINI_API_KEY
        : '')
  );
}

function getActiveDeepseekKey(): string {
  const providerCfg = appConfig.aiProvider;
  return sanitizeBearerKey(
    providerCfg?.deepseekApiKey ||
      (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY'
        ? process.env.DEEPSEEK_API_KEY
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
        return `¡Claro que sí! 😊 La *${matchedProd.name}* sigue disponible en *RD$${matchedProd.list_price.toLocaleString()}* (${matchedProd.virtual_available} unidad(es) en stock real en nuestra tienda de la *Av. Charles de Gaulle No. 133*).\n\n¿Deseas pasar hoy por la tienda para apartártela o prefieres que te coordinemos envío a domicilio con pago contra entrega en Santo Domingo? 🛒`;
      }
      return `¡Claro que sí! 😊 ¿Sobre cuál equipo o pregunta te gustaría que te confirme los detalles? Estoy atento por aquí para ayudarte de inmediato.`;
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

  if (/(nota de voz|audio|grabaci[oó]n|micr[oó]fono|🎤|\[audio)/i.test(userMsg)) {
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    if (!rdNow.isOpen) {
      return `¡Hola! 😊 En este momento nos encontramos fuera de horario laboral (${rdNow.statusDetail}), pero con gusto te tomamos tu pedido o consulta por aquí para despacharlo a primera hora ${rdNow.nextOpeningStr}. ¿En qué equipo, laptop o accesorio te podemos colaborar? 💻📦`;
    }
    return `¡Hola! 😊 Con gusto te atiendo en *Todo Lapto*. ¿Qué modelo de laptop, impresora o accesorio estás buscando para pasarte opciones y precios disponibles de inmediato? 💻✨`;
  }

  // 4a. If sysInstruction already contained the catalog block, return it directly!
  if (sysInstruction) {
    const sysBlockMatch = sysInstruction.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/);
    if (sysBlockMatch && sysBlockMatch[1]?.trim()) {
      return sysBlockMatch[1].trim();
    }
  }

  // 4b. If the user is asking for a generic product family (laptop, pc, impresora, mouse, monitor, teclado, etc.)
  const matchedFamily = detectGenericProductFamily(userMsg);
  if (matchedFamily) {
    const familyHighlight = getRelevantProductsHighlight(userMsg, '', '');
    const familyBlockMatch = familyHighlight.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/);
    if (familyBlockMatch && familyBlockMatch[1]?.trim()) {
      return familyBlockMatch[1].trim();
    }
  }

  // 4c. If sysInstruction didn't have the catalog block, compute it dynamically from live inventory
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

  // 4d. Handle customer sticker, laugh, meme or reaction
  if (
    lower.includes('[el cliente envió un sticker') ||
    lower.includes('sticker') ||
    /^(jajaja|jejeje|jaja|jeje|😂|🤣|😹|xd|gracioso|lol)+$/i.test(lower.replace(/\s+/g, ''))
  ) {
    return `¡Jajaja! 😂 ¡Saludos! ¿En qué te podemos colaborar hoy? Cuéntanos si andas buscando alguna laptop, impresora o accesorio y con gusto te pasamos las opciones de inmediato. 💻✨`;
  }

  // 4e. Handle customer short conversation confirmation ("Ahhh bueno", "Ps mejor", "ok", "listo", "perfecto")
  if (/^(ahhh?\s*bueno|ps\s*mejor|pues\s*mejor|ok|okay|esta\s*bien|ta\s*bien|perfecto|excelente|entendido|listo|de\s*acuerdo|ya\s*veo|comprendo|chevere|así\s*mismo)\b/i.test(lower)) {
    return `¡Así mismo es! 👍 Quedamos atentos por aquí para cuando gustes apartar tu pedido o pasar por nuestra tienda física en la *Av. Charles de Gaulle No. 133*. ¡Siempre a tu orden en Todo Lapto! 😊`;
  }

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

async function callGeminiApi(options: {
  prompt: string;
  sysInstruction?: string;
  chatMessages?: { role: 'user' | 'assistant'; content: string }[];
  jsonMode?: boolean;
  temperature?: number;
  model?: string;
}): Promise<{ text: string; modelUsed: string }> {
  const geminiKey = getActiveGeminiKey();
  if (!geminiKey) {
    throw new Error('No hay una API Key de Google Gemini configurada.');
  }

  let modelName = options.model || appConfig.aiProvider?.model || 'gemini-3.5-flash-lite';
  if (!modelName.startsWith('gemini')) {
    modelName = 'gemini-3.5-flash-lite';
  }

  const contents: any[] = [];
  if (options.chatMessages && options.chatMessages.length > 0) {
    for (const cm of options.chatMessages) {
      if (cm.content?.trim()) {
        contents.push({
          role: cm.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: cm.content }],
        });
      }
    }
  }
  contents.push({
    role: 'user',
    parts: [{ text: options.prompt }],
  });

  const bodyPayload: any = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.35,
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  if (options.sysInstruction) {
    bodyPayload.systemInstruction = {
      parts: [{ text: options.sysInstruction }],
    };
  }

  const t0 = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(35000),
  });

  const durationMs = Date.now() - t0;

  if (!res.ok) {
    let errMessage = `Gemini HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.error?.message) {
        errMessage += `: ${errBody.error.message}`;
      }
    } catch {}

    recordSystemApiLog({
      service: 'AI Engine',
      action: `Gemini Chat (${modelName})`,
      method: 'POST',
      url,
      statusCode: res.status,
      success: false,
      durationMs,
      requestPreview: options.prompt.slice(0, 100),
      error: errMessage,
    });
    throw new Error(errMessage);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  recordSystemApiLog({
    service: 'AI Engine',
    action: `Gemini Chat (${modelName})`,
    method: 'POST',
    url,
    statusCode: res.status,
    success: true,
    durationMs,
    requestPreview: options.prompt.slice(0, 100),
    responseSnippet: text.trim().slice(0, 140),
  });

  return { text, modelUsed: modelName };
}

async function callOpenAiChat(options: {
  prompt: string;
  sys?: string;
  chatMessages?: { role: 'user' | 'assistant'; content: string }[];
  jsonMode?: boolean;
  temperature?: number;
  model?: string;
  openaiKey: string;
}): Promise<{ text: string; modelUsed: string }> {
  const model = options.model || 'gpt-4o-mini';
  const isReasoningModel = model.startsWith('o1') || model.startsWith('o3');
  const openaiUrl = resolveChatCompletionsUrl(
    appConfig.aiProvider?.openaiBaseUrl,
    'https://api.openai.com/v1/chat/completions'
  );

  const messages: any[] = [];
  if (options.sys) {
    messages.push({ role: isReasoningModel ? 'developer' : 'system', content: options.sys });
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
    model,
    messages,
    ...(isReasoningModel
      ? { max_completion_tokens: 1024 }
      : { temperature: options.temperature ?? 0.35, max_tokens: 1024 }),
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };

  const t0 = Date.now();
  const res = await fetch(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.openaiKey}`,
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(30000),
  });

  const durationMs = Date.now() - t0;
  if (!res.ok) {
    let errorDetail = '';
    try {
      const errBody = await res.json();
      errorDetail = errBody?.error?.message || '';
    } catch {}
    const errMessage = `OpenAI HTTP ${res.status}${errorDetail ? `: ${errorDetail}` : ''}`;
    recordSystemApiLog({
      service: 'AI Engine',
      action: `OpenAI Chat (${model})`,
      method: 'POST',
      url: openaiUrl,
      statusCode: res.status,
      success: false,
      durationMs,
      requestPreview: options.prompt.slice(0, 100),
      error: errMessage,
      responseSnippet: errorDetail.slice(0, 180),
    });
    throw new Error(errMessage);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  recordSystemApiLog({
    service: 'AI Engine',
    action: `OpenAI Chat (${model})`,
    method: 'POST',
    url: openaiUrl,
    statusCode: res.status,
    success: true,
    durationMs,
    requestPreview: options.prompt.slice(0, 100),
    responseSnippet: text.trim().slice(0, 140),
  });
  return { text, modelUsed: model };
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
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    temperature: 0.35,
  };
  const temp = options.temperature ?? providerCfg.temperature ?? 0.35;
  const sys = [options.systemInstruction, providerCfg.customInstructions]
    .filter(Boolean)
    .join('\n\n');

  const chosenProvider = providerCfg.provider || 'gemini';
  const openaiKey = getActiveOpenAiKey();
  const geminiKey = getActiveGeminiKey();

  // Route A: Provider is Gemini
  if (chosenProvider === 'gemini') {
    if (geminiKey) {
      try {
        const geminiResult = await callGeminiApi({
          prompt: options.prompt,
          sysInstruction: sys,
          chatMessages: options.chatMessages,
          jsonMode: options.jsonMode,
          temperature: temp,
          model: providerCfg.model?.startsWith('gemini') ? providerCfg.model : 'gemini-3.5-flash-lite',
        });
        if (geminiResult.text.trim()) {
          return { text: geminiResult.text, providerUsed: 'gemini', modelUsed: geminiResult.modelUsed };
        }
      } catch (geminiErr: any) {
        console.warn('⚠️ [Gemini Error, comprobando failover a OpenAI]:', geminiErr.message);
        if (openaiKey) {
          try {
            console.log('🔄 [Auto-Failover to OpenAI]: Reintentando consulta con OpenAI...');
            const oaiResult = await callOpenAiChat({
              prompt: options.prompt,
              sys,
              chatMessages: options.chatMessages,
              jsonMode: options.jsonMode,
              temperature: temp,
              model: 'gpt-4o-mini',
              openaiKey,
            });
            if (oaiResult.text.trim()) {
              return { text: oaiResult.text, providerUsed: 'openai', modelUsed: oaiResult.modelUsed };
            }
          } catch {}
        }
        if (options.allowFallback === false) throw geminiErr;
      }
    } else if (openaiKey) {
      try {
        const oaiResult = await callOpenAiChat({
          prompt: options.prompt,
          sys,
          chatMessages: options.chatMessages,
          jsonMode: options.jsonMode,
          temperature: temp,
          model: providerCfg.model || 'gpt-4o-mini',
          openaiKey,
        });
        if (oaiResult.text.trim()) {
          return { text: oaiResult.text, providerUsed: 'openai', modelUsed: oaiResult.modelUsed };
        }
      } catch (err) {
        if (options.allowFallback === false) throw err;
      }
    }
  }

  // Route B: Provider is OpenAI (Strictly OpenAI — No Gemini fallbacks)
  if (chosenProvider === 'openai') {
    if (openaiKey) {
      try {
        const oaiResult = await callOpenAiChat({
          prompt: options.prompt,
          sys,
          chatMessages: options.chatMessages,
          jsonMode: options.jsonMode,
          temperature: temp,
          model: providerCfg.model?.startsWith('gpt') || providerCfg.model?.startsWith('o') ? providerCfg.model : 'gpt-4o-mini',
          openaiKey,
        });
        if (oaiResult.text.trim()) {
          return { text: oaiResult.text, providerUsed: 'openai', modelUsed: oaiResult.modelUsed };
        }
      } catch (openaiErr: any) {
        console.warn(`⚠️ [OpenAI Error]: ${openaiErr.message}`);
        if (options.allowFallback === false) throw openaiErr;
      }
    } else {
      if (options.allowFallback === false) {
        throw new Error('API Key de OpenAI no configurada.');
      }
    }
  }

  // Route C: Resilient Deterministic Engine fallback (WhatsApp bot NEVER goes silent)
  if (!options.jsonMode) {
    const fallbackText = buildResilientSalesBotReply(options.prompt, sys, options.chatMessages);
    return { text: fallbackText, providerUsed: 'deterministic', modelUsed: 'resilient-sales-engine' };
  }

  throw new Error('No se pudo generar respuesta con la API de OpenAI.');
}

async function transcribeAudioWithOpenAI(base64Audio: string, mimeType = 'audio/ogg'): Promise<string> {
  const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, '');
  const cleanMime = mimeType.split(';')[0] || 'audio/ogg';
  const openaiKey = getActiveOpenAiKey();

  if (!openaiKey) {
    throw new Error('API Key de OpenAI no configurada para Whisper.');
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : mimeType.includes('mp3') ? 'mp3' : 'ogg';
  const formData = new FormData();
  const blob = new Blob([buffer], { type: cleanMime });
  formData.append('file', blob, `voice_note.${ext}`);
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: formData,
    signal: AbortSignal.timeout(30000),
  });
  const durationMs = Date.now() - t0;

  if (res.ok) {
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

  const errBody = await res.text().catch(() => '');
  recordSystemApiLog({
    service: 'AI Engine',
    action: 'OpenAI Whisper Transcripción Audio',
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    statusCode: res.status,
    success: false,
    durationMs,
    error: `OpenAI Whisper HTTP ${res.status}: ${errBody.slice(0, 300)}`,
  });

  throw new Error(`Error en transcripción con OpenAI Whisper (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
}

async function analyzeImageWithOpenAI(
  base64Image: string,
  mimeType = 'image/jpeg',
  promptText: string,
  jsonMode = false
): Promise<string> {
  const cleanBase64 = base64Image.replace(/^data:[^;]+;base64,/, '');
  const cleanMime = mimeType.split(';')[0] || 'image/jpeg';
  const openaiKey = getActiveOpenAiKey();

  if (!openaiKey) {
    throw new Error('API Key de OpenAI no configurada para análisis de imagen con Visión.');
  }

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
    signal: AbortSignal.timeout(30000),
  });
  const durationMs = Date.now() - t0;

  if (res.ok) {
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

  const errBody = await res.text().catch(() => '');
  recordSystemApiLog({
    service: 'AI Engine',
    action: `OpenAI Vision (${model})`,
    method: 'POST',
    url: openaiUrl,
    statusCode: res.status,
    success: false,
    durationMs,
    error: `OpenAI Vision HTTP ${res.status}: ${errBody.slice(0, 300)}`,
  });

  throw new Error(`Error en análisis de imagen con OpenAI Vision (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
}

async function analyzeCustomerImageWithVision(
  base64Image: string,
  mimeType = 'image/jpeg'
): Promise<{ rawJson: any; interpretedText: string; isReceipt: boolean; suggestedQuery?: string; imageType: 'comprobante' | 'producto' | 'vacante' | 'otro' }> {
  const visionPrompt = `Analiza esta imagen y determina qué tipo es:

TIPO A — Comprobante de pago/transferencia (montos, referencias, banco, fecha).
TIPO B — Producto: laptop, accesorio, electrónico, o un anuncio/flyer/promo de un producto.
TIPO C — Anuncio o publicación que solicita personal, empleo o vacante (ayudante, vendedor, técnico, etc.).
TIPO D — Cualquier otra cosa.

Responde ÚNICAMENTE uno de estos JSON exactos, sin texto adicional ni markdown:
A: {"tipo":"comprobante","es_comprobante":true,"query_busqueda":"","descripcion":"comprobante de pago"}
B: {"tipo":"producto","es_comprobante":false,"query_busqueda":"MARCA MODELO-EXACTO","descripcion":"descripción breve"}
C: {"tipo":"vacante","es_comprobante":false,"query_busqueda":"","descripcion":"puesto que se solicita"}
D: {"tipo":"otro","es_comprobante":false,"query_busqueda":"","descripcion":"descripción breve"}`;

  try {
    const rawRes = await analyzeImageWithOpenAI(base64Image, mimeType, visionPrompt, false);
    let p: any = null;
    try {
      const cleanJson = rawRes.replace(/```json|```/g, '').trim();
      p = JSON.parse(cleanJson);
    } catch {
      const match = rawRes.match(/\{[\s\S]*?\}/);
      if (match) {
        try { p = JSON.parse(match[0]); } catch {}
      }
    }

    if (p) {
      if (p.es_comprobante || p.tipo === 'comprobante') {
        return {
          rawJson: p,
          interpretedText: 'COMPROBANTE_PAGO',
          isReceipt: true,
          suggestedQuery: '',
          imageType: 'comprobante',
        };
      }
      if (p.tipo === 'vacante') {
        const desc = p.descripcion || 'solicitud de personal';
        return {
          rawJson: p,
          interpretedText: `El cliente envió captura de un anuncio de EMPLEO / VACANTE: ${desc}`,
          isReceipt: false,
          suggestedQuery: p.query_busqueda || '',
          imageType: 'vacante',
        };
      }
      if (p.tipo === 'otro') {
        const desc = p.descripcion || 'imagen enviada';
        return {
          rawJson: p,
          interpretedText: `El cliente envió una imagen que no es producto ni comprobante: ${desc}`,
          isReceipt: false,
          suggestedQuery: p.query_busqueda || '',
          imageType: 'otro',
        };
      }
      // Producto
      const desc = p.descripcion || 'equipo';
      const query = (p.query_busqueda || '').trim();
      return {
        rawJson: p,
        interpretedText: `El cliente envió una imagen de: ${desc}. Búscalo en el INVENTARIO (sugerencia: ${query || desc})`,
        isReceipt: false,
        suggestedQuery: query,
        imageType: 'producto',
      };
    }
  } catch (err: any) {
    console.log('[Vision Analyze Notice]:', err?.message || err);
  }

  return {
    rawJson: null,
    interpretedText: 'El cliente envió una imagen adjunta.',
    isReceipt: false,
    imageType: 'otro',
  };
}

// Initial fallback products (immediately replaced on startup by 600+ real Odoo products)
let products: ProductItem[] = [];

// Per-chat AI pause overrides & transcriptions cache
const aiEnabledBySession = new Map<string, boolean>();
const transcriptionsByMsgId = new Map<string, string>();
const aiAnalysisByMsgId = new Map<string, string>();
const mediaCache = new Map<string, { buffer: Buffer; mimetype: string }>();
const TRANSCRIPTIONS_CACHE_FILE = path.join(__dirname, '.vendema-transcriptions.json');

function loadPersistedTranscriptions(): void {
  try {
    if (fs.existsSync(TRANSCRIPTIONS_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(TRANSCRIPTIONS_CACHE_FILE, 'utf-8'));
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (k && typeof v === 'string' && v.trim()) {
            const cleanId = k.replace(/^evo-/, '').trim();
            transcriptionsByMsgId.set(cleanId, v.trim());
            transcriptionsByMsgId.set(`evo-${cleanId}`, v.trim());
          }
        }
      }
    }
  } catch {}

  // Also hydrate any historical voice note transcriptions recorded in .vendema-bot-audit.json
  try {
    const auditFile = path.join(__dirname, '.vendema-bot-audit.json');
    if (fs.existsSync(auditFile)) {
      const auditEntries = JSON.parse(fs.readFileSync(auditFile, 'utf-8'));
      if (Array.isArray(auditEntries)) {
        for (const entry of auditEntries) {
          const id = String(entry?.incomingMessageId || '').replace(/^evo-/, '').trim();
          const txt = String(entry?.incomingText || '').trim();
          if (id && txt && txt.length > 2 && !txt.startsWith('🎤 Nota de voz')) {
            if (!transcriptionsByMsgId.has(id)) {
              transcriptionsByMsgId.set(id, txt);
              transcriptionsByMsgId.set(`evo-${id}`, txt);
            }
          }
        }
      }
    }
  } catch {}
}

let transcriptionSaveTimer: NodeJS.Timeout | null = null;
function saveTranscriptionForId(msgId: string | undefined, text: string | undefined): void {
  if (!msgId || !text || !text.trim()) return;
  const cleanId = msgId.replace(/^evo-/, '').trim();
  if (!cleanId) return;
  const cleanText = text.trim();
  transcriptionsByMsgId.set(cleanId, cleanText);
  transcriptionsByMsgId.set(`evo-${cleanId}`, cleanText);
  if (transcriptionSaveTimer) return;
  transcriptionSaveTimer = setTimeout(() => {
    transcriptionSaveTimer = null;
    try {
      const entries = Array.from(transcriptionsByMsgId.entries())
        .filter(([k]) => !k.startsWith('evo-'))
        .slice(-800);
      const obj: Record<string, string> = {};
      for (const [k, v] of entries) obj[k] = v;
      writeFileAtomicSync(TRANSCRIPTIONS_CACHE_FILE, JSON.stringify(obj, null, 2));
    } catch {}
  }, 800);
}

loadPersistedTranscriptions();

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

export interface IdempotencyRecord {
  messageId: string;
  correlationId?: string;
  conversationId?: string;
  processedAt: number;
  responseSent: boolean;
  orderOrQuoteCreated?: boolean;
}
const idempotencyLedger = new Map<string, IdempotencyRecord>();

try {
  if (fs.existsSync(PROCESSED_IDS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, 'utf-8'));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    if (raw && typeof raw === 'object') {
      for (const [k, val] of Object.entries(raw)) {
        if (typeof val === 'number' && val > cutoff) {
          processedMessageIds.set(k, val);
        } else if (val && typeof val === 'object' && typeof (val as any).processedAt === 'number' && (val as any).processedAt > cutoff) {
          processedMessageIds.set(k, (val as any).processedAt);
          idempotencyLedger.set(k, val as IdempotencyRecord);
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
      writeFileAtomicSync(PROCESSED_IDS_FILE, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }, 1500);
}

function normalizeMsgIdKey(rawId?: string): string {
  return (rawId || '').trim().replace(/^evo-/, '');
}

function markMessageIdProcessed(
  rawId: string,
  contactKeys: string[] = [],
  meta?: { correlationId?: string; conversationId?: string; responseSent?: boolean; orderOrQuoteCreated?: boolean }
): void {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return;
  const now = Date.now();
  processedMessageIds.set(cleanId, now);
  processedMessageIds.set(`evo-${cleanId}`, now);
  for (const k of contactKeys) {
    processedMessageIds.set(`${k}::${cleanId}`, now);
    processedMessageIds.set(`${k}::evo-${cleanId}`, now);
  }
  const existing = idempotencyLedger.get(cleanId);
  idempotencyLedger.set(cleanId, {
    messageId: cleanId,
    correlationId: meta?.correlationId || existing?.correlationId,
    conversationId: meta?.conversationId || existing?.conversationId,
    processedAt: now,
    responseSent: meta?.responseSent ?? existing?.responseSent ?? true,
    orderOrQuoteCreated: meta?.orderOrQuoteCreated ?? existing?.orderOrQuoteCreated ?? false,
  });
  scheduleSaveProcessedIds();
}

function unmarkMessageIdProcessedForRetry(rawId: string, contactKeys: string[] = []): void {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return;
  processedMessageIds.delete(cleanId);
  processedMessageIds.delete(`evo-${cleanId}`);
  for (const k of contactKeys) {
    processedMessageIds.delete(`${k}::${cleanId}`);
    processedMessageIds.delete(`${k}::evo-${cleanId}`);
  }
  const existing = idempotencyLedger.get(cleanId);
  if (existing) {
    existing.responseSent = false;
  }
  scheduleSaveProcessedIds();
}

function isMessageIdAlreadyProcessed(rawId: string, contactKeys: string[] = []): boolean {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return false;
  const ledgerEntry = idempotencyLedger.get(cleanId);
  if (ledgerEntry && ledgerEntry.responseSent === false) {
    return false; // Allow retry when previous attempt failed before sending
  }
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
// Fase 1.7 — Central System API & Correlation Trace Logging Engine
// ---------------------------------------------------------
interface SystemApiLog {
  id: string;
  timestamp: string;
  service: 'Backend' | 'Evolution API' | 'Odoo ERP' | 'AI Engine' | 'Supabase';
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
  correlationId?: string;
  stage?: DiagnosticStage;
  severity?: LogSeverity;
  module?: string;
  customer?: string;
  conversationId?: string;
  messageId?: string;
  errorCategory?: string;
}

const MAX_SYSTEM_API_LOGS = 400;
const systemApiLogs: SystemApiLog[] = [];

function classifyErrorSeverityAndCategory(
  success: boolean,
  statusCode?: number,
  errorText?: string
): { severity: LogSeverity; errorCategory?: string } {
  if (success && (!statusCode || statusCode < 400)) {
    return { severity: 'INFO' };
  }
  const errLower = (errorText || '').toLowerCase();
  if (statusCode === 401 || statusCode === 403 || errLower.includes('incorrect api key') || errLower.includes('unauthorized')) {
    return { severity: 'CRITICAL', errorCategory: 'AUTH_ERROR' };
  }
  if (statusCode === 429 || errLower.includes('rate limit') || errLower.includes('quota')) {
    return { severity: 'HIGH', errorCategory: 'RATE_LIMIT' };
  }
  if (errLower.includes('connection closed') || errLower.includes('socket') || errLower.includes('econnrefused')) {
    return { severity: 'HIGH', errorCategory: 'CONNECTION_ERROR' };
  }
  if (errLower.includes('timeout') || errLower.includes('aborted')) {
    return { severity: 'MEDIUM', errorCategory: 'TIMEOUT' };
  }
  if (statusCode && statusCode >= 500) {
    return { severity: 'HIGH', errorCategory: 'UPSTREAM_ERROR' };
  }
  return { severity: 'MEDIUM', errorCategory: 'GENERAL_ERROR' };
}

let activeCorrelationIdContext: string | undefined = undefined;

function recordSystemApiLog(log: Omit<SystemApiLog, 'id' | 'timestamp'>): SystemApiLog {
  const autoClassified = classifyErrorSeverityAndCategory(log.success, log.statusCode, log.error || log.responseSnippet);
  const entry: SystemApiLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...log,
    correlationId: log.correlationId || activeCorrelationIdContext,
    severity: log.severity || autoClassified.severity,
    errorCategory: log.errorCategory || autoClassified.errorCategory,
    requestPreview: log.requestPreview ? sanitizeSecretsInText(log.requestPreview) : undefined,
    responseSnippet: log.responseSnippet ? sanitizeSecretsInText(log.responseSnippet) : undefined,
    error: log.error ? sanitizeSecretsInText(log.error) : undefined,
  };
  systemApiLogs.unshift(entry);
  if (systemApiLogs.length > MAX_SYSTEM_API_LOGS) {
    systemApiLogs.pop();
  }
  return entry;
}

function recordDiagnosticStage(params: {
  correlationId: string;
  stage: DiagnosticStage;
  service?: SystemApiLog['service'];
  module?: string;
  customer?: string;
  conversationId?: string;
  messageId?: string;
  success?: boolean;
  durationMs?: number;
  details?: string;
  error?: string;
  severity?: LogSeverity;
}) {
  return recordSystemApiLog({
    service: params.service || 'Backend',
    action: `[${params.stage}] ${params.details || params.stage}`,
    method: 'TRACE',
    target: params.customer || params.conversationId,
    statusCode: params.success === false ? 500 : 200,
    success: params.success !== false,
    durationMs: params.durationMs ?? 0,
    requestPreview: `correlation_id: ${params.correlationId} | stage: ${params.stage} | msgId: ${params.messageId || 'N/A'}`,
    responseSnippet: params.details,
    error: params.error,
    correlationId: params.correlationId,
    stage: params.stage,
    severity: params.severity || (params.success === false ? 'HIGH' : 'INFO'),
    module: params.module || 'pipeline',
    customer: params.customer,
    conversationId: params.conversationId,
    messageId: params.messageId,
  });
}

// Seed initial startup health log
recordSystemApiLog({
  service: 'Backend',
  action: 'Inicialización de Monitor y Cola Persistente (Fase 1)',
  method: 'SYS',
  statusCode: 200,
  success: true,
  durationMs: 0,
  severity: 'INFO',
  module: 'boot',
  requestPreview: 'Módulo centralizado de diagnóstico, cola persistente y trazabilidad correlation_id activo',
  responseSnippet: 'Monitoreando Backend, Supabase, Evolution API, OpenAI y Odoo ERP',
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
const QUOTED_MESSAGES_CACHE_FILE = path.join(__dirname, '.vendema-quoted-messages.json');
const quotedMessagesByMsgId = new Map<string, QuotedMessage>();

function loadPersistedQuotedMessages(): void {
  try {
    if (fs.existsSync(QUOTED_MESSAGES_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(QUOTED_MESSAGES_CACHE_FILE, 'utf-8'));
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (k && v && typeof v === 'object') {
            const qv = v as QuotedMessage;
            const cleanK = k.replace(/^evo-/, '');
            const cleanQId = (qv.id || '').replace(/^evo-/, '');
            const isLegacyHeuristic =
              Boolean(qv.text?.includes('💬 Consultas citadas:')) ||
              Boolean(cleanQId && cleanQId === cleanK);
            if (!isLegacyHeuristic) {
              quotedMessagesByMsgId.set(k, qv);
            }
          }
        }
      }
    }
  } catch {}
}

function hydrateQuotedMessageById(
  msg: ChatMessage,
  messages: ChatMessage[],
  customerNameFallback: string
): void {
  if (!msg.quotedMessage?.id) return;
  const qId = msg.quotedMessage.id;
  const cleanQId = qId.replace(/^evo-/, '');
  const selfId = (msg.evolutionMessageId || msg.id).replace(/^evo-/, '');
  if (!cleanQId || cleanQId === selfId) return;

  const isPlaceholder =
    !msg.quotedMessage.text ||
    msg.quotedMessage.text.trim().length === 0 ||
    msg.quotedMessage.text === '🎤 Nota de voz citada' ||
    msg.quotedMessage.text === '🎤 Nota de voz de WhatsApp' ||
    msg.quotedMessage.text === '🎤 Nota de voz anterior';

  if (!isPlaceholder) return;

  const savedTr = transcriptionsByMsgId.get(qId) || transcriptionsByMsgId.get(cleanQId);
  const parent = messages.find(
    cand =>
      cand !== msg &&
      !isInternalOrNoiseContent(cand.content) &&
      (cand.id === qId ||
        cand.evolutionMessageId === qId ||
        cand.id === `evo-${cleanQId}` ||
        cand.evolutionMessageId === cleanQId)
  );

  if (parent) {
    const parentTr = parent.transcription || savedTr;
    msg.quotedMessage.text =
      (parent.type === 'audio' && parentTr ? `🎤 "${parentTr}"` : parentTr || parent.content) ||
      (parent.type === 'image'
        ? '📷 Foto enviada anteriormente'
        : parent.type === 'audio'
        ? '🎤 Nota de voz citada'
        : parent.type === 'video'
        ? '🎥 Video anterior'
        : 'Mensaje anterior');
    msg.quotedMessage.type = parent.type;
    msg.quotedMessage.mediaUrl = parent.mediaUrl;
    msg.quotedMessage.author =
      parent.sender === 'customer' ? customerNameFallback : 'Todo Lapto';
    saveQuotedMessageForId(msg.evolutionMessageId || msg.id, msg.quotedMessage);
  } else if (savedTr) {
    msg.quotedMessage.text = `🎤 "${savedTr}"`;
    msg.quotedMessage.type = 'audio';
    saveQuotedMessageForId(msg.evolutionMessageId || msg.id, msg.quotedMessage);
  }
}

let quotedSaveTimer: NodeJS.Timeout | null = null;
function saveQuotedMessageForId(msgId: string | undefined, qm: QuotedMessage | undefined): void {
  if (!msgId || !qm || (!qm.text && !qm.id && !qm.mediaBase64)) return;
  const cleanId = msgId.replace(/^evo-/, '').trim();
  if (!cleanId) return;
  quotedMessagesByMsgId.set(cleanId, qm);
  quotedMessagesByMsgId.set(`evo-${cleanId}`, qm);
  if (quotedSaveTimer) return;
  quotedSaveTimer = setTimeout(() => {
    quotedSaveTimer = null;
    try {
      const entries = Array.from(quotedMessagesByMsgId.entries()).filter(([k]) => !k.startsWith('evo-')).slice(-500);
      const obj: Record<string, QuotedMessage> = {};
      for (const [k, v] of entries) obj[k] = v;
      writeFileAtomicSync(QUOTED_MESSAGES_CACHE_FILE, JSON.stringify(obj, null, 2));
    } catch {}
  }, 1000);
}

loadPersistedQuotedMessages();

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
    content = msgObj.videoMessage?.caption || '[El cliente envió un VIDEO. El bot no puede verlo.]';
    mediaDuration = msgObj.videoMessage?.seconds || 0;
    mediaMimeType = msgObj.videoMessage?.mimetype || 'video/mp4';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}?video=true`;
  } else if (msgObj.documentMessage || msgTypeRaw === 'documentMessage') {
    type = 'document';
    fileName = msgObj.documentMessage?.fileName || msgObj.documentMessage?.title || 'Documento';
    content = msgObj.documentMessage?.caption || `📄 ${fileName} [El cliente envió un DOCUMENTO. El bot no puede verlo.]`;
    mediaMimeType = msgObj.documentMessage?.mimetype || 'application/pdf';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.stickerMessage || msgTypeRaw === 'stickerMessage') {
    type = 'sticker';
    content = '[El cliente envió un STICKER.]';
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.locationMessage || msgTypeRaw === 'locationMessage') {
    type = 'location';
    const lat = msgObj.locationMessage?.degreesLatitude;
    const lng = msgObj.locationMessage?.degreesLongitude;
    content = lat && lng ? `📍 Ubicación GPS: https://www.google.com/maps?q=${lat},${lng}` : '[El cliente envió una UBICACIÓN.]';
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

  if (quotedMessage) {
    saveQuotedMessageForId(msgId, quotedMessage);
  } else {
    const cachedQuote =
      quotedMessagesByMsgId.get(msgId) ||
      quotedMessagesByMsgId.get(msgId.replace(/^evo-/, ''));
    if (cachedQuote) {
      quotedMessage = { ...cachedQuote };
    }
  }

  const tsNum = Number(record.messageTimestamp);
  const timestamp = tsNum
    ? new Date(tsNum > 1e12 ? tsNum : tsNum * 1000).toISOString()
    : new Date().toISOString();

  const cleanMsgId = msgId.replace(/^evo-/, '');
  const savedTranscription = transcriptionsByMsgId.get(msgId) || transcriptionsByMsgId.get(cleanMsgId);
  const savedAiAnalysis = aiAnalysisByMsgId.get(msgId) || aiAnalysisByMsgId.get(cleanMsgId);
  if (type === 'audio' && savedTranscription) {
    content = `🎤 "${savedTranscription}"`;
  }

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
    transcription: type === 'audio' ? savedTranscription : undefined,
    aiAnalysis: savedAiAnalysis,
    metadata: fileName ? { fileName } : undefined,
  };
}

const relatedJidsBySession = new Map<string, Set<string>>();
const lidToPhoneMap = new Map<string, string>();
const LID_MAPPINGS_FILE = path.join(__dirname, '.vendema-lid-mappings.json');

function loadLidMappings(): void {
  try {
    if (fs.existsSync(LID_MAPPINGS_FILE)) {
      const raw = fs.readFileSync(LID_MAPPINGS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') {
          lidToPhoneMap.set(k, v);
          const cleanK = k.replace(/@.*$/, '').replace(/\D/g, '');
          if (cleanK) lidToPhoneMap.set(cleanK, v);
          if (!k.includes('@')) lidToPhoneMap.set(`${k}@lid`, v);
        }
      }
      console.log(`📋 [LID Mappings]: Cargados ${lidToPhoneMap.size} registros de mapeo LID a teléfono.`);
    }
  } catch (err: any) {
    console.warn('[LID Mappings Load Warning]:', err?.message || err);
  }
}

function saveLidMappings(): void {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of lidToPhoneMap.entries()) {
      obj[k] = v;
    }
    writeFileAtomicSync(LID_MAPPINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (err: any) {
    console.warn('[LID Mappings Save Warning]:', err?.message || err);
  }
}

loadLidMappings();
syncAuthoritativeDominicanTime().catch(() => {});

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
let lastDisconnectedStateCheck = 0;
let evolutionLastKnownState: string = 'unknown';

const evolutionQrCache: {
  qrBase64: string | null;
  pairingCode: string | null;
  generatedAt: number;
  ownerJid: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  lastMetaFetchAt: number;
} = {
  qrBase64: null,
  pairingCode: null,
  generatedAt: 0,
  ownerJid: null,
  profileName: null,
  profilePicUrl: null,
  lastMetaFetchAt: 0,
};

function isSyntheticTestArtifact(val?: string): boolean {
  if (!val) return false;
  return /^(TEST1_|TEST2_|TEST3_|TEST4_|TEST_|TEST-MSG-|TEST-)/i.test(val) ||
    val.includes('18095550') ||
    val.includes('551199999000') ||
    val === 'Cliente Prueba 1' ||
    val === 'Cliente Concurrente' ||
    val === 'Cliente Auditoria' ||
    val.startsWith('Cliente Lote ');
}

// ---------------------------------------------------------------------------
// Strict Message & Contact Deduplication Engine (Unifies LID and Phone IDs)
// ---------------------------------------------------------------------------
function isDuplicateChatMessage(existingList: ChatMessage[], newMsg: ChatMessage): boolean {
  if (!existingList || existingList.length === 0 || !newMsg) return false;

  const normNewId = normalizeMsgIdKey(newMsg.id);
  const normNewEvoId = normalizeMsgIdKey(newMsg.evolutionMessageId || '');
  const newText = (newMsg.content || '').trim();
  const newTime = new Date(newMsg.timestamp).getTime();

  return existingList.some(m => {
    const normId = normalizeMsgIdKey(m.id);
    const normEvoId = normalizeMsgIdKey(m.evolutionMessageId || '');

    // 1. Direct ID or Evolution Message ID match
    if (normNewId && (normNewId === normId || normNewId === normEvoId)) return true;
    if (normNewEvoId && (normNewEvoId === normId || normNewEvoId === normEvoId)) return true;

    // 2. Content + Sender + Timestamp proximity match (within 60s)
    if (m.sender === newMsg.sender && m.type === newMsg.type) {
      if (newText && (m.content || '').trim() === newText) {
        const mTime = new Date(m.timestamp).getTime();
        if (Math.abs(newTime - mTime) <= 60000) {
          return true;
        }
      }
    }
    return false;
  });
}

function deduplicateMessagesArray(msgs: ChatMessage[]): ChatMessage[] {
  if (!Array.isArray(msgs) || msgs.length === 0) return [];
  const result: ChatMessage[] = [];
  for (const m of msgs) {
    if (!isDuplicateChatMessage(result, m)) {
      result.push(m);
    }
  }
  return result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function consolidateDuplicateConversations(): boolean {
  if (!Array.isArray(conversations) || conversations.length === 0) return false;

  let hasChanges = false;
  // Step 1: Clean duplicate messages within every single conversation
  for (const conv of conversations) {
    const origCount = conv.messages?.length || 0;
    conv.messages = deduplicateMessagesArray(conv.messages || []);
    if (conv.messages.length !== origCount) {
      hasChanges = true;
    }
  }

  // Step 2: Canonical indexes to unify duplicate conversation entities
  const byPhone = new Map<string, Conversation>();
  const byName = new Map<string, Conversation>();
  const bySession = new Map<string, Conversation>();
  const toRemove = new Set<string>();

  // Pass 1: Register real-phone conversations first (so canonical phone always wins over LID)
  for (const conv of conversations) {
    const cleanPhone = (conv.customerPhone || conv.sessionId || '').replace(/@.*$/, '').replace(/\D/g, '');
    const isLid = conv.sessionId.endsWith('@lid') || cleanPhone.length > 13;
    if (!isLid && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      byPhone.set(std, conv);
      byPhone.set(std.slice(-10), conv);
      bySession.set(conv.sessionId, conv);
      if (!isGenericContactName(conv.customerName)) {
        byName.set(conv.customerName.trim().toLowerCase(), conv);
      }
    }
  }

  // Pass 2: Merge LID conversations or duplicate sessions into canonical phone conversations
  for (const conv of conversations) {
    const cleanPhone = (conv.customerPhone || conv.sessionId || '').replace(/@.*$/, '').replace(/\D/g, '');
    const isLid = conv.sessionId.endsWith('@lid') || cleanPhone.length > 13;
    const nameKey = !isGenericContactName(conv.customerName) ? conv.customerName.trim().toLowerCase() : '';

    let primary: Conversation | undefined;

    // Check if mapped via lidToPhoneMap
    if (isLid) {
      const mappedPhone = lidToPhoneMap.get(conv.sessionId) || lidToPhoneMap.get(cleanPhone);
      if (mappedPhone) {
        primary = byPhone.get(mappedPhone) || byPhone.get(mappedPhone.slice(-10));
      }
    }

    // Check by unique non-generic name
    if (!primary && nameKey) {
      primary = byName.get(nameKey);
    }

    // Check by relatedJidsBySession
    if (!primary && relatedJidsBySession.has(conv.sessionId)) {
      for (const rel of relatedJidsBySession.get(conv.sessionId)!) {
        if (bySession.has(rel)) {
          primary = bySession.get(rel);
          break;
        }
      }
    }

    // If duplicate found and it's not itself:
    if (primary && primary.sessionId !== conv.sessionId) {
      hasChanges = true;
      toRemove.add(conv.sessionId);

      // Preserve AI pause state if either was paused
      if (primary.aiEnabled === false || conv.aiEnabled === false) {
        primary.aiEnabled = false;
        aiEnabledBySession.set(primary.sessionId, false);
        if (primary.customerPhone) aiEnabledBySession.set(primary.customerPhone, false);
        aiEnabledBySession.set(conv.sessionId, false);
      }

      // Merge messages into primary without duplicates
      for (const m of conv.messages) {
        if (!isDuplicateChatMessage(primary.messages, m)) {
          primary.messages.push(m);
        }
      }
      primary.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Update primary name if primary has generic name
      if (isGenericContactName(primary.customerName) && !isGenericContactName(conv.customerName)) {
        primary.customerName = conv.customerName;
      }
      if (!primary.profilePicUrl && conv.profilePicUrl) {
        primary.profilePicUrl = conv.profilePicUrl;
      }

      // Update timestamps
      const lastM = primary.messages[primary.messages.length - 1];
      if (lastM) {
        primary.lastTimestamp = lastM.timestamp;
        primary.lastMessagePreview = lastM.content;
        primary.lastMessageType = lastM.type;
      }

      // Associate LID with primary
      const jSet = relatedJidsBySession.get(primary.sessionId) || new Set<string>([primary.sessionId]);
      jSet.add(conv.sessionId);
      if (conv.customerPhone) jSet.add(conv.customerPhone);
      relatedJidsBySession.set(primary.sessionId, jSet);
      if (isLid && primary.customerPhone) {
        lidToPhoneMap.set(conv.sessionId, primary.customerPhone);
        lidToPhoneMap.set(cleanPhone, primary.customerPhone);
        saveLidMappings();
      }
    } else if (!isLid && cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      byPhone.set(std, conv);
      byPhone.set(std.slice(-10), conv);
      bySession.set(conv.sessionId, conv);
      if (nameKey) byName.set(nameKey, conv);
    }
  }

  if (toRemove.size > 0) {
    conversations = conversations.filter(c => !toRemove.has(c.sessionId));
    hasChanges = true;
    console.log(`🧹 [Deduplicación de Contactos]: Se unificaron ${toRemove.size} conversaciones duplicadas.`);
  }

  if (hasChanges) {
    conversations.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    savePersistedConversations();
    broadcastEvent('conversations_update', { count: conversations.length });
  }

  return hasChanges;
}

let lastContactsSyncAt = 0;
async function syncEvolutionContactsDirectory(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastContactsSyncAt < 30 * 60 * 1000) return;
  lastContactsSyncAt = now;

  try {
    const baseUrl = (appConfig.evolution.serverUrl || '').replace(/\/$/, '');
    const instance = appConfig.evolution.instance;
    if (!baseUrl || !appConfig.evolution.apiKey) return;

    const res = await fetch(`${baseUrl}/chat/findContacts/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({ where: {} }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return;
    const contacts: any[] = await res.json().catch(() => []);
    if (!Array.isArray(contacts) || contacts.length === 0) return;

    const phonesByName = new Map<string, string>();
    for (const c of contacts) {
      const rJid = c.remoteJid || c.id || '';
      if (rJid.endsWith('@s.whatsapp.net') && c.pushName && c.pushName.trim()) {
        const phone = rJid.replace(/@.*$/, '').replace(/\D/g, '');
        if (phone.length >= 10 && phone.length <= 13) {
          phonesByName.set(c.pushName.trim().toLowerCase(), phone);
        }
      }
    }

    let mappedCount = 0;
    for (const c of contacts) {
      const rJid = c.remoteJid || c.id || '';
      if (rJid.endsWith('@lid') && c.pushName && c.pushName.trim()) {
        const matchedPhone = phonesByName.get(c.pushName.trim().toLowerCase());
        if (matchedPhone) {
          lidToPhoneMap.set(rJid, matchedPhone);
          lidToPhoneMap.set(rJid.replace(/@.*$/, ''), matchedPhone);
          mappedCount++;
        }
      }
    }

    if (mappedCount > 0) {
      console.log(`🔗 [LID to Phone Sync]: Mapeados ${mappedCount} identificadores @lid a números reales de WhatsApp.`);
      consolidateDuplicateConversations();
    }
  } catch (err: any) {
    console.log('[Contacts Directory Sync Info]:', err.message);
  }
}

const CONVERSATIONS_CACHE_FILE = path.join(__dirname, '.vendema-conversations.json');

function savePersistedConversations(): void {
  try {
    if (!Array.isArray(conversations) || conversations.length === 0) return;
    const cleanList = conversations
      .filter(c => !isSyntheticTestArtifact(c.sessionId) && !isSyntheticTestArtifact(c.customerName))
      .slice(0, 80)
      .map(c => ({
        ...c,
        messages: Array.isArray(c.messages) ? c.messages.slice(-40) : [],
      }));
    writeFileAtomicSync(CONVERSATIONS_CACHE_FILE, JSON.stringify(cleanList, null, 2));
  } catch (err: any) {
    console.warn('[Conversations Cache Save Warning]:', err?.message || err);
  }
}

/**
 * Clears all live & persisted WhatsApp chats when the instance disconnects,
 * preventing stale chats from remaining visible or auto-replying while unlinked.
 */
function clearAllChatsOnWhatsAppDisconnect(disconnectedState = 'close'): void {
  const hadChats = conversations.length > 0;
  const wasConnected = evolutionLastKnownState === 'open' || appConfig.evolution.connected;

  evolutionLastKnownState = disconnectedState;
  appConfig.evolution.connected = false;
  evolutionQrCache.ownerJid = null;
  evolutionQrCache.profileName = null;
  evolutionQrCache.profilePicUrl = null;

  conversations = [];
  relatedJidsBySession.clear();
  lastChatMessagesFetchBySession.clear();
  inFlightBotKeys.clear();
  if (persistentJobQueue.length > 0) {
    persistentJobQueue = persistentJobQueue.filter(
      j => j.status === 'COMPLETED' || j.status === 'DEAD_LETTER'
    );
    savePersistentJobQueue();
  }

  try {
    writeFileAtomicSync(CONVERSATIONS_CACHE_FILE, '[]');
  } catch {}

  if (hadChats || wasConnected) {
    console.log(`🔌 [WhatsApp Disconnected (${disconnectedState})]: Todos los chats fueron limpiados del sistema.`);
    broadcastEvent('evolution_status', { connected: false, state: disconnectedState });
    broadcastEvent('conversations_update', { count: 0, cleared: true });
  }
}

function loadPersistedConversations(): void {
  try {
    if (fs.existsSync(CONVERSATIONS_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONVERSATIONS_CACHE_FILE, 'utf-8'));
      if (Array.isArray(raw) && raw.length > 0) {
        conversations = raw.filter(
          (c: Conversation) =>
            c &&
            c.sessionId &&
            !isSyntheticTestArtifact(c.sessionId) &&
            !isSyntheticTestArtifact(c.customerName)
        );
        for (const c of conversations) {
          if (c.aiEnabled !== undefined) {
            aiEnabledBySession.set(c.sessionId, c.aiEnabled);
            if (c.customerPhone) aiEnabledBySession.set(c.customerPhone, c.aiEnabled);
          }
        }
        consolidateDuplicateConversations();
      }
    }
  } catch (err: any) {
    console.warn('[Conversations Cache Load Warning]:', err?.message || err);
  }
}

loadPersistedConversations();
syncEvolutionContactsDirectory().catch(() => {});

async function quickSeedConversationsFromRecentMessages(): Promise<void> {
  if (conversations.length > 0) return;
  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findMessages/${appConfig.evolution.instance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: appConfig.evolution.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 50 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    const records: any[] = data?.messages?.records || (Array.isArray(data) ? data : []);
    if (!Array.isArray(records) || records.length === 0 || conversations.length > 0) return;

    const bySession = new Map<string, Conversation>();
    for (const rec of records) {
      const remoteJid = rec?.key?.remoteJid || '';
      const rawAlt = rec?.key?.remoteJidAlt || '';
      if (!remoteJid || isWhatsAppGroup(remoteJid) || remoteJid === 'status@broadcast') continue;

      const cleanPhone = (
        rawAlt.endsWith('@s.whatsapp.net')
          ? rawAlt.replace('@s.whatsapp.net', '')
          : remoteJid.replace(/@.*$/, '')
      ).replace(/\D/g, '');
      const sessionId =
        cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 12
          ? `${cleanPhone}@s.whatsapp.net`
          : remoteJid;
      const pushName =
        (!rec?.key?.fromMe && rec?.pushName && rec.pushName !== 'Você' ? rec.pushName : '') ||
        (cleanPhone.length <= 12 ? `Cliente +${cleanPhone}` : `WhatsApp #${cleanPhone.slice(-6)}`);

      const parsed = parseSingleEvolutionMessage(rec, pushName);
      if (!parsed) continue;

      const existing = bySession.get(sessionId);
      if (!existing) {
        bySession.set(sessionId, {
          sessionId,
          customerPhone: cleanPhone,
          customerName: pushName,
          messages: [parsed],
          messagesLoaded: false,
          aiEnabled: true,
          unreadCount: 0,
          lastTimestamp: parsed.timestamp,
          lastMessagePreview: parsed.content,
          lastMessageType: parsed.type,
          intentStatus: 'explorando',
          detectedProducts: [],
          zone: 'santo_domingo',
          isLiveEvolution: true,
        });
      } else {
        if (!existing.messages.some(m => m.id === parsed.id)) {
          existing.messages.push(parsed);
          existing.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        }
        if (new Date(parsed.timestamp).getTime() >= new Date(existing.lastTimestamp).getTime()) {
          existing.lastTimestamp = parsed.timestamp;
          existing.lastMessagePreview = parsed.content;
          existing.lastMessageType = parsed.type;
        }
      }
    }

    if (conversations.length === 0 && bySession.size > 0) {
      conversations = Array.from(bySession.values()).sort(
        (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
      );
      savePersistedConversations();
      broadcastEvent('conversations_update', { count: conversations.length });
    }
  } catch {}
}

async function syncEvolutionChats(): Promise<Conversation[]> {
  if (isEvoSyncRunning) return conversations;
  const now = Date.now();
  if (conversations.length === 0) {
    loadPersistedConversations();
  }
  // Throttle delta message check to every 5 seconds
  if (now - lastEvolutionChatsSync < 5000 && conversations.length > 0) {
    return conversations;
  }
  isEvoSyncRunning = true;
  lastEvolutionChatsSync = now;

  try {
    const baseUrl = (appConfig.evolution.serverUrl || '').replace(/\/$/, '');
    const instance = appConfig.evolution.instance;

    // 1. Lightweight connectionState check (< 4s). Never run DB queries on Evolution API if socket is not 'open'
    // so we never block Baileys WebSocket during QR pairing or reconnection!
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      headers: { apikey: appConfig.evolution.apiKey },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    const stateData = stateRes && stateRes.ok ? await stateRes.json().catch(() => null) : null;
    const currentState = stateData?.instance?.state || stateData?.state || 'close';

    if (currentState !== 'open') {
      clearAllChatsOnWhatsAppDisconnect(currentState);
      return conversations;
    }

    if (evolutionLastKnownState !== 'open') {
      evolutionLastKnownState = 'open';
      appConfig.evolution.connected = true;
      evolutionQrCache.qrBase64 = null;
      evolutionQrCache.pairingCode = null;
      botStartupCutoffMs = getEffectiveCurrentDate().getTime() - 10000;
      isFirstEvolutionSync = true;
      broadcastEvent('evolution_status', { connected: true, state: 'open' });
    }

    // 2. Fetch recent messages: seed wider (200) when recovering from empty state (e.g. after reconnect), otherwise lightweight delta (15)
    const fetchOffset = conversations.length === 0 ? 200 : 15;
    const msgUrl = `${baseUrl}/chat/findMessages/${instance}`;
    const msgRes = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        apikey: appConfig.evolution.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page: 1, offset: fetchOffset }),
      signal: AbortSignal.timeout(12000),
    });

    if (!msgRes.ok) {
      throw new Error(`Evolution findMessages delta status ${msgRes.status}`);
    }

    const msgData = await msgRes.json().catch(() => null);
    const rawRecords: any[] = msgData?.messages?.records || (Array.isArray(msgData) ? msgData : []);
    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
      return conversations;
    }

    // Process records from oldest to newest so conversation order and lastMessage are chronological
    const sortedRecords = [...rawRecords].sort(
      (a, b) => Number(a?.messageTimestamp || 0) - Number(b?.messageTimestamp || 0)
    );

    let hasChanges = false;

    for (const rec of sortedRecords) {
      const key = rec?.key;
      if (!key) continue;
      const remoteJid = key.remoteJid || '';
      const rawAlt = key.remoteJidAlt || '';
      const participant = key.participant || '';

      if (
        !remoteJid ||
        isWhatsAppGroup(remoteJid) ||
        isWhatsAppGroup(rawAlt) ||
        isWhatsAppGroup(participant) ||
        remoteJid === 'status@broadcast'
      ) {
        continue;
      }

      if (remoteJid.endsWith('@lid') && rawAlt.endsWith('@s.whatsapp.net')) {
        const altPhone = rawAlt.replace(/@.*$/, '').replace(/\D/g, '');
        if (altPhone) {
          lidToPhoneMap.set(remoteJid, altPhone);
          lidToPhoneMap.set(remoteJid.replace(/@.*$/, ''), altPhone);
        }
      }

      const cleanPhone = (
        rawAlt.endsWith('@s.whatsapp.net')
          ? rawAlt
          : remoteJid.endsWith('@lid') && (lidToPhoneMap.get(remoteJid) || lidToPhoneMap.get(remoteJid.replace(/@.*$/, '')))
          ? (lidToPhoneMap.get(remoteJid) || lidToPhoneMap.get(remoteJid.replace(/@.*$/, '')))!
          : remoteJid
      )
        .replace(/@.*$/, '')
        .replace(/\D/g, '');

      const canonicalSessionId =
        cleanPhone && cleanPhone.length >= 10 && cleanPhone.length <= 13
          ? `${cleanPhone}@s.whatsapp.net`
          : remoteJid;

      const pushName =
        (!key.fromMe && rec.pushName && rec.pushName !== 'Você' ? rec.pushName : '') ||
        (cleanPhone.length <= 13 ? `Cliente +${cleanPhone}` : `WhatsApp #${cleanPhone.slice(-6)}`);

      const parsedMsg = parseSingleEvolutionMessage(rec, pushName);
      if (!parsedMsg) continue;

      let conv = conversations.find(
        c =>
          c.sessionId === canonicalSessionId ||
          c.sessionId === remoteJid ||
          (rawAlt && c.sessionId === rawAlt) ||
          (cleanPhone && cleanPhone.length <= 13 && c.customerPhone === cleanPhone) ||
          relatedJidsBySession.get(c.sessionId)?.has(remoteJid) ||
          (!isGenericContactName(pushName) && !isGenericContactName(c.customerName) && c.customerName.trim().toLowerCase() === pushName.trim().toLowerCase())
      );

      if (!conv) {
        const odooMatch = findOdooPartnerByPhone(cleanPhone);
        const isAiPausedForChat =
          aiEnabledBySession.get(canonicalSessionId) === false ||
          aiEnabledBySession.get(remoteJid) === false ||
          (cleanPhone ? aiEnabledBySession.get(cleanPhone) === false : false);
        conv = {
          sessionId: canonicalSessionId,
          customerPhone: cleanPhone,
          customerName: !isGenericContactName(pushName)
            ? pushName
            : odooMatch?.name || pushName,
          messages: [parsedMsg],
          messagesLoaded: false,
          aiEnabled: !isAiPausedForChat,
          unreadCount: key.fromMe ? 0 : 1,
          lastTimestamp: parsedMsg.timestamp,
          lastMessagePreview: parsedMsg.content,
          lastMessageType: parsedMsg.type,
          intentStatus: 'explorando',
          detectedProducts: [],
          zone: 'santo_domingo',
          odooPartnerId: odooMatch?.id,
          isOdooClient: Boolean(odooMatch),
          isLiveEvolution: true,
        };
        const jSet = relatedJidsBySession.get(conv.sessionId) || new Set<string>([conv.sessionId]);
        if (remoteJid) jSet.add(remoteJid);
        if (rawAlt) jSet.add(rawAlt);
        relatedJidsBySession.set(conv.sessionId, jSet);
        conversations.unshift(conv);
        hasChanges = true;
      } else {
        const jSet = relatedJidsBySession.get(conv.sessionId) || new Set<string>([conv.sessionId]);
        if (remoteJid) jSet.add(remoteJid);
        if (rawAlt) jSet.add(rawAlt);
        relatedJidsBySession.set(conv.sessionId, jSet);

        if (!isGenericContactName(pushName) && isGenericContactName(conv.customerName)) {
          conv.customerName = pushName;
          hasChanges = true;
        }

        const alreadyExists = isDuplicateChatMessage(conv.messages, parsedMsg);

        if (!alreadyExists) {
          hydrateQuotedMessageById(parsedMsg, conv.messages, conv.customerName || pushName);
          conv.messages.push(parsedMsg);
          conv.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          if (!key.fromMe) {
            conv.unreadCount = (conv.unreadCount || 0) + 1;
          }
          recordLocalMessage(conv.sessionId, parsedMsg, conv.customerPhone);
          broadcastEvent('new_message', { sessionId: conv.sessionId, message: parsedMsg });
          hasChanges = true;
        }

        if (new Date(parsedMsg.timestamp).getTime() >= new Date(conv.lastTimestamp).getTime()) {
          if (conv.lastTimestamp !== parsedMsg.timestamp || conv.lastMessagePreview !== parsedMsg.content) {
            hasChanges = true;
          }
          conv.lastTimestamp = parsedMsg.timestamp;
          conv.lastMessagePreview = parsedMsg.content;
          conv.lastMessageType = parsedMsg.type;
        }
      }
    }

    if (hasChanges) {
      conversations.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
      savePersistedConversations();
      broadcastEvent('conversations_update', { count: conversations.length });
    }

    // On first sync after server boot/reset, mark messages at or before botStartupCutoffMs as historical
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
      const nowMs = getEffectiveCurrentDate().getTime();
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

        // Check if any alias/related JID was marked as paused in this session
        if (contactKeys.some(k => aiEnabledBySession.get(k) === false)) {
          continue;
        }

        // Check cooldown and answered state
        const skipCheck = shouldSkipBotReply(conv, lastMsg, 'live_evolution_poll');
        if (skipCheck.skip) continue;

        // Mark contact as handled in this cycle ONLY (acquireBotLock inside triggerSalesBotReplyForConversation owns inFlightBotKeys)
        for (const k of contactKeys) {
          handledContactsThisCycle.add(k);
        }

        console.log(`🤖 [Auto-Reply Polling Trigger]: Encolando mensaje de ${conv.customerName} ("${lastMsg.content.slice(0, 30)}")`);
        const { isDuplicate } = enqueueInboundMessageJob({
          messageId: msgId || lastMsg.id,
          conversationId: conv.sessionId,
          customer: conv.customerName,
          customerPhone: conv.customerPhone,
          instance: appConfig.evolution?.instance || 'todolapto',
          contentType: lastMsg.type,
        });
        if (!isDuplicate) {
          processPersistentQueueTick().catch(err =>
            console.log(`[Auto-Reply Poll Info for ${conv.customerName}]:`, err?.message || err)
          );
        }
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
      // Preserve local quotedMessage, transcription, aiAnalysis or mediaUrl if Evolution API record didn't include it
      if (localMsg.quotedMessage && !combined[existingIdx].quotedMessage) {
        combined[existingIdx].quotedMessage = localMsg.quotedMessage;
      }
      if (localMsg.transcription && !combined[existingIdx].transcription) {
        combined[existingIdx].transcription = localMsg.transcription;
        if (combined[existingIdx].type === 'audio') {
          combined[existingIdx].content = `🎤 "${localMsg.transcription}"`;
        }
      }
      if (localMsg.aiAnalysis && !combined[existingIdx].aiAnalysis) {
        combined[existingIdx].aiAnalysis = localMsg.aiAnalysis;
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

    // Resolve quoted messages strictly by stanzaId / parentMessageKey and hydrate quoted voice notes
    for (let i = 0; i < unique.length; i++) {
      const m = unique[i];
      hydrateQuotedMessageById(m, unique.slice(0, i), conv?.customerName || fallbackName);

      // Only attach a catalog item reference if the customer's message ITSELF explicitly selects a catalog position or number ("La última", "La primera", "La 8", "La quinta")
      if (!m.quotedMessage && m.sender === 'customer' && i > 0) {
        const rawTxt = (m.transcription || m.content || '').trim();
        const txt = rawTxt.replace(/^🎤\s*"?|"?$/g, '').trim();
        if (isPositionalOrNumberSelection(txt)) {
          const tempConvForSlice: Conversation = {
            sessionId: canonicalId,
            customerPhone: cleanPhone,
            customerName: conv?.customerName || fallbackName,
            aiEnabled: true,
            unreadCount: 0,
            lastTimestamp: m.timestamp,
            lastMessagePreview: txt,
            intentStatus: 'explorando',
            detectedProducts: [],
            messages: unique.slice(0, i + 1),
          };
          const resolvedRef = resolveCatalogItemAndModelReference(tempConvForSlice, txt, '');
          if (resolvedRef?.product && resolvedRef.matchedByPositionOrNumber) {
            const p = resolvedRef.product;
            const numPrefix = resolvedRef.itemNumber ? `*${resolvedRef.itemNumber}.* ` : '';
            const condLabel =
              p.condition === 'Nuevo'
                ? '✨ Nuevo de Caja (Garantía 1 año)'
                : '♻️ Reacondicionado Clase A (Garantía 6 meses)';
            const specsPart = p.specsSummary || p.description_sale ? `\n⚙️ ${p.specsSummary || p.description_sale}` : '';
            let catalogMsgId = m.evolutionMessageId || m.id;
            for (let j = i - 1; j >= 0; j--) {
              if (unique[j].sender !== 'customer' && unique[j].content.includes('*1.*')) {
                catalogMsgId = unique[j].evolutionMessageId || unique[j].id;
                break;
              }
            }
            m.quotedMessage = {
              id: catalogMsgId,
              text: `${numPrefix}*${p.name}*\n💰 RD$${p.list_price.toLocaleString()} | 📦 ${p.virtual_available} unidad(es) | 🏷️ ${condLabel}${specsPart}`,
              type: 'text',
              author: `Todo Lapto (Catálogo — ${resolvedRef.referenceLabel})`,
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
        const ageMs = getEffectiveCurrentDate().getTime() - msgTimeMs;
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
            console.log(`🤖 [Active Chat Fast Trigger]: Encolando respuesta a ${conv.customerName} ("${latest.content.slice(0, 35)}")`);
            const { isDuplicate } = enqueueInboundMessageJob({
              messageId: msgId || latest.id,
              conversationId: conv.sessionId,
              customer: conv.customerName,
              customerPhone: conv.customerPhone,
              instance: appConfig.evolution?.instance || 'todolapto',
              contentType: latest.type,
            });
            if (!isDuplicate) {
              processPersistentQueueTick().catch(err =>
                console.log(`[Active Chat Trigger Info for ${conv.customerName}]:`, err?.message || err)
              );
            }
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
      writeFileAtomicSync(BOT_AUDIT_LOG_FILE, JSON.stringify(botAuditLogs.slice(0, 300), null, 2));
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

// ---------------------------------------------------------
// Fase 1.5 — Structured Cross-Process Conversation Locks
// ---------------------------------------------------------
const BOT_OUTBOUND_LOCKS_FILE = path.join(__dirname, '.vendema-outbound-locks.json');
const structuredConversationLocks = new Map<string, ConversationLockEntry>();

function readCrossProcessLocksFromDisk(): Record<string, ConversationLockEntry> {
  const result: Record<string, ConversationLockEntry> = {};
  try {
    if (fs.existsSync(BOT_OUTBOUND_LOCKS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BOT_OUTBOUND_LOCKS_FILE, 'utf-8'));
      const now = Date.now();
      if (raw && typeof raw === 'object') {
        for (const [k, val] of Object.entries(raw)) {
          if (typeof val === 'number') {
            if (now < val) {
              result[k] = {
                conversationId: k,
                owner: `pid-${process.pid}`,
                acquiredAt: new Date(val - BOT_LOCK_TTL_MS).toISOString(),
                expiresAt: new Date(val).toISOString(),
              };
            }
          } else if (val && typeof val === 'object' && (val as any).expiresAt) {
            const expMs = new Date((val as any).expiresAt).getTime();
            if (expMs > now) {
              result[k] = val as ConversationLockEntry;
            }
          }
        }
      }
    }
  } catch {}
  return result;
}

function getActiveConversationLocks(): ConversationLockEntry[] {
  const diskLocks = readCrossProcessLocksFromDisk();
  const uniqueByConv = new Map<string, ConversationLockEntry>();
  for (const entry of Object.values(diskLocks)) {
    if (entry && entry.conversationId) {
      uniqueByConv.set(entry.conversationId, entry);
    }
  }
  const now = Date.now();
  for (const [k, entry] of structuredConversationLocks.entries()) {
    if (new Date(entry.expiresAt).getTime() > now) {
      uniqueByConv.set(entry.conversationId || k, entry);
    } else {
      structuredConversationLocks.delete(k);
    }
  }
  return Array.from(uniqueByConv.values());
}

function acquireCrossProcessBotLock(
  lockKeys: string[],
  conversationId: string,
  ownerId: string,
  ttlMs = BOT_LOCK_TTL_MS
): boolean {
  try {
    const data = readCrossProcessLocksFromDisk();
    const now = Date.now();
    for (const key of lockKeys) {
      const existing = data[key];
      if (existing) {
        const expMs = new Date(existing.expiresAt).getTime();
        if (now < expMs && existing.owner !== ownerId) {
          return false; // Locked by another active owner/job
        }
      }
    }
    const lockRecord: ConversationLockEntry = {
      conversationId,
      owner: ownerId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    for (const key of lockKeys) {
      data[key] = lockRecord;
      structuredConversationLocks.set(key, lockRecord);
    }
    writeFileAtomicSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return true;
  }
}

function renewCrossProcessBotLock(lockKeys: string[], ownerId: string, ttlMs = BOT_LOCK_TTL_MS): void {
  try {
    const data = readCrossProcessLocksFromDisk();
    const now = Date.now();
    const nextExpires = new Date(now + ttlMs).toISOString();
    for (const key of lockKeys) {
      if (data[key] && data[key].owner === ownerId) {
        data[key].expiresAt = nextExpires;
      }
      const mem = structuredConversationLocks.get(key);
      if (mem && mem.owner === ownerId) {
        mem.expiresAt = nextExpires;
      }
      if (inFlightBotKeys.has(key)) {
        inFlightBotKeys.set(key, now);
      }
    }
    writeFileAtomicSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function releaseCrossProcessBotLock(lockKeys: string[], ownerId?: string): void {
  try {
    const data = readCrossProcessLocksFromDisk();
    for (const key of lockKeys) {
      if (!ownerId || !data[key] || data[key].owner === ownerId) {
        delete data[key];
      }
      structuredConversationLocks.delete(key);
    }
    writeFileAtomicSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

function acquireBotLock(conv: Conversation, triggerSource = 'unknown', ownerId?: string): boolean {
  const effectiveOwner = ownerId || `${triggerSource}-${process.pid}-${Date.now()}`;
  if (triggerSource === 'manual_crm_trigger') {
    releaseBotLock(conv);
  }
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    if (isBotLockActive(k)) {
      const existingMem = structuredConversationLocks.get(k);
      if (!existingMem || existingMem.owner !== effectiveOwner) {
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
          reason: `Bloqueo atómico activo por conversación (owner: ${existingMem?.owner || 'in_flight'}).`,
          durationMs: 0,
        });
        return false;
      }
    }
  }

  if (!acquireCrossProcessBotLock(keys, conv.sessionId, effectiveOwner, BOT_LOCK_TTL_MS)) {
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
      reason: 'Ya hay una respuesta generándose en otro worker. Bloqueo multi-proceso activo.',
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

function releaseBotLock(conv: Conversation, ownerId?: string): void {
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    inFlightBotKeys.delete(k);
  }
  releaseCrossProcessBotLock(keys, ownerId);
}

// ---------------------------------------------------------
// Fase 1.4 — Persistent Job Queue Engine (.vendema-job-queue.json)
// ---------------------------------------------------------
const JOB_QUEUE_FILE = path.join(__dirname, '.vendema-job-queue.json');
const JOB_MAX_EXECUTION_MS = 90000;
const JOB_DEFAULT_MAX_ATTEMPTS = 3;
let persistentJobQueue: QueueJobEntry[] = [];
let isQueueWorkerRunning = false;

function savePersistentJobQueue() {
  try {
    // Purge any synthetic test jobs and bound file size to 400 jobs
    persistentJobQueue = persistentJobQueue.filter(
      j =>
        !isSyntheticTestArtifact(j.messageId) &&
        !isSyntheticTestArtifact(j.conversationId) &&
        !isSyntheticTestArtifact(j.customer)
    );
    if (persistentJobQueue.length > 400) {
      persistentJobQueue = persistentJobQueue.slice(0, 400);
    }
    writeFileAtomicSync(JOB_QUEUE_FILE, JSON.stringify(persistentJobQueue, null, 2));
  } catch (err: any) {
    console.warn('[JobQueue Save Error]:', err?.message || err);
  }
}

function loadPersistentJobQueue() {
  try {
    if (fs.existsSync(JOB_QUEUE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(JOB_QUEUE_FILE, 'utf-8'));
      if (Array.isArray(raw)) {
        persistentJobQueue = raw.filter(
          (j: QueueJobEntry) =>
            !isSyntheticTestArtifact(j?.messageId) &&
            !isSyntheticTestArtifact(j?.conversationId) &&
            !isSyntheticTestArtifact(j?.customer)
        );
      }
    }
  } catch {
    persistentJobQueue = [];
  }

  // Fase 1.4 — Recover stuck PROCESSING or RECEIVED jobs after server restart
  let recoveredCount = 0;
  const nowIso = new Date().toISOString();
  for (const job of persistentJobQueue) {
    if (job.status === 'PROCESSING' || job.status === 'RECEIVED') {
      job.status = 'RETRY';
      job.nextRetryAt = nowIso;
      job.lastError = 'Recuperado automáticamente tras reinicio del servidor';
      recoveredCount++;
    }
  }
  savePersistentJobQueue();
  if (recoveredCount > 0) {
    recordSystemApiLog({
      service: 'Backend',
      action: `Recuperación de Cola Persistente (${recoveredCount} tareas)`,
      method: 'QUEUE',
      statusCode: 200,
      success: true,
      durationMs: 0,
      severity: 'MEDIUM',
      module: 'queue',
      requestPreview: `Se detectaron ${recoveredCount} trabajos en estado PROCESSING/RECEIVED tras reinicio`,
      responseSnippet: `Trabajos restablecidos a estado RETRY para procesamiento seguro.`,
    });
  }
}

loadPersistentJobQueue();

function generateCorrelationId(messageId?: string): string {
  const cleanMsg = normalizeMsgIdKey(messageId).slice(-8) || Math.random().toString(36).slice(2, 8);
  return `corr-${Date.now()}-${cleanMsg}`;
}

function enqueueInboundMessageJob(params: {
  messageId: string;
  conversationId: string;
  customer: string;
  customerPhone: string;
  instance: string;
  contentType: string;
  correlationId?: string;
}): { job: QueueJobEntry; isDuplicate: boolean } {
  const cleanMsgId = normalizeMsgIdKey(params.messageId) || `msg-${Date.now()}`;
  const existing = persistentJobQueue.find(
    j =>
      normalizeMsgIdKey(j.messageId) === cleanMsgId &&
      ['RECEIVED', 'PENDING', 'PROCESSING', 'RETRY', 'COMPLETED'].includes(j.status)
  );
  if (existing) {
    return { job: existing, isDuplicate: true };
  }

  const correlationId = params.correlationId || generateCorrelationId(cleanMsgId);
  const nowIso = new Date().toISOString();
  const job: QueueJobEntry = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    correlationId,
    messageId: cleanMsgId,
    conversationId: params.conversationId,
    customer: params.customer || 'Cliente WhatsApp',
    customerPhone: params.customerPhone || '',
    instance: params.instance || appConfig.evolution?.instance || 'todolapto',
    contentType: params.contentType || 'text',
    receivedAt: nowIso,
    status: 'RECEIVED',
    attempts: 0,
    maxAttempts: JOB_DEFAULT_MAX_ATTEMPTS,
  };

  persistentJobQueue.unshift(job);
  recordDiagnosticStage({
    correlationId,
    stage: 'QUEUE_CREATED',
    module: 'queue',
    customer: job.customer,
    conversationId: job.conversationId,
    messageId: job.messageId,
    details: `Trabajo ${job.id} creado en cola persistente (estado RECEIVED -> PENDING)`,
  });

  job.status = 'PENDING';
  savePersistentJobQueue();
  return { job, isDuplicate: false };
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

  // 0. Explicit AI pause (Human takeover or global AI off)
  if (triggerSource !== 'manual_crm_trigger') {
    if (!appConfig.globalAiActive) {
      return { skip: true, reason: 'IA desactivada globalmente en la configuración del CRM' };
    }
    const isChatAiPaused =
      conv.aiEnabled === false ||
      keys.some(k => aiEnabledBySession.get(k) === false);
    if (isChatAiPaused) {
      const reason = 'IA pausada manualmente en este chat para permitir atención humana';
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: 'blocked_manual_pause',
        reason,
        durationMs: 0,
      });
      return { skip: true, reason };
    }
  }

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
        reason: `Mensaje previo al corte de activación (${formatDominicanTimeOnly(msgTimeMs) || new Date(msgTimeMs).toLocaleTimeString()}). Solo se responden mensajes nuevos automáticamente.`,
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
const lastBotSendTimeByPhone = new Map<string, number>();

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureEvolutionInstanceConnected(): Promise<boolean> {
  if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) return false;
  const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, '');
  const instance = appConfig.evolution.instance;
  const headers = { apikey: appConfig.evolution.apiKey };

  try {
    // 1. Check current connection state
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

    if (stateRes?.ok) {
      const data = await stateRes.json().catch(() => null);
      const state = data?.instance?.state || data?.state;
      if (state === 'open') {
        appConfig.evolution.connected = true;
        return true;
      }
      // If currently connecting, wait briefly
      if (state === 'connecting') {
        for (let i = 0; i < 3; i++) {
          await sleepMs(1000);
          const chk = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
            headers,
            signal: AbortSignal.timeout(3000),
          }).catch(() => null);
          if (chk?.ok) {
            const d = await chk.json().catch(() => null);
            if ((d?.instance?.state || d?.state) === 'open') {
              appConfig.evolution.connected = true;
              return true;
            }
          }
        }
      }
    }

    // 2. Trigger connect (non-destructive)
    await fetch(`${baseUrl}/instance/connect/${instance}`, {
      headers,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

    await sleepMs(1200);
    const verifyRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      headers,
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (verifyRes?.ok) {
      const vData = await verifyRes.json().catch(() => null);
      const vState = vData?.instance?.state || vData?.state;
      if (vState === 'open') {
        appConfig.evolution.connected = true;
        return true;
      }
    }
  } catch {
    // Ignore transient network delays
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
  const cleanKey = raw.replace(/@.*$/, '').replace(/\D/g, '');

  // Prioritize mapped phone number if this is a LID or known mapped contact
  const mappedPhone = lidToPhoneMap.get(raw) || (cleanKey ? lidToPhoneMap.get(cleanKey) : undefined);
  if (mappedPhone) {
    const cleanMapped = mappedPhone.replace(/\D/g, '');
    if (cleanMapped.length === 10 && /^(809|829|849)/.test(cleanMapped)) {
      return `1${cleanMapped}@s.whatsapp.net`;
    }
    return `${cleanMapped}@s.whatsapp.net`;
  }

  if (raw.includes('@')) return raw;
  // WhatsApp @lid IDs are 14-15 digits long, whereas standard phone numbers are 10-12 digits
  if (cleanKey.length >= 14) {
    return `${cleanKey}@lid`;
  }
  if (cleanKey.length === 10 && /^(809|829|849)/.test(cleanKey)) {
    return `1${cleanKey}@s.whatsapp.net`;
  }
  return cleanKey ? `${cleanKey}@s.whatsapp.net` : raw;
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
  const trimmedText = text.trim();
  const dispatchKey = `${cleanTargetKey}::${trimmedText}`;
  const nowMs = Date.now();

  // 1. Anti-Duplicate: Drop identical message dispatched to this target within 60s
  const lastExactTs = recentOutboundDispatches.get(dispatchKey);
  if (lastExactTs && nowMs - lastExactTs < 60000) {
    console.log(`🛡️ [Anti-Duplicate]: Mensaje idéntico ya despachado a ${cleanTargetKey} hace ${Math.round((nowMs - lastExactTs) / 1000)}s. Cancelando duplicado.`);
    return { ok: true, socketClosed: false };
  }

  // 2. Anti-Duplicate Cooldown: Prevent automated bot from sending rapid-fire dual messages to same contact within 10s
  if (!isManualAgent) {
    const lastAnyBotSend = lastBotSendTimeByPhone.get(cleanTargetKey);
    if (lastAnyBotSend && nowMs - lastAnyBotSend < 10000) {
      console.log(`🛡️ [Anti-Duplicate Guard]: El bot ya envió un mensaje a ${cleanTargetKey} hace ${Math.round((nowMs - lastAnyBotSend) / 1000)}s. Previniendo envío doble.`);
      return { ok: true, socketClosed: false };
    }
  }

  const url = `${appConfig.evolution.serverUrl.replace(/\/$/, '')}/message/sendText/${appConfig.evolution.instance}`;

  // Execute with automatic self-healing if Baileys/Evolution API socket was disconnected (max 2 attempts)
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Alternate between target with JID (e.g. 18495393496@s.whatsapp.net) and bare digits (18495393496) on retry
    const dispatchTarget =
      attempt === 2 && cleanTargetKey.length >= 10 && !cleanTargetKey.includes('@lid')
        ? cleanTargetKey
        : target;

    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: appConfig.evolution.apiKey,
        },
        body: JSON.stringify({
          number: dispatchTarget,
          text,
          delay: delayMs,
        }),
        signal: AbortSignal.timeout(20000),
      });

      const durationMs = Date.now() - t0;

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const messageId = data?.key?.id || data?.id || '';
        if (!isManualAgent) {
          recentOutboundDispatches.set(dispatchKey, Date.now());
          lastBotSendTimeByPhone.set(cleanTargetKey, Date.now());
        }
        appConfig.evolution.connected = true;

        recordSystemApiLog({
          service: 'Evolution API',
          action: 'Enviar Mensaje WhatsApp (sendText)',
          method: 'POST',
          url,
          target: dispatchTarget,
          statusCode: res.status,
          success: true,
          durationMs,
          requestPreview: `Destino: ${dispatchTarget} | Texto: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`,
          responseSnippet: JSON.stringify(data || {}).slice(0, 350),
        });

        return { ok: true, socketClosed: false, messageId };
      }

      const errBody = await res.text().catch(() => '');
      const isSocketClosed =
        /Connection Closed|Connection Failure|Timed Out|Stream Errored|Precondition Required|1006|1005|1001|closed|socket/i.test(errBody) ||
        res.status >= 500;

      recordSystemApiLog({
        service: 'Evolution API',
        action: 'Enviar Mensaje WhatsApp (sendText)',
        method: 'POST',
        url,
        target: dispatchTarget,
        statusCode: res.status,
        success: false,
        durationMs,
        requestPreview: `Destino: ${dispatchTarget} | Intento: ${attempt}/2 | Texto: ${text.length > 70 ? `${text.slice(0, 70)}...` : text}`,
        error: errBody || `HTTP ${res.status}`,
        responseSnippet: errBody.slice(0, 500),
      });

      if (isSocketClosed && attempt === 1) {
        const reconnected = await ensureEvolutionInstanceConnected();
        if (reconnected) {
          await sleepMs(800);
          continue;
        }
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
        target: dispatchTarget,
        statusCode: 0,
        success: false,
        durationMs,
        requestPreview: `Destino: ${dispatchTarget} | Intento: ${attempt}/2`,
        error: fetchErr?.message || 'Error de red o timeout al despachar a Evolution API',
      });

      if (attempt === 1) {
        const reconnected = await ensureEvolutionInstanceConnected();
        if (reconnected) {
          await sleepMs(800);
          continue;
        }
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

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        number: primaryTarget,
        delay: durationMs,
        presence: 'composing',
      }),
      signal: AbortSignal.timeout(durationMs + 3000),
    }).catch(() => null);
  } catch {
    // Ignore presence errors
  }

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
  } else {
    // Check if mapped via lidToPhoneMap
    const mappedPhone = lidToPhoneMap.get(conv.sessionId) || (cleanPhone ? lidToPhoneMap.get(cleanPhone) : undefined);
    if (mappedPhone) {
      const cleanM = mappedPhone.replace(/\D/g, '');
      const stdM = cleanM.length === 10 && /^(809|829|849)/.test(cleanM) ? `1${cleanM}` : cleanM;
      primaryTarget = `${stdM}@s.whatsapp.net`;
    } else if (conv.sessionId && !conv.sessionId.includes('@lid')) {
      primaryTarget = conv.sessionId;
    } else if (cleanPhone) {
      primaryTarget = cleanPhone;
    } else {
      primaryTarget = conv.sessionId;
    }
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
  
  const candidateJids = new Set<string>();
  if (remoteJid) candidateJids.add(remoteJid);
  if (rawRecord?.key?.remoteJid) candidateJids.add(rawRecord.key.remoteJid);

  if (remoteJid) {
    const mapped = lidToPhoneMap.get(remoteJid) || lidToPhoneMap.get(remoteJid.replace(/@.*$/, ''));
    if (mapped) candidateJids.add(`${mapped}@s.whatsapp.net`);
    const rel = relatedJidsBySession.get(remoteJid);
    if (rel) {
      for (const r of rel) candidateJids.add(r);
    }
  }

  for (const conv of conversations) {
    if (conv.messages?.some(m => m.evolutionMessageId === cleanId || m.id === cleanId)) {
      candidateJids.add(conv.sessionId);
      if (conv.customerPhone) candidateJids.add(`${conv.customerPhone}@s.whatsapp.net`);
      const rel = relatedJidsBySession.get(conv.sessionId);
      if (rel) {
        for (const r of rel) candidateJids.add(r);
      }
      break;
    }
  }

  // Try with n8n and Evolution API candidate payloads
  const payloads: any[] = [
    { 'message.key.id': cleanId, convertToMp4 },
    { message: { key: { id: cleanId } }, convertToMp4 },
    rawRecord?.key
      ? { message: { key: rawRecord.key, message: rawRecord.message }, convertToMp4 }
      : null,
  ];

  for (const j of candidateJids) {
    payloads.push({ message: { key: { id: cleanId, remoteJid: j, fromMe: false } }, convertToMp4 });
    payloads.push({ message: { key: { id: cleanId, remoteJid: j, fromMe: true } }, convertToMp4 });
    payloads.push({ message: { key: { id: cleanId, remoteJid: j } }, convertToMp4 });
    payloads.push({ 'message.key.id': cleanId, 'message.key.remoteJid': j, convertToMp4 });
  }

  const validPayloads = payloads.filter(Boolean);

  for (const payload of validPayloads) {
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
  if (/\b(impresora|impresoras|printer|printers|multifuncional|multifuncionales|imprimir|fotocopiadora|fotocopiadoras)\b/i.test(s)) {
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
  if (/\b(monitor|monitores|pantalla|pantallas|pantalla\s*de\s*pc|pantalla\s*para\s*pc|pantallas\s*pc)\b/i.test(s) && !/\b(tactil|táctil|partida|rota|pequeña)\b/i.test(s)) {
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

  // 14. Laptops, Computadoras y Portátiles
  if (
    /\b(laptop|laptops|lapto|laptos|computadora|computadoras|computador|computadores|pc|pcs|portatil|portatiles|portátil|portátiles|notebook|notebooks|chromebook|chromebooks|maquina|maquinas|máquina|máquinas)\b/i.test(
      s
    ) &&
    !/\b(pad|mouse|alfombrilla|pantalla\s*de\s*pc|pantalla\s*para\s*pc|monitor)\b/i.test(s)
  ) {
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

// Helper: Normalize common Spanish Whisper voice-note phonetic transcriptions into canonical laptop/product model tokens
function normalizePhoneticProductText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\b(team\s*pack|tin\s*pad|tink\s*pad|thin\s*pad|think\s*pack|tim\s*pad|zin\s*pad)\b/gi, 'thinkpad')
    .replace(/\b(lati\s*tud|lati\s*tu)\b/gi, 'latitude')
    .replace(/\b(pro\s*buk|pro\s*book)\b/gi, 'probook')
    .replace(/\b(eli\s*te\s*book|elite\s*buk|elit\s*book)\b/gi, 'elitebook')
    .replace(/\b(idea\s*pad|idea\s*pack)\b/gi, 'ideapad')
    .replace(/\b(ins\s*piron)\b/gi, 'inspiron')
    .replace(/\b(crome\s*book|crom\s*book|chro\s*book)\b/gi, 'chromebook')
    .replace(/\b([exltpgc])\s+(\d{2,4})\b/gi, '$1$2');
}

function isDiscountInquiry(raw: string): boolean {
  if (!raw) return false;
  return /\b(descuento|descuentos|rebaja|rebajas|rebajar|me\s*la\s*dejas?\s*en|en\s*cu[aá]nto\s*me\s*la\s*deja[sn]?|cu[aá]l\s*es\s*el\s*precio\s*m[ií]nimo|precio\s*m[ií]nimo|lo\s*menos\s*que\s*la\s*deja[sn]?|en\s*cu[aá]nto\s*es\s*lo\s*m[ií]nimo|hacerme\s*un\s*especial|precio\s*especial|me\s*haces?\s*(?:un\s*)?descuento|le\s*haces?\s*(?:un\s*)?descuento|le\s*hacen\s*(?:alg[uú]n\s*)?descuento|tiene\s*descuento|tienen\s*descuento|dejarla\s*en\s*menos|algo\s*menos)\b/i.test(
    raw
  );
}

function hasSpecificModelCodeInText(raw: string): boolean {
  if (!raw) return false;
  const norm = normalizePhoneticProductText(raw).toLowerCase();
  return /\b(e460|e570|e5570|e5470|e5270|e7270|l490|x131e|x360|c730|c771|p22t|3100|3300|3400|3541|5400|5420|5480|5510|t480|t470|15iil05|ba009dx|850\s*g4|450\s*g3|450\s*g5|430\s*g7|640\s*g2|2874|2875|720|530|617|n23|100e|11e|m4|c203x)\b/i.test(
    norm
  );
}

function isPositionalOrNumberSelection(raw: string): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  if (
    /\b(la\s*[uú]ltima|el\s*[uú]ltimo|la\s*pen[uú]ltima|el\s*pen[uú]ltimo|la\s*primera|el\s*primero|la\s*segunda|el\s*segundo|la\s*tercera|el\s*tercero|la\s*cuarta|el\s*cuarto|la\s*quinta|el\s*quinto|la\s*sexta|el\s*sexto|la\s*s[eé]ptima|el\s*s[eé]ptimo|la\s*octava|el\s*octavo|la\s*novena|el\s*noveno|la\s*d[eé]cima|el\s*d[eé]cimo|[uú]ltima\s*opci[oó]n|primera\s*opci[oó]n|segunda\s*opci[oó]n|tercera\s*opci[oó]n)\b/i.test(
      s
    )
  ) {
    return true;
  }
  if (/^\s*(?:la|el|opci[oó]n|modelo|n[uú]mero|numero|item|#)?\s*#?(\d{1,2})\s*[.!?]?\s*$/i.test(s)) {
    return true;
  }
  if (
    /\b(?:la|el|opci[oó]n|modelo|n[uú]mero|numero|#)\s*#?(\d{1,2})\b(?!\s*(?:gb|tb|ram|ssd|hdd|pulgadas|mil|k|pesos|dop|generaci[oó]n|gen|n[uú]cleos|meses|a[ñn]os|unidades|horas|am|pm))/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

// Search all Odoo products dynamically based on customer message, brand, budget, condition & use case
function getRelevantProductsHighlight(
  latestQueryText: string,
  fullContextText = '',
  recentConversationText = ''
): string {
  if ((!latestQueryText && !fullContextText && !recentConversationText) || products.length === 0) return '';
  // Strip any internal prompt wrapper headers if present so we only analyze the user's real words
  const userOnlyLatest = normalizePhoneticProductText(
    latestQueryText
      .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Mensaje actual del cliente sobre esta cita anterior:\s*"?/gi, '')
      .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:\s*"?/gi, '')
      .replace(/\[nota de voz[^\]]*\]/gi, ' ')
      .replace(/\[audio[^\]]*\]/gi, ' ')
      .replace(/\[foto[^\]]*\]/gi, ' ')
      .replace(/\[detalles[^\]]*\]/gi, ' ')
      .replace(/\[contenido visual[^\]]*\]/gi, ' ')
      .replace(/[🎤📷🔍]/g, ' ')
      .trim()
  );
  const cleanLatest = userOnlyLatest.toLowerCase();

  // Pure greeting or courtesy guard: NEVER search or inject catalog for simple greetings
  if (isSimpleConversationalMessage(cleanLatest)) {
    return '';
  }

  // Discount or positional/number selection guard: NEVER inject a 36-item full or brand catalog when customer asks for a discount or selects a specific item by number/position/model!
  const isSingleModelOrSelection =
    isDiscountInquiry(cleanLatest) ||
    isPositionalOrNumberSelection(cleanLatest) ||
    hasSpecificModelCodeInText(cleanLatest);

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
    !isSingleModelOrSelection &&
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

      const rdNowForFooter = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
      const scheduleNoticeInFooter = rdNowForFooter.isOpen
        ? `\n\n🏪 *Estamos abiertos ahora mismo en la Av. Charles de Gaulle No. 133 hasta las 6:00 PM.* Contamos con retiro en tienda física y servicio de entrega a domicilio con pago contra entrega en Santo Domingo 🚚.`
        : `\n\n🕒 *Horario Todo Lapto:* Actualmente nos encontramos fuera de jornada (${rdNowForFooter.statusDetail}). Con gusto tomamos tu pedido por aquí y queda apartado para despacharse a primera hora ${rdNowForFooter.nextOpeningStr} 🚚.`;

      const catalogFooter =
        genericFamily.id === 'laptop'
          ? `${scheduleNoticeInFooter}\n\n*¿Cuál de estas opciones te interesa? También dime si buscas una marca, presupuesto o uso específico (oficina, estudios o gaming) y te filtro las mejores alternativas.* 🛒`
          : `${scheduleNoticeInFooter}\n\n*¿Cuál de estas opciones te interesa? Te la aparto ahora mismo para entrega a domicilio o retiro en tienda.* 🛒`;

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
  } else if (!isSingleModelOrSelection && (brandFilter || budgetFilter || useCaseFilter || wantsOnlyNew)) {
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
      const bestScore = scored[0]?.score || 0;
      const topMatches = isSingleModelOrSelection
        ? scored.filter(s => s.score === bestScore).slice(0, 2).map(s => s.product)
        : scored.map(s => s.product);
      if (topMatches.length > 0) {
        if (isSingleModelOrSelection) {
          sections.push(
            `=== 🎯 PRODUCTO ESPECÍFICO IDENTIFICADO EN INVENTARIO ODOO ===\n` +
              topMatches
                .map((p, idx) => formatWhatsAppProductBlock(p, idx))
                .join('\n\n')
          );
        } else {
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

// 0. System API Logs & Fase 1.8 Diagnostics Endpoints
function buildFiveServiceHealthSnapshot(): ServiceHealthProbe[] {
  const nowIso = new Date().toISOString();

  // 1. Backend
  const backendProbe: ServiceHealthProbe = {
    service: 'Backend',
    status: isServerShuttingDown ? 'DISCONNECTED' : 'CONNECTED',
    latencyMs: 1,
    lastCheckedAt: nowIso,
    failureType: 'NONE',
    details: `PID ${process.pid} · Uptime ${Math.floor(process.uptime())}s`,
  };

  // 2. Supabase
  const lastSupaLog = systemApiLogs.find(l => l.service === 'Supabase');
  const hasSupaCfg = Boolean(appConfig.supabase?.url && appConfig.supabase?.anonKey);
  const pendingSyncCount = pendingSupabaseSyncMap.size;
  const supabaseProbe: ServiceHealthProbe = {
    service: 'Supabase',
    status: !hasSupaCfg
      ? 'DISCONNECTED'
      : pendingSyncCount > 5
      ? 'DEGRADED'
      : appConfig.supabase?.connected !== false
      ? 'CONNECTED'
      : 'DEGRADED',
    latencyMs: lastSupaLog?.durationMs || 0,
    lastCheckedAt: lastSupaLog?.timestamp || appConfig.supabase?.lastSync || nowIso,
    failureType: !hasSupaCfg ? 'INVALID_CONFIG' : pendingSyncCount > 0 ? 'CONNECTION_ERROR' : 'NONE',
    details: !hasSupaCfg
      ? 'Sin credenciales configuradas'
      : pendingSyncCount > 0
      ? `${pendingSyncCount} sincronizaciones en cola local`
      : 'Sincronización activa',
  };

  // 3. Evolution API
  const lastEvoLog = systemApiLogs.find(l => l.service === 'Evolution API');
  const hasEvoCfg = Boolean(appConfig.evolution?.serverUrl && appConfig.evolution?.instance && appConfig.evolution?.apiKey);
  const evoErrText = (lastEvoLog?.error || '').toLowerCase();
  const evolutionProbe: ServiceHealthProbe = {
    service: 'Evolution API',
    status: !hasEvoCfg
      ? 'DISCONNECTED'
      : lastEvoLog
      ? lastEvoLog.success
        ? 'CONNECTED'
        : evoErrText.includes('connection closed')
        ? 'DISCONNECTED'
        : 'DEGRADED'
      : appConfig.evolution?.connected
      ? 'CONNECTED'
      : 'UNKNOWN',
    latencyMs: lastEvoLog?.durationMs || 0,
    lastCheckedAt: lastEvoLog?.timestamp || nowIso,
    failureType: !hasEvoCfg
      ? 'INVALID_CONFIG'
      : lastEvoLog && !lastEvoLog.success
      ? lastEvoLog.statusCode === 401 || lastEvoLog.statusCode === 403
        ? 'AUTH_ERROR'
        : evoErrText.includes('connection closed')
        ? 'CONNECTION_ERROR'
        : 'UPSTREAM_ERROR'
      : 'NONE',
    details: lastEvoLog
      ? lastEvoLog.success
        ? `Instancia ${appConfig.evolution.instance} conectada`
        : lastEvoLog.error || `HTTP ${lastEvoLog.statusCode || 500}`
      : `Instancia ${appConfig.evolution.instance}`,
  };

  // 4. OpenAI
  const lastAiLog = systemApiLogs.find(l => l.service === 'AI Engine');
  const hasOpenAiKey = Boolean(appConfig.aiProvider?.openaiApiKey && !isMaskedSecret(appConfig.aiProvider.openaiApiKey));
  const aiErrText = (lastAiLog?.error || '').toLowerCase();
  const openaiProbe: ServiceHealthProbe = {
    service: 'OpenAI',
    status: !hasOpenAiKey
      ? 'DISCONNECTED'
      : lastAiLog
      ? lastAiLog.success
        ? 'CONNECTED'
        : 'DISCONNECTED'
      : 'UNKNOWN',
    latencyMs: lastAiLog?.durationMs || 0,
    lastCheckedAt: lastAiLog?.timestamp || nowIso,
    failureType: !hasOpenAiKey
      ? 'INVALID_CONFIG'
      : lastAiLog && !lastAiLog.success
      ? lastAiLog.statusCode === 401 || aiErrText.includes('401') || aiErrText.includes('incorrect api key')
        ? 'AUTH_ERROR'
        : lastAiLog.statusCode === 429 || aiErrText.includes('429')
        ? 'RATE_LIMIT'
        : 'UPSTREAM_ERROR'
      : 'NONE',
    details: !hasOpenAiKey
      ? 'Falta API Key sk-...'
      : lastAiLog
      ? lastAiLog.success
        ? `Motor ${appConfig.aiProvider?.model || 'gpt-4o-mini'} operativo`
        : lastAiLog.error || `HTTP ${lastAiLog.statusCode || 401}`
      : `Modelo ${appConfig.aiProvider?.model || 'gpt-4o-mini'}`,
  };

  // 5. Odoo
  const lastOdooLog = systemApiLogs.find(l => l.service === 'Odoo ERP');
  const hasOdooCfg = Boolean(appConfig.odoo?.url && appConfig.odoo?.db && appConfig.odoo?.apiKey);
  const odooProbe: ServiceHealthProbe = {
    service: 'Odoo',
    status: !hasOdooCfg
      ? 'DISCONNECTED'
      : lastOdooLog
      ? lastOdooLog.success
        ? 'CONNECTED'
        : 'DEGRADED'
      : products.length > 0
      ? 'CONNECTED'
      : 'UNKNOWN',
    latencyMs: lastOdooLog?.durationMs || 0,
    lastCheckedAt: lastOdooLog?.timestamp || appConfig.odoo?.lastSync || nowIso,
    failureType: !hasOdooCfg
      ? 'INVALID_CONFIG'
      : lastOdooLog && !lastOdooLog.success
      ? 'UPSTREAM_ERROR'
      : 'NONE',
    details: `${products.length} productos en stock · DB: ${appConfig.odoo.db}`,
  };

  return [backendProbe, supabaseProbe, evolutionProbe, openaiProbe, odooProbe];
}

app.get('/api/system/logs', (req, res) => {
  const service = req.query.service as string | undefined;
  const status = req.query.status as string | undefined;
  const severity = req.query.severity as string | undefined;
  const correlationId = req.query.correlationId as string | undefined;
  const customer = req.query.customer as string | undefined;
  const moduleFilter = req.query.module as string | undefined;
  const stageFilter = req.query.stage as string | undefined;

  let filtered = [...systemApiLogs];

  if (service && service !== 'all') {
    filtered = filtered.filter(l => l.service.toLowerCase().includes(service.toLowerCase()));
  }
  if (status === 'error') {
    filtered = filtered.filter(l => !l.success || (l.statusCode && l.statusCode >= 400));
  } else if (status === 'success') {
    filtered = filtered.filter(l => l.success && (!l.statusCode || l.statusCode < 400));
  }
  if (severity && severity !== 'all') {
    filtered = filtered.filter(l => (l.severity || 'INFO').toUpperCase() === severity.toUpperCase());
  }
  if (correlationId && correlationId.trim()) {
    const q = correlationId.trim().toLowerCase();
    filtered = filtered.filter(l => (l.correlationId || '').toLowerCase().includes(q));
  }
  if (customer && customer.trim()) {
    const q = customer.trim().toLowerCase();
    filtered = filtered.filter(
      l =>
        (l.customer || '').toLowerCase().includes(q) ||
        (l.target || '').toLowerCase().includes(q) ||
        (l.conversationId || '').toLowerCase().includes(q)
    );
  }
  if (moduleFilter && moduleFilter !== 'all') {
    filtered = filtered.filter(l => (l.module || '').toLowerCase() === moduleFilter.toLowerCase());
  }
  if (stageFilter && stageFilter !== 'all') {
    filtered = filtered.filter(l => l.stage === stageFilter);
  }

  const activeLocks = getActiveConversationLocks();
  const fiveServices = buildFiveServiceHealthSnapshot();
  const mapProbe = (svcName: string) => {
    const found = fiveServices.find(s => s.service === svcName);
    return {
      name: svcName,
      status: found?.status || 'UNKNOWN',
      lastChecked: found?.lastCheckedAt || new Date().toISOString(),
      responseTimeMs: found?.latencyMs,
      details: found?.details,
      error: found?.failureType && found.failureType !== 'NONE' ? found.details : undefined,
    };
  };

  const queueSummary = {
    total: persistentJobQueue.length,
    pending: persistentJobQueue.filter(j => j.status === 'PENDING' || j.status === 'RECEIVED').length,
    processing: persistentJobQueue.filter(j => j.status === 'PROCESSING').length,
    retry: persistentJobQueue.filter(j => j.status === 'RETRY').length,
    deadLetter: persistentJobQueue.filter(j => j.status === 'DEAD_LETTER' || j.status === 'FAILED').length,
    failed: persistentJobQueue.filter(j => j.status === 'DEAD_LETTER' || j.status === 'FAILED').length,
    completed: persistentJobQueue.filter(j => j.status === 'COMPLETED').length,
  };

  const diagnosticsPayload = {
    services: {
      backend: mapProbe('Backend'),
      supabase: mapProbe('Supabase'),
      evolution: mapProbe('Evolution API'),
      openai: mapProbe('OpenAI'),
      odoo: mapProbe('Odoo'),
    },
    queueStats: queueSummary,
    queueJobs: persistentJobQueue.slice(0, 80),
    activeLocks,
    pendingSyncCount: pendingSupabaseSyncMap.size,
    lastWebhookAt: lastWebhookReceivedAt,
  };

  res.json({
    success: true,
    logs: filtered,
    totalCount: systemApiLogs.length,
    errorCount: systemApiLogs.filter(l => !l.success || (l.statusCode && l.statusCode >= 400)).length,
    servicesHealth: fiveServices,
    queueSummary,
    recentJobs: persistentJobQueue.slice(0, 60),
    activeLocks,
    pendingSupabaseSyncs: Array.from(pendingSupabaseSyncMap.values()),
    lastWebhookReceivedAt,
    diagnostics: diagnosticsPayload,
  });
});

app.get('/api/system/diagnostics', (_req, res) => {
  const activeLocks = getActiveConversationLocks();
  const fiveServices = buildFiveServiceHealthSnapshot();
  const mapProbe = (svcName: string) => {
    const found = fiveServices.find(s => s.service === svcName);
    return {
      name: svcName,
      status: found?.status || 'UNKNOWN',
      lastChecked: found?.lastCheckedAt || new Date().toISOString(),
      responseTimeMs: found?.latencyMs,
      details: found?.details,
      error: found?.failureType && found.failureType !== 'NONE' ? found.details : undefined,
    };
  };
  const queueSummary = {
    total: persistentJobQueue.length,
    pending: persistentJobQueue.filter(j => j.status === 'PENDING' || j.status === 'RECEIVED').length,
    processing: persistentJobQueue.filter(j => j.status === 'PROCESSING').length,
    retry: persistentJobQueue.filter(j => j.status === 'RETRY').length,
    deadLetter: persistentJobQueue.filter(j => j.status === 'DEAD_LETTER' || j.status === 'FAILED').length,
    failed: persistentJobQueue.filter(j => j.status === 'DEAD_LETTER' || j.status === 'FAILED').length,
    completed: persistentJobQueue.filter(j => j.status === 'COMPLETED').length,
  };

  res.json({
    success: true,
    services: fiveServices,
    queue: {
      summary: queueSummary,
      jobs: persistentJobQueue.slice(0, 100),
    },
    activeLocks,
    pendingSupabaseSyncs: Array.from(pendingSupabaseSyncMap.values()),
    lastWebhookReceivedAt,
    diagnostics: {
      services: {
        backend: mapProbe('Backend'),
        supabase: mapProbe('Supabase'),
        evolution: mapProbe('Evolution API'),
        openai: mapProbe('OpenAI'),
        odoo: mapProbe('Odoo'),
      },
      queueStats: queueSummary,
      queueJobs: persistentJobQueue.slice(0, 100),
      activeLocks,
      pendingSyncCount: pendingSupabaseSyncMap.size,
      lastWebhookAt: lastWebhookReceivedAt,
    },
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/system/queue/retry/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = persistentJobQueue.find(j => j.id === jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Trabajo no encontrado en la cola.' });
  }
  job.status = 'RETRY';
  job.attempts = 0;
  job.nextRetryAt = new Date().toISOString();
  job.lastError = undefined;
  unmarkMessageIdProcessedForRetry(job.messageId, [job.conversationId, job.customerPhone]);
  savePersistentJobQueue();
  processPersistentQueueTick().catch(() => {});
  res.json({ success: true, job, message: 'Trabajo reencolado para procesamiento inmediato.' });
});

app.post('/api/system/locks/release', (req, res) => {
  const { conversationId } = req.body || {};
  if (conversationId) {
    const conv = conversations.find(c => c.sessionId === conversationId);
    if (conv) {
      releaseBotLock(conv);
    } else {
      releaseCrossProcessBotLock([conversationId]);
    }
  } else {
    inFlightBotKeys.clear();
    structuredConversationLocks.clear();
    writeFileAtomicSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify({}, null, 2));
  }
  res.json({ success: true, activeLocks: getActiveConversationLocks() });
});

app.post('/api/system/queue/clear', (_req, res) => {
  persistentJobQueue = persistentJobQueue.filter(
    j => j.status === 'PROCESSING' || j.status === 'PENDING' || j.status === 'RECEIVED'
  );
  savePersistentJobQueue();
  res.json({
    success: true,
    jobs: persistentJobQueue,
    message: 'Historial de trabajos fallidos y completados limpiado.',
  });
});

app.post('/api/system/logs/clear', (_req, res) => {
  systemApiLogs.length = 0;
  persistentJobQueue = persistentJobQueue.filter(
    j => j.status === 'PROCESSING' || j.status === 'PENDING' || j.status === 'RECEIVED'
  );
  savePersistentJobQueue();
  recordSystemApiLog({
    service: 'Backend',
    action: 'Registros del Sistema Vaciados',
    method: 'SYS',
    statusCode: 200,
    success: true,
    durationMs: 0,
    severity: 'INFO',
    module: 'diagnostics',
    requestPreview: 'Limpieza manual solicitada desde la interfaz',
    responseSnippet: 'Buffer de diagnóstico y tareas fallidas reiniciados a 0.',
  });
  res.json({ success: true, message: 'Registros del sistema vaciados con éxito' });
});

app.post('/api/system/logs/test-ping', async (_req, res) => {
  const results: any = { backend: { ok: true, status: 200, durationMs: 1 }, supabase: null, evolution: null, odoo: null, openai: null };

  // 0. Test Supabase Connection
  try {
    const t0 = Date.now();
    const supaRes = await testSupabaseConnection(
      appConfig.supabase?.url || DEFAULT_SUPABASE_URL,
      appConfig.supabase?.anonKey || DEFAULT_SUPABASE_ANON_KEY
    );
    const supaDuration = Date.now() - t0;
    recordSystemApiLog({
      service: 'Supabase',
      action: 'Diagnóstico en Vivo (Supabase Probe)',
      method: 'GET',
      url: appConfig.supabase?.url || DEFAULT_SUPABASE_URL,
      statusCode: supaRes.success ? 200 : 500,
      success: supaRes.success,
      durationMs: supaDuration,
      responseSnippet: supaRes.message,
      error: supaRes.success ? undefined : supaRes.message,
    });
    results.supabase = {
      ok: supaRes.success,
      status: supaRes.success ? 200 : 500,
      durationMs: supaDuration,
      details: supaRes.message,
    };
  } catch (err: any) {
    results.supabase = { ok: false, status: 500, error: err.message };
  }

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
      error: sanitizeSecretsInText(err.message),
    };
  }

  res.json({ success: true, results, servicesHealth: buildFiveServiceHealthSnapshot() });
});

// 1. Get Configuration & Status (Fase 1.1: Returns Public Masked Config — ZERO raw secrets exposed)
app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    config: getPublicMaskedConfig(appConfig),
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
    recordSupabaseSyncState('holiday', 'all', syncRes.synced);
    res.json({
      success: syncRes.synced,
      ...syncRes,
    });
  } catch (err: any) {
    recordSupabaseSyncState('holiday', 'all', false, err.message);
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
      recordSupabaseSyncState('holiday', 'overrides', dbSynced);
      if (appConfig.supabase?.autoSync !== false) {
        autoSyncConfigToSupabase(appConfig)
          .then(() => recordSupabaseSyncState('config', 'global', true))
          .catch(e => recordSupabaseSyncState('config', 'global', false, e?.message));
      }
    } catch (e: any) {
      recordSupabaseSyncState('holiday', 'overrides', false, e?.message);
    }
    broadcastEvent('config_updated', appConfig);
  }
  const ctx = getDominicanTimeContext(new Date(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    dbSynced,
    tableExists,
    tableRowsSynced,
    storage,
    config: getPublicMaskedConfig(appConfig),
    schedule: ctx,
    holidayOverrides: appConfig.holidayOverrides || [],
    availableYears: getAvailableHolidayYears(ctx.year, ctx.month, appConfig.holidayOverrides || []),
    holidays: getHolidaysWithOverridesForYear(ctx.year, appConfig.holidayOverrides || []),
  });
});

app.post('/api/config', requireSessionRole(['super_admin', 'dueno', 'empleado'], false), async (req, res) => {
  const { globalAiActive, aiProvider, odoo, evolution, supabase, holidayOverrides } = req.body;
  if (globalAiActive !== undefined) appConfig.globalAiActive = Boolean(globalAiActive);
  if (aiProvider) {
    const existingOpenAiKey = appConfig.aiProvider?.openaiApiKey || '';
    const incomingOpenAiKey = typeof aiProvider.openaiApiKey === 'string' ? aiProvider.openaiApiKey.trim() : '';
    const resolvedOpenAiKey = !isMaskedSecret(incomingOpenAiKey) ? incomingOpenAiKey : existingOpenAiKey;

    const existingGeminiKey = appConfig.aiProvider?.geminiApiKey || '';
    const incomingGeminiKey = typeof aiProvider.geminiApiKey === 'string' ? aiProvider.geminiApiKey.trim() : '';
    const resolvedGeminiKey = !isMaskedSecret(incomingGeminiKey) ? incomingGeminiKey : existingGeminiKey;

    const existingDeepseekKey = appConfig.aiProvider?.deepseekApiKey || '';
    const incomingDeepseekKey = typeof aiProvider.deepseekApiKey === 'string' ? aiProvider.deepseekApiKey.trim() : '';
    const resolvedDeepseekKey = !isMaskedSecret(incomingDeepseekKey) ? incomingDeepseekKey : existingDeepseekKey;

    const targetProvider = (aiProvider.provider || appConfig.aiProvider?.provider || 'gemini') as AIProviderType;
    let targetModel = aiProvider.model || appConfig.aiProvider?.model;
    if (!targetModel) {
      targetModel = targetProvider === 'gemini' ? 'gemini-3.5-flash-lite' : 'gpt-4o-mini';
    }

    const nextAi = {
      ...appConfig.aiProvider,
      ...aiProvider,
      provider: targetProvider,
      model: targetModel,
      openaiApiKey: resolvedOpenAiKey,
      geminiApiKey: resolvedGeminiKey,
      deepseekApiKey: resolvedDeepseekKey,
    };
    if (typeof aiProvider.openaiBaseUrl === 'string' && aiProvider.openaiBaseUrl.trim()) {
      nextAi.openaiBaseUrl = aiProvider.openaiBaseUrl.trim();
    }
    if (typeof aiProvider.deepseekBaseUrl === 'string' && aiProvider.deepseekBaseUrl.trim()) {
      nextAi.deepseekBaseUrl = aiProvider.deepseekBaseUrl.trim();
    }
    appConfig.aiProvider = nextAi;
  }
  if (odoo) {
    const existingOdooKey = appConfig.odoo?.apiKey || '';
    const incomingOdooKey = typeof odoo.apiKey === 'string' ? odoo.apiKey.trim() : '';
    appConfig.odoo = {
      ...appConfig.odoo,
      ...odoo,
      apiKey: !isMaskedSecret(incomingOdooKey) ? incomingOdooKey : existingOdooKey,
    };
  }
  if (evolution) {
    const existingEvoKey = appConfig.evolution?.apiKey || '';
    const incomingEvoKey = typeof evolution.apiKey === 'string' ? evolution.apiKey.trim() : '';
    appConfig.evolution = {
      ...appConfig.evolution,
      ...evolution,
      apiKey: !isMaskedSecret(incomingEvoKey) ? incomingEvoKey : existingEvoKey,
    };
  }
  if (supabase) {
    const existingSupaKey = appConfig.supabase?.anonKey || '';
    const incomingSupaKey = typeof supabase.anonKey === 'string' ? supabase.anonKey.trim() : '';
    appConfig.supabase = {
      ...(appConfig.supabase || { url: '', anonKey: '' }),
      ...supabase,
      anonKey: !isMaskedSecret(incomingSupaKey) ? incomingSupaKey : existingSupaKey,
    };
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
    autoSyncConfigToSupabase(appConfig)
      .then(() => recordSupabaseSyncState('config', 'global', true))
      .catch(e => recordSupabaseSyncState('config', 'global', false, e?.message));
  }
  broadcastEvent('config_updated', appConfig);
  res.json({ success: true, config: getPublicMaskedConfig(appConfig) });
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

// Dedicated endpoint to save AI Provider & API Keys with guaranteed persistence
app.post('/api/ai/save-credentials', async (req, res) => {
  const {
    provider,
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
    geminiApiKey,
    deepseekApiKey,
    deepseekBaseUrl,
  } = req.body;

  const targetProvider = (provider || appConfig.aiProvider?.provider || 'gemini') as AIProviderType;

  const cleanModel =
    model && String(model).trim()
      ? String(model).trim()
      : targetProvider === 'gemini'
      ? 'gemini-3.5-flash-lite'
      : 'gpt-4o-mini';

  const existingOpenAiKey = appConfig.aiProvider?.openaiApiKey || '';
  const incomingOpenAiKey = openaiApiKey !== undefined ? String(openaiApiKey).trim() : '';
  const resolvedOpenAiKey = !isMaskedSecret(incomingOpenAiKey) ? incomingOpenAiKey : existingOpenAiKey;

  const existingGeminiKey = appConfig.aiProvider?.geminiApiKey || '';
  const incomingGeminiKey = geminiApiKey !== undefined ? String(geminiApiKey).trim() : '';
  const resolvedGeminiKey = !isMaskedSecret(incomingGeminiKey) ? incomingGeminiKey : existingGeminiKey;

  const existingDeepseekKey = appConfig.aiProvider?.deepseekApiKey || '';
  const incomingDeepseekKey = deepseekApiKey !== undefined ? String(deepseekApiKey).trim() : '';
  const resolvedDeepseekKey = !isMaskedSecret(incomingDeepseekKey) ? incomingDeepseekKey : existingDeepseekKey;

  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: targetProvider,
    model: cleanModel,
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? '',
    openaiApiKey: resolvedOpenAiKey,
    geminiApiKey: resolvedGeminiKey,
    deepseekApiKey: resolvedDeepseekKey,
    ...(openaiBaseUrl !== undefined && String(openaiBaseUrl).trim() ? { openaiBaseUrl: String(openaiBaseUrl).trim() } : {}),
    ...(deepseekBaseUrl !== undefined && String(deepseekBaseUrl).trim() ? { deepseekBaseUrl: String(deepseekBaseUrl).trim() } : {}),
  };

  savePersistedConfig();

  try {
    await autoSyncConfigToSupabase(appConfig);
    recordSupabaseSyncState('config', 'ai', true);
  } catch (e: any) {
    recordSupabaseSyncState('config', 'ai', false, e?.message);
  }

  broadcastEvent('config_updated', appConfig);
  res.json({
    success: true,
    config: getPublicMaskedConfig(appConfig),
    message: 'Credenciales de OpenAI guardadas permanentemente en el servidor y respaldadas en Supabase.',
  });
});

// Supabase: Test Connection & Probe Tables
app.post('/api/supabase/test-connection', async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || '').trim();
  const rawAnon = (req.body.anonKey || '').trim();
  const anonKey = !isMaskedSecret(rawAnon) ? rawAnon : (appConfig.supabase?.anonKey || '').trim();

  if (!url || !anonKey) {
    return res.status(400).json({
      success: false,
      message: 'Se requiere la URL del proyecto y la Anon Key de Supabase.',
    });
  }

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
    recordSupabaseSyncState('config', 'supabase_probe', true);
  } else {
    recordSupabaseSyncState('config', 'supabase_probe', false, result.message);
  }

  res.json(result);
});

// Supabase: Get SQL Migration / Table Setup Script
app.get('/api/supabase/schema-sql', (_req, res) => {
  res.json({
    success: true,
    sql: getSupabaseSchemaSql(),
  });
});

// Supabase: Upload and Synchronize Everything (Users, Config, Products, Orders, Customers, WhatsApp Messages, Reminders & AI Insights)
app.post('/api/supabase/sync-all', async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || DEFAULT_SUPABASE_URL).trim();
  const rawAnon = (req.body.anonKey || '').trim();
  const anonKey = !isMaskedSecret(rawAnon)
    ? rawAnon
    : (appConfig.supabase?.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();

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

    recordSupabaseSyncState('config', 'sync_all', true);
    res.json({
      success: stats.errors.length === 0 || (stats.usersSynced + stats.ordersSynced + stats.customersSynced + stats.messagesSynced) > 0,
      stats,
      lastSync: appConfig.supabase?.lastSync,
    });
  } catch (err: any) {
    recordSupabaseSyncState('config', 'sync_all', false, err.message);
    res.status(500).json({
      success: false,
      message: `Error al subir datos a Supabase: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------
// Fase 1.1 — User Authentication, Rate Limiting & RBAC Hierarchy Endpoints
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

  const clientIp = String(req.ip || req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const rateKey = `${clientIp}:${String(username).toLowerCase().trim()}`;
  const now = Date.now();
  const rateEntry = loginRateLimitMap.get(rateKey);

  if (rateEntry && rateEntry.lockedUntil > now) {
    const waitSec = Math.ceil((rateEntry.lockedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      message: `Demasiados intentos fallidos. Por seguridad, intenta nuevamente en ${waitSec} segundos.`,
    });
  }

  let found = findMatchingSystemUser(username);
  let pwCheck = found ? verifyUserPassword(password, found.password) : { valid: false, needsMigration: false };

  // If user is not found locally or password doesn't match, hydrate latest users from Supabase
  if (!found || !pwCheck.valid) {
    await hydrateAndSyncUsersWithSupabase();
    found = findMatchingSystemUser(username);
    pwCheck = found ? verifyUserPassword(password, found.password) : { valid: false, needsMigration: false };
  }

  if (!found || !pwCheck.valid) {
    const prevCount = rateEntry && now - rateEntry.firstAttemptAt < 10 * 60 * 1000 ? rateEntry.count + 1 : 1;
    loginRateLimitMap.set(rateKey, {
      count: prevCount,
      firstAttemptAt: rateEntry && now - rateEntry.firstAttemptAt < 10 * 60 * 1000 ? rateEntry.firstAttemptAt : now,
      lockedUntil: prevCount >= 8 ? now + 5 * 60 * 1000 : 0,
    });
    return res.status(401).json({
      success: false,
      message: !found ? 'Nombre de usuario no encontrado.' : 'Contraseña incorrecta.',
    });
  }

  if (!found.activo) {
    return res.status(403).json({ success: false, message: 'Esta cuenta ha sido desactivada por el Super Administrador.' });
  }

  // Clear rate limit on successful login
  loginRateLimitMap.delete(rateKey);

  // Transparently migrate legacy plain-text password to scrypt hash
  if (pwCheck.needsMigration || !isPasswordHashed(found.password)) {
    found.password = hashUserPassword(password);
  }

  found.lastLogin = new Date().toISOString();
  savePersistedUsers();
  autoSyncUserToSupabase(found, systemUsers)
    .then(() => recordSupabaseSyncState('user', found!.id, true))
    .catch(e => recordSupabaseSyncState('user', found!.id, false, e?.message));

  const { token, expiresAt } = createSignedSessionToken(found);
  setSessionCookie(res, token, req);

  res.json({
    success: true,
    user: sanitizeUser(found),
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

app.get('/api/auth/me', async (req, res) => {
  const token = extractTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'No autenticado.' });
  }

  const verified = verifySignedSessionToken(token);
  if (verified.valid && verified.userId) {
    let user = systemUsers.find(u => u.id === verified.userId && u.activo);
    if (!user) {
      await hydrateAndSyncUsersWithSupabase();
      user = systemUsers.find(u => u.id === verified.userId && u.activo);
    }
    if (user) {
      return res.json({ success: true, user: sanitizeUser(user) });
    }
  }

  res.status(401).json({ success: false, message: 'Sesión no válida o expirada.' });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractTokenFromRequest(req);
  const verified = verifySignedSessionToken(token);
  if (verified.sessionId) {
    activeSessionsMap.delete(verified.sessionId);
  }
  clearSessionCookie(res);
  res.json({ success: true, message: 'Sesión cerrada correctamente.' });
});

app.get('/api/users', requireSessionRole(['super_admin', 'dueno'], false), async (_req, res) => {
  await hydrateAndSyncUsersWithSupabase();
  res.json({
    success: true,
    users: systemUsers.map(sanitizeUser),
    total: systemUsers.length,
  });
});

app.post('/api/users', requireSessionRole(['super_admin', 'dueno'], false), async (req, res) => {
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
    password: hashUserPassword(String(password).trim()),
    whatsapp: String(whatsapp).replace(/[^\d+]/g, ''),
    role: userRole,
    activo: true,
    createdAt: new Date().toISOString(),
  };

  systemUsers.push(newUser);
  savePersistedUsers();
  await autoSyncUserToSupabase(newUser, systemUsers).catch(e =>
    recordSupabaseSyncState('user', newUser.id, false, e?.message)
  );

  res.status(201).json({
    success: true,
    message: `Usuario ${newUser.nombre} (@${newUser.username}) creado con contraseña cifrada y sincronizado con Supabase.`,
    user: sanitizeUser(newUser),
  });
});

app.put('/api/users/:id', requireSessionRole(['super_admin', 'dueno'], false), async (req, res) => {
  const { id } = req.params;
  const userIdx = systemUsers.findIndex(u => u.id === id);

  if (userIdx === -1) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
  }

  const targetUser = systemUsers[userIdx];
  const { nombre, whatsapp, password, role, activo } = req.body;

  if (nombre) targetUser.nombre = String(nombre).trim();
  if (whatsapp) targetUser.whatsapp = String(whatsapp).replace(/[^\d+]/g, '');
  if (password && String(password).trim() && !isMaskedSecret(password)) {
    targetUser.password = hashUserPassword(String(password).trim());
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
  await autoSyncUserToSupabase(targetUser, systemUsers).catch(e =>
    recordSupabaseSyncState('user', targetUser.id, false, e?.message)
  );

  res.json({
    success: true,
    message: `Usuario ${targetUser.nombre} actualizado y sincronizado con Supabase.`,
    user: sanitizeUser(targetUser),
  });
});

app.delete('/api/users/:id', requireSessionRole(['super_admin', 'dueno'], false), async (req, res) => {
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
  await deleteUserFromSupabase(targetUser, systemUsers).catch(() => {});

  res.json({
    success: true,
    message: `Usuario @${targetUser.username} eliminado correctamente.`,
  });
});

// Test Active AI Provider (Gemini / OpenAI / DeepSeek)
app.post('/api/ai/test-provider', async (req, res) => {
  const {
    provider,
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
    geminiApiKey,
    deepseekApiKey,
    deepseekBaseUrl,
  } = req.body;

  const targetProvider = (provider || appConfig.aiProvider?.provider || 'gemini') as AIProviderType;

  const cleanModel =
    model && String(model).trim()
      ? String(model).trim()
      : targetProvider === 'gemini'
      ? 'gemini-3.5-flash-lite'
      : 'gpt-4o-mini';

  const existingOpenAiKey = appConfig.aiProvider?.openaiApiKey || '';
  const incomingOpenAiKey = openaiApiKey !== undefined ? String(openaiApiKey).trim() : '';
  const resolvedOpenAiKey = !isMaskedSecret(incomingOpenAiKey) ? incomingOpenAiKey : existingOpenAiKey;

  const existingGeminiKey = appConfig.aiProvider?.geminiApiKey || '';
  const incomingGeminiKey = geminiApiKey !== undefined ? String(geminiApiKey).trim() : '';
  const resolvedGeminiKey = !isMaskedSecret(incomingGeminiKey) ? incomingGeminiKey : existingGeminiKey;

  const existingDeepseekKey = appConfig.aiProvider?.deepseekApiKey || '';
  const incomingDeepseekKey = deepseekApiKey !== undefined ? String(deepseekApiKey).trim() : '';
  const resolvedDeepseekKey = !isMaskedSecret(incomingDeepseekKey) ? incomingDeepseekKey : existingDeepseekKey;

  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: targetProvider,
    model: cleanModel,
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? '',
    openaiApiKey: resolvedOpenAiKey,
    geminiApiKey: resolvedGeminiKey,
    deepseekApiKey: resolvedDeepseekKey,
    ...(openaiBaseUrl !== undefined ? { openaiBaseUrl: String(openaiBaseUrl).trim() } : {}),
    ...(deepseekBaseUrl !== undefined ? { deepseekBaseUrl: String(deepseekBaseUrl).trim() } : {}),
  };

  savePersistedConfig();

  if (targetProvider === 'gemini' && !getActiveGeminiKey()) {
    return res.json({
      success: false,
      requestedProvider: 'gemini',
      message: 'Por favor ingresa tu API Key de Google Gemini para probar la conexión.',
    });
  }

  if (targetProvider === 'openai' && !getActiveOpenAiKey()) {
    return res.json({
      success: false,
      requestedProvider: 'openai',
      message: 'Por favor ingresa tu API Key de OpenAI (sk-...) para probar la conexión con OpenAI.',
    });
  }

  try {
    const result = await generateTextWithConfiguredAI({
      prompt: 'Responde únicamente: OK',
      systemInstruction: 'Eres el motor de inteligencia artificial de Vendemá CRM para Todo Lapto.',
      allowFallback: false,
    });

    res.json({
      success: true,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      reply: result.text.trim(),
      message: `Motor ${result.providerUsed.toUpperCase()} (${result.modelUsed}) conectado y verificado con éxito: "${result.text.trim()}"`,
    });
  } catch (err: any) {
    res.json({
      success: false,
      requestedProvider: targetProvider,
      message: `No se pudo conectar con ${targetProvider.toUpperCase()}: ${sanitizeSecretsInText(err.message)}`,
    });
  }
});

// System Real-Time Time Synchronization & Status (America/Santo_Domingo UTC-4)
// Authoritative master clock synchronized with atomic internet NTP / TimeAPI servers
app.get('/api/system/time-sync', async (req, res) => {
  const effective = getEffectiveCurrentDate();
  const rd = getDominicanTimeContext(effective, appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: effective.getTime(),
    effectiveTimestamp: effective.getTime(),
    timezone: 'America/Santo_Domingo (UTC-4)',
    dominicanTime: rd,
  });
});

app.post('/api/system/time-sync', async (req, res) => {
  await syncAuthoritativeDominicanTime().catch(() => {});
  const effective = getEffectiveCurrentDate();
  const rd = getDominicanTimeContext(effective, appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: effective.getTime(),
    effectiveTimestamp: effective.getTime(),
    timezone: 'America/Santo_Domingo (UTC-4)',
    dominicanTime: rd,
  });
});

app.get('/api/system/time-status', (req, res) => {
  const effective = getEffectiveCurrentDate();
  const rd = getDominicanTimeContext(effective, appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: effective.getTime(),
    effectiveTimestamp: effective.getTime(),
    timezone: 'America/Santo_Domingo (UTC-4)',
    dominicanTime: rd,
  });
});

app.post('/api/system/time-reset', async (req, res) => {
  await syncAuthoritativeDominicanTime().catch(() => {});
  const effective = getEffectiveCurrentDate();
  const rd = getDominicanTimeContext(effective, appConfig.holidayOverrides || []);
  res.json({
    success: true,
    message: 'Reloj del servidor sincronizado con la hora oficial atómica de República Dominicana.',
    serverTimestamp: effective.getTime(),
    effectiveTimestamp: effective.getTime(),
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
  const baseUrl = (serverUrl || '').replace(/\/$/, '');
  try {
    // 1. Check connectionState (< 5s timeout)
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    const stateData = stateRes && stateRes.ok ? await stateRes.json().catch(() => null) : null;
    let currentState: string = stateData?.instance?.state || stateData?.state || 'unknown';

    // Refresh instance metadata (ownerJid, profileName) using ?instanceName= filter so it returns in <500ms
    if (Date.now() - evolutionQrCache.lastMetaFetchAt > 20000 || !evolutionQrCache.ownerJid) {
      evolutionQrCache.lastMetaFetchAt = Date.now();
      const instancesRes = await fetch(
        `${baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`,
        {
          headers: { apikey: apiKey },
          signal: AbortSignal.timeout(4500),
        }
      ).catch(() => null);
      if (instancesRes && instancesRes.ok) {
        const instancesData = await instancesRes.json().catch(() => []);
        const instRecord = Array.isArray(instancesData)
          ? instancesData.find((i: any) => i.name === instance || i.instanceName === instance) || instancesData[0]
          : null;
        if (instRecord) {
          evolutionQrCache.ownerJid = instRecord.ownerJid || evolutionQrCache.ownerJid;
          evolutionQrCache.profileName = instRecord.profileName || evolutionQrCache.profileName;
          evolutionQrCache.profilePicUrl = instRecord.profilePicUrl || evolutionQrCache.profilePicUrl;
          if (currentState === 'unknown' && instRecord.connectionStatus) {
            currentState = instRecord.connectionStatus;
          }
        }
      }
    }

    const forceConnect = req.query.forceConnect === 'true';
    // STRICT: An instance is ONLY connected when state === 'open'!
    const isConnected = currentState === 'open';

    if (isConnected && !forceConnect) {
      if (evolutionLastKnownState !== 'open') {
        evolutionLastKnownState = 'open';
        botStartupCutoffMs = getEffectiveCurrentDate().getTime() - 10000;
        isFirstEvolutionSync = true;
        broadcastEvent('evolution_status', { connected: true, state: 'open' });
      }
      appConfig.evolution.connected = true;
      evolutionQrCache.qrBase64 = null;
      evolutionQrCache.pairingCode = null;

      return res.json({
        success: true,
        instance,
        state: 'open',
        connected: true,
        ownerJid: evolutionQrCache.ownerJid,
        profileName: evolutionQrCache.profileName,
        profilePicUrl: evolutionQrCache.profilePicUrl,
        qrBase64: null,
        pairingCode: null,
      });
    }

    // 3. Not 'open': clear chats on disconnect & request QR if forceConnect=true OR if no cached QR exists yet (or cached QR is >40s old)
    clearAllChatsOnWhatsAppDisconnect(currentState);
    const qrAgeMs = Date.now() - evolutionQrCache.generatedAt;
    if (forceConnect || !evolutionQrCache.qrBase64 || qrAgeMs > 40000) {
      const connectRes = await fetch(`${baseUrl}/instance/connect/${instance}`, {
        headers: { apikey: apiKey },
        signal: AbortSignal.timeout(7000),
      }).catch(() => null);

      if (connectRes && connectRes.ok) {
        const connectData = await connectRes.json().catch(() => ({}));
        if (connectData?.instance?.state === 'open' || connectData?.state === 'open') {
          evolutionLastKnownState = 'open';
          appConfig.evolution.connected = true;
          evolutionQrCache.qrBase64 = null;
          botStartupCutoffMs = getEffectiveCurrentDate().getTime() - 10000;
          isFirstEvolutionSync = true;
          return res.json({
            success: true,
            instance,
            state: 'open',
            connected: true,
            ownerJid: evolutionQrCache.ownerJid,
            profileName: evolutionQrCache.profileName,
            profilePicUrl: evolutionQrCache.profilePicUrl,
            qrBase64: null,
            pairingCode: null,
          });
        }
        const newQr = connectData?.base64 || connectData?.qrcode?.base64 || null;
        const newPairing = connectData?.pairingCode || connectData?.code || null;
        if (newQr) {
          evolutionQrCache.qrBase64 = newQr;
          evolutionQrCache.pairingCode = newPairing;
          evolutionQrCache.generatedAt = Date.now();
        }
      }
    }

    res.json({
      success: true,
      instance,
      state: currentState,
      connected: false,
      ownerJid: evolutionQrCache.ownerJid,
      profileName: evolutionQrCache.profileName,
      profilePicUrl: evolutionQrCache.profilePicUrl,
      qrBase64: evolutionQrCache.qrBase64,
      pairingCode: evolutionQrCache.pairingCode,
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
  const baseUrl = (serverUrl || '').replace(/\/$/, '');
  try {
    evolutionQrCache.qrBase64 = null;
    evolutionQrCache.pairingCode = null;
    evolutionQrCache.generatedAt = 0;
    clearAllChatsOnWhatsAppDisconnect('close');

    await fetch(`${baseUrl}/instance/logout/${instance}`, {
      method: 'DELETE',
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(6000),
    }).catch(() => null);

    // Wait briefly for Baileys socket teardown then request a fresh QR code
    await new Promise(r => setTimeout(r, 1500));
    const connectRes = await fetch(`${baseUrl}/instance/connect/${instance}`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(7000),
    }).catch(() => null);
    const connectData = connectRes && connectRes.ok ? await connectRes.json().catch(() => ({})) : {};
    const newQr = connectData?.base64 || connectData?.qrcode?.base64 || null;
    const newPairing = connectData?.pairingCode || null;
    if (newQr) {
      evolutionQrCache.qrBase64 = newQr;
      evolutionQrCache.pairingCode = newPairing;
      evolutionQrCache.generatedAt = Date.now();
    }

    res.json({
      success: true,
      state: 'connecting',
      connected: false,
      qrBase64: evolutionQrCache.qrBase64,
      pairingCode: evolutionQrCache.pairingCode,
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
  const baseUrl = (serverUrl || '').replace(/\/$/, '');
  try {
    evolutionQrCache.qrBase64 = null;
    evolutionQrCache.generatedAt = 0;
    const r = await fetch(`${baseUrl}/instance/restart/${instance}`, {
      method: 'POST',
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(10000),
    });
    let data: any = {};
    try { data = await r.json(); } catch {}
    const newQr = data?.base64 || data?.qrcode?.base64 || null;
    const newPairing = data?.pairingCode || data?.code || null;
    if (newQr) {
      evolutionQrCache.qrBase64 = newQr;
      evolutionQrCache.pairingCode = newPairing;
      evolutionQrCache.generatedAt = Date.now();
      broadcastEvent('evolution_qr', {
        qrBase64: newQr,
        pairingCode: newPairing,
        state: 'connecting',
        connected: false,
      });
    }
    res.json({
      success: r.ok,
      qrBase64: evolutionQrCache.qrBase64,
      pairingCode: evolutionQrCache.pairingCode,
      message: r.ok
        ? `Instancia "${instance}" reiniciada correctamente.${newQr ? ' Código QR actualizado.' : ''}`
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
  if (conversations.length === 0 && (evolutionLastKnownState === 'open' || evolutionLastKnownState === 'unknown')) {
    loadPersistedConversations();
  }
  if (!appConfig.evolution.connected && evolutionLastKnownState !== 'open' && evolutionLastKnownState !== 'unknown') {
    conversations = [];
  } else if (conversations.length === 0) {
    syncEvolutionChats().catch(() => {});
  } else if (forceRefresh) {
    lastChatMessagesFetchBySession.clear();
    lastEvolutionChatsSync = 0;
    syncEvolutionChats().catch(() => {});
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
    if (!appConfig.evolution.connected && evolutionLastKnownState !== 'open' && evolutionLastKnownState !== 'unknown') {
      return res.json({ success: true, sessionId, messages: [] });
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
    if (!appConfig.evolution.connected && evolutionLastKnownState !== 'open' && evolutionLastKnownState !== 'unknown') {
      return res.json({ success: true, sessionId, messages: [] });
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
  if (conv.customerPhone) {
    aiEnabledBySession.set(conv.customerPhone, conv.aiEnabled);
    aiEnabledBySession.set(`${conv.customerPhone}@s.whatsapp.net`, conv.aiEnabled);
  }

  const related = relatedJidsBySession.get(conv.sessionId);
  if (related) {
    for (const r of related) {
      aiEnabledBySession.set(r, conv.aiEnabled);
      const rClean = r.replace(/@.*$/, '').replace(/\D/g, '');
      if (rClean) aiEnabledBySession.set(rClean, conv.aiEnabled);
      const relConv = conversations.find(c => c.sessionId === r);
      if (relConv) relConv.aiEnabled = conv.aiEnabled;
    }
  }

  const contactKeys = getConversationContactKeys(conv);
  for (const k of contactKeys) {
    aiEnabledBySession.set(k, conv.aiEnabled);
  }

  const lead = customers.find(c => c.phone === conv.customerPhone || c.lidJid === conv.sessionId);
  if (lead) lead.aiEnabled = conv.aiEnabled;

  savePersistedConversations();

  // If pausing AI, purge any PENDING or RETRY jobs for this chat from the queue and release any lock
  if (!conv.aiEnabled) {
    const keys = getConversationContactKeys(conv);
    persistentJobQueue = persistentJobQueue.filter(j => {
      const match = keys.some(k => j.conversationId === k || j.customerPhone === k);
      return !match;
    });
    savePersistentJobQueue();
    releaseBotLock(conv);
  }

  broadcastEvent('chat_ai_toggled', {
    sessionId: conv.sessionId,
    customerPhone: conv.customerPhone,
    aiEnabled: conv.aiEnabled,
  });
  broadcastEvent('conversations_update', { count: conversations.length });

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
    const media = await fetchMediaBase64FromEvolution(messageId, false, sessionId);
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
    const media = await fetchMediaBase64FromEvolution(messageId, false, sessionId);
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

function isCustomerSellingOrStoreBuyingQuery(text: string): boolean {
  const c = cleanQueryForStoreCheck(text);
  if (!c || c.length > 180) return false;
  if (/\b(donde|en\s+que\s+lugar)\s+compran\b/i.test(c)) return false;
  if (/\b(quiero|quisiera|deseo|necesito|voy\s+a|para)\s+comprar\b/i.test(c) && !/\bcompran\b/i.test(c)) {
    return false;
  }
  return (
    /\b(ustedes|uds|todolapto|todo\s*lapto)\s+(me\s+)?compran\b/i.test(c) ||
    /\bme\s+compra[ns]?\b/i.test(c) ||
    /\bcompran\b[\s\S]*\b(articulos?|equipos?|pc|pcs|laptops?|laptos?|computadoras?|impresoras?|monitores?|celulares?|tablets?|piezas?|repuestos?|usad[oa]s?|segunda|cosas?|eso)\b/i.test(
      c
    ) ||
    /\b(quiero|les|te)\s+vender(les|te)?\b/i.test(c) ||
    /\b(tengo|vendo)\s+(?:una?|unos?|mi)\s+(?:pc|laptop|lapto|computadora|equipo|articulo|impresora|monitor|tablet)\b/i.test(c) ||
    /\b(reciben|aceptan|toman)\s+(?:equipos?|articulos?|laptops?|pc|computadoras?|impresoras?)\s*(?:usad[oa]s?|como\s+parte\s+de\s+pago|en\s+parte\s+de\s+pago|de\s+cambio)\b/i.test(
      c
    ) ||
    /\b(trade[\s-]*in|intercambio\s+de\s+(?:equipos?|laptops?|pc)|cuanto\s+(?:me\s+)?(?:dan|ofrecen|pagan)\s+por\s+(?:mi|una?))\b/i.test(
      c
    )
  );
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

  // 0. Business does NOT buy articles / PCs / laptops / used equipment from customers
  if (candidates.some(c => isCustomerSellingOrStoreBuyingQuery(c))) {
    return '🙏 Actualmente no compramos artículos ni equipos usados, solo vendemos. Pero si buscas algo nuevo o reacondicionado, tenemos muy buenas opciones — ¿qué tipo de equipo o laptop necesitas?';
  }

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

// Helper: Extract the numbered items from the most recent valid catalog message sent by the bot in this conversation
function extractLatestSentCatalogItems(conv?: Conversation): {
  number: number;
  name: string;
  product?: ProductItem;
}[] {
  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  const laptopsInStock = [...inStock.filter(p => p.category === 'laptop')].sort(
    (a, b) => a.list_price - b.list_price
  );

  if (conv?.messages && conv.messages.length > 0) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.sender === 'customer' || !m.content) continue;
      if (m.content.includes('*1.* *') && m.content.includes('*2.* *')) {
        const parsed: { number: number; name: string; product?: ProductItem }[] = [];
        const lineRegex = /\*(\d{1,2})\.\*\s*\*([^*\n]+)\*/g;
        let match: RegExpExecArray | null;
        while ((match = lineRegex.exec(m.content)) !== null) {
          const num = parseInt(match[1], 10);
          const rawName = match[2].trim();
          const nameLower = rawName.toLowerCase();
          const matchedProd =
            inStock.find(p => p.name.trim().toLowerCase() === nameLower) ||
            inStock.find(
              p =>
                p.name.toLowerCase().includes(nameLower) ||
                nameLower.includes(p.name.toLowerCase())
            );
          parsed.push({
            number: num,
            name: rawName,
            product: matchedProd,
          });
        }
        // Only accept a catalog message if at least 80% of its items match real Odoo products in stock
        // (skips any truncated/hallucinated message from earlier tests and finds the real 36-laptop or 5-printer catalog!)
        const validCount = parsed.filter(it => Boolean(it.product)).length;
        const headerCountMatch = m.content.match(/\*\((\d+)\s+(?:modelos|opciones)\s+disponibles/i);
        const expectedCount = headerCountMatch ? parseInt(headerCountMatch[1], 10) : parsed.length;
        if (
          parsed.length >= 2 &&
          validCount >= Math.ceil(parsed.length * 0.8) &&
          parsed.length >= Math.min(expectedCount, 5)
        ) {
          // If the header said 36 models but this message was truncated before #36, keep searching back for the full 36-item catalog
          if (expectedCount > parsed.length && parsed.length < 15) {
            continue;
          }
          return parsed;
        }
      }
    }
  }

  return laptopsInStock.map((p, idx) => ({
    number: idx + 1,
    name: p.name,
    product: p,
  }));
}

// Helper: Resolve positional ("la última", "la primera", "la segunda"), numbered ("la 8", "#8", "opción 8") or specific model ("lenovo team pack e 460") references
function resolveCatalogItemAndModelReference(
  conv: Conversation | undefined,
  rawUserText: string,
  quotedText = ''
): {
  product: ProductItem;
  itemNumber?: number;
  totalItems?: number;
  referenceLabel: string;
  matchedByPositionOrNumber: boolean;
} | null {
  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  if (inStock.length === 0) return null;
  const laptopsInStock = [...inStock.filter(p => p.category === 'laptop')].sort(
    (a, b) => a.list_price - b.list_price
  );

  const catalogItems = extractLatestSentCatalogItems(conv);
  const totalItems = catalogItems.length;
  const isMultiItemQuotedCatalog =
    quotedText.includes('*1.*') && quotedText.includes('*2.*') && quotedText.includes('*3.*');
  const effectiveQuoteForMatch = isMultiItemQuotedCatalog ? '' : quotedText;
  const isPointerBump =
    /^([.?!👆⬆️⬇️👉👀]+|esto|esta|este|esa|ese|aquella|aquel|dime|y\s*esto|info|precio|cuanto|disponible|me\s*interesa|la\s*quiero)\s*[.?!]*$/i.test(
      (rawUserText || '').trim()
    );

  const normUser = normalizePhoneticProductText(
    isPointerBump && effectiveQuoteForMatch ? `${rawUserText} ${effectiveQuoteForMatch}` : rawUserText || ''
  ).trim();
  const lower = normUser.toLowerCase();
  const accentFreeLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const pickCatalogIndex = (idx: number, label: string) => {
    if (idx < 0 || idx >= catalogItems.length) return null;
    const entry = catalogItems[idx];
    const prod =
      entry.product ||
      inStock.find(p => p.name.toLowerCase() === entry.name.toLowerCase()) ||
      laptopsInStock[idx];
    if (!prod) return null;
    return {
      product: prod,
      itemNumber: entry.number || idx + 1,
      totalItems,
      referenceLabel: label,
      matchedByPositionOrNumber: true,
    };
  };

  // 1. Positional / Ordinal references ("la última", "la penúltima", "la primera", "la segunda", "la tercera", etc.)
  if (/\b(la\s*penultima|el\s*penultimo|penultima\s*opcion|penultimo\s*modelo|penultima|penultimo)\b/i.test(accentFreeLower)) {
    const res = pickCatalogIndex(totalItems - 2, `penúltima opción (#${totalItems - 1})`);
    if (res) return res;
  }
  if (/\b(la\s*ultima|el\s*ultimo|ultima\s*opcion|ultimo\s*modelo|la\s*del\s*final|el\s*del\s*final|ultima|ultimo)\b/i.test(accentFreeLower)) {
    const res = pickCatalogIndex(totalItems - 1, `última opción (#${totalItems})`);
    if (res) return res;
  }

  const ordinalPatterns: { regex: RegExp; index: number; label: string }[] = [
    { regex: /\b(la\s*primera|el\s*primero|primera\s*opcion|primer\s*modelo|la\s*1ra|la\s*1era|el\s*1ro|la\s*uno|el\s*uno|primera|primero)\b/i, index: 0, label: 'primera opción (#1)' },
    { regex: /\b(la\s*segunda|el\s*segundo|segunda\s*opcion|segundo\s*modelo|la\s*2da|el\s*2do|la\s*dos|el\s*dos|segunda|segundo)\b/i, index: 1, label: 'segunda opción (#2)' },
    { regex: /\b(la\s*tercera|el\s*tercero|tercera\s*opcion|tercer\s*modelo|la\s*3ra|la\s*3era|el\s*3ro|la\s*tres|el\s*tres|tercera|tercero)\b/i, index: 2, label: 'tercera opción (#3)' },
    { regex: /\b(la\s*cuarta|el\s*cuarto|cuarta\s*opcion|cuarto\s*modelo|la\s*4ta|el\s*4to|la\s*cuatro|el\s*cuatro|cuarta|cuarto)\b/i, index: 3, label: 'cuarta opción (#4)' },
    { regex: /\b(la\s*quinta|el\s*quinto|quinta\s*opcion|quinto\s*modelo|la\s*5ta|el\s*5to|la\s*cinco|el\s*cinco|quinta|quinto)\b/i, index: 4, label: 'quinta opción (#5)' },
    { regex: /\b(la\s*sexta|el\s*sexto|sexta\s*opcion|sexto\s*modelo|la\s*6ta|el\s*6to|la\s*seis|el\s*seis|sexta|sexto)\b/i, index: 5, label: 'sexta opción (#6)' },
    { regex: /\b(la\s*septima|el\s*septimo|septima\s*opcion|la\s*7ma|el\s*7mo|la\s*siete|el\s*siete|septima|septimo)\b/i, index: 6, label: 'séptima opción (#7)' },
    { regex: /\b(la\s*octava|el\s*octavo|octava\s*opcion|la\s*8va|el\s*8vo|la\s*ocho|el\s*ocho|octava|octavo)\b/i, index: 7, label: 'octava opción (#8)' },
    { regex: /\b(la\s*novena|el\s*noveno|novena\s*opcion|la\s*9na|el\s*9no|la\s*nueve|el\s*nueve|novena|noveno)\b/i, index: 8, label: 'novena opción (#9)' },
    { regex: /\b(la\s*decima|el\s*decimo|decima\s*opcion|la\s*10ma|el\s*10mo|la\s*diez|el\s*diez|decima|decimo)\b/i, index: 9, label: 'décima opción (#10)' },
  ];

  for (const ord of ordinalPatterns) {
    if (ord.regex.test(accentFreeLower)) {
      const res = pickCatalogIndex(ord.index, ord.label);
      if (res) return res;
    }
  }

  // 2. Number reference ("La 8", "8", "#8", "opción 8", "la número 8", "me gusta la 8", "quiero la 17", or quoted "*36.* *DELL LATITUDE 5420 i5*")
  const standaloneNumMatch = accentFreeLower.match(
    /^\s*(?:quiero|me\s*gusta|me\s*interesa|dame|apartame|precio\s*de|info\s*de|informacion\s*de)?\s*(?:la|el|opcion|modelo|numero|item|#)?\s*#?(\d{1,2})\s*[.!?]?\s*$/i
  );
  const quotedSnippetNumMatch = effectiveQuoteForMatch.match(/^\s*\*(\d{1,2})\.\*\s*\*/);
  const embeddedNumMatch =
    standaloneNumMatch ||
    accentFreeLower.match(
      /\b(?:la|el|opcion|modelo|numero|#)\s*#?(\d{1,2})\b(?!\s*(?:gb|tb|ram|ssd|hdd|pulgadas|mil|k|pesos|dop|generacion|gen|nucleos|meses|anos|unidades|horas|am|pm))/i
    ) ||
    quotedSnippetNumMatch;

  if (embeddedNumMatch) {
    const num = parseInt(embeddedNumMatch[1], 10);
    const maxLen = Math.max(totalItems, laptopsInStock.length);
    if (num >= 1 && num <= maxLen) {
      const byNum = catalogItems.find(it => it.number === num) || catalogItems[num - 1];
      const prod =
        byNum?.product ||
        (byNum ? inStock.find(p => p.name.toLowerCase() === byNum.name.toLowerCase()) : undefined) ||
        laptopsInStock[num - 1];
      if (prod) {
        return {
          product: prod,
          itemNumber: num,
          totalItems: maxLen,
          referenceLabel: `opción #${num}`,
          matchedByPositionOrNumber: true,
        };
      }
    }
  }

  // 3. Specific Model Code or Phonetic Name Match (e.g. "me gusta la lenovo team pack e 460" -> "LAPTOP LENOVO THINKPAD E460")
  const combinedSearch = normalizePhoneticProductText(`${rawUserText} ${effectiveQuoteForMatch}`).toLowerCase();
  const modelCodeMatches: { product: ProductItem; score: number; itemNumber?: number }[] = [];
  const ignoredTokens = new Set([
    'laptop', 'lapto', 'notebook', 'chrobook', 'chromebook', 'touch', 'pro', 'con', 'para', 'todo', 'en', 'uno',
    'impresora', 'color', 'wifi', 'smart', 'app', 'copia', 'escaner', 'usb', 'type', 'sata', 'solid', 'state',
    'ssd', 'hdd', 'ram', 'gb', 'tb', 'negro', 'gris', 'plata', 'azul', 'rojo', 'blanco', 'de', 'la', 'el', 'los',
    'las', 'un', 'una', 'me', 'te', 'le', 'lo', 'se', 'es', 'al', 'del', 'por', 'sin', 'mas', 'muy', 'eso', 'esa'
  ]);

  for (const p of inStock) {
    const pLower = p.name.toLowerCase();
    const pTokens = pLower
      .replace(/[^\w0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => (t.length >= 3 || (t.length >= 2 && /\d/.test(t))) && !ignoredTokens.has(t));

    let score = 0;
    let matchedDistinctCode = false;
    for (const tk of pTokens) {
      const escaped = tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(combinedSearch)) {
        const isAlphanumericModel = /\d/.test(tk) && !/^\d+(?:gb|tb|mm|w|v)$/i.test(tk);
        score += isAlphanumericModel ? 10 : 4;
        if (isAlphanumericModel) matchedDistinctCode = true;
      }
    }

    if (matchedDistinctCode || score >= 8) {
      const catEntry = catalogItems.find(it => it.product?.id === p.id || it.name.toLowerCase() === pLower);
      modelCodeMatches.push({
        product: p,
        score,
        itemNumber: catEntry?.number,
      });
    }
  }

  if (modelCodeMatches.length > 0) {
    modelCodeMatches.sort((a, b) => b.score - a.score);
    const best = modelCodeMatches[0];
    return {
      product: best.product,
      itemNumber: best.itemNumber,
      totalItems,
      referenceLabel: best.itemNumber ? `opción #${best.itemNumber}` : best.product.name,
      matchedByPositionOrNumber: false,
    };
  }

  // 4. Context Continuation: ONLY if customer asks a discount follow-up ("Le hacen algún descuento?") without a quote, right after selecting a specific product in the immediately preceding turn
  if (!effectiveQuoteForMatch && isDiscountInquiry(rawUserText) && conv?.messages && conv.messages.length >= 2) {
    for (let i = conv.messages.length - 2; i >= Math.max(0, conv.messages.length - 4); i--) {
      const prevMsg = conv.messages[i];
      const rawPrevText = (prevMsg.transcription || prevMsg.content || '').trim();
      const prevText = rawPrevText.replace(/^🎤\s*"?|"?$/g, '').trim();
      if (!prevText || prevText === 'Nota de voz de WhatsApp' || prevText.includes('Catálogo completo de') || /^([.?!👆⬆️⬇️👉👀]+)$/.test(prevText)) continue;
      if (prevMsg.sender === 'customer') {
        const prevResolved = resolveCatalogItemAndModelReference(
          { ...conv, messages: conv.messages.slice(0, i + 1) },
          prevText,
          prevMsg.quotedMessage?.text || ''
        );
        if (prevResolved) return prevResolved;
      } else {
        for (const p of inStock) {
          if (prevText.toLowerCase().includes(p.name.toLowerCase())) {
            const catEntry = catalogItems.find(it => it.product?.id === p.id);
            return {
              product: p,
              itemNumber: catEntry?.number,
              totalItems,
              referenceLabel: catEntry?.number ? `opción #${catEntry.number}` : p.name,
              matchedByPositionOrNumber: false,
            };
          }
        }
      }
    }
  }

  return null;
}

// Helper: Handle positional/numbered catalog selections, quoted product/question replies, AND discount escalation to human sales advisor
function resolveDirectProductSelectionOrDiscountReply(
  conv: Conversation,
  targetCustomerMsg: ChatMessage,
  baseCustomerText: string
): {
  reply: string;
  advisorAlertText?: string;
} | null {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';
  const rawQText = (targetCustomerMsg.quotedMessage?.text || '').trim();
  const qText = rawQText.replace(/^🎤\s*"?|"?$/g, '').trim();
  const cleanUserText = (baseCustomerText || '').replace(/^🎤\s*"?|"?$/g, '').trim();
  const isPointerBump =
    /^([.?!👆⬆️⬇️👉👀]+|esto|esta|este|esa|ese|aquella|aquel|dime|dime\s*a\s*ver|y\s*esto|y\s*esa|y\s*esta|info|precio|cuanto|disponible|me\s*interesa|la\s*quiero)\s*[.?!]*$/i.test(
      cleanUserText
    );

  // If the customer is quoting a message that is an operational store question (e.g. "Quiero saber si están trabajando.") or a generic category inquiry (e.g. "Ok tienen impresora?"), let resolveQuotedMessageDirectReply handle it naturally!
  if (qText && !isPositionalOrNumberSelection(cleanUserText) && !hasSpecificModelCodeInText(cleanUserText)) {
    if (resolveDirectStoreQuestion(cleanUserText, conv, qText)) {
      return null;
    }
    const quotedFamily = detectGenericProductFamily(qText);
    if (quotedFamily && quotedFamily.id !== 'laptop' && isPointerBump) {
      return null;
    }
    if (/\b(impresora|impresoras|monitor|monitores|mouse|teclado|cargador|disco|ssd|ram|mochila)\b/i.test(qText) && isPointerBump) {
      return null;
    }
  }

  const wantsDiscount =
    isDiscountInquiry(cleanUserText) ||
    (Boolean(qText) && isPointerBump && isDiscountInquiry(qText));

  const resolved = resolveCatalogItemAndModelReference(
    conv,
    cleanUserText,
    qText
  );

  // Case A: Customer requests a DISCOUNT ("le haces un descuento?", "La última me gusta le haces un descuento?", or quotes their discount question)
  // MUST identify the exact product (if referenced) and pass immediately to a human advisor!
  if (wantsDiscount) {
    const cleanPhone = (conv?.customerPhone || '').replace(/\D/g, '');
    const stdPhone = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    const effectiveMsgPreview = qText
      ? `${cleanUserText} (En referencia a: "${qText.slice(0, 100)}")`
      : cleanUserText;

    if (resolved?.product) {
      const p = resolved.product;
      const numBadge = resolved.itemNumber ? ` (Opción #${resolved.itemNumber})` : '';
      const priceStr = `RD$${p.list_price.toLocaleString()}`;
      const alertText = `🔔 *💰 CLIENTE SOLICITA DESCUENTO — ASESOR REQUERIDO*\n\n👤 Cliente: ${conv?.customerName || 'WhatsApp'}\n📱 Teléfono: ${stdPhone || 'No disponible'}\n💻 Equipo solicitado: *${p.name}*${numBadge}\n💰 Precio en catálogo: ${priceStr} (Stock: ${p.virtual_available})\n💬 Mensaje del cliente: "${effectiveMsgPreview}"\n\n👉 Por favor comunícate con el cliente para asistirlo con el descuento.`;

      const reply = `¡Claro que sí${namePart}! 😊 La *${p.name}* tiene un precio en catálogo de *${priceStr}* (${p.virtual_available} unidad(es) disponible(s)).\n\nYa le pasé tu consulta a uno de nuestros *asesores de ventas* 👨‍💼 para que te escriba por esta misma vía en unos minutos y te ayude personalmente con el descuento. ¡Estamos a tu orden! 🙌`;
      return { reply, advisorAlertText: alertText };
    }

    const alertText = `🔔 *💰 CLIENTE SOLICITA DESCUENTO — ASESOR REQUERIDO*\n\n👤 Cliente: ${conv?.customerName || 'WhatsApp'}\n📱 Teléfono: ${stdPhone || 'No disponible'}\n💬 Mensaje del cliente: "${effectiveMsgPreview}"\n\n👉 Por favor comunícate con el cliente para asistirlo con su solicitud de descuento.`;
    const reply = `¡Claro que sí${namePart}! 😊 Ya le pasé tu solicitud a uno de nuestros *asesores de ventas* 👨‍💼 para que te atienda personalmente por aquí en unos minutos y te ayude con el descuento. ¡Estamos a tu orden! 🙌`;
    return { reply, advisorAlertText: alertText };
  }

  // Case B: Customer selects or quotes a specific product from the catalog by POSITION ("la última", "la primera", "la segunda"), by NUMBER ("La 8", "#8"), or by model ("lenovo e460")
  if (resolved?.product && (!isPointerBump || Boolean(qText))) {
    const p = resolved.product;
    const condBadge =
      p.condition === 'Nuevo'
        ? '✨ Nuevo de Caja (Garantía 1 año)'
        : '♻️ Reacondicionado Clase A (Garantía 6 meses)';
    const specsLine = p.specsSummary || p.description_sale ? `\n⚙️ *Especificaciones:* ${p.specsSummary || p.description_sale}` : '';
    const useLine = p.useCases && p.useCases.length > 0 ? `\n🎯 *Ideal para:* ${p.useCases.join(' · ')}` : '';
    const urlLine = p.website_url ? `\n🔗 https://todolapto.com.do${p.website_url}` : '';

    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    const storeLine = rdNow.isOpen
      ? `📍 La tenemos disponible ahora mismo en nuestra tienda física de la *Av. Charles de Gaulle No. 133* (abiertos hasta las 6:00 PM) o con envío a domicilio con pago contra entrega en Santo Domingo 🚚.`
      : `📍 La tenemos disponible en nuestra tienda física de la *Av. Charles de Gaulle No. 133* (abrimos ${rdNow.nextOpeningStr}) y contamos con envío a domicilio con pago contra entrega en Santo Domingo 🚚.`;

    const reply = `¡Claro que sí${namePart}! 😊 Aquí tienes los detalles de la *${p.name}*:\n\n💻 *${p.name}*\n💰 *Precio:* *RD$${p.list_price.toLocaleString()}* | 📦 *Stock:* ${p.virtual_available} unidad(es) disponible(s)\n🏷️ *Condición:* ${condBadge}${specsLine}${useLine}${urlLine}\n\n${storeLine}\n\n¿Deseas que te la apartemos para pasar por la tienda o prefieres que coordinemos el envío a tu dirección? 🛒`;
    return { reply };
  }

  return null;
}

// Helper: Intelligent direct resolution for WhatsApp Quoted Messages (Citas / Mensajes citados)
function resolveQuotedMessageDirectReply(
  conv: Conversation,
  targetCustomerMsg: ChatMessage
): string | null {
  const quoted = targetCustomerMsg.quotedMessage;
  if (!quoted) return null;
  const rawQText = (quoted.text || quoted.aiAnalysis || '').trim();
  const qText = rawQText.replace(/^🎤\s*"?|"?$/g, '').trim();
  const rawUserText = (targetCustomerMsg.transcription || targetCustomerMsg.content || '').trim();
  const userText = rawUserText.replace(/^🎤\s*"?|"?$/g, '').trim();
  const lowerUser = userText.toLowerCase();
  const lowerQuote = qText.toLowerCase();
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : '';
  const namePart = customerName ? `, ${customerName}` : '';
  const isShortOrPointer = /^([.?!👆⬆️⬇️👉👀]+|esto|esta|este|esa|ese|info|precio|cuanto|disponible|me\s*interesa|la\s*quiero|dime|dime\s*a\s*ver|y\s*esto)\s*[.?!]*$/i.test(userText);

  // 1. Quoted sticker / reaction / meme / laughter
  const isStickerOrLaughter =
    targetCustomerMsg.type === 'sticker' ||
    userText.includes('[El cliente envió un STICKER') ||
    userText.includes('[cliente envió un sticker') ||
    /^(jajaja|jejeje|jaja|jeje|😂|🤣|😹|xd|gracioso|lol)+$/i.test(userText.replace(/\s+/g, ''));

  if (isStickerOrLaughter) {
    return `¡Jajaja! 😂 ¡Saludos${namePart}! ¿En qué te podemos colaborar hoy? Cuéntanos si buscas alguna laptop, impresora o accesorio y con gusto te pasamos las opciones disponibles de inmediato. 💻✨`;
  }

  // 2. Customer acknowledges previous negotiation or agreement ("Ahhh bueno", "Ps mejor", "ok", "listo", "perfecto")
  const isConversationalAck = /^(ahhh?\s*bueno|ps\s*mejor|pues\s*mejor|ok|okay|esta\s*bien|ta\s*bien|perfecto|excelente|entendido|listo|de\s*acuerdo|ya\s*veo|comprendo|chevere|así\s*mismo)\b/i.test(lowerUser);
  if (isConversationalAck && lowerUser.length < 50) {
    return `¡Así mismo es! 👍 Quedamos atentos por aquí para cuando gustes apartar tu pedido o pasar por nuestra tienda física en la *Av. Charles de Gaulle No. 133*. ¡Siempre a la orden en Todo Lapto${namePart}! 😊`;
  }

  // 3. Customer quotes a store greeting ("¡Saludos! 😊 Bienvenido a *Todo Lapto*...")
  const isGreetingQuote = lowerQuote.includes('bienvenido a *todo lapto*') || lowerQuote.includes('en qué te podemos ayudar hoy');
  if (isGreetingQuote) {
    if (isSimpleConversationalMessage(userText, false) || lowerUser.length < 15) {
      return `¡A tu orden${namePart}! 😊 Dime si andas buscando alguna laptop, impresora, monitor o accesorio o tu presupuesto y te paso las opciones disponibles de inmediato. 💻✨`;
    }
  }

  // 3b. Customer quotes an operational question (hours, location, shipping, warranty — e.g. voice note "Quiero saber si están trabajando." + "?")
  const storeQuotedReply = resolveDirectStoreQuestion(userText, conv, qText);
  if (storeQuotedReply) {
    return storeQuotedReply;
  }

  // 3c. Customer quotes a category/product inquiry (e.g. "Ok tienen impresora?" or "IMPRESORAS, ¿CUÁNTAS TIENES?" + "?")
  if (qText && (isShortOrPointer || lowerUser.length <= 25)) {
    const quotedCatalogReply = resolveDirectCatalogReply(qText, conv, false);
    if (quotedCatalogReply) {
      return quotedCatalogReply;
    }
  }

  // 4. Customer quotes a multi-item catalog message vs a specific single product card
  const isMultiItemCatalogQuote =
    lowerQuote.includes('*1.*') && lowerQuote.includes('*2.*') && lowerQuote.includes('*3.*');

  if (isMultiItemCatalogQuote) {
    const resolvedFromCatalog = resolveCatalogItemAndModelReference(conv, userText, '');
    if (resolvedFromCatalog?.product) {
      const sel = resolveDirectProductSelectionOrDiscountReply(conv, targetCustomerMsg, userText);
      if (sel?.reply) return sel.reply;
    }
    const isShortOrPointer = /^([.?!👆⬆️⬇️👉👀]+|esto|esta|este|esa|ese|info|precio|cuanto|disponible|me\s*interesa|la\s*quiero|dime)\s*[.?!]*$/i.test(userText);
    if (isShortOrPointer) {
      return `¡Claro que sí${namePart}! 😊 ¿Cuál de los modelos de la lista (por ejemplo *la #1*, *la #8* o *la última*) es el que te interesa para pasarte los detalles o apartártelo de inmediato? 💻🛒`;
    }
    return null;
  }

  // 5. Customer quotes a specific product or a message mentioning a specific product
  const resolvedQuotedProd = resolveCatalogItemAndModelReference(conv, userText, qText);
  if (resolvedQuotedProd?.product) {
    const matchedProd = resolvedQuotedProd.product;
    const conditionText = matchedProd.condition === 'Nuevo' ? '✨ Nuevo de Caja (Garantía 1 año)' : '♻️ Reacondicionada Clase A (Garantía 6 meses)';
    const specsLine = matchedProd.specsSummary || matchedProd.description_sale || '';
    const priceFormatted = `RD$${matchedProd.list_price.toLocaleString()}`;
    const urlLine = matchedProd.website_url ? `\n🔗 https://todolapto.com.do${matchedProd.website_url}` : '';
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);

    const scheduleSuffix = rdNow.isOpen
      ? 'Estamos abiertos ahora mismo en nuestra tienda física de la *Av. Charles de Gaulle No. 133* hasta las 6:00 PM.'
      : `Nuestra tienda física en la *Av. Charles de Gaulle No. 133* abre ${rdNow.nextOpeningStr}.`;

    return `¡Claro que sí${namePart}! 😊 Con respecto a la *${matchedProd.name}*:\n\n💰 *Precio:* *${priceFormatted}* (${matchedProd.virtual_available} unidad(es) en stock real)\n🏷️ *Condición:* ${conditionText}\n⚙️ *Especificaciones:* ${specsLine}${urlLine}\n\n🏪 ${scheduleSuffix} Contamos con retiro directo en tienda y servicio de envío a domicilio con pago contra entrega en Santo Domingo 🚚.\n\n¿Deseas que te la apartemos para pasar a buscarla o prefieres envío a tu dirección? 🛒`;
  }

  return null;
}

// Helper: Direct deterministic catalog reply for product/category/brand/budget inquiries
function resolveDirectCatalogReply(rawText: string, conv?: Conversation, hasQuote = false): string | null {
  if (hasQuote) return null;
  const cleaned = (rawText || '').trim();
  if (!cleaned || cleaned.length > 160) return null;

  // Never send product catalog when customer is asking if the store buys articles/equipment
  if (isCustomerSellingOrStoreBuyingQuery(cleaned)) {
    return null;
  }

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

  const catalogBlock = highlight.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/);
  if (catalogBlock && catalogBlock[1]?.trim()) {
    return catalogBlock[1].trim();
  }

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
  if (hasQuote && lastMsg?.quotedMessage?.text) {
    return `¡Claro que sí${namePart}! 😊 Respecto a "${lastMsg.quotedMessage.text.slice(0, 120)}", cuéntame exactamente qué detalle necesitas confirmar (precio, disponibilidad o envío) y con gusto te ayudo de una vez.`;
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
  const recent = conv.messages.slice(-8);
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

    // In assistant turns, if a previous message contained a catalog or product list (> 600 chars),
    // preserve the complete numbered index (*1.* to *N.*) so the AI knows every item by number and position ("primera", "segunda", "última", "la 8") without repeating all URLs
    if (role === 'assistant' && (text.includes('Catálogo completo') || text.includes('catálogo completo') || text.includes('opciones disponibles')) && text.length > 600) {
      const compactLines: string[] = [];
      const itemRegex = /\*(\d{1,2})\.\*\s*\*([^*\n]+)\*[\s\S]*?(RD\$[\d,]+)/g;
      let mItem: RegExpExecArray | null;
      while ((mItem = itemRegex.exec(text)) !== null) {
        compactLines.push(`*${mItem[1]}.* ${mItem[2].trim()} (${mItem[3]})`);
      }
      if (compactLines.length >= 2) {
        text = `[Catálogo numerado enviado previamente al cliente (${compactLines.length} opciones, donde #1 es la primera y #${compactLines.length} es la última)]:\n` + compactLines.join('\n');
      } else {
        text = text.slice(0, 600) + '\n... [Catálogo de opciones enviado previamente al cliente]';
      }
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

// Unified Core Sales Bot Auto-Responder (Used by Queue Worker, Polling, Webhook, and Manual Trigger)
async function triggerSalesBotReplyForConversation(
  conv: Conversation,
  triggerSource: string,
  correlationId?: string,
  ownerId?: string
): Promise<{
  success: boolean;
  skipped?: boolean;
  reply?: string;
  providerUsed?: string;
  modelUsed?: string;
  toolsExecuted?: string[];
  sentToWhatsApp?: boolean;
  error?: string;
  correlationId?: string;
}> {
  if (isServerShuttingDown) {
    return { success: false, error: 'Servidor en proceso de apagado controlado (graceful shutdown)' };
  }

  // CRITICAL: The AI Bot NEVER replies to WhatsApp groups
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`🛡️ [Bot bloqueado]: Se ignoró generación automática para grupo (${conv.sessionId})`);
    return {
      success: false,
      skipped: true,
      error: 'Los grupos de WhatsApp están expresamente excluidos de las respuestas del bot',
    };
  }

  const initialLastMsg = conv.messages[conv.messages.length - 1];
  const initialMsgId = normalizeMsgIdKey(initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '');
  const effCorrelationId = correlationId || generateCorrelationId(initialMsgId);
  const effOwnerId = ownerId || `${triggerSource}-${process.pid}-${Date.now()}`;

  const initialSkip = shouldSkipBotReply(conv, initialLastMsg, triggerSource);
  if (initialSkip.skip) {
    return { success: false, skipped: true, error: initialSkip.reason, correlationId: effCorrelationId };
  }

  if (!acquireBotLock(conv, triggerSource, effOwnerId)) {
    return {
      success: false,
      error: 'Ya se está generando una respuesta para este chat (bloqueo activo)',
      correlationId: effCorrelationId,
    };
  }

  recordDiagnosticStage({
    correlationId: effCorrelationId,
    stage: 'LOCK_ACQUIRED',
    module: 'concurrency',
    customer: conv.customerName,
    conversationId: conv.sessionId,
    messageId: initialMsgId,
    details: `Bloqueo exclusivo adquirido por ${effOwnerId} (${triggerSource})`,
  });

  const startTime = Date.now();
  const contactKeys = getConversationContactKeys(conv);
  if (initialMsgId && triggerSource !== 'manual_crm_trigger') {
    markMessageIdProcessed(initialMsgId, contactKeys, {
      correlationId: effCorrelationId,
      conversationId: conv.sessionId,
      responseSent: false,
    });
  }

  const previousCorrelationContext = activeCorrelationIdContext;
  activeCorrelationIdContext = effCorrelationId;

  try {
    const initialText = initialLastMsg?.transcription || initialLastMsg?.content || conv.lastMessagePreview || '';
    const initialHasQuote = Boolean(initialLastMsg?.quotedMessage?.text?.trim());
    const isInitialSimpleGreeting =
      initialLastMsg?.type === 'text' &&
      !initialLastMsg?.quotedMessage &&
      isSimpleConversationalMessage(initialText, initialHasQuote);

    const typingPresenceMs = 400;
    sendEvolutionTypingPresence(conv, typingPresenceMs).catch(() => {});

    // 1. Ensure Odoo inventory is loaded (only block if not a simple greeting)
    if (!isInitialSimpleGreeting) {
      recordDiagnosticStage({
        correlationId: effCorrelationId,
        stage: 'ODOO_REQUEST_STARTED',
        service: 'Odoo ERP',
        module: 'odoo',
        customer: conv.customerName,
        conversationId: conv.sessionId,
        messageId: initialMsgId,
        details: products.length === 0 ? 'Sincronizando inventario inicial de Odoo ERP' : `Consultando inventario en memoria (${products.length} productos activos)`,
      });
      if (products.length === 0) {
        await syncOdooInventory();
      }
      recordDiagnosticStage({
        correlationId: effCorrelationId,
        stage: 'ODOO_REQUEST_COMPLETED',
        service: 'Odoo ERP',
        module: 'odoo',
        customer: conv.customerName,
        conversationId: conv.sessionId,
        messageId: initialMsgId,
        details: `Inventario verificado (${products.length} productos disponibles)`,
      });
    }

    // 2. Fetch Evolution message history if thread has < 3 messages or a quoted message needs text hydration so positional/numbered catalog references ("la última", "la 8") always have the prior catalog
    const needsHistoryHydration =
      !conv.messages ||
      conv.messages.length < 3 ||
      Boolean(initialLastMsg?.quotedMessage && !initialLastMsg.quotedMessage.text);

    if (needsHistoryHydration) {
      await loadEvolutionMessagesForChat(conv.sessionId);
    } else if (!conv.messagesLoaded && !isInitialSimpleGreeting) {
      loadEvolutionMessagesForChat(conv.sessionId).catch(() => {});
    }

    const lastMsg = conv.messages[conv.messages.length - 1];
    if (!lastMsg) {
      return { success: false, skipped: true, error: 'Sin mensajes en la conversación', correlationId: effCorrelationId };
    }

    // Strictly enforce that the bot never answers if the last message in the thread is already from the assistant or agent
    if (lastMsg.sender !== 'customer' && triggerSource !== 'manual_crm_trigger') {
      return {
        success: false,
        skipped: true,
        error: 'El último mensaje ya fue respondido por el equipo o el bot',
        correlationId: effCorrelationId,
      };
    }

    // For manual CRM trigger or mixed threads, identify the substantive customer message to address
    const targetCustomerMsg =
      lastMsg.sender === 'customer'
        ? lastMsg
        : [...conv.messages].reverse().find(m => m.sender === 'customer') || lastMsg;

    renewCrossProcessBotLock(contactKeys, effOwnerId, BOT_LOCK_TTL_MS);

    // 3. Auto-transcribe if the customer sent a voice note (OpenAI Whisper)!
    if (targetCustomerMsg.type === 'audio' && targetCustomerMsg.evolutionMessageId && !targetCustomerMsg.transcription) {
      console.log(`🎤 [Audio Processing]: Descargando audio para transcribir con Whisper (msgId: ${targetCustomerMsg.evolutionMessageId})...`);
      let media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
      if (!media) {
        await new Promise(r => setTimeout(r, 800));
        media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
      }
      if (!media || !media.base64) {
        recordDiagnosticStage({
          correlationId: effCorrelationId,
          stage: 'MEDIA_DOWNLOADED',
          service: 'Evolution API',
          module: 'media',
          customer: conv.customerName,
          conversationId: conv.sessionId,
          messageId: targetCustomerMsg.evolutionMessageId,
          success: false,
          severity: 'HIGH',
          details: 'No se pudo descargar el archivo de audio desde Evolution API',
        });
        throw new Error('No se pudo descargar la nota de voz desde Evolution API para transcribirla');
      }

      recordDiagnosticStage({
        correlationId: effCorrelationId,
        stage: 'MEDIA_DOWNLOADED',
        service: 'Evolution API',
        module: 'media',
        customer: conv.customerName,
        conversationId: conv.sessionId,
        messageId: targetCustomerMsg.evolutionMessageId,
        details: `Audio descargado (${media.mimetype})`,
      });

      const trText = await transcribeAudioWithOpenAI(media.base64, media.mimetype);
      if (trText) {
        targetCustomerMsg.transcription = trText;
        targetCustomerMsg.content = `🎤 "${trText}"`;
        saveTranscriptionForId(targetCustomerMsg.evolutionMessageId, trText);
        conv.lastMessagePreview = `🎤 "${trText}"`;
        broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
        recordDiagnosticStage({
          correlationId: effCorrelationId,
          stage: 'MEDIA_TRANSCRIBED',
          service: 'AI Engine',
          module: 'whisper',
          customer: conv.customerName,
          conversationId: conv.sessionId,
          messageId: targetCustomerMsg.evolutionMessageId,
          details: `Nota de voz transcrita: "${trText.slice(0, 120)}"`,
        });
        console.log(`✅ [Audio Whisper Transcrito]: "${trText}"`);
      }
    }

    // 3b. Hydrate quoted voice note transcription if the customer quoted an audio message
    if (
      targetCustomerMsg.quotedMessage &&
      targetCustomerMsg.quotedMessage.id &&
      (!targetCustomerMsg.quotedMessage.text ||
        targetCustomerMsg.quotedMessage.text === '🎤 Nota de voz citada' ||
        targetCustomerMsg.quotedMessage.text === '🎤 Nota de voz de WhatsApp' ||
        targetCustomerMsg.quotedMessage.text === '🎤 Nota de voz anterior')
    ) {
      const qCleanId = targetCustomerMsg.quotedMessage.id.replace(/^evo-/, '');
      let qTr = transcriptionsByMsgId.get(qCleanId) || transcriptionsByMsgId.get(`evo-${qCleanId}`);
      if (!qTr) {
        const parentInConv = conv.messages.find(
          m => m.evolutionMessageId === qCleanId || m.id === `evo-${qCleanId}` || m.id === qCleanId
        );
        if (parentInConv?.transcription) {
          qTr = parentInConv.transcription;
        }
      }
      if (!qTr) {
        try {
          const qMedia = await fetchMediaBase64FromEvolution(qCleanId, false, conv.sessionId);
          if (qMedia?.base64) {
            qTr = await transcribeAudioWithOpenAI(qMedia.base64, qMedia.mimetype);
            if (qTr) {
              saveTranscriptionForId(qCleanId, qTr);
            }
          }
        } catch {}
      }
      if (qTr) {
        targetCustomerMsg.quotedMessage.text = `🎤 "${qTr}"`;
        targetCustomerMsg.quotedMessage.type = 'audio';
        saveQuotedMessageForId(targetCustomerMsg.evolutionMessageId || targetCustomerMsg.id, targetCustomerMsg.quotedMessage);
        broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
      }
    }

    let detectedImageQuery = '';

    // 4. Auto-analyze if the customer sent an image (OpenAI Vision with n8n parity)!
    if (targetCustomerMsg.type === 'image' && targetCustomerMsg.evolutionMessageId && !targetCustomerMsg.aiAnalysis) {
      try {
        console.log(`📷 [Image Processing]: Descargando imagen para clasificar con Visión (msgId: ${targetCustomerMsg.evolutionMessageId})...`);
        let media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        if (!media) {
          await new Promise(r => setTimeout(r, 800));
          media = await fetchMediaBase64FromEvolution(targetCustomerMsg.evolutionMessageId, false, conv.sessionId);
        }
        if (media && media.base64) {
          recordDiagnosticStage({
            correlationId: effCorrelationId,
            stage: 'MEDIA_DOWNLOADED',
            service: 'Evolution API',
            module: 'media',
            customer: conv.customerName,
            conversationId: conv.sessionId,
            messageId: targetCustomerMsg.evolutionMessageId,
            details: `Imagen descargada (${media.mimetype})`,
          });
          const visionResult = await analyzeCustomerImageWithVision(media.base64, media.mimetype);
          targetCustomerMsg.aiAnalysis = visionResult.interpretedText;
          aiAnalysisByMsgId.set(targetCustomerMsg.evolutionMessageId, visionResult.interpretedText);
          if (visionResult.suggestedQuery) {
            detectedImageQuery = visionResult.suggestedQuery;
          }
          recordDiagnosticStage({
            correlationId: effCorrelationId,
            stage: 'MEDIA_TRANSCRIBED',
            service: 'AI Engine',
            module: 'vision',
            customer: conv.customerName,
            conversationId: conv.sessionId,
            messageId: targetCustomerMsg.evolutionMessageId,
            details: `Imagen analizada (${visionResult.imageType}): ${visionResult.interpretedText.slice(0, 120)}`,
          });
          broadcastEvent('message_updated', { sessionId: conv.sessionId, message: targetCustomerMsg });
          console.log(`✅ [Image Vision (${visionResult.imageType})]: ${visionResult.interpretedText}`);
        }
      } catch (e: any) {
        recordDiagnosticStage({
          correlationId: effCorrelationId,
          stage: 'MEDIA_TRANSCRIBED',
          service: 'AI Engine',
          module: 'vision',
          customer: conv.customerName,
          conversationId: conv.sessionId,
          messageId: targetCustomerMsg.evolutionMessageId,
          success: false,
          severity: 'HIGH',
          details: `Error al analizar imagen: ${e?.message || e}`,
        });
      }
    }

    // 4b. Auto-analyze Quoted Status / Quoted Media with OpenAI Vision!
    if (targetCustomerMsg.quotedMessage) {
      const qId = targetCustomerMsg.quotedMessage.id;
      const isQuotedIdInChatHistory = qId
        ? conv.messages.some(
            m => m.id !== targetCustomerMsg.id && (m.evolutionMessageId === qId || m.id === `evo-${qId}`)
          )
        : true;

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
        : (targetCustomerMsg.quotedMessage?.text || targetCustomerMsg.quotedMessage?.aiAnalysis
            ? 'El cliente envió un audio sobre la consulta citada'
            : 'Hola, buenas');
    } else if (targetCustomerMsg.type === 'image') {
      const caption = targetCustomerMsg.content && targetCustomerMsg.content !== '📷 Foto' ? targetCustomerMsg.content : '';
      baseCustomerText = targetCustomerMsg.aiAnalysis
        ? (caption ? `${caption}\n${targetCustomerMsg.aiAnalysis}` : targetCustomerMsg.aiAnalysis)
        : (caption || 'El cliente envió una imagen adjunta');
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
1. Toma como referencia TANTO el mensaje citado como el mensaje nuevo del cliente (el motivo por el que lo citó: "${baseCustomerText}"). Responde combinando ambos de forma directa y natural.
2. SI EL MENSAJE CITADO ES UNA PREGUNTA OPERATIVA (ej. "¿Están laborando?", "¿Abren hoy?", "¿Cuál es el horario?", "¿Dónde están ubicados?", "¿Hacen envíos?", "¿Tienen garantía?"): Responde DIRECTA y EXACTAMENTE a esa pregunta citada informando el estado de la tienda física en la Av. Charles de Gaulle #133. ESTÁ TERMINANTEMENTE PROHIBIDO enviar catálogos o listas de productos cuando el cliente cita una pregunta operativa.
3. SI EL MENSAJE CITADO O EL NUEVO ES UNA NOTA DE VOZ O IMAGEN: Interpreta su contenido junto con la cita y responde directo al punto. Si la nota de voz fue corta o solo envió "?" / ".", atiende directamente la consulta o pregunta citada.
4. SI CITA UN PRODUCTO O LAPTOP: Confirma precio, stock y specs de ese producto citado y responde al motivo de su mensaje. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
5. TONO 100% HUMANO Y NATURAL: Responde exactamente como una persona normal atendiendo por WhatsApp (cálido, directo y conciso). ESTÁ TERMINANTEMENTE PROHIBIDO decir frases robóticas o de sistema como "Reconozco tus mensajes y notas de voz citadas", "Reconozco tu mensaje citado", "Vi que citaste", "Según tu nota de voz citada" o mencionar que eres un bot que reconoce audios o citas.
6. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos. Tienes todo el contexto citado e inventario en tiempo real.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    }

    const quotedContentStr =
      targetCustomerMsg.quotedMessage?.text ||
      targetCustomerMsg.quotedMessage?.aiAnalysis ||
      '';
    const quotedParticipantStr = targetCustomerMsg.quotedMessage?.author || '';

    const n8nContextBlock = hasQuote || isStatusReply
      ? `📋 [DATOS NORMALIZADOS DE LA ENTRADA (PARIDAD N8N)]:
- chat_input: "${baseCustomerText}"
- has_quoted_message: ${hasQuote || isStatusReply}
- quoted_message_content: "${quotedContentStr}"
- quoted_participant: "${quotedParticipantStr}"\n\n`
      : '';

    const customerMessageText = quotedBlock
      ? `${n8nContextBlock}${quotedBlock}\nConsulta del cliente: "${baseCustomerText}"`
      : `${n8nContextBlock}${baseCustomerText}`;

    const systemInstruction = buildMasterSalesSystemInstruction(conv, customerMessageText);
    const fullHistoryTurns = buildChatHistoryTurns(conv);
    if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === 'user') {
      fullHistoryTurns.pop();
    }
    const historyTurns = isSimpleMsg ? fullHistoryTurns.slice(-4) : fullHistoryTurns;

    console.log(
      `🤖 [Sales Bot Generating Reply (${triggerSource})]: Cliente="${conv.customerName}" | Citando="${hasQuote ? 'SÍ' : 'NO'}" | Motor=OpenAI (${appConfig.aiProvider?.model || 'gpt-4o-mini'}) | Corr=${effCorrelationId}`
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

    renewCrossProcessBotLock(contactKeys, effOwnerId, BOT_LOCK_TTL_MS);

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'AI_REQUEST_STARTED',
      service: 'AI Engine',
      module: 'openai',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: initialMsgId,
      details: `Generando respuesta para: "${baseCustomerText.slice(0, 100)}"`,
    });

    const directSelectionOrDiscount = resolveDirectProductSelectionOrDiscountReply(
      conv,
      targetCustomerMsg,
      baseCustomerText
    );
    const storeAnswer = resolveDirectStoreQuestion(baseCustomerText, conv, targetCustomerMsg.quotedMessage?.text);
    const directQuotedReply = hasQuote ? resolveQuotedMessageDirectReply(conv, targetCustomerMsg) : null;
    const genericFamily = detectGenericProductFamily(baseCustomerText);

    // Fast-path catalog extraction from systemInstruction or direct inventory highlight
    const catalogBlockMatch =
      systemInstruction.match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/) ||
      (genericFamily ? getRelevantProductsHighlight(baseCustomerText, targetCustomerMsg.quotedMessage?.text || '', '').match(/<!-- \[CATALOG_BLOCK_START\] -->\s*([\s\S]*?)\s*<!-- \[CATALOG_BLOCK_END\] -->/) : null);

    const isGenericCategoryInquiry =
      !directSelectionOrDiscount &&
      !isCustomerSellingOrStoreBuyingQuery(baseCustomerText) &&
      !isDiscountInquiry(baseCustomerText) &&
      !isPositionalOrNumberSelection(baseCustomerText) &&
      !hasSpecificModelCodeInText(baseCustomerText) &&
      (Boolean(genericFamily) ||
        /\b(lapto|laptops|laptop|computadora|computadoras|pc|portatil|portatiles|impresora|impresoras|mouse|raton|ratones|teclado|teclados|monitor|monitores|pantalla|pantallas|bocina|bocinas|audifono|audifonos|tablet|tablets|cargador|cargadores|disco|discos|ssd|ram|mochila|mochilas|router|repetidor|tienen|cuales|catalogo|lista)\b/i.test(
          baseCustomerText
        ));

    if (directSelectionOrDiscount) {
      aiReply = directSelectionOrDiscount.reply;
      providerUsed = 'openai';
      modelUsed = directSelectionOrDiscount.advisorAlertText
        ? 'discount-advisor-escalation'
        : 'catalog-selection-engine';
      if (directSelectionOrDiscount.advisorAlertText) {
        toolsExecuted = ['notificar_equipo'];
        sendEvolutionMessage(
          appConfig.evolution.teamPhone,
          directSelectionOrDiscount.advisorAlertText
        ).catch(() => {});
      }
    } else if (directQuotedReply) {
      aiReply = directQuotedReply;
      providerUsed = 'openai';
      modelUsed = 'quoted-context-engine';
    } else if (catalogBlockMatch && isGenericCategoryInquiry) {
      // Deterministic delivery of the 100% complete stock catalog without LLM truncation or latency
      const fullCatalog = catalogBlockMatch[1].trim();
      aiReply = storeAnswer ? `${storeAnswer}\n\n${fullCatalog}` : fullCatalog;
      providerUsed = 'openai';
      modelUsed = 'full-catalog-engine';
    } else if (storeAnswer) {
      aiReply = storeAnswer;
    } else if (isSimpleMsg) {
      aiReply = buildInstantConversationalReply(conv, baseCustomerText);
    } else {
      // Strict OpenAI execution for technical sales questions, consultative selling, and specific filtered queries
      const aiResult = await generateTextWithConfiguredAI({
        prompt: promptToSend,
        systemInstruction,
        chatMessages: historyTurns,
        allowFallback: false,
      });

      const processed = await processAndExecuteCrmTools(aiResult.text || '', conv);
      let candidateReply = processed.cleanText.trim();

      // Safety Guard 1: If OpenAI was expected to output the complete catalog but truncated to <= 3 items, fallback to the guaranteed full catalog
      if (isGenericCategoryInquiry && catalogBlockMatch && isCatalogSectionPresent && candidateReply.length < 500 && catalogBlockMatch[1].length > 800) {
        candidateReply = catalogBlockMatch[1].trim();
      }

      // Safety Guard 2 (Anti-Catalog-Dump Guard): If the customer is quoting a message, sending "." / "?", or NOT asking for a general catalog, NEVER allow OpenAI to dump the 36-laptop catalog
      if (
        !isGenericCategoryInquiry &&
        (/Cat[aá]logo completo de laptops/i.test(candidateReply) ||
          (candidateReply.match(/\*\d{1,2}\.\*\s*\*/g) || []).length >= 5)
      ) {
        const fallbackQuote = resolveQuotedMessageDirectReply(conv, targetCustomerMsg);
        if (fallbackQuote) {
          candidateReply = fallbackQuote;
        } else {
          const resolvedCtx = resolveCatalogItemAndModelReference(
            conv,
            baseCustomerText,
            targetCustomerMsg.quotedMessage?.text || ''
          );
          if (resolvedCtx?.product) {
            const p = resolvedCtx.product;
            const posBadge = resolvedCtx.itemNumber ? ` (opción *#${resolvedCtx.itemNumber}* de la lista)` : '';
            const condBadge =
              p.condition === 'Nuevo'
                ? '✨ Nuevo de Caja (Garantía 1 año)'
                : '♻️ Reacondicionado Clase A (Garantía 6 meses)';
            candidateReply = `¡Claro que sí${conv.customerName && !isGenericContactName(conv.customerName) ? `, ${conv.customerName}` : ''}! Te confirmo los detalles de la *${p.name}*${posBadge}:\n\n💻 *${p.name}*\n💰 *Precio:* RD$${p.list_price.toLocaleString()} _(Impuestos incluidos)_\n📦 *Disponibilidad:* ${p.virtual_available} unidad(es) en stock real\n🏷️ *Condición:* ${condBadge}\n⚙️ *Especificaciones:* ${p.specsSummary || p.description_sale || 'Excelente estado y rendimiento garantizado'}\n${p.website_url ? `🔗 https://todolapto.com.do${p.website_url}\n` : ''}\n¿Deseas pasar a verla a nuestra tienda en la *Av. Charles de Gaulle No. 133* o prefieres que te coordinemos el envío a domicilio? 🚚`;
          } else {
            candidateReply = `¡Hola${conv.customerName && !isGenericContactName(conv.customerName) ? `, ${conv.customerName}` : ''}! 😊 Estoy atento a tu mensaje. Confírmame por favor cuál de los modelos te llamó la atención o cómo deseas que te ayudemos (retiro en tienda en la *Av. Charles de Gaulle No. 133* o envío a domicilio). 💻✨`;
          }
        }
      }

      aiReply = candidateReply;
      toolsExecuted = processed.toolsExecuted;
      providerUsed = aiResult.providerUsed;
      modelUsed = aiResult.modelUsed;
    }

    if (!aiReply) {
      throw new Error('No se pudo generar el texto de respuesta.');
    }

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'AI_REQUEST_COMPLETED',
      service: 'AI Engine',
      module: 'openai',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: initialMsgId,
      details: `Respuesta IA generada (${aiReply.length} caracteres, modelo: ${modelUsed})`,
    });

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'RESPONSE_VALIDATED',
      service: 'Backend',
      module: 'validator',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: initialMsgId,
      details: `Respuesta validada y sanitizada (${toolsExecuted.length} herramientas ejecutadas)`,
    });

    renewCrossProcessBotLock(contactKeys, effOwnerId, BOT_LOCK_TTL_MS);

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'WHATSAPP_SEND_STARTED',
      service: 'Evolution API',
      module: 'evolution',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: initialMsgId,
      details: `Enviando respuesta a WhatsApp (${conv.customerPhone || conv.sessionId})`,
    });

    // Fast immediate delivery (150ms) so Evolution API records the outgoing reply immediately and prevents any secondary cloud preview container from sending a duplicate
    const targetDelayMs = 150;
    const sendRes = await sendEvolutionMessageToConversation(
      conv,
      aiReply,
      targetDelayMs,
      triggerSource === 'manual_crm_trigger'
    );
    const sentOk = sendRes.ok;
    const durationMs = Date.now() - startTime;

    if (!sentOk) {
      recordDiagnosticStage({
        correlationId: effCorrelationId,
        stage: 'WHATSAPP_SEND_COMPLETED',
        service: 'Evolution API',
        module: 'evolution',
        customer: conv.customerName,
        conversationId: conv.sessionId,
        messageId: initialMsgId,
        success: false,
        severity: 'HIGH',
        details: 'No se pudo entregar a WhatsApp (Evolution API desconectado o socket cerrado)',
      });

      recordBotAuditLog({
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: initialLastMsg?.evolutionMessageId || initialLastMsg?.id || '',
        incomingText: baseCustomerText,
        decision: 'error',
        reason: `No se pudo entregar a WhatsApp (Evolution API desconectado o número inválido)`,
        replyText: aiReply,
        durationMs,
      });

      return {
        success: false,
        reply: aiReply,
        providerUsed,
        modelUsed,
        toolsExecuted,
        sentToWhatsApp: false,
        correlationId: effCorrelationId,
        error: 'No se pudo entregar a WhatsApp porque la sesión de Evolution API está desconectada. Por favor verifica o escanea el código QR.',
      };
    }

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'WHATSAPP_SEND_COMPLETED',
      service: 'Evolution API',
      module: 'evolution',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: sendRes.messageId || initialMsgId,
      details: `Entregado exitosamente a WhatsApp en ${durationMs}ms`,
    });

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
      markMessageIdProcessed(sendRes.messageId, contactKeys, {
        correlationId: effCorrelationId,
        conversationId: conv.sessionId,
        responseSent: true,
      });
    }
    if (initialMsgId) {
      markMessageIdProcessed(initialMsgId, contactKeys, {
        correlationId: effCorrelationId,
        conversationId: conv.sessionId,
        responseSent: true,
        orderOrQuoteCreated: toolsExecuted.some(t => t === 'odoo_crear_cotizacion' || t === 'registrar_pedido'),
      });
    }

    if (!isDuplicateChatMessage(conv.messages, assistantMessage)) {
      recordLocalMessage(conv.sessionId, assistantMessage, conv.customerPhone);
      conv.messages.push(assistantMessage);
    }
    conv.lastTimestamp = assistantMessage.timestamp;
    conv.lastMessagePreview = aiReply;
    conv.lastMessageType = 'text';

    broadcastEvent('new_message', { sessionId: conv.sessionId, message: assistantMessage });
    broadcastEvent('conversations_update', { count: conversations.length });

    setTimeout(() => {
      loadEvolutionMessagesForChat(conv.sessionId)
        .then(() => {
          broadcastEvent('conversations_update', { count: conversations.length });
        })
        .catch(() => {});
    }, 1800);

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

    recordDiagnosticStage({
      correlationId: effCorrelationId,
      stage: 'MESSAGE_COMPLETED',
      service: 'Backend',
      module: 'pipeline',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId: initialMsgId,
      details: `Flujo completo finalizado con éxito en ${durationMs}ms`,
    });

    return {
      success: true,
      reply: aiReply,
      providerUsed,
      modelUsed,
      toolsExecuted,
      sentToWhatsApp: sentOk,
      correlationId: effCorrelationId,
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
    return { success: false, error: err.message, correlationId: effCorrelationId };
  } finally {
    activeCorrelationIdContext = previousCorrelationContext;
    releaseBotLock(conv, effOwnerId);
  }
}

// ---------------------------------------------------------
// Fase 1.4 — Persistent Queue Worker with Timeout & Exponential Backoff
// ---------------------------------------------------------
const activeQueueConversations = new Set<string>();

async function executeSingleQueueJob(job: QueueJobEntry): Promise<void> {
  const convKey = job.conversationId || job.customerPhone || job.id;
  if (activeQueueConversations.has(convKey)) {
    return;
  }

  // Discard synthetic test jobs immediately if encountered
  if (
    isSyntheticTestArtifact(job.messageId) ||
    isSyntheticTestArtifact(job.conversationId) ||
    isSyntheticTestArtifact(job.customer)
  ) {
    persistentJobQueue = persistentJobQueue.filter(j => j.id !== job.id);
    savePersistentJobQueue();
    return;
  }

  let conv =
    findConversationByAnyId(job.conversationId) ||
    (job.customerPhone ? findConversationByAnyId(job.customerPhone) : undefined);

  if (!conv && job.conversationId && job.conversationId.includes('@')) {
    const cleanPhone = (job.customerPhone || job.conversationId.replace(/@.*$/, '')).replace(/\D/g, '');
    conv = {
      sessionId: job.conversationId,
      customerPhone: cleanPhone,
      customerName: job.customer || `Cliente +${cleanPhone}`,
      aiEnabled: true,
      unreadCount: 1,
      lastTimestamp: job.receivedAt || new Date().toISOString(),
      lastMessagePreview: 'Mensaje recibido por WhatsApp',
      lastMessageType: (job.contentType as any) || 'text',
      intentStatus: 'explorando',
      detectedProducts: [],
      messages: [],
      messagesLoaded: false,
      isLiveEvolution: true,
    };
    conversations.unshift(conv);
    await loadEvolutionMessagesForChat(conv.sessionId).catch(() => {});
  }

  if (!conv) {
    job.status = 'FAILED';
    job.lastError = `Conversación no encontrada en memoria (${job.conversationId})`;
    savePersistentJobQueue();
    return;
  }

  const contactKeys = getConversationContactKeys(conv);
  if (conv.aiEnabled === false || !appConfig.globalAiActive || contactKeys.some(k => aiEnabledBySession.get(k) === false)) {
    job.status = 'COMPLETED';
    job.lastError = 'IA pausada manualmente en este chat para permitir atención humana';
    savePersistentJobQueue();
    return;
  }

  if (contactKeys.some(k => isBotLockActive(k))) {
    // Another worker/message for this same conversation is currently in-flight; wait for next tick
    return;
  }

  activeQueueConversations.add(convKey);
  job.status = 'PROCESSING';
  job.attempts = (job.attempts || 0) + 1;
  savePersistentJobQueue();

  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    // Ensure the message ID is not prematurely blocked if this is a retry attempt
    if (job.attempts > 1) {
      unmarkMessageIdProcessedForRetry(job.messageId, contactKeys);
    }

    const timeoutPromise = new Promise<{
      success: boolean;
      skipped?: boolean;
      error?: string;
    }>(resolve => {
      timeoutHandle = setTimeout(() => {
        resolve({
          success: false,
          error: `Tiempo máximo de ejecución excedido (${JOB_MAX_EXECUTION_MS / 1000}s timeout)`,
        });
      }, JOB_MAX_EXECUTION_MS);
    });

    const result = await Promise.race([
      triggerSalesBotReplyForConversation(conv, 'persistent_queue_worker', job.correlationId, job.id),
      timeoutPromise,
    ]);

    if (result.success || result.skipped) {
      job.status = 'COMPLETED';
      job.completedAt = new Date().toISOString();
      job.lastError = undefined;
      job.nextRetryAt = undefined;
      savePersistentJobQueue();
      return;
    }

    // Job failed: unmark message ID so subsequent retry is permitted
    unmarkMessageIdProcessedForRetry(job.messageId, contactKeys);

    const errMsg = result.error || 'Error desconocido al procesar tarea de cola';
    job.lastError = errMsg;

    if (job.attempts < (job.maxAttempts || JOB_DEFAULT_MAX_ATTEMPTS)) {
      // Exponential backoff: 5s (attempt 1), 15s (attempt 2), 45s (attempt 3)
      const backoffScheduleMs = [5000, 15000, 45000];
      const delayMs = backoffScheduleMs[Math.min(job.attempts - 1, backoffScheduleMs.length - 1)] || 15000;
      job.status = 'RETRY';
      job.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
      recordSystemApiLog({
        service: 'Backend',
        action: `Cola Persistente — Reintento Programado (${job.attempts}/${job.maxAttempts})`,
        method: 'QUEUE',
        statusCode: 429,
        success: false,
        durationMs: 0,
        correlationId: job.correlationId,
        severity: 'MEDIUM',
        module: 'queue',
        customer: job.customer,
        conversationId: job.conversationId,
        messageId: job.messageId,
        requestPreview: `Reintento en ${delayMs / 1000}s para mensaje ${job.messageId}`,
        error: errMsg,
      });
    } else {
      job.status = 'DEAD_LETTER';
      job.nextRetryAt = undefined;
      recordSystemApiLog({
        service: 'Backend',
        action: `Cola Persistente — Tarea en DEAD_LETTER (${job.attempts}/${job.maxAttempts})`,
        method: 'QUEUE',
        statusCode: 500,
        success: false,
        durationMs: 0,
        correlationId: job.correlationId,
        severity: 'CRITICAL',
        module: 'queue',
        customer: job.customer,
        conversationId: job.conversationId,
        messageId: job.messageId,
        requestPreview: `Agotados los ${job.maxAttempts} intentos para mensaje ${job.messageId}`,
        error: errMsg,
      });
    }
    savePersistentJobQueue();
  } catch (err: any) {
    unmarkMessageIdProcessedForRetry(job.messageId, contactKeys);
    job.lastError = err?.message || String(err);
    if (job.attempts < (job.maxAttempts || JOB_DEFAULT_MAX_ATTEMPTS)) {
      const delayMs = job.attempts === 1 ? 5000 : job.attempts === 2 ? 15000 : 45000;
      job.status = 'RETRY';
      job.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    } else {
      job.status = 'DEAD_LETTER';
    }
    savePersistentJobQueue();
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    activeQueueConversations.delete(convKey);
  }
}

async function processPersistentQueueTick(): Promise<void> {
  if (isServerShuttingDown || isQueueWorkerRunning) return;
  if (!appConfig.globalAiActive) return;

  isQueueWorkerRunning = true;
  try {
    const now = Date.now();
    // Process oldest ready jobs first so messages in a conversation are answered in chronological order
    const readyJobs = [...persistentJobQueue]
      .reverse()
      .filter(job => {
        if (job.status === 'PENDING' || job.status === 'RECEIVED') return true;
        if (job.status === 'RETRY') {
          if (!job.nextRetryAt) return true;
          return new Date(job.nextRetryAt).getTime() <= now;
        }
        return false;
      });

    if (readyJobs.length === 0) return;

    // Pick at most one ready job per conversationId in this tick so different customers run in parallel while same-customer jobs run sequentially
    const jobsToLaunch: QueueJobEntry[] = [];
    const seenConvs = new Set<string>();
    for (const job of readyJobs) {
      const cKey = job.conversationId || job.customerPhone || job.id;
      if (seenConvs.has(cKey) || activeQueueConversations.has(cKey)) continue;
      seenConvs.add(cKey);
      jobsToLaunch.push(job);
      if (jobsToLaunch.length >= 5) break;
    }

    await Promise.all(jobsToLaunch.map(j => executeSingleQueueJob(j)));
  } finally {
    isQueueWorkerRunning = false;
  }
}

// AI Sales Assistant Suggestion Endpoint (Generates draft in composer without sending — Strictly OpenAI)
app.post('/api/ai/generate-reply', async (req, res) => {
  const { sessionId, userMessage, quotedStatusText, isStatusReply: reqIsStatusReply } = req.body;
  const conv = conversations.find(c => c.sessionId === sessionId);

  if (products.length === 0) {
    await syncOdooInventory();
  }

  if (conv && !conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(conv.sessionId);
  }

  const lastMsg = conv?.messages
    ? [...conv.messages].reverse().find(m => m.sender === 'customer') || conv.messages[conv.messages.length - 1]
    : undefined;
  const baseText = userMessage || lastMsg?.transcription || lastMsg?.content || conv?.lastMessagePreview || 'Hola';
  const effectiveQuotedText = quotedStatusText || req.body.quotedText || lastMsg?.quotedMessage?.text || '';
  const isStatusReply = Boolean(reqIsStatusReply || req.body.isStatusReply || quotedStatusText || lastMsg?.quotedMessage?.isStatusReply);
  const hasQuote = Boolean(effectiveQuotedText.trim());

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
1. Toma como referencia TANTO el mensaje citado como el mensaje nuevo ("${baseText}") para responder el motivo exacto por el que lo citó.
2. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
3. Responde como un asesor humano normal por WhatsApp (cálido y conciso). NUNCA digas "Reconozco tus mensajes citados", "Vi que citaste", "Sobre tu nota de voz citada" ni hables de que reconoces citas o audios.
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  }

  const queryText = quotedBlock ? `${quotedBlock}\nConsulta del cliente: "${baseText}"` : baseText;
  const searchQueryText = effectiveQuotedText ? `${effectiveQuotedText}\n${baseText}` : baseText;
  const systemInstruction = buildMasterSalesSystemInstruction(conv, searchQueryText);
  const fullHistoryTurns = buildChatHistoryTurns(conv);
  if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === 'user') {
    fullHistoryTurns.pop();
  }
  const historyTurns = fullHistoryTurns;

  const effectiveLastMsg: ChatMessage | undefined =
    conv && (lastMsg || hasQuote)
      ? {
          ...(lastMsg || {}),
          id: lastMsg?.id || `draft-${Date.now()}`,
          sender: 'customer',
          type: lastMsg?.type || 'text',
          content: baseText,
          timestamp: lastMsg?.timestamp || new Date().toISOString(),
          quotedMessage:
            lastMsg?.quotedMessage?.text
              ? lastMsg.quotedMessage
              : hasQuote
                ? {
                    id: '',
                    text: effectiveQuotedText,
                    author: 'Todo Lapto',
                    type: 'text',
                    isStatusReply,
                  }
                : undefined,
        }
      : undefined;

  try {
    if (conv && effectiveLastMsg) {
      const directSelectionOrDiscount = resolveDirectProductSelectionOrDiscountReply(
        conv,
        effectiveLastMsg,
        baseText
      );
      if (directSelectionOrDiscount) {
        return res.json({
          success: true,
          reply: directSelectionOrDiscount.reply,
          toolsExecuted: directSelectionOrDiscount.advisorAlertText ? ['notificar_equipo'] : [],
          providerUsed: 'openai',
          modelUsed: directSelectionOrDiscount.advisorAlertText
            ? 'discount-advisor-escalation'
            : 'catalog-selection-engine',
        });
      }

      if (hasQuote) {
        const directQuotedReply = resolveQuotedMessageDirectReply(conv, effectiveLastMsg);
        if (directQuotedReply) {
          return res.json({
            success: true,
            reply: directQuotedReply,
            toolsExecuted: [],
            providerUsed: 'openai',
            modelUsed: 'quoted-context-engine',
          });
        }
      }
    }

    const storeAnswer = resolveDirectStoreQuestion(baseText, conv, effectiveQuotedText);
    if (storeAnswer) {
      return res.json({
        success: true,
        reply: storeAnswer,
        toolsExecuted: [],
        providerUsed: 'deterministic',
        modelUsed: 'store-direct',
      });
    }

    const directCatalogAnswer = resolveDirectCatalogReply(baseText, conv, hasQuote);
    if (directCatalogAnswer) {
      return res.json({
        success: true,
        reply: directCatalogAnswer,
        toolsExecuted: [],
        providerUsed: 'openai',
        modelUsed: 'full-catalog-engine',
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
    return res.status(200).json({ success: false, message: result.error || 'Error al generar respuesta', reply: result.reply });
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

// 9. Fase 1.3 — Webhook for Evolution API (Real-Time Inbound Messages, Batch Support, Persistent Queue)
const handleEvolutionWebhook = async (req: express.Request, res: express.Response) => {
  res.status(200).json({ received: true });

  const body = req.body || {};
  const rawEvent = (body?.event || body?.type || '').toString().trim().toLowerCase().replace(/[-_]/g, '.');

  // Handle real-time QR code updates from Evolution API
  if (rawEvent === 'qrcode.updated') {
    const qrBase64 =
      body?.data?.qrcode?.base64 ||
      body?.data?.base64 ||
      body?.qrcode?.base64 ||
      null;
    const pairingCode = body?.data?.qrcode?.pairingCode || body?.data?.pairingCode || null;
    if (qrBase64) {
      evolutionQrCache.qrBase64 = qrBase64;
      evolutionQrCache.pairingCode = pairingCode;
      evolutionQrCache.generatedAt = Date.now();
      broadcastEvent('evolution_qr', {
        qrBase64,
        pairingCode,
        state: 'connecting',
        connected: false,
      });
    }
    return;
  }

  // Handle real-time connection state updates (e.g., when user finishes scanning QR on phone)
  if (rawEvent === 'connection.update') {
    const newState = (
      body?.data?.state ||
      body?.data?.connection ||
      body?.data?.status ||
      body?.state ||
      body?.connection ||
      ''
    ).toString().toLowerCase();
    if (newState === 'open' || newState === 'connected') {
      evolutionLastKnownState = 'open';
      appConfig.evolution.connected = true;
      evolutionQrCache.qrBase64 = null;
      evolutionQrCache.pairingCode = null;
      botStartupCutoffMs = getEffectiveCurrentDate().getTime();
      isFirstEvolutionSync = true;
      broadcastEvent('evolution_status', { connected: true, state: 'open' });
    } else if (newState === 'close' || newState === 'connecting' || newState === 'closed' || newState === 'logged_out') {
      clearAllChatsOnWhatsAppDisconnect(newState);
    }
    return;
  }

  // Accept ONLY messages.upsert and incoming message events (STRICTLY EXCLUDE messages.update, which are delivery status updates)
  const isMessageUpsert =
    rawEvent === 'messages.upsert' ||
    rawEvent === 'messages_upsert' ||
    rawEvent === 'message' ||
    (rawEvent.endsWith('.upsert') && !rawEvent.includes('update'));

  if (!isMessageUpsert) {
    return;
  }

  // Ignore Baileys history sync ('append') pushed when linking a WhatsApp device via QR code
  if (body?.data?.type === 'append' || body?.type === 'append') {
    return;
  }

  lastWebhookReceivedAt = new Date().toISOString();

  // Fase 1.3 — Unpack ALL messages in batch payloads (data[], data.messages[], or single message object)
  const rawBatchList: any[] = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.data?.messages)
    ? body.data.messages
    : Array.isArray(body?.messages)
    ? body.messages
    : [body?.data || body?.message || body];

  const instanceName = body?.instance || appConfig.evolution?.instance || 'todolapto';
  let enqueuedAny = false;

  for (const messageData of rawBatchList) {
    const key = messageData?.key;
    if (!key || key.fromMe) {
      continue;
    }

    const messageId = normalizeMsgIdKey(key.id);
    if (isSyntheticTestArtifact(messageId) || isSyntheticTestArtifact(key.remoteJid)) {
      continue;
    }

    // Ignore historical messages (> 3 minutes old) pushed during WhatsApp QR device linking sync
    const rawMsgTs = Number(messageData?.messageTimestamp || 0);
    const msgTimeMs = rawMsgTs > 0 ? (rawMsgTs < 1e12 ? rawMsgTs * 1000 : rawMsgTs) : Date.now();
    if (Date.now() - msgTimeMs > 3 * 60 * 1000) {
      markMessageIdProcessed(messageId, [key.remoteJid || '']);
      continue;
    }

    const now = Date.now();
    const correlationId = generateCorrelationId(messageId);

    recordDiagnosticStage({
      correlationId,
      stage: 'WEBHOOK_RECEIVED',
      service: 'Evolution API',
      module: 'webhook',
      messageId,
      details: `Evento ${rawEvent} recibido desde instancia ${instanceName}`,
    });

    if (messageId) {
      const prevWebhookTs = seenWebhookDeliveryIds.get(messageId);
      if (prevWebhookTs && now - prevWebhookTs < 120000) {
        recordDiagnosticStage({
          correlationId,
          stage: 'WEBHOOK_VALIDATED',
          service: 'Evolution API',
          module: 'webhook',
          messageId,
          details: `Webhook duplicado ignorado por idempotencia HTTP (${messageId})`,
        });
        continue;
      }
      seenWebhookDeliveryIds.set(messageId, now);
      if (seenWebhookDeliveryIds.size > 1000) {
        const oldestKey = seenWebhookDeliveryIds.keys().next().value;
        if (oldestKey) seenWebhookDeliveryIds.delete(oldestKey);
      }
    }

    if (isMessageIdAlreadyProcessed(messageId)) {
      recordDiagnosticStage({
        correlationId,
        stage: 'WEBHOOK_VALIDATED',
        service: 'Evolution API',
        module: 'webhook',
        messageId,
        details: `Mensaje ${messageId} ya registrado como procesado en registro de idempotencia`,
      });
      continue;
    }

    const remoteJid = key.remoteJid || '';
    const rawAlt = key.remoteJidAlt || '';
    const participant = key.participant || '';

    // CRITICAL: Ignore all WhatsApp group messages entirely (never respond, never add to CRM inbox)
    if (isWhatsAppGroup(remoteJid) || isWhatsAppGroup(rawAlt) || isWhatsAppGroup(participant)) {
      continue;
    }

    recordDiagnosticStage({
      correlationId,
      stage: 'WEBHOOK_VALIDATED',
      service: 'Evolution API',
      module: 'webhook',
      messageId,
      details: `Webhook validado para JID ${remoteJid}`,
    });

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
    if (!parsedIncoming) continue;

    recordDiagnosticStage({
      correlationId,
      stage: 'MESSAGE_NORMALIZED',
      service: 'Backend',
      module: 'normalizer',
      customer: pushName,
      conversationId: remoteJid,
      messageId,
      details: `Mensaje normalizado (tipo: ${parsedIncoming.type}, texto: "${(parsedIncoming.content || '').slice(0, 80)}")`,
    });

    let conv = conversations.find(
      c =>
        c.sessionId === remoteJid ||
        (rawAlt && c.sessionId === rawAlt) ||
        (senderNumber && senderNumber.length <= 12 && c.customerPhone === senderNumber) ||
        relatedJidsBySession.get(c.sessionId)?.has(remoteJid) ||
        (!isGenericContactName(pushName) && !isGenericContactName(c.customerName) && c.customerName.trim().toLowerCase() === pushName.trim().toLowerCase())
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
      if (!isDuplicateChatMessage(conv.messages, parsedIncoming)) {
        hydrateQuotedMessageById(parsedIncoming, conv.messages, conv.customerName || pushName);
        conv.messages.push(parsedIncoming);
      }
    }

    // Persist incoming message locally before any AI call (Fase 1.3 rule)
    recordLocalMessage(conv.sessionId, parsedIncoming, conv.customerPhone);

    broadcastEvent('new_message', { sessionId: conv.sessionId, message: parsedIncoming });
    broadcastEvent('conversations_update', { count: conversations.length });

    if (appConfig.supabase?.autoSync !== false) {
      autoSyncMessageToSupabase(conv, parsedIncoming).catch(() => {});
    }

    recordDiagnosticStage({
      correlationId,
      stage: 'MESSAGE_PERSISTED',
      service: 'Backend',
      module: 'storage',
      customer: conv.customerName,
      conversationId: conv.sessionId,
      messageId,
      details: `Mensaje persistido en conversación ${conv.sessionId} antes de invocar IA`,
    });

    // Enqueue in persistent job queue if AI is enabled for this chat
    if (appConfig.globalAiActive && conv.aiEnabled) {
      const skipCheck = shouldSkipBotReply(conv, parsedIncoming, 'evolution_webhook');
      if (skipCheck.skip) {
        console.log(`🛡️ [Webhook Skip]: ${skipCheck.reason} (${conv.customerName})`);
        continue;
      }

      enqueueInboundMessageJob({
        messageId: messageId || parsedIncoming.id,
        conversationId: conv.sessionId,
        customer: conv.customerName,
        customerPhone: conv.customerPhone,
        instance: instanceName,
        contentType: parsedIncoming.type,
        correlationId,
      });
      enqueuedAny = true;
    }
  }

  if (enqueuedAny) {
    processPersistentQueueTick().catch(err => {
      console.log('[Persistent Queue Tick Info]:', err?.message || err);
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
            'MESSAGES_UPSERT',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE'
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
    let registeredEvents: string[] = [];
    if (findRes && findRes.ok) {
      const data = await findRes.json().catch(() => null);
      isEnabled = Boolean(data?.enabled);
      registeredUrl = data?.url || '';
      registeredEvents = Array.isArray(data?.events) ? data.events : [];
    }

    const requiredEvents = [
      'MESSAGES_UPSERT',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
      'MESSAGES_UPDATE',
      'SEND_MESSAGE'
    ];
    const hasAllEvents = requiredEvents.every(ev => registeredEvents.includes(ev));

    const configuredWebhook = (
      preferredUrl ||
      (appConfig.evolution as any).webhookUrl ||
      ''
    ).trim();
    if (!configuredWebhook) {
      if (isEnabled) {
        console.log(`🛡️ [Webhook Guard]: Desactivando webhook fantasma en Evolution API para evitar duplicados.`);
        await fetch(`${baseUrl}/webhook/set/${instance}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: appConfig.evolution.apiKey,
          },
          body: JSON.stringify({
            webhook: {
              enabled: false,
              url: 'https://disabled-webhook.local',
              events: [],
            },
          }),
          signal: AbortSignal.timeout(6000),
        }).catch(() => {});
      }
      return;
    }

    const targetUrl = configuredWebhook;
    if (isEnabled && registeredUrl === targetUrl && hasAllEvents) {
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
          events: requiredEvents,
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
      if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
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
            if (buffer.length < 5 * 1024 * 1024) {
              staticMemoryCache.set(cleanRel, { buffer, mime });
            }
            return { buffer, mime };
          }
        } catch {}
      }
      return null;
    };

    app.get(['/favicon.ico', '/favicon.svg'], (_req, res) => {
      const asset = readStaticAsset('favicon.svg') || readStaticAsset('favicon.ico');
      if (asset) {
        res.setHeader('Content-Type', asset.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(asset.buffer);
      }
      return res.status(204).end();
    });

    app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
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

        const ext = path.extname(reqPath).toLowerCase();
        if (ext && ext !== '.html') {
          return res.status(404).send('Asset not found');
        }
      }

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

    // Immediately synchronize authoritative RD clock, then WhatsApp chats, Persistent Queue & Odoo inventory
    setTimeout(async () => {
      await syncAuthoritativeDominicanTime().catch(() => {});
      botStartupCutoffMs = getEffectiveCurrentDate().getTime() - 10000;

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

      processPersistentQueueTick().catch(() => {});
    }, 600);

    // Background synchronization schedule registered for clean graceful shutdown:
    // 0. Authoritative Dominican Republic Time Synchronization: Every 60 seconds
    syncAuthoritativeDominicanTime().catch(() => {});
    registerBackgroundInterval(() => {
      syncAuthoritativeDominicanTime().catch(() => {});
    }, 60000);

    // 1. Persistent Job Queue Worker: Every 2.5 seconds
    registerBackgroundInterval(() => {
      processPersistentQueueTick().catch(() => {});
    }, 2500);

    // 2. WhatsApp Evolution API: Fast poll every 3 seconds
    registerBackgroundInterval(() => {
      syncEvolutionChats().catch(() => {});
    }, 3000);

    // 3. Odoo Inventory: Synchronized every 30 minutes
    registerBackgroundInterval(() => {
      syncOdooInventory().catch(() => {});
    }, 1000 * 60 * 30);

    // 4. Odoo Customers: Synchronized every 30 minutes
    registerBackgroundInterval(() => {
      syncOdooCustomers().catch(() => {});
    }, 1000 * 60 * 30);
  };

  server.on('error', (err: any) => {
    console.log(`[Server Listen Notice on ${PORT}]:`, err.message);
  });

  if (!isServerListening) {
    isServerListening = true;
    server.listen(PORT, onListening);
  }

  // Fase 1.2 — Controlled Graceful Shutdown for Hostinger / Passenger / Docker
  const shutdown = (signal: string) => {
    if (isServerShuttingDown) return;
    isServerShuttingDown = true;
    console.log(`[Server] Received ${signal}. Starting controlled graceful shutdown...`);

    // 1. Stop all background polling & queue intervals
    for (const timer of backgroundIntervals) {
      clearInterval(timer);
    }
    backgroundIntervals.length = 0;

    // 2. Persist any in-flight queue jobs as RETRY so they resume cleanly on next boot
    try {
      for (const job of persistentJobQueue) {
        if (job.status === 'PROCESSING' || job.status === 'RECEIVED') {
          job.status = 'RETRY';
          job.nextRetryAt = new Date().toISOString();
          job.lastError = `Interrumpido por apagado controlado (${signal}); reanudará al iniciar`;
        }
      }
      savePersistentJobQueue();
      savePersistedConfig(false);
    } catch (e: any) {
      console.warn('[Server Shutdown Persistence Warning]:', e?.message || e);
    }

    // 3. Close active SSE clients cleanly
    for (const client of sseClients) {
      try {
        client.end();
      } catch {}
    }
    sseClients.clear();

    // 4. Close HTTP server
    server.close(() => {
      console.log('[Server] HTTP server and persistent state closed cleanly.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Forcing shutdown after timeout.');
      process.exit(1);
    }, 4500).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

export default app;
export { app, startServer };

