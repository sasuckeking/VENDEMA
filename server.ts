import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
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
  UserRole
} from './src/types.ts';
import { OFFICIAL_TODO_LAPTO_MASTER_PROMPT } from './src/masterPrompt.ts';
import { 
  getDominicanTimeContext, 
  buildDominicanTimePromptContext,
  setGlobalHolidayOverrides,
  getHolidaysWithOverridesForYear,
  getAvailableHolidayYears
} from './src/utils/businessSchedule.ts';
import { 
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_ANON_KEY,
  INTERNAL_USERS_BACKUP_ID,
  INTERNAL_HOLIDAYS_BACKUP_ID,
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
  autoSyncConfigToSupabase,
  autoSyncOrderToSupabase,
  autoSyncMessageToSupabase,
  autoSyncCustomerToSupabase
} from './src/utils/supabaseService.ts';

dotenv.config();

// Global process error handlers to prevent container crashes on network/background glitches
process.on('uncaughtException', (err) => {
  console.error('[Process Error] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process Error] Unhandled Rejection:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', true);
const rawPort = process.env.PORT;
const isNumericPort = rawPort && !isNaN(Number(rawPort));
const PORT: number | string = isNumericPort ? Number(rawPort) : (rawPort || 3000);

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'default_gemini_key',
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

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
// Global State & Preconfigured Credentials from n8n Workflow
// ---------------------------------------------------------
const CONFIG_FILE_PATH = path.join(__dirname, '.vendema-config.json');
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

      // AI Provider Credentials
      OPENAI_API_KEY: cfg.aiProvider?.openaiApiKey || '',
      DEEPSEEK_API_KEY: cfg.aiProvider?.deepseekApiKey || '',
      GEMINI_API_KEY: cfg.aiProvider?.geminiApiKey || process.env.GEMINI_API_KEY || '',
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
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    temperature: 0.35,
    customInstructions: '',
    systemPrompt: OFFICIAL_TODO_LAPTO_MASTER_PROMPT,
    openaiApiKey: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY' ? process.env.OPENAI_API_KEY : '',
    openaiBaseUrl: 'https://api.openai.com/v1/chat/completions',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY' ? process.env.DEEPSEEK_API_KEY : '',
    deepseekBaseUrl: 'https://api.deepseek.com/chat/completions',
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
};

function loadPersistedConfig() {
  try {
    if (fs.existsSync(ENV_FILE_PATH)) {
      dotenv.config({ path: ENV_FILE_PATH, override: true });
    }

    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      const saved = JSON.parse(raw);
      if (saved.globalAiActive !== undefined) appConfig.globalAiActive = Boolean(saved.globalAiActive);
      if (saved.aiProvider) {
        const savedPrompt = saved.aiProvider.systemPrompt || '';
        const shouldRefreshPrompt =
          !savedPrompt ||
          savedPrompt.includes('1️⃣ *NOMBRE COMPLETO*') ||
          !savedPrompt.includes('REGLA DE CITAS MEJORADA V2') ||
          !savedPrompt.includes('FILTRADO INTELIGENTE V3');
        appConfig.aiProvider = {
          ...appConfig.aiProvider,
          ...saved.aiProvider,
          systemPrompt: shouldRefreshPrompt ? OFFICIAL_TODO_LAPTO_MASTER_PROMPT : savedPrompt,
          openaiApiKey: saved.aiProvider.openaiApiKey || (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY' ? process.env.OPENAI_API_KEY : ''),
          deepseekApiKey: saved.aiProvider.deepseekApiKey || (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY' ? process.env.DEEPSEEK_API_KEY : ''),
          geminiApiKey: saved.aiProvider.geminiApiKey || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' ? process.env.GEMINI_API_KEY : ''),
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
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(appConfig, null, 2), 'utf-8');
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
    fs.writeFileSync(USERS_FILE_PATH, content, 'utf-8');
    if (USERS_FALLBACK_PATH !== USERS_FILE_PATH) {
      fs.writeFileSync(USERS_FALLBACK_PATH, content, 'utf-8');
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
  savePersistedUsers();
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
      savePersistedUsers();
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
        savePersistedConfig();
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

const rejectedOpenAiKeys = new Set<string>();
const rejectedDeepseekKeys = new Set<string>();

function sanitizeBearerKey(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

// ---------------------------------------------------------
// Helper: Unified Multi-Provider AI Engine (Gemini, OpenAI, DeepSeek)
// ---------------------------------------------------------
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
    model: 'gemini-3.8-flash',
    temperature: 0.35,
  };
  const provider = providerCfg.provider || 'gemini';
  const temp = options.temperature ?? providerCfg.temperature ?? 0.35;
  const allowFallback = options.allowFallback ?? true;
  const sys = [options.systemInstruction, providerCfg.customInstructions]
    .filter(Boolean)
    .join('\n\n');

  const openaiKey = sanitizeBearerKey(
    providerCfg.openaiApiKey ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
        ? process.env.OPENAI_API_KEY
        : '')
  );
  const openaiUrl = resolveChatCompletionsUrl(
    providerCfg.openaiBaseUrl,
    'https://api.openai.com/v1/chat/completions'
  );

  const deepseekKey = sanitizeBearerKey(
    providerCfg.deepseekApiKey ||
      (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'MY_DEEPSEEK_API_KEY'
        ? process.env.DEEPSEEK_API_KEY
        : '')
  );
  const deepseekUrl = resolveChatCompletionsUrl(
    providerCfg.deepseekBaseUrl,
    'https://api.deepseek.com/chat/completions'
  );

  // 1. OpenAI (ChatGPT)
  if (provider === 'openai' && openaiKey) {
    // If this exact key was already rejected with 401 and fallback is allowed, go straight to Gemini
    if (allowFallback && rejectedOpenAiKeys.has(openaiKey)) {
      // Skip repeated 401 requests during live background polling
    } else {
      const primaryOpenAiModel =
        providerCfg.model?.startsWith('gpt') || providerCfg.model?.startsWith('o')
          ? providerCfg.model
          : 'gpt-4o-mini';
      const openAiCandidates =
        primaryOpenAiModel === 'gpt-4o-mini'
          ? ['gpt-4o-mini']
          : [primaryOpenAiModel, 'gpt-4o-mini'];

      let lastOpenAiErr: any = null;
      for (const model of openAiCandidates) {
        try {
          const isReasoningModel = model.startsWith('o1') || model.startsWith('o3');
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
            model,
            messages,
            ...(isReasoningModel ? {} : { temperature: temp }),
            ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          };

          const res = await fetch(openaiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify(bodyPayload),
          });

          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              rejectedOpenAiKeys.add(openaiKey);
              const prefixHint = !openaiKey.startsWith('sk-')
                ? ' (la clave ingresada no comienza con "sk-" ni "sk-proj-", verifica haberla copiado completa desde OpenAI)'
                : ' (verifica que la clave esté activa en platform.openai.com)';
              lastOpenAiErr = new Error(
                `La API Key de OpenAI fue rechazada por autorización (HTTP ${res.status})${prefixHint}`
              );
              break;
            }
            throw new Error(`OpenAI devolvió estado HTTP ${res.status} en el modelo ${model}`);
          }

          rejectedOpenAiKeys.delete(openaiKey);
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || '';
          if (text.trim()) {
            return { text, providerUsed: 'openai', modelUsed: model };
          }
          throw new Error('OpenAI devolvió una respuesta vacía');
        } catch (err: any) {
          lastOpenAiErr = err;
          console.log(`[AI Engine Info]: Reintento o respaldo desde OpenAI (${model}) -> ${err.message}`);
        }
      }

      if (!allowFallback && lastOpenAiErr) throw lastOpenAiErr;
      console.log(
        '[AI Engine]: Aplicando respaldo automático con Google Gemini para responder al cliente en tiempo real.'
      );
    }
  }

  // 2. DeepSeek (deepseek-chat / deepseek-reasoner)
  if (provider === 'deepseek' && deepseekKey) {
    if (allowFallback && rejectedDeepseekKeys.has(deepseekKey)) {
      // Skip repeated 401 requests during live background polling
    } else {
      try {
        const model = providerCfg.model?.startsWith('deepseek')
          ? providerCfg.model
          : 'deepseek-chat';
        const messages: any[] = [];
        if (sys) messages.push({ role: 'system', content: sys });
        if (options.chatMessages && options.chatMessages.length > 0) {
          for (const cm of options.chatMessages) {
            if (cm.content?.trim()) {
              messages.push({ role: cm.role, content: cm.content });
            }
          }
        }
        messages.push({ role: 'user', content: options.prompt });

        const res = await fetch(deepseekUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deepseekKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: temp,
            ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            rejectedDeepseekKeys.add(deepseekKey);
            throw new Error(
              `La API Key de DeepSeek fue rechazada (HTTP ${res.status}). Verifica que comience con "sk-" y tenga saldo activo.`
            );
          }
          throw new Error(`DeepSeek devolvió estado HTTP ${res.status}`);
        }

        rejectedDeepseekKeys.delete(deepseekKey);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text.trim()) {
          return { text, providerUsed: 'deepseek', modelUsed: model };
        }
        throw new Error('DeepSeek devolvió una respuesta vacía');
      } catch (err: any) {
        console.log(`[AI Engine Info]: Respaldo desde DeepSeek -> ${err.message}`);
        if (!allowFallback) throw err;
      }
    }
  }

  // 3. Google Gemini (Default or Custom Gemini Key / Automatic Fallback with multi-model resilience)
  const preferredGeminiModel =
    provider === 'gemini' && providerCfg.model?.startsWith('gemini')
      ? providerCfg.model
      : 'gemini-3.8-flash';

  const geminiCandidates = Array.from(
    new Set([preferredGeminiModel, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'])
  );

  const customGeminiKey = sanitizeBearerKey(providerCfg.geminiApiKey);
  const geminiClient = customGeminiKey
    ? new GoogleGenAI({
        apiKey: customGeminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      })
    : ai;

  const fullPromptForGemini =
    options.chatMessages && options.chatMessages.length > 0
      ? `Historial reciente de mensajes:\n${options.chatMessages
          .map(m => `${m.role === 'user' ? 'CLIENTE' : 'TODO LAPTO (AGENTE)'}: ${m.content}`)
          .join('\n')}\n\n${options.prompt}`
      : options.prompt;

  let lastGeminiErr: any = null;
  for (const gModel of geminiCandidates) {
    try {
      const response = await geminiClient.models.generateContent({
        model: gModel,
        contents: fullPromptForGemini,
        config: {
          ...(sys ? { systemInstruction: sys } : {}),
          temperature: temp,
          ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      });

      if (response.text) {
        return {
          text: response.text,
          providerUsed: 'gemini',
          modelUsed: gModel,
        };
      }
    } catch (err: any) {
      lastGeminiErr = err;
      console.log(`[AI Engine Info]: Alternando modelo Gemini (${gModel})...`);
      await new Promise(r => setTimeout(r, 350));
    }
  }

  throw lastGeminiErr || new Error('No se pudo generar respuesta con los modelos disponibles.');
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

// ---------------------------------------------------------
// Helper: Exact Odoo Category + Keyword Product Categorizer
// ---------------------------------------------------------
const keywordsLaptop = [
  'chromebook','thinkpad','ideapad','latitude','macbook','edu gear','edugear','evvo','yoga',
  'probook','elitebook','inspiron','precision','vostro','aspire','travelmate','alienware',
  'chrobook','c771','thinkpad x131','thinkpad 11e','thinkpad t4','thinkpad t47',
  'thinkpad e5','thinkpad x1','thinkbook','thinkcentro','hp 15-','hp 14-','hp 14dq',
  'hp envy','hp stream','hp notebook','hp victus','dell chromebook','dell latitude',
  'dell inspiron','dell precision','lenovo 100e','lenovo n22','lenovo n23','lenovo n24',
  'lenovo thinkpad','lenovo ideapad','lenovo yoga','lenovo flex','laptop','notebook',
  'asus c203','touchsmart','satellite','surface','all in one'
];
const keywordsExcluir = [
  'cargador','bateria','batería','monitor','teclado','mouse','cartucho','impresora',
  'memoria usb','pieza','caddy','stand','soporte','bulto','stuche','estuche','funda',
  'candado','lock','cooling pad','cooler','bracket','hub usb','estacion de acoplamiento',
  'estación de acoplamiento','headset','mdp to vga','combo teclado','cover lenovo',
  'sky devices','board lenovo','board ','mouse pad','alfombra','liteon','ssd','ngff',
  'solid state','tablet acer b1','xtrike','concentrador usb','hp cargador','hp-318',
  'pantalla 11.','pantalla 14.','pantalla 15.','sleeve','mesa '
];
const keywordsRed = [
  'repetidor','router','antena wifi','wireless-n','ethernet adapter','rj45',
  '300mbps','linkzone','alcatel link','hotspot','switch ','wifi'
];
const keywordsMonitor = ['monitor','pantalla'];
const keywordsImpresora = ['impresora','cartucho','tinta','smart tank','deskjet'];

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

  // New boxed accessories (mouse, keyboards, hubs, bags, adapters, repeaters, soundbars)
  if (
    category === 'red' ||
    /\b(mouse|teclado|combo|hub|adaptador|cable|mochila|bulto|funda|estuche|cooling|stand|soporte|aud[ií]fono|headset|karaoke|barra de sonido|repetidor|router|candado|control|ups)\b/i.test(
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

  if ((categ.includes('laptop') || categ.includes('all in one')) && !isExcludedPart) {
    return 'laptop';
  }
  if (categ.includes('monitor')) {
    return 'monitor';
  }
  if (keywordsLaptop.some(k => nombre.includes(k)) && !isExcludedPart) {
    return 'laptop';
  }
  if (keywordsImpresora.some(k => nombre.includes(k))) {
    return 'impresora';
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

async function callOdoo(service: string, method: string, args: any[], maxRetries = 3): Promise<any> {
  await acquireOdooSlot();
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
          throw new Error(`Odoo status ${res.status}`);
        }

        const data = await res.json();
        if (data.error) {
          const rpcMsg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
          throw new Error(rpcMsg);
        }
        return data.result;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastErr = err;
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
    // 1. Fetch all internal locations in Odoo (Vitrina, Almacen, Recepcion, Existencias)
    const locations = await callOdoo('object', 'execute_kw', [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      'stock.location',
      'search_read',
      [[['usage', '=', 'internal']]],
      { fields: ['id', 'complete_name'] },
    ]);

    const vitrinaLoc = Array.isArray(locations)
      ? locations.find((l: any) => (l.complete_name || '').toLowerCase().includes('vitrina'))
      : { id: 41 };
    const almacenLoc = Array.isArray(locations)
      ? locations.find((l: any) => (l.complete_name || '').toLowerCase().includes('almacen'))
      : { id: 8 };
    const recepcionLoc = Array.isArray(locations)
      ? locations.find((l: any) => (l.complete_name || '').toLowerCase().includes('recepcion'))
      : { id: 35 };

    // Refresh static product attribute definitions every 30 minutes
    const now = Date.now();
    const shouldRefreshAttrs =
      cachedOdooAttrValues.length === 0 ||
      cachedOdooAttrLines.length === 0 ||
      now - lastOdooAttrsSync > 1000 * 60 * 30;

    // 2. Fetch active vendible products + location stock + cached/fresh Odoo product attributes
    const [allVendibleProducts, vitrinaProducts, almacenProducts, recepcionProducts, attrValues, attrLines] =
      await Promise.all([
        callOdoo('object', 'execute_kw', [
          appConfig.odoo.db,
          appConfig.odoo.uid,
          appConfig.odoo.apiKey,
          'product.template',
          'search_read',
          [[['sale_ok', '=', true], ['active', '=', true]]],
          {
            fields: [
              'name',
              'list_price',
              'qty_available',
              'virtual_available',
              'website_url',
              'description_sale',
              'description_ecommerce',
              'product_variant_id',
              'website_published',
              'categ_id',
              'brand_id',
            ],
            limit: 2000,
            order: 'list_price asc',
          },
        ]),
        vitrinaLoc
          ? callOdoo('object', 'execute_kw', [
              appConfig.odoo.db,
              appConfig.odoo.uid,
              appConfig.odoo.apiKey,
              'product.template',
              'search_read',
              [[['qty_available', '>', 0], ['sale_ok', '=', true], ['active', '=', true]]],
              {
                fields: ['id', 'qty_available', 'virtual_available'],
                limit: 2000,
                context: { location: [vitrinaLoc.id] },
              },
            ]).catch(() => [])
          : Promise.resolve([]),
        almacenLoc
          ? callOdoo('object', 'execute_kw', [
              appConfig.odoo.db,
              appConfig.odoo.uid,
              appConfig.odoo.apiKey,
              'product.template',
              'search_read',
              [[['qty_available', '>', 0], ['sale_ok', '=', true], ['active', '=', true]]],
              {
                fields: ['id', 'qty_available', 'virtual_available'],
                limit: 2000,
                context: { location: [almacenLoc.id] },
              },
            ]).catch(() => [])
          : Promise.resolve([]),
        recepcionLoc
          ? callOdoo('object', 'execute_kw', [
              appConfig.odoo.db,
              appConfig.odoo.uid,
              appConfig.odoo.apiKey,
              'product.template',
              'search_read',
              [[['qty_available', '>', 0], ['sale_ok', '=', true], ['active', '=', true]]],
              {
                fields: ['id', 'qty_available', 'virtual_available'],
                limit: 2000,
                context: { location: [recepcionLoc.id] },
              },
            ]).catch(() => [])
          : Promise.resolve([]),
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

    const vitrinaMap = new Map<number, number>();
    if (Array.isArray(vitrinaProducts)) {
      for (const vp of vitrinaProducts) {
        vitrinaMap.set(vp.id, Math.max(Number(vp.qty_available) || 0, Number(vp.virtual_available) || 0));
      }
    }

    const almacenMap = new Map<number, number>();
    if (Array.isArray(almacenProducts)) {
      for (const ap of almacenProducts) {
        almacenMap.set(ap.id, Math.max(Number(ap.qty_available) || 0, Number(ap.virtual_available) || 0));
      }
    }

    const recepcionMap = new Map<number, number>();
    if (Array.isArray(recepcionProducts)) {
      for (const rp of recepcionProducts) {
        recepcionMap.set(rp.id, Math.max(Number(rp.qty_available) || 0, Number(rp.virtual_available) || 0));
      }
    }

    if (Array.isArray(allVendibleProducts) && allVendibleProducts.length > 0) {
      const mapped: ProductItem[] = allVendibleProducts
        .map((p: any) => {
          const vStock = vitrinaMap.get(p.id) || 0;
          const aStock = almacenMap.get(p.id) || 0;
          const rStock = recepcionMap.get(p.id) || 0;
          // Exclude RCP/Recepcion stock (uninspected/repair warehouse) from vendible stock
          const rawGlobal = Math.max(Number(p.qty_available) || 0, Number(p.virtual_available) || 0);
          const totalStock =
            vStock + aStock > 0
              ? vStock + aStock
              : Math.max(0, rawGlobal - rStock);
          const odooCatName = Array.isArray(p.categ_id) ? String(p.categ_id[1] || '') : '';
          const odooBrandName = Array.isArray(p.brand_id) ? String(p.brand_id[1] || '') : '';
          const cat = categorizeOdooProduct(p.name || '', odooCatName);
          const odooAttrs = prodAttrsByTmplId.get(p.id) || {};

          const rawSaleDesc = typeof p.description_sale === 'string' ? p.description_sale.replace(/\s+/g, ' ').trim() : '';
          const cleanEcomDesc =
            typeof p.description_ecommerce === 'string'
              ? p.description_ecommerce
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/gi, ' ')
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
            vitrinaStock: vStock,
            almacenStock: aStock,
            recepcionStock: rStock,
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
        // Keep all products with positive stock (in Vitrina/Almacén) and valid price (> RD$1)
        .filter((p: ProductItem) => p.virtual_available > 0 && p.list_price > 1);

      products = mapped;
      const laptopCount = products.filter(p => p.category === 'laptop').length;

      appConfig.odoo.lastSync = new Date().toISOString();
      appConfig.odoo.connected = true;
      console.log(
        `[Odoo Real-Time Sync]: Loaded ${products.length} in-stock products (${laptopCount} laptops, ${vitrinaMap.size} in Vitrina, ${almacenMap.size} in Almacén; Recepción excluded)`
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
  if (!force && odooCustomersCache.length > 0 && now - lastOdooCustomersSync < 1000 * 60 * 5) {
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
    console.error(`[Odoo Create Customer Error]: ${err.message}`);
  }

  return null;
}

// ---------------------------------------------------------
// Helper: Evolution API Live WhatsApp Sync & Media Parser
// ---------------------------------------------------------
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
  let quotedMessage: QuotedMessage | undefined;
  const ctx =
    msgObj.extendedTextMessage?.contextInfo ||
    msgObj.imageMessage?.contextInfo ||
    msgObj.videoMessage?.contextInfo ||
    msgObj.audioMessage?.contextInfo ||
    msgObj.documentMessage?.contextInfo ||
    msgObj.stickerMessage?.contextInfo ||
    msgObj.interactiveMessage?.contextInfo ||
    msgObj.interactiveResponseMessage?.contextInfo ||
    msgObj.buttonsResponseMessage?.contextInfo ||
    msgObj.templateButtonReplyMessage?.contextInfo ||
    msgObj.listResponseMessage?.contextInfo ||
    rawMsgObj.contextInfo ||
    rawMsgObj.messageContextInfo ||
    rawMsgObj.extendedTextMessage?.contextInfo ||
    record.contextInfo ||
    record.message?.contextInfo ||
    record.message?.extendedTextMessage?.contextInfo ||
    record.quotedMessage ||
    record.quoted;

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

    if (qText || quotedId) {
      const partPhone = ctx?.participant
        ? String(ctx.participant).replace(/@.*$/, '').replace(/\D/g, '')
        : '';
      const isTodoLaptoAuthor =
        Boolean(ctx?.fromMe) ||
        (partPhone &&
          (partPhone === appConfig.evolution.teamPhone || partPhone === appConfig.evolution.adminPhone));

      quotedMessage = {
        id: quotedId,
        text: qText,
        type: qType,
        author: isTodoLaptoAuthor
          ? 'Todo Lapto'
          : partPhone
          ? `+${partPhone}`
          : customerNameFallback,
      };
    }
  } else if (ctx?.externalAdReply) {
    const adTitle = ctx.externalAdReply.title || 'Anuncio de Redes Sociales';
    const adBody = ctx.externalAdReply.body || ctx.externalAdReply.sourceUrl || '';
    quotedMessage = {
      id: quotedId,
      text: `${adTitle}${adBody ? ` — ${adBody}` : ''}`,
      type: 'text',
      author: '📢 Anuncio Citado',
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
  if (now - lastContactsSync < 1000 * 60 * 5 && evolutionContactsMap.size > 0) return;

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

async function syncEvolutionChats(): Promise<Conversation[]> {
  if (isEvoSyncRunning) return conversations;
  isEvoSyncRunning = true;

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

    // Pre-populate lidToPhoneMap from validChats that have remoteJidAlt
    for (const c of validChats) {
      const alt = c.lastMessage?.key?.remoteJidAlt;
      if (alt && alt.endsWith('@s.whatsapp.net')) {
        const altPhone = alt.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        if (altPhone) {
          lidToPhoneMap.set(c.remoteJid, altPhone);
          const lidDigits = c.remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
          lidToPhoneMap.set(lidDigits, altPhone);
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
        existingInLoop = dedupedByName.get(normName);
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
        (!isGenericName ? conversations.find(c => !isGenericContactName(c.customerName) && c.customerName.trim().toLowerCase() === normName) : undefined);

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

      let messages = prevConv?.messages || (parsedLast ? [parsedLast] : []);
      if (
        prevConv?.messagesLoaded &&
        parsedLast &&
        !messages.some(m => m.evolutionMessageId === parsedLast.evolutionMessageId)
      ) {
        messages = [...messages, parsedLast];
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
      if (normName && seenFinalNames.has(normName)) continue;

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

    // Flush any queued outbound messages that were waiting for Evolution's Baileys socket to finish reconnecting
    await flushPendingOutboundQueue();

    // Check top active conversations for unanswered recent customer messages and auto-reply with Sales Bot!
    if (appConfig.globalAiActive) {
      const nowMs = Date.now();
      for (const conv of conversations.slice(0, 15)) {
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (!lastMsg) continue;
        const msgId = lastMsg.evolutionMessageId || lastMsg.id;

        if (isFirstEvolutionSync) {
          // On initial server boot, mark all pre-existing messages as already seen so we only auto-reply to NEW incoming messages
          processedMessageIds.set(msgId, nowMs);
          continue;
        }

        if (!conv.aiEnabled) continue;
        // Skip WhatsApp groups and internal team/admin/support numbers
        if (
          isWhatsAppGroup(conv.sessionId) ||
          isWhatsAppGroup(conv.customerPhone) ||
          conv.sessionId === '270647783641294@lid' ||
          conv.customerName.toLowerCase().includes('soporte todo lapto') ||
          (conv.customerPhone &&
            (conv.customerPhone === appConfig.evolution.teamPhone ||
              conv.customerPhone === appConfig.evolution.adminPhone))
        ) {
          processedMessageIds.set(msgId, nowMs);
          continue;
        }

        const msgTimeMs = new Date(lastMsg.timestamp).getTime();
        const ageMs = nowMs - msgTimeMs;

        // If a brand new message in the thread is from the customer, arrived within the last 5 minutes, and hasn't been answered yet:
        if (
          lastMsg.sender === 'customer' &&
          ageMs <= 5 * 60 * 1000 &&
          !processedMessageIds.has(msgId) &&
          !inFlightBotSessions.has(conv.sessionId)
        ) {
          processedMessageIds.set(msgId, nowMs);
          triggerSalesBotReplyForConversation(conv, 'live_evolution_poll').catch(err =>
            console.log(`[Auto-Reply Poll Info for ${conv.customerName}]:`, err.message)
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

  const addCandidates = (arr?: ChatMessage[], localOnly = true) => {
    if (!arr) return;
    for (const m of arr) {
      if (!localOnly || !m.evolutionMessageId || m.id.startsWith('msg-') || m.id.startsWith('sim-')) {
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

  for (const localMsg of candidateLocals) {
    const localTime = new Date(localMsg.timestamp).getTime();
    const localText = (localMsg.content || '').trim();

    // Check if already in combined by ID or if Evolution API has indexed this exact sent message
    const existingIdx = combined.findIndex(evo => {
      if (evo.id === localMsg.id) return true;
      if (localMsg.evolutionMessageId && evo.evolutionMessageId === localMsg.evolutionMessageId) return true;
      if (
        evo.sender !== 'customer' &&
        localMsg.sender !== 'customer' &&
        localText.length > 0 &&
        (evo.content || '').trim() === localText &&
        Math.abs(new Date(evo.timestamp).getTime() - localTime) < 300000
      ) {
        return true;
      }
      return false;
    });

    if (existingIdx >= 0) {
      // Preserve local quotedMessage or mediaUrl if Evolution API record didn't include it
      if (localMsg.quotedMessage && !combined[existingIdx].quotedMessage) {
        combined[existingIdx].quotedMessage = localMsg.quotedMessage;
      }
      if (localMsg.mediaUrl && !combined[existingIdx].mediaUrl) {
        combined[existingIdx].mediaUrl = localMsg.mediaUrl;
      }
    } else {
      combined.push(localMsg);
    }
  }

  combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return combined;
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
  if (conv?.customerPhone) {
    const phoneJid = `${conv.customerPhone}@s.whatsapp.net`;
    if (!otherSessionIds.has(phoneJid)) {
      jidSet.add(phoneJid);
    }
  }

  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findMessages/${appConfig.evolution.instance}`;
    const responses = await Promise.all(
      Array.from(jidSet).map(jid =>
        fetch(url, {
          method: 'POST',
          headers: {
            apikey: appConfig.evolution.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            where: { key: { remoteJid: jid } },
            limit: 80,
          }),
        })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );

    const records: any[] = [];
    for (const data of responses) {
      if (!data) continue;
      const recs = data?.messages?.records || (Array.isArray(data) ? data : []);
      records.push(...recs);
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
      // Only update lastTimestamp/lastMessagePreview if there is a locally sent message newer than conv.lastTimestamp
      const latest = mergedMessages[mergedMessages.length - 1];
      const hasLocalSent = (localSentMessagesBySession.get(canonicalId)?.length || 0) > 0;
      if (
        hasLocalSent &&
        latest &&
        new Date(latest.timestamp).getTime() > new Date(conv.lastTimestamp).getTime()
      ) {
        conv.lastTimestamp = latest.timestamp;
        conv.lastMessagePreview = latest.content || conv.lastMessagePreview;
        conv.lastMessageType = latest.type;
      }
    }

    return mergedMessages;
  } catch {
    return mergeWithLocalMessages(canonicalId, [], conv?.messages || [], conv?.customerPhone);
  }
}

// ---------------------------------------------------------
// Helper: Evolution API WhatsApp Senders (Text, Media, Audio) with Auto-Reconnect & Retry Queue
// ---------------------------------------------------------
let isFirstEvolutionSync = true;
const inFlightBotSessions = new Set<string>();
const pendingOutboundQueue = new Map<string, { conv: Conversation; text: string; attempts: number }>();
let lastEvolutionRestartMs = 0;

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
      const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, { headers });
      if (stateRes.ok) {
        const data = await stateRes.json().catch(() => null);
        const state = data?.instance?.state || data?.state;
        if (state === 'open') {
          appConfig.evolution.connected = true;
          return true;
        }
      }
    }

    // When Baileys throws "Connection Closed" even though connectionState cached "open",
    // trigger POST /instance/restart/{instance} + GET /instance/connect/{instance} (with 15s cooldown)
    const now = Date.now();
    if (now - lastEvolutionRestartMs > 15000) {
      lastEvolutionRestartMs = now;
      await fetch(`${baseUrl}/instance/restart/${instance}`, { method: 'POST', headers }).catch(() => null);
      await sleepMs(1500);
      await fetch(`${baseUrl}/instance/connect/${instance}`, { headers }).catch(() => null);
      await sleepMs(2000);
    } else {
      await sleepMs(1800);
    }

    const verifyRes = await fetch(`${baseUrl}/instance/connectionState/${instance}`, { headers });
    if (verifyRes.ok) {
      const vData = await verifyRes.json().catch(() => null);
      const vState = vData?.instance?.state || vData?.state;
      if (vState === 'open') {
        appConfig.evolution.connected = true;
        return true;
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
  delayMs = 500
): Promise<{ ok: boolean; socketClosed: boolean }> {
  if (isWhatsAppGroup(numberOrJid)) {
    console.log(`🛡️ [Grupo bloqueado]: Envío a grupo cancelado (${numberOrJid})`);
    return { ok: false, socketClosed: false };
  }
  const target = normalizeEvolutionTarget(numberOrJid);
  if (!target || isWhatsAppGroup(target)) {
    return { ok: false, socketClosed: false };
  }
  const url = `${appConfig.evolution.serverUrl.replace(/\/$/, '')}/message/sendText/${appConfig.evolution.instance}`;

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      });

      if (res.ok) {
        appConfig.evolution.connected = true;
        return { ok: true, socketClosed: false };
      }

      const errBody = await res.text().catch(() => '');
      const isSocketClosed =
        /Connection Closed|Connection Failure|Timed Out|Stream Errored|Precondition Required/i.test(errBody) ||
        res.status >= 500;

      if (isSocketClosed) {
        if (attempt < maxAttempts) {
          await ensureEvolutionInstanceConnected(true);
          continue;
        }
        return { ok: false, socketClosed: true };
      }

      return { ok: false, socketClosed: false };
    } catch {
      if (attempt < maxAttempts) {
        await sleepMs(1200);
        continue;
      }
      return { ok: false, socketClosed: true };
    }
  }
  return { ok: false, socketClosed: false };
}

async function sendEvolutionMessage(numberOrJid: string, text: string, delayMs = 500): Promise<boolean> {
  const res = await sendEvolutionMessageWithStatus(numberOrJid, text, delayMs);
  return res.ok;
}

async function sendEvolutionMessageToConversation(
  conv: Conversation,
  text: string,
  delayMs = 600,
  isRetryFromQueue = false
): Promise<boolean> {
  // Never send automated or bot messages to WhatsApp groups
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`🛡️ [Grupo bloqueado]: Envío a grupo cancelado para sesión ${conv.sessionId}`);
    pendingOutboundQueue.delete(conv.sessionId);
    return false;
  }

  const candidates: string[] = [];

  // 1. If customerPhone is a valid 10-13 digit phone number (e.g. 1809..., 1829..., 1849...), try it first
  const cleanPhone = (conv.customerPhone || '').replace(/\D/g, '');
  if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    candidates.push(std);
    if (!candidates.includes(`${std}@s.whatsapp.net`)) {
      candidates.push(`${std}@s.whatsapp.net`);
    }
  }

  // 2. Try canonical sessionId
  if (conv.sessionId && !candidates.includes(conv.sessionId)) {
    candidates.push(conv.sessionId);
  }

  // 3. Try any related JIDs (@s.whatsapp.net or @lid) mapped to this conversation
  const related = relatedJidsBySession.get(conv.sessionId);
  if (related) {
    for (const jid of related) {
      if (jid && !candidates.includes(jid)) {
        candidates.push(jid);
      }
    }
  }

  // 4. If customerPhone is a 14+ digit LID, add @lid candidate
  if (cleanPhone.length >= 14 && !candidates.includes(`${cleanPhone}@lid`)) {
    candidates.push(`${cleanPhone}@lid`);
  }

  for (const target of candidates) {
    const { ok, socketClosed } = await sendEvolutionMessageWithStatus(target, text, delayMs);
    if (ok) {
      pendingOutboundQueue.delete(conv.sessionId);
      console.log(`✅ [WhatsApp Bot Sent]: Respuesta entregada a ${conv.customerName} (${target})`);
      return true;
    }
    // If Evolution API's own WhatsApp socket is temporarily disconnected, stop trying alternate JIDs immediately
    // and let the pendingOutboundQueue deliver as soon as the socket reconnects.
    if (socketClosed) {
      break;
    }
  }

  // Queue for automatic delivery on next poll once Evolution API's Baileys socket finishes reconnecting
  if (!isRetryFromQueue) {
    pendingOutboundQueue.set(conv.sessionId, { conv, text, attempts: 1 });
    console.log(
      `⏳ [WhatsApp Queue]: Respuesta para ${conv.customerName} programada para entrega automática al reconectar WhatsApp.`
    );
  }
  return false;
}

async function flushPendingOutboundQueue(): Promise<void> {
  if (pendingOutboundQueue.size === 0) return;
  const isOpen = await ensureEvolutionInstanceConnected(false);
  if (!isOpen) return;

  for (const [sessionId, item] of Array.from(pendingOutboundQueue.entries())) {
    const delivered = await sendEvolutionMessageToConversation(item.conv, item.text, 500, true);
    if (delivered) {
      pendingOutboundQueue.delete(sessionId);
    } else {
      item.attempts += 1;
      if (item.attempts >= 12) {
        pendingOutboundQueue.delete(sessionId);
      }
    }
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
    return res.ok;
  } catch (err: any) {
    console.log(`[Evolution API Send Media Info]: ${err.message}`);
    return false;
  }
}

async function sendEvolutionAudio(numberOrJid: string, base64Audio: string): Promise<boolean> {
  const target = numberOrJid.includes('@') ? numberOrJid : numberOrJid.replace(/\D/g, '');
  const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, '');
  const url = `${appConfig.evolution.serverUrl}/message/sendWhatsAppAudio/${appConfig.evolution.instance}`;

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
    return res.ok;
  } catch (err: any) {
    console.log(`[Evolution API Send Audio Info]: ${err.message}`);
    return false;
  }
}

async function fetchMediaBase64FromEvolution(
  messageId: string,
  convertToMp4 = false
): Promise<{ buffer: Buffer; mimetype: string; base64: string } | null> {
  const cacheKey = `${messageId}_${convertToMp4}`;
  if (mediaCache.has(cacheKey)) {
    const cached = mediaCache.get(cacheKey)!;
    return { ...cached, base64: cached.buffer.toString('base64') };
  }

  const url = `${appConfig.evolution.serverUrl}/chat/getBase64FromMediaMessage/${appConfig.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: appConfig.evolution.apiKey,
      },
      body: JSON.stringify({
        message: { key: { id: messageId } },
        convertToMp4,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.base64) return null;

    const buffer = Buffer.from(data.base64, 'base64');
    const mimetype = data.mimetype || (convertToMp4 ? 'video/mp4' : 'application/octet-stream');

    // Keep cache bounded to 50 items
    if (mediaCache.size > 50) {
      const firstKey = mediaCache.keys().next().value;
      if (firstKey) mediaCache.delete(firstKey);
    }
    mediaCache.set(cacheKey, { buffer, mimetype });

    return { buffer, mimetype, base64: data.base64 };
  } catch (err: any) {
    console.error(`[Evolution Media Fetch Error for ${messageId}]:`, err.message);
    return null;
  }
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

  const readyToSendLaptopCatalog = laptops
    .map(
      (p, idx) =>
        `*${idx + 1}.* *${p.name}*\n💰 RD$${p.list_price.toLocaleString()} | 📦 ${p.virtual_available} unidad(es) | 🏷️ ${p.condition === 'Nuevo' ? 'Nuevo' : 'Reacondicionado Clase A'}${p.specsSummary ? `\n⚙️ ${p.specsSummary.slice(0, 90)}` : ''}\n🔗 https://todolapto.com.do${p.website_url || ''}`
    )
    .join('\n\n');

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
  * REGLA DE FILTRADO INTELIGENTE:
    1) Si piden catálogo general de una categoría ("qué laptops tienen", "qué monitores tienen", etc.) SIN especificar marca, precio ni uso -> Envía TODOS los modelos de esa categoría completos del *1.* al último sin cortar en 10.
    2) Si piden una MARCA específica (ej. Dell, Lenovo, HP, Asus, Acer, ThinkPad, Latitude, Chromebook) -> Envía ÚNICAMENTE los modelos de esa marca.
    3) Si piden un PRECIO o PRESUPUESTO específico (ej. 10,000 pesos, menos de 8 mil, entre 10 y 15 mil) -> Envía ÚNICAMENTE los modelos dentro de ese rango de precio.
    4) Si piden para un USO específico (ej. Oficina/Trabajo/Contabilidad, Gaming/Juegos, Estudios/Escuela, Programación/Diseño) -> Envía ÚNICAMENTE los modelos recomendados para ese uso.
    5) Si preguntan si son NUEVOS o USADOS/REACONDICIONADOS -> Indica con total transparencia la condición exacta marcada en Odoo de cada equipo (las laptops corporativas son Reacondicionadas Importadas Clase A probadas en 25 puntos con 6 meses de garantía; los equipos o accesorios marcados como Nuevos tienen 1 año de garantía).
- Tablets, iPads y Celulares en stock: ${tabletsMoviles.length}
- Repetidores y Redes: ${redes.length}
- Monitores y Pantallas: ${monitores.length}
- Impresoras y Tintas: ${impresoras.length}
- Discos SSD, Discos Duros y Memorias RAM: ${discosRam.length}
- Cargadores y Baterías de Laptop: ${cargadoresBaterias.length}
- Total Accesorios y Repuestos en stock: ${allAccesorios.length}

=== LAPTOPS Y EQUIPOS PORTÁTILES (${laptops.length} MODELOS DISPONIBLES CON MARCA, CONDICIÓN, SPECS Y USO) ===
${formatNumberedList(laptops)}

=== FORMATO LISTO PARA ENVIAR CUANDO PIDAN EL CATÁLOGO GENERAL COMPLETO DE LAPTOPS (SOLO CUANDO NO HAYA FILTRO DE MARCA, PRECIO NI USO) ===
🖥️ *Catálogo completo de laptops — Todo Lapto*

*(${laptops.length} modelos disponibles en stock real)*

${readyToSendLaptopCatalog}

*¿Cuál te interesa? Te ayudo a procesarlo ahora mismo.* 🛒

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

// Search all Odoo products dynamically based on customer message, brand, budget, condition & use case
function getRelevantProductsHighlight(latestQueryText: string, fullContextText = ''): string {
  if ((!latestQueryText && !fullContextText) || products.length === 0) return '';
  // Strip any internal prompt wrapper headers if present so we only analyze the user's real words
  const userOnlyLatest = latestQueryText
    .replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:/gi, '')
    .trim();
  const cleanLatest = userOnlyLatest.toLowerCase();
  const inStock = products.filter(p => p.virtual_available > 0 && p.list_price > 1);
  const laptopsInStock = [...inStock.filter(p => p.category === 'laptop')].sort(
    (a, b) => a.list_price - b.list_price
  );

  const sections: string[] = [];

  // Detect active filters in the customer's current message
  const brandFilter = detectRequestedBrandOrLine(userOnlyLatest);
  const budgetFilter = extractBudgetQuery(userOnlyLatest);
  const useCaseFilter = detectRequestedUseCase(userOnlyLatest);
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

  // 2. Apply Combined or Individual Smart Filters (Brand, Budget, Use Case)
  if (brandFilter || budgetFilter || useCaseFilter || wantsOnlyNew) {
    const wantsSpecificNonLaptopCategory =
      /\b(monitor|monitores|pantalla)\b/i.test(cleanLatest)
        ? 'monitor'
        : /\b(impresora|impresoras)\b/i.test(cleanLatest)
        ? 'impresora'
        : /\b(router|repetidor|wifi|red)\b/i.test(cleanLatest)
        ? 'red'
        : null;

    let filtered = wantsSpecificNonLaptopCategory
      ? inStock.filter(p => p.category === wantsSpecificNonLaptopCategory)
      : [...laptopsInStock];

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
        filtered = inStock.filter(brandFilter.matcher);
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
      const readyFilteredList = filtered.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n');

      sections.push(
        `=== 🎯 FILTRO ESTRICTO ACTIVO (${filterTitle}) — MOSTRAR ÚNICAMENTE ESTOS ${filtered.length} MODELOS ===
⚠️ INSTRUCCIÓN OBLIGATORIA PARA LA IA:
El cliente solicitó un filtro específico (${filterTitle}).
${useCaseFilter ? `💡 Argumento de venta para este uso: ${useCaseFilter.pitch}\n` : ''}1. Debes enviar **ÚNICAMENTE** estos ${filtered.length} productos filtrados (del *1.* al *${filtered.length}.*).
2. **ESTÁ ESTRICTAMENTE PROHIBIDO** enviar el catálogo general de 38 laptops cuando el cliente pidió una marca, precio o uso específico.
3. Incluye en cada opción su precio en RD$, stock, condición (Nuevo o Reacondicionado Clase A), especificaciones clave y su link directo sin corchetes Markdown.

LISTA FILTRADA LISTA PARA ENVIAR AL CLIENTE (${filtered.length} opciones):

${readyFilteredList}`
      );
    } else {
      sections.push(
        `=== ⚠️ SIN COINCIDENCIAS EXACTAS PARA EL FILTRO (${activeFilterLabels.join(' + ')}) ===
Informa cordialmente al cliente que en este momento no tenemos un modelo exacto con esa combinación en stock, y muéstrale las 3 opciones más cercanas disponibles en nuestro inventario real.`
      );
    }
  }

  // 3. Check if customer is asking for a complete non-laptop category (e.g. Monitores, Impresoras, Redes, Tablets, SSD/RAM, Mouse/Teclados)
  if (!brandFilter && !budgetFilter && !useCaseFilter) {
    if (/\b(monitor|monitores)\b/i.test(cleanLatest)) {
      const mons = inStock.filter(p => p.category === 'monitor').sort((a, b) => a.list_price - b.list_price);
      if (mons.length > 0) {
        sections.push(
          `=== 🎯 CATÁLOGO COMPLETO DE MONITORES SOLICITADO (${mons.length} disponibles) — ENVIAR TODOS ===\n` +
            mons.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n')
        );
      }
    } else if (/\b(impresora|impresoras)\b/i.test(cleanLatest)) {
      const imps = inStock.filter(p => p.category === 'impresora').sort((a, b) => a.list_price - b.list_price);
      if (imps.length > 0) {
        sections.push(
          `=== 🎯 CATÁLOGO COMPLETO DE IMPRESORAS Y TINTAS SOLICITADO (${imps.length} disponibles) — ENVIAR TODOS ===\n` +
            imps.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n')
        );
      }
    } else if (/\b(tablet|tablets|ipad|ipads)\b/i.test(cleanLatest)) {
      const tabs = inStock
        .filter(p => /tablet|ipad|galaxy tab|fire 8|tab 910|alcatel 1t/i.test(`${p.name} ${p.odooCategory || ''}`))
        .sort((a, b) => a.list_price - b.list_price);
      if (tabs.length > 0) {
        sections.push(
          `=== 🎯 CATÁLOGO COMPLETO DE TABLETS E IPADS SOLICITADO (${tabs.length} disponibles) — ENVIAR TODOS ===\n` +
            tabs.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n')
        );
      }
    } else if (/\b(repetidor|repetidores|router|routers|antena\s*wifi)\b/i.test(cleanLatest)) {
      const reds = inStock.filter(p => p.category === 'red').sort((a, b) => a.list_price - b.list_price);
      if (reds.length > 0) {
        sections.push(
          `=== 🎯 CATÁLOGO COMPLETO DE REPETIDORES Y REDES SOLICITADO (${reds.length} disponibles) — ENVIAR TODOS ===\n` +
            reds.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join('\n\n')
        );
      }
    }
  }

  // 4. General Keyword & Model Search across all 600+ products
  const stopWords = new Set([
    'hola', 'buenos', 'dias', 'tardes', 'noches', 'quiero', 'tienen', 'tiene', 'busco',
    'para', 'como', 'cual', 'cuales', 'precio', 'precios', 'cuanto', 'cuesta', 'vale',
    'disponible', 'disponibles', 'todo', 'una', 'uno', 'unos', 'unas', 'por',
    'favor', 'gracias', 'saludos', 'info', 'informacion', 'pesos', 'mil', 'tengo', 'presupuesto'
  ]);

  const searchSource = `${userOnlyLatest} ${fullContextText}`.toLowerCase();
  const tokens = searchSource
    .replace(/[^\wáéíóúñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  if (tokens.length > 0) {
    const scored: { product: ProductItem; score: number }[] = [];

    for (const p of inStock) {
      const hay = `${p.name} ${p.brand || ''} ${p.condition || ''} ${p.specsSummary || ''} ${p.description_sale || ''} ${(p.useCases || []).join(' ')} ${p.category} ${p.odooCategory || ''}`.toLowerCase();
      let score = 0;
      for (const tk of tokens) {
        if (hay.includes(tk)) {
          score += tk.length >= 4 ? 3 : 1;
        }
        if ((tk === 'lapto' || tk === 'laptop' || tk === 'laptops' || tk === 'computadora') && p.category === 'laptop') {
          score += 5;
        }
      }
      if (score > 0) {
        scored.push({ product: p, score });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.product.list_price - b.product.list_price);
    const topMatches = scored.slice(0, 40).map(s => s.product);
    if (topMatches.length > 0) {
      sections.push(
        `=== COINCIDENCIAS DIRECTAS EN INVENTARIO ODOO PARA LA CONSULTA ACTUAL (${topMatches.length} encontrados) ===\n` +
          topMatches
            .map(
              (p, idx) =>
                `${idx + 1}. ${p.name} | ID:${p.variantId || p.id} | Marca:${p.brand || '-'} | Condición:${p.condition || 'Reacondicionado'} (${p.conditionDetail || '6 meses garantía'}) | Precio: RD$${p.list_price.toLocaleString()} | Stock: ${p.virtual_available} unidad(es) (Vitrina: ${p.vitrinaStock || 0}, Almacén: ${p.almacenStock || 0}) | Uso: ${(p.useCases || []).join(', ')} | Specs: ${p.specsSummary || p.description_sale || '-'} | Link: https://todolapto.com.do${p.website_url || ''}`
            )
            .join('\n')
      );
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

app.post('/api/config', (req, res) => {
  const { globalAiActive, aiProvider, odoo, evolution, supabase, holidayOverrides } = req.body;
  if (globalAiActive !== undefined) appConfig.globalAiActive = Boolean(globalAiActive);
  if (aiProvider) {
    appConfig.aiProvider = { ...appConfig.aiProvider, ...aiProvider };
    rejectedOpenAiKeys.clear();
    rejectedDeepseekKeys.clear();
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

  savePersistedConfig();
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncConfigToSupabase(appConfig).catch(() => {});
  }
  broadcastEvent('config_updated', appConfig);
  res.json({ success: true, config: appConfig });
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

// Test Active AI Provider (Gemini, OpenAI, DeepSeek)
app.post('/api/ai/test-provider', async (req, res) => {
  const {
    provider,
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
    deepseekApiKey,
    deepseekBaseUrl,
    geminiApiKey,
  } = req.body;

  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: provider || appConfig.aiProvider?.provider || 'gemini',
    model: model || appConfig.aiProvider?.model || 'gemini-3.8-flash',
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? '',
    ...(openaiApiKey !== undefined ? { openaiApiKey } : {}),
    ...(openaiBaseUrl !== undefined ? { openaiBaseUrl } : {}),
    ...(deepseekApiKey !== undefined ? { deepseekApiKey } : {}),
    ...(deepseekBaseUrl !== undefined ? { deepseekBaseUrl } : {}),
    ...(geminiApiKey !== undefined ? { geminiApiKey } : {}),
  };

  rejectedOpenAiKeys.clear();
  rejectedDeepseekKeys.clear();
  savePersistedConfig();

  const requested = appConfig.aiProvider.provider;
  if (requested === 'openai' && !appConfig.aiProvider.openaiApiKey && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'MY_OPENAI_API_KEY')) {
    return res.json({
      success: false,
      message: 'Por favor ingresa tu API Key de OpenAI (sk-...) en el campo de credenciales para conectar con OpenAI.',
    });
  }
  if (requested === 'deepseek' && !appConfig.aiProvider.deepseekApiKey && (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'MY_DEEPSEEK_API_KEY')) {
    return res.json({
      success: false,
      message: 'Por favor ingresa tu API Key de DeepSeek (sk-...) en el campo de credenciales para conectar con DeepSeek.',
    });
  }

  try {
    const result = await generateTextWithConfiguredAI({
      prompt: 'Responde en una sola línea confirmando que estás activo para vender laptops en Todo Lapto.',
      systemInstruction: 'Eres el motor de inteligencia artificial de Vendemá CRM para Todo Lapto.',
      allowFallback: false,
    });

    res.json({
      success: true,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      message: `Motor ${result.providerUsed.toUpperCase()} (${result.modelUsed}) conectado y guardado: "${result.text.trim()}"`,
    });
  } catch (err: any) {
    try {
      const fallbackResult = await generateTextWithConfiguredAI({
        prompt: 'Responde en una sola línea confirmando que estás activo para vender laptops en Todo Lapto.',
        systemInstruction: 'Eres el motor de inteligencia artificial de Vendemá CRM para Todo Lapto.',
        allowFallback: true,
      });
      res.json({
        success: false,
        providerUsed: fallbackResult.providerUsed,
        modelUsed: fallbackResult.modelUsed,
        message: `${err.message}. Mientras actualizas la clave, el Bot de Ventas está respondiendo tus chats de WhatsApp automáticamente con el motor integrado (${fallbackResult.providerUsed.toUpperCase()} ${fallbackResult.modelUsed}).`,
      });
    } catch {
      res.json({
        success: false,
        message: `No se pudo conectar con ${requested.toUpperCase()}: ${err.message}`,
      });
    }
  }
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

// 4. Live Conversations & Chat Management
app.get('/api/conversations', async (req, res) => {
  if (conversations.length === 0 || req.query.refresh === 'true') {
    await syncEvolutionChats();
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
  try {
    const rawSessionId = req.params.sessionId || (req.query.sessionId as string) || '';
    const sessionId = decodeURIComponent(rawSessionId).trim();
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
    console.error('[Load Messages Error]:', err.message);
    res.json({
      success: false,
      message: err.message,
      sessionId: req.params.sessionId,
      messages: [],
    });
  }
});

app.get('/api/messages', async (req, res) => {
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

  // Deliver to WhatsApp via Evolution API in background (with auto-retry queue) so UI never blocks
  sendEvolutionMessageToConversation(conv, content, 400).catch(() => {});
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
    sendEvolutionMessageToConversation(conv, caption, 400).catch(() => {});
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

// 5. AI Voice Note Transcription & Multimodal Image/Video Analysis
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: media.mimetype.split(';')[0] || 'audio/ogg',
              data: media.base64,
            },
          },
          { text: 'Transcribe este mensaje de voz en español con exactitud.' },
        ],
      },
    });

    const transcript = (response.text || '').trim() || '[Audio sin voz detectable]';
    transcriptionsByMsgId.set(messageId, transcript);

    if (sessionId) {
      const conv = conversations.find(c => c.sessionId === sessionId);
      const msg = conv?.messages.find(m => m.evolutionMessageId === messageId);
      if (msg) {
        msg.transcription = transcript;
        msg.content = `🎤 "${transcript}"`;
      }
    }

    res.json({ success: true, transcription: transcript });
  } catch (err: any) {
    console.error('[Transcribe Audio Error]:', err);
    res.status(500).json({ success: false, message: err.message });
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: media.mimetype.split(';')[0] || 'image/jpeg',
              data: media.base64,
            },
          },
          {
            text: `Analiza esta imagen enviada por un cliente a Todo Lapto (República Dominicana).
Indica en español de forma concisa (máximo 3 líneas):
1. ¿Es un comprobante de pago bancario (monto, banco, referencia), un producto/laptop (marca, modelo), o un equipo para reparación?
2. Recomendación de acción inmediata para el vendedor.`,
          },
        ],
      },
    });

    const analysis = (response.text || '').trim();
    aiAnalysisByMsgId.set(messageId, analysis);

    if (sessionId) {
      const conv = conversations.find(c => c.sessionId === sessionId);
      const msg = conv?.messages.find(m => m.evolutionMessageId === messageId);
      if (msg) {
        msg.aiAnalysis = analysis;
      }
    }

    res.json({ success: true, analysis });
  } catch (err: any) {
    console.error('[Analyze Media Error]:', err);
    res.status(500).json({ success: false, message: err.message });
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

// Helper: Build Master System Instruction with Live Odoo Inventory, Customer Phone & Learned Brain
function buildMasterSalesSystemInstruction(conv?: Conversation, latestQuery = ''): string {
  const rawTemplate = appConfig.aiProvider?.systemPrompt || OFFICIAL_TODO_LAPTO_MASTER_PROMPT;
  const cleanPhone = (conv?.customerPhone || '').replace(/\D/g, '');
  // Only treat 10-13 digit numbers as valid phone numbers (14+ digits are WhatsApp @lid IDs)
  const detectedPhone =
    cleanPhone.length >= 10 && cleanPhone.length <= 13
      ? cleanPhone.length === 10
        ? `1${cleanPhone}`
        : cleanPhone
      : 'NO DISPONIBLE';

  const lastMsg = conv?.messages[conv.messages.length - 1];
  const searchContext = [
    latestQuery,
    lastMsg?.quotedMessage?.text || '',
    conv?.lastMessagePreview || '',
    ...(conv?.messages
      .slice(-6)
      .map(m => `${m.quotedMessage?.text || ''} ${m.transcription || m.content}`) || []),
  ].join(' ');

  const relevantHighlight = getRelevantProductsHighlight(latestQuery, searchContext);
  const inventoryContext = `${relevantHighlight ? relevantHighlight + '\n\n' : ''}${getLiveInventoryString()}`;
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
  const rdTimeContext = getDominicanTimeContext(new Date(), appConfig.holidayOverrides || []);
  const rdTimePromptBlock = buildDominicanTimePromptContext(new Date(), appConfig.holidayOverrides || []);

  const filledInstruction =
    rdTimePromptBlock +
    '\n\n' +
    rawTemplate
      .replace(/\{\{\s*\$json\.telefono_cliente[^}]*\}\}/g, detectedPhone)
      .replace(/\{\{TELEFONO_CLIENTE\}\}/g, detectedPhone)
      .replace(/\{\{\s*\$json\.inventario_completo\s*\}\}/g, inventoryContext)
      .replace(/\{\{INVENTARIO_COMPLETO\}\}/g, inventoryContext)
      .replace(/\{\{APRENDIZAJE_CEREBRO_IA\}\}/g, learnedContext)
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

    // In assistant turns, if a previous message contained the entire 38-laptop catalog (> 1000 chars),
    // shorten it in history so it doesn't trigger the model to repeat all 38 laptops again!
    if (role === 'assistant' && text.includes('Catálogo completo de laptops') && text.length > 800) {
      text = text.slice(0, 400) + '\n... [Opciones de laptops enviadas previamente con modelos desde RD$4,000 en vitrina]';
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

  if (inFlightBotSessions.has(conv.sessionId)) {
    return { success: false, error: 'Ya se está generando una respuesta para este chat' };
  }
  inFlightBotSessions.add(conv.sessionId);

  try {
    // 1. Ensure Odoo inventory is loaded
    if (products.length === 0) {
      await syncOdooInventory();
    }

    // 2. Load full WhatsApp conversation history from Evolution API so the bot has complete context
    await loadEvolutionMessagesForChat(conv.sessionId);

    const lastMsg = conv.messages[conv.messages.length - 1];
    if (!lastMsg) {
      return { success: false, error: 'Sin mensajes en la conversación' };
    }

    // If triggered by background poll, double-check that the last message in the full thread is from the customer
    if (triggerSource === 'live_evolution_poll' && lastMsg.sender !== 'customer') {
      return { success: false, error: 'El último mensaje ya fue respondido por el equipo o el bot' };
    }

    // 3. Auto-transcribe if the customer sent a voice note!
    if (lastMsg.type === 'audio' && lastMsg.evolutionMessageId && !lastMsg.transcription) {
      try {
        const media = await fetchMediaBase64FromEvolution(lastMsg.evolutionMessageId, false);
        if (media) {
          const trRes = await ai.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                { inlineData: { mimeType: media.mimetype.split(';')[0] || 'audio/ogg', data: media.base64 } },
                { text: 'Transcribe este mensaje de voz en español con exactitud.' },
              ],
            },
          });
          const trText = (trRes.text || '').trim();
          if (trText) {
            lastMsg.transcription = trText;
            lastMsg.content = `🎤 "${trText}"`;
            transcriptionsByMsgId.set(lastMsg.evolutionMessageId, trText);
          }
        }
      } catch (e: any) {
        console.warn('[Auto-Transcribe Audio Warning]:', e.message);
      }
    }

    // 4. Auto-analyze if the customer sent an image (payment receipt, laptop photo, damaged screen)!
    if (lastMsg.type === 'image' && lastMsg.evolutionMessageId && !lastMsg.aiAnalysis) {
      try {
        const media = await fetchMediaBase64FromEvolution(lastMsg.evolutionMessageId, false);
        if (media) {
          const imgRes = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: {
              parts: [
                { inlineData: { mimeType: media.mimetype.split(';')[0] || 'image/jpeg', data: media.base64 } },
                {
                  text: 'Analiza esta imagen enviada por el cliente a Todo Lapto. Indica si es un comprobante de pago (banco, monto, referencia), una foto de laptop/producto, o un equipo para reparación, y describe todos los detalles visibles.',
                },
              ],
            },
          });
          const analysis = (imgRes.text || '').trim();
          if (analysis) {
            lastMsg.aiAnalysis = analysis;
            aiAnalysisByMsgId.set(lastMsg.evolutionMessageId, analysis);
          }
        }
      } catch (e: any) {
        console.warn('[Auto-Analyze Image Warning]:', e.message);
      }
    }

    const baseCustomerText =
      lastMsg.transcription ||
      (lastMsg.aiAnalysis
        ? `${lastMsg.content || '📷 [Imagen enviada]'}\n[Contenido de la imagen: ${lastMsg.aiAnalysis}]`
        : lastMsg.content) ||
      'Hola, me gustaría recibir información.';

    const hasQuote = Boolean(lastMsg.quotedMessage?.text?.trim());
    const quotedBlock = hasQuote
      ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACIÓN]
Autor del mensaje citado: ${lastMsg.quotedMessage!.author || 'Todo Lapto'}
Contenido del mensaje anterior que el cliente está citando:
"""
${lastMsg.quotedMessage!.text}
"""

Mensaje actual del cliente sobre esta cita anterior:
"${baseCustomerText}"

⚠️ REGLAS OBLIGATORIAS PARA ESTA CITA:
1. El cliente pregunta o se refiere a lo conversado anteriormente (la visita acordada a la tienda física de la Charles de Gaulle No. 133 o las opciones de laptops). NO está citando un error ni pidiendo un catálogo nuevo.
2. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
3. Responde de forma cálida, humana y concisa (máximo 2 a 4 líneas):
   - Confirma de inmediato que sí recuerdas: "¡Claro que sí, ${conv.customerName}! Recuerdo perfectamente [lo que conversamos sobre tu visita a la tienda / las opciones de laptops que te mostré]."
   - Confirma que las opciones siguen disponibles en nuestra tienda de la Av. Charles de Gaulle No. 133.
   - Haz una pregunta directa para cerrar o coordinar: "¿Tienes pensado pasar hoy por la tienda para apartarte el equipo, o prefieres que coordinemos el envío directo a tu dirección?"
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos. Tienes todo el contexto citado e inventario en tiempo real.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
      : '';

    const customerMessageText = quotedBlock
      ? `${quotedBlock}\nConsulta del cliente: "${baseCustomerText}"`
      : baseCustomerText;

    const systemInstruction = buildMasterSalesSystemInstruction(conv, customerMessageText);
    const historyTurns = buildChatHistoryTurns(conv);
    // Remove last turn from historyTurns if it's the customer message we're passing in `prompt`
    if (historyTurns.length > 0 && historyTurns[historyTurns.length - 1].role === 'user') {
      historyTurns.pop();
    }

    console.log(
      `🤖 [Sales Bot Generating Reply (${triggerSource})]: Cliente="${conv.customerName}" | Citando="${hasQuote ? 'SÍ' : 'NO'}" | Motor=${appConfig.aiProvider?.provider} (${appConfig.aiProvider?.model})`
    );

    const aiResult = await generateTextWithConfiguredAI({
      prompt: `Mensaje actual del cliente (${conv.customerName}):\n${customerMessageText}\n\nResponde ahora como el Agente Oficial de Ventas de Todo Lapto siguiendo las 36 reglas y el estado de horario/apertura en RD, usando únicamente productos y precios reales del catálogo y guiando activamente al cliente hacia la compra:`,
      systemInstruction,
      chatMessages: historyTurns,
      allowFallback: true,
    });

    const { cleanText, toolsExecuted } = await processAndExecuteCrmTools(aiResult.text || '', conv);
    const aiReply =
      cleanText ||
      '¡Hola! Bienvenido a *Todo Lapto* 💻. Con gusto te ayudo. ¿Buscas una laptop para trabajo, estudios o uso diario, o algún accesorio en particular?';

    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'assistant',
      type: 'text',
      content: aiReply,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    recordLocalMessage(conv.sessionId, assistantMessage, conv.customerPhone);
    conv.messages.push(assistantMessage);
    conv.lastTimestamp = assistantMessage.timestamp;
    conv.lastMessagePreview = aiReply;
    conv.lastMessageType = 'text';

    broadcastEvent('new_message', { sessionId: conv.sessionId, message: assistantMessage });
    broadcastEvent('conversations_update', { count: conversations.length });

    // Send to WhatsApp via Evolution API using smart JID/phone resolution
    const sentOk = await sendEvolutionMessageToConversation(conv, aiReply, 700);

    return {
      success: true,
      reply: aiReply,
      providerUsed: aiResult.providerUsed,
      modelUsed: aiResult.modelUsed,
      toolsExecuted,
      sentToWhatsApp: sentOk,
    };
  } catch (err: any) {
    console.log(`[Sales Bot Info for ${conv.customerName}]:`, err.message);
    return { success: false, error: err.message };
  } finally {
    inFlightBotSessions.delete(conv.sessionId);
  }
}

// AI Sales Assistant Suggestion Endpoint (Generates draft in composer without sending)
app.post('/api/ai/generate-reply', async (req, res) => {
  const { sessionId, userMessage } = req.body;
  const conv = conversations.find(c => c.sessionId === sessionId);

  if (products.length === 0) {
    await syncOdooInventory();
  }

  if (conv && !conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(conv.sessionId);
  }

  const lastMsg = conv?.messages[conv.messages.length - 1];
  const baseText = userMessage || lastMsg?.transcription || lastMsg?.content || conv?.lastMessagePreview || 'Hola';

  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());
  const quotedBlock = hasQuote
    ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 [ATENCIÓN MÁXIMA — EL CLIENTE ESTÁ CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACIÓN]
Autor del mensaje citado: ${lastMsg!.quotedMessage!.author || 'Todo Lapto'}
Contenido del mensaje anterior que el cliente está citando:
"""
${lastMsg!.quotedMessage!.text}
"""
Mensaje actual del cliente sobre la cita: "${baseText}"

⚠️ REGLAS OBLIGATORIAS:
1. El cliente pregunta o se refiere a lo conversado anteriormente (la visita acordada a la tienda física de la Charles de Gaulle No. 133 o las opciones de laptops). NO está pidiendo un catálogo nuevo.
2. ESTÁ ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CATÁLOGO COMPLETO AQUÍ.
3. Responde de forma cálida, humana y concisa (máximo 2 a 4 líneas) confirmando que sí recuerdas lo conversado, confirmando disponibilidad en tienda y preguntando si pasará hoy por la tienda o prefiere coordinar envío.
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa información...", pedir que repitan lo dicho, o enviar mensajes evasivos.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : '';

  const queryText = quotedBlock ? `${quotedBlock}\nConsulta del cliente: "${baseText}"` : baseText;
  const systemInstruction = buildMasterSalesSystemInstruction(conv, queryText);
  const historyTurns = buildChatHistoryTurns(conv);
  if (historyTurns.length > 0 && historyTurns[historyTurns.length - 1].role === 'user') {
    historyTurns.pop();
  }

  try {
    const result = await generateTextWithConfiguredAI({
      prompt: `Mensaje actual del cliente:\n${queryText}\n\nResponde siguiendo estrictamente las 36 reglas del Agente Oficial de Ventas de Todo Lapto:`,
      systemInstruction,
      chatMessages: historyTurns,
      allowFallback: true,
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
    console.error('AI generate reply error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Trigger Immediate AI Sales Bot Auto-Reply & Send to WhatsApp
app.post('/api/conversations/:sessionId/auto-reply', async (req, res) => {
  const { sessionId } = req.params;
  const conv = conversations.find(c => c.sessionId === sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: 'Conversación no encontrada' });
  }

  const result = await triggerSalesBotReplyForConversation(conv, 'manual_crm_trigger');
  if (!result.success) {
    return res.status(500).json({ success: false, message: result.error || 'Error al generar respuesta' });
  }

  res.json(result);
});

// AI Multimodal Receipt Verifier Endpoint
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

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: imageBase64.replace(/^data:image\/[a-z]+;base64,/, ''),
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, verification: parsed });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. Webhook for Evolution API (Real-Time Inbound Messages, Audio, Photos, Videos)
app.post('/api/webhook/evolution', async (req, res) => {
  res.status(200).json({ received: true });

  const body = req.body;
  const event = body?.event;
  const messageData = body?.data;
  const key = messageData?.key;

  if (event !== 'messages.upsert' || !key || key.fromMe) {
    return;
  }

  const messageId = key.id;
  const now = Date.now();

  if (processedMessageIds.has(messageId)) {
    const prevTime = processedMessageIds.get(messageId)!;
    if (now - prevTime < 60000) return;
  }
  processedMessageIds.set(messageId, now);

  const remoteJid = key.remoteJid || '';
  const rawAlt = key.remoteJidAlt || '';
  const participant = key.participant || '';

  // CRITICAL: Ignore all WhatsApp group messages entirely (never respond, never add to CRM inbox)
  if (isWhatsAppGroup(remoteJid) || isWhatsAppGroup(rawAlt) || isWhatsAppGroup(participant)) {
    return;
  }

  const senderNumber = (rawAlt.endsWith('@s.whatsapp.net') ? rawAlt : remoteJid)
    .replace(/@.*$/, '')
    .replace(/\D/g, '');
  const pushName = messageData.pushName || 'Cliente WhatsApp';

  const parsedIncoming = parseSingleEvolutionMessage(messageData, pushName);
  if (!parsedIncoming) return;

  let conv = conversations.find(
    c =>
      c.sessionId === remoteJid ||
      (senderNumber && c.customerPhone === senderNumber) ||
      relatedJidsBySession.get(c.sessionId)?.has(remoteJid)
  );
  if (!conv) {
    conv = {
      sessionId: remoteJid,
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
      messagesLoaded: true,
      isLiveEvolution: true,
    };
    conversations.unshift(conv);
  } else {
    conv.unreadCount += 1;
    conv.lastTimestamp = parsedIncoming.timestamp;
    conv.lastMessagePreview = parsedIncoming.content;
    conv.lastMessageType = parsedIncoming.type;
    if (!conv.messages.some(m => m.evolutionMessageId === parsedIncoming.evolutionMessageId)) {
      conv.messages.push(parsedIncoming);
    }
  }

  broadcastEvent('new_message', { sessionId: conv.sessionId, message: parsedIncoming });

  if (appConfig.supabase?.autoSync !== false) {
    autoSyncMessageToSupabase(conv, parsedIncoming).catch(() => {});
  }

  // Trigger AI Reply if active
  if (appConfig.globalAiActive && conv.aiEnabled) {
    await triggerSalesBotReplyForConversation(conv, 'evolution_webhook');
  }
});

// ---------------------------------------------------------
// Mount Vite middlewares & Start Background Real-Time Syncs
// ---------------------------------------------------------
async function startServer() {
  const distPath = fs.existsSync(path.join(process.cwd(), 'dist'))
    ? path.join(process.cwd(), 'dist')
    : path.join(__dirname, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  // Use Vite only when explicitly running development AND dist build is not present
  const isDev = process.env.NODE_ENV === 'development' && !hasDist;

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const publicPath = path.join(__dirname, 'public');
    app.use(express.static(distPath));
    if (fs.existsSync(publicPath)) {
      app.use(express.static(publicPath));
    }
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/')) {
        return res.status(404).json({ error: 'Endpoint no encontrado' });
      }
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build frontend no encontrado en dist/. Por favor ejecuta npm run build.');
      }
    });
  }

  // Primary Server instance - strictly ONE listen call for Hostinger / Passenger / Docker compatibility
  const server = http.createServer(app);

  const onListening = () => {
    const listenTarget = typeof PORT === 'number' ? `http://0.0.0.0:${PORT}` : String(PORT);
    console.log(`🚀 Vendemá CRM Server listening on ${listenTarget} (PID: ${process.pid})`);

    // Initial real-time sync of Users & Holiday Calendar with Supabase, Odoo Inventory, Odoo Customers, and Evolution API WhatsApp Chats
    hydrateAndSyncUsersWithSupabase()
      .then(() => hydrateAndSyncHolidaysWithSupabase())
      .then(() => autoSyncConfigToSupabase(appConfig))
      .then(() => syncOdooInventory())
      .then(() => syncOdooCustomers())
      .then(() => syncEvolutionChats())
      .catch(e => console.error('Initial sync err:', e));

    // Continuous background polling every 3.5 seconds for real-time WhatsApp messages & AI Sales Bot replies
    setInterval(() => {
      syncEvolutionChats().catch(() => {});
    }, 3500);

    setInterval(() => {
      syncOdooInventory().catch(() => {});
    }, 60000);

    // Refresh Odoo customers cache every 5 minutes
    setInterval(() => {
      syncOdooCustomers().catch(() => {});
    }, 1000 * 60 * 5);
  };

  if (typeof PORT === 'number') {
    server.listen(PORT, '0.0.0.0', onListening);
  } else {
    // Passenger Unix domain socket or named pipe
    server.listen(PORT, onListening);
  }

  server.on('error', (err: any) => {
    console.error(`[Server Listen Error on ${PORT}]:`, err.message);
  });

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
