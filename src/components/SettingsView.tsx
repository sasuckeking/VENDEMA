import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  Server, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Copy, 
  Check, 
  PhoneCall, 
  Save,
  Sparkles,
  QrCode,
  Smartphone,
  LogOut,
  RotateCcw,
  Cpu,
  Database,
  UploadCloud,
  FileCode,
  Terminal,
  ExternalLink,
  Activity,
  X
} from 'lucide-react';
import type { AppConfig, AIProviderType, UserAccount } from '../types';
import { getSupabaseSchemaSql, testSupabaseConnection } from '../utils/supabaseService';
import { SystemLogsView } from './SystemLogsView';

interface SettingsViewProps {
  config: AppConfig;
  onUpdateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
}

const AI_MODELS_BY_PROVIDER: Record<AIProviderType, { id: string; label: string; badge: string }[]> = {
  gemini: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Rápido para Ventas en WhatsApp)', badge: 'Velocidad' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Recomendado — Rápido para Ventas en WhatsApp)', badge: 'Velocidad' },
    { id: 'gpt-4o', label: 'GPT-4o Omni (Máxima Capacidad y Visión)', badge: 'Flagship' },
    { id: 'o3-mini', label: 'OpenAI o3-mini (Razonamiento Comercial)', badge: 'Reasoning' },
  ],
  deepseek: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Rápido para Ventas en WhatsApp)', badge: 'Velocidad' },
  ],
};

export const SettingsView: React.FC<SettingsViewProps> = ({ config, onUpdateConfig, currentUser, onLogout }) => {
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isReadOnly = !isSuperAdmin;
  const [settingsSubTab, setSettingsSubTab] = useState<'config' | 'logs'>('config');

  // Helper to read persisted AI config from localStorage as fallback
  const getSavedLocalAi = (): Partial<NonNullable<AppConfig['aiProvider']>> => {
    try {
      const raw = localStorage.getItem('vendema_ai_provider_config');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  };

  const initialLocalAi = getSavedLocalAi();

  // AI Provider state (Strictly OpenAI Exclusive)
  const [aiProvider, setAiProvider] = useState<AIProviderType>('openai');
  const [aiModel, setAiModel] = useState<string>(
    config.aiProvider?.model && ['gpt-4o-mini', 'gpt-4o', 'o3-mini'].includes(config.aiProvider.model)
      ? config.aiProvider.model
      : initialLocalAi.model && ['gpt-4o-mini', 'gpt-4o', 'o3-mini'].includes(initialLocalAi.model)
      ? initialLocalAi.model
      : 'gpt-4o-mini'
  );
  const [aiTemperature, setAiTemperature] = useState<number>(
    config.aiProvider?.temperature ?? initialLocalAi.temperature ?? 0.35
  );
  const [customInstructions, setCustomInstructions] = useState<string>(
    config.aiProvider?.customInstructions || initialLocalAi.customInstructions || ''
  );
  const [openaiApiKey, setOpenaiApiKey] = useState<string>(
    config.aiProvider?.openaiApiKey || initialLocalAi.openaiApiKey || ''
  );
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState<string>(
    config.aiProvider?.openaiBaseUrl || initialLocalAi.openaiBaseUrl || 'https://api.openai.com/v1/chat/completions'
  );
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [aiKeySavedBanner, setAiKeySavedBanner] = useState<string | null>(null);

  const isEditingAiInputRef = useRef<boolean>(false);
  const autoSaveTimerRef = useRef< ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Never overwrite inputs while the user is actively typing/pasting in the credential fields
    if (isEditingAiInputRef.current) return;

    if (config.aiProvider) {
      setAiProvider('openai');
      if (config.aiProvider.model && ['gpt-4o-mini', 'gpt-4o', 'o3-mini'].includes(config.aiProvider.model)) {
        setAiModel(config.aiProvider.model);
      }
      if (config.aiProvider.temperature !== undefined) setAiTemperature(config.aiProvider.temperature);
      if (config.aiProvider.customInstructions !== undefined) setCustomInstructions(config.aiProvider.customInstructions);
      if (config.aiProvider.openaiApiKey) setOpenaiApiKey(config.aiProvider.openaiApiKey);
      if (config.aiProvider.openaiBaseUrl) setOpenaiBaseUrl(config.aiProvider.openaiBaseUrl);
    }
  }, [config.aiProvider]);

  useEffect(() => {
    if (config.odoo) {
      if (config.odoo.url) setOdooUrl(config.odoo.url);
      if (config.odoo.db) setOdooDb(config.odoo.db);
      if (config.odoo.uid) setOdooUid(config.odoo.uid);
      if (config.odoo.apiKey) setOdooApiKey(config.odoo.apiKey);
    }
  }, [config.odoo]);

  useEffect(() => {
    if (config.evolution) {
      if (config.evolution.serverUrl) setEvolutionUrl(config.evolution.serverUrl);
      if (config.evolution.instance) setEvolutionInstance(config.evolution.instance);
      if (config.evolution.apiKey) setEvolutionApiKey(config.evolution.apiKey);
      if (config.evolution.teamPhone) setTeamPhone(config.evolution.teamPhone);
      if (config.evolution.adminPhone) setAdminPhone(config.evolution.adminPhone);
    }
  }, [config.evolution]);

  useEffect(() => {
    if (config.supabase) {
      if (config.supabase.url && config.supabase.url.trim().length > 0) {
        setSupabaseUrl(config.supabase.url);
      }
      if (config.supabase.anonKey && config.supabase.anonKey.trim().length > 0) {
        setSupabaseAnonKey(config.supabase.anonKey);
      }
      if (config.supabase.autoSync !== undefined) {
        setSupabaseAutoSync(config.supabase.autoSync);
      }
    }
  }, [config.supabase]);

  // Odoo state
  const [odooUrl, setOdooUrl] = useState(config.odoo.url);
  const [odooDb, setOdooDb] = useState(config.odoo.db);
  const [odooUid, setOdooUid] = useState(config.odoo.uid);
  const [odooApiKey, setOdooApiKey] = useState(config.odoo.apiKey);

  // Evolution API state
  const [evolutionUrl, setEvolutionUrl] = useState(config.evolution.serverUrl);
  const [evolutionInstance, setEvolutionInstance] = useState(config.evolution.instance);
  const [evolutionApiKey, setEvolutionApiKey] = useState(config.evolution.apiKey);
  const [teamPhone, setTeamPhone] = useState(config.evolution.teamPhone);
  const [adminPhone, setAdminPhone] = useState(config.evolution.adminPhone);

  // QR & WhatsApp session state
  const [qrStatus, setQrStatus] = useState<{
    loading: boolean;
    state: string;
    connected: boolean;
    ownerJid?: string | null;
    profileName?: string | null;
    profilePicUrl?: string | null;
    qrBase64?: string | null;
    pairingCode?: string | null;
    message?: string;
  }>({
    loading: true,
    state: 'checking',
    connected: Boolean(config.evolution.connected),
  });

  // Supabase state (with localStorage fallback so credentials never get lost)
  const [supabaseUrl, setSupabaseUrl] = useState(() => {
    if (config.supabase?.url) return config.supabase.url;
    try {
      const saved = localStorage.getItem('vendema_supabase_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.url) return parsed.url;
      }
    } catch {}
    return '';
  });

  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => {
    if (config.supabase?.anonKey) return config.supabase.anonKey;
    try {
      const saved = localStorage.getItem('vendema_supabase_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.anonKey) return parsed.anonKey;
      }
    } catch {}
    return '';
  });

  const [supabaseAutoSync, setSupabaseAutoSync] = useState(() => {
    if (config.supabase?.autoSync !== undefined) return config.supabase.autoSync;
    try {
      const saved = localStorage.getItem('vendema_supabase_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.autoSync !== undefined) return parsed.autoSync;
      }
    } catch {}
    return true;
  });
  const [isTestingSupabase, setIsTestingSupabase] = useState(false);
  const [supabaseTestResult, setSupabaseTestResult] = useState<{ success: boolean; message: string; accessibleTables?: string[] } | null>(null);
  const [isSyncingAllSupabase, setIsSyncingAllSupabase] = useState(false);
  const [supabaseSyncResult, setSupabaseSyncResult] = useState<any | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [schemaSql, setSchemaSql] = useState('');

  const [isTestingOdoo, setIsTestingOdoo] = useState(false);
  const [odooTestResult, setOdooTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isTestingEvolution, setIsTestingEvolution] = useState(false);
  const [evolutionTestResult, setEvolutionTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [webhookRegisterResult, setWebhookRegisterResult] = useState<{ success: boolean; message: string } | null>(null);

  const webhookUrl = `${window.location.origin}/api/webhook/evolution`;

  const handleRegisterWebhook = async () => {
    setIsRegisteringWebhook(true);
    setWebhookRegisterResult(null);
    try {
      const res = await fetch('/api/evolution/register-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await res.json();
      setWebhookRegisterResult(data);
    } catch (err: any) {
      setWebhookRegisterResult({ success: false, message: err.message || 'Error al conectar con Evolution API' });
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  // Fetch Evolution QR & Connection Status on mount
  const fetchQrAndState = async (forceConnect = false) => {
    setQrStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/evolution/qrcode${forceConnect ? '?forceConnect=true' : ''}`);
      const data = await res.json();
      if (data.success) {
        setQrStatus({
          loading: false,
          state: data.state || 'unknown',
          connected: Boolean(data.connected),
          ownerJid: data.ownerJid,
          profileName: data.profileName,
          profilePicUrl: data.profilePicUrl,
          qrBase64: data.qrBase64,
          pairingCode: data.pairingCode,
        });
      } else {
        setQrStatus(prev => ({
          ...prev,
          loading: false,
          message: data.message || 'No se pudo obtener estado de la instancia',
        }));
      }
    } catch (err: any) {
      setQrStatus(prev => ({ ...prev, loading: false, message: err.message }));
    }
  };

  useEffect(() => {
    fetchQrAndState(false);
  }, []);

  // Auto-poll QR state every 8 seconds when not connected so as soon as user scans QR it turns green!
  useEffect(() => {
    if (qrStatus.connected) return;
    const interval = setInterval(() => {
      fetchQrAndState(true);
    }, 8000);
    return () => clearInterval(interval);
  }, [qrStatus.connected]);

  const syncAiConfigImmediately = async (overrides?: Partial<AppConfig['aiProvider']>) => {
    const nextAiProvider = {
      ...config.aiProvider,
      provider: 'openai' as AIProviderType,
      model: aiModel,
      temperature: aiTemperature,
      customInstructions,
      openaiApiKey: (overrides?.openaiApiKey !== undefined ? overrides.openaiApiKey : openaiApiKey).trim(),
      openaiBaseUrl: (overrides?.openaiBaseUrl !== undefined ? overrides.openaiBaseUrl : openaiBaseUrl).trim(),
      deepseekApiKey: '',
      deepseekBaseUrl: '',
      geminiApiKey: '',
      ...overrides,
    };
    nextAiProvider.provider = 'openai';
    if (nextAiProvider.openaiApiKey) nextAiProvider.openaiApiKey = nextAiProvider.openaiApiKey.trim();

    try {
      localStorage.setItem('vendema_ai_provider_config', JSON.stringify(nextAiProvider));
    } catch {}

    try {
      await fetch('/api/ai/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextAiProvider),
      });
    } catch {}

    await onUpdateConfig({ aiProvider: nextAiProvider });
  };

  // Immediately persist to localStorage on every keystroke/paste and debounce-sync to server + Supabase
  const handleAiFieldChange = (overrides: Partial<AppConfig['aiProvider']>) => {
    isEditingAiInputRef.current = true;
    const nextSnapshot = {
      ...config.aiProvider,
      provider: 'openai' as AIProviderType,
      model: aiModel,
      temperature: aiTemperature,
      customInstructions,
      openaiApiKey,
      openaiBaseUrl,
      deepseekApiKey: '',
      deepseekBaseUrl: '',
      geminiApiKey: '',
      ...overrides,
    };
    try {
      localStorage.setItem('vendema_ai_provider_config', JSON.stringify(nextSnapshot));
    } catch {}

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      syncAiConfigImmediately(overrides).then(() => {
        setAiKeySavedBanner('✓ API Key de OpenAI guardada automáticamente en Servidor y Supabase');
        setTimeout(() => setAiKeySavedBanner(null), 4000);
      });
    }, 450);
  };

  const handleTestAiProvider = async () => {
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      await syncAiConfigImmediately();
      const res = await fetch('/api/ai/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          model: aiModel,
          temperature: aiTemperature,
          customInstructions,
          openaiApiKey,
          openaiBaseUrl,
        }),
      });
      const data = await res.json();
      setAiTestResult({ success: Boolean(data.success), message: data.message });
    } catch (err: any) {
      setAiTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingAi(false);
    }
  };

  const handleLogoutAndGetNewQr = async () => {
    setQrStatus(prev => ({ ...prev, loading: true, message: 'Desvinculando sesión actual y generando nuevo QR...' }));
    try {
      const res = await fetch('/api/evolution/logout', { method: 'POST' });
      const data = await res.json();
      setQrStatus({
        loading: false,
        state: data.state || 'connecting',
        connected: false,
        qrBase64: data.qrBase64 || null,
        pairingCode: data.pairingCode || null,
        message: data.message,
      });
    } catch (err: any) {
      setQrStatus(prev => ({ ...prev, loading: false, message: err.message }));
    }
  };

  const handleRestartInstance = async () => {
    setQrStatus(prev => ({ ...prev, loading: true }));
    try {
      await fetch('/api/evolution/restart', { method: 'POST' });
      await fetchQrAndState(true);
    } catch (err: any) {
      setQrStatus(prev => ({ ...prev, loading: false, message: err.message }));
    }
  };

  const handleTestSupabase = async () => {
    setIsTestingSupabase(true);
    setSupabaseTestResult(null);
    try {
      let data: any = null;

      // 1. Try server endpoint first
      try {
        const res = await fetch('/api/supabase/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: supabaseUrl, anonKey: supabaseAnonKey }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        }
      } catch (proxyErr) {
        console.warn('[Supabase Test Proxy Notice]:', proxyErr);
      }

      // 2. If server proxy returned HTML (e.g. 503/504 proxy page) or wasn't available, test directly in browser
      if (!data) {
        data = await testSupabaseConnection(supabaseUrl, supabaseAnonKey);
      }

      setSupabaseTestResult(data);
      if (data?.success) {
        await syncSupabaseConfigImmediately({ connected: true });
      }
    } catch (err: any) {
      setSupabaseTestResult({ success: false, message: err.message || 'Error al conectar con Supabase' });
    } finally {
      setIsTestingSupabase(false);
    }
  };

  const handleSyncAllSupabase = async () => {
    setIsSyncingAllSupabase(true);
    setSupabaseSyncResult(null);
    try {
      const res = await fetch('/api/supabase/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: supabaseUrl, anonKey: supabaseAnonKey }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`El servidor devolvió respuesta no válida (${res.status}): ${text.slice(0, 150)}`);
      }
      const data = await res.json();
      setSupabaseSyncResult(data);
    } catch (err: any) {
      setSupabaseSyncResult({ success: false, message: err.message });
    } finally {
      setIsSyncingAllSupabase(false);
    }
  };

  const handleFetchSqlSchema = async () => {
    try {
      const res = await fetch('/api/supabase/schema-sql');
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (data.sql) {
          setSchemaSql(data.sql);
          setShowSqlModal(true);
          return;
        }
      }
    } catch (err: any) {
      console.warn('Using local SQL schema generator:', err);
    }
    setSchemaSql(getSupabaseSchemaSql());
    setShowSqlModal(true);
  };

  const handleTestOdoo = async () => {
    setIsTestingOdoo(true);
    setOdooTestResult(null);
    try {
      const res = await fetch('/api/odoo/test-connection', { method: 'POST' });
      const data = await res.json();
      setOdooTestResult(data);
    } catch (err: any) {
      setOdooTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingOdoo(false);
    }
  };

  const handleTestEvolution = async () => {
    setIsTestingEvolution(true);
    setEvolutionTestResult(null);
    try {
      const res = await fetch('/api/evolution/test-connection', { method: 'POST' });
      const data = await res.json();
      setEvolutionTestResult(data);
      fetchQrAndState(false);
    } catch (err: any) {
      setEvolutionTestResult({ success: false, message: err.message });
    } finally {
      setIsTestingEvolution(false);
    }
  };

  const handleSaveAiCredentials = async () => {
    setIsSaving(true);
    isEditingAiInputRef.current = false;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    await syncAiConfigImmediately({
      provider: 'openai',
      openaiApiKey: openaiApiKey.trim(),
      openaiBaseUrl: openaiBaseUrl.trim(),
    });
    setIsSaving(false);
    setAiKeySavedBanner('✓ API Key de OpenAI guardada permanentemente en Servidor, Navegador y Supabase');
    setSaveToast('Credenciales exclusivas de OpenAI guardadas y activadas con éxito.');
    setTimeout(() => {
      setSaveToast(null);
      setAiKeySavedBanner(null);
    }, 4500);
  };

  const handleSaveOdoo = async () => {
    setIsSaving(true);
    await onUpdateConfig({
      odoo: {
        ...config.odoo,
        url: odooUrl,
        db: odooDb,
        uid: Number(odooUid),
        apiKey: odooApiKey,
      },
    });
    setIsSaving(false);
    setSaveToast('Credenciales del Servidor Central Odoo guardadas con éxito.');
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleSaveEvolution = async () => {
    setIsSaving(true);
    await onUpdateConfig({
      evolution: {
        ...config.evolution,
        serverUrl: evolutionUrl,
        instance: evolutionInstance,
        apiKey: evolutionApiKey,
        teamPhone,
        adminPhone,
      },
    });
    setIsSaving(false);
    setSaveToast('Credenciales de Evolution API WhatsApp guardadas con éxito.');
    setTimeout(() => setSaveToast(null), 3500);
  };

  const syncSupabaseConfigImmediately = async (overrides?: Partial<NonNullable<AppConfig['supabase']>>) => {
    const nextSupabase = {
      ...config.supabase,
      url: supabaseUrl.trim(),
      anonKey: supabaseAnonKey.trim(),
      autoSync: supabaseAutoSync,
      ...overrides,
    };
    try {
      localStorage.setItem('vendema_supabase_config', JSON.stringify(nextSupabase));
    } catch {}
    await onUpdateConfig({ supabase: nextSupabase });
  };

  const handleSaveSupabase = async () => {
    setIsSaving(true);
    await syncSupabaseConfigImmediately();
    setIsSaving(false);
    setSaveToast('Credenciales de Supabase (URL y Key) guardadas y fijadas con éxito.');
    setTimeout(() => setSaveToast(null), 3500);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    isEditingAiInputRef.current = false;
    const nextAi = {
      ...config.aiProvider,
      provider: 'openai' as AIProviderType,
      model: aiModel,
      temperature: aiTemperature,
      customInstructions,
      openaiApiKey: openaiApiKey.trim(),
      openaiBaseUrl: openaiBaseUrl.trim(),
      deepseekApiKey: '',
      deepseekBaseUrl: '',
      geminiApiKey: '',
    };
    try {
      localStorage.setItem('vendema_ai_provider_config', JSON.stringify(nextAi));
    } catch {}
    try {
      await fetch('/api/ai/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextAi),
      });
    } catch {}
    await onUpdateConfig({
      aiProvider: nextAi,
      odoo: {
        ...config.odoo,
        url: odooUrl,
        db: odooDb,
        uid: Number(odooUid),
        apiKey: odooApiKey,
      },
      evolution: {
        ...config.evolution,
        serverUrl: evolutionUrl,
        instance: evolutionInstance,
        apiKey: evolutionApiKey,
        teamPhone,
        adminPhone,
      },
      supabase: {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
        autoSync: supabaseAutoSync,
      },
    });
    setIsSaving(false);
    setAiKeySavedBanner('✓ API Key de OpenAI guardada permanentemente en Servidor, Navegador y Supabase');
    setSaveToast('Configuración de OpenAI, Supabase, Servidor Central y WhatsApp guardada con éxito.');
    setTimeout(() => {
      setSaveToast(null);
      setAiKeySavedBanner(null);
    }, 4500);
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 bg-[#090D12] text-slate-100">
      {/* Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#0F141C] border border-white/[0.07] shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-lime-950/80 border border-lime-500/30 flex items-center justify-center text-lime-400 shrink-0">
            {isSuperAdmin ? <Settings className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">
              {isSuperAdmin
                ? 'Centro de Control: Motor de IA, Escáner QR WhatsApp & Conexión ERP'
                : 'Vinculación de WhatsApp & Escáner de Código QR'}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSuperAdmin
                ? 'Configura el motor exclusivo de OpenAI (ChatGPT), vincula tu WhatsApp por Código QR sin salir del CRM y gestiona la sincronización.'
                : 'Verifica el estado de conexión de WhatsApp o escanea el código QR directamente desde el teléfono del negocio.'}
            </p>
          </div>
        </div>

        {saveToast && (
          <div className="px-3.5 py-2 rounded-xl bg-lime-950/90 border border-lime-500/50 text-lime-300 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-lime-400" />
            <span>{saveToast}</span>
          </div>
        )}
      </div>

      {/* Sub-navigation tabs: Configuración vs System Logs */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-[#0F141C] border border-white/[0.07] w-fit shadow-md">
        <button
          type="button"
          onClick={() => setSettingsSubTab('config')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            settingsSubTab === 'config'
              ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
        >
          <Settings className="w-4 h-4 text-lime-400" />
          <span>Configuración & Conexiones</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsSubTab('logs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            settingsSubTab === 'logs'
              ? 'bg-lime-500/20 text-lime-300 border border-lime-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
        >
          <Activity className="w-4 h-4 text-lime-400" />
          <span>Registros del Sistema (System Logs)</span>
        </button>
      </div>

      {settingsSubTab === 'logs' ? (
        <SystemLogsView />
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
        {/* SECTION 1: OpenAI Exclusive AI Engine — SUPER ADMIN ONLY */}
        {isSuperAdmin && (
        <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-lime-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Motor de Inteligencia Artificial Exclusivo: OpenAI (ChatGPT / Whisper / Vision)
                </h2>
                <span className="text-[11px] text-slate-400">
                  100% de las respuestas comerciales, transcripción de notas de voz y visión de comprobantes operan directamente con OpenAI
                </span>
              </div>
            </div>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleTestAiProvider}
                disabled={isTestingAi}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lime-950/80 hover:bg-lime-900 border border-lime-700/60 text-lime-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isTestingAi ? 'animate-spin' : ''}`} />
                <span>{isTestingAi ? 'Probando OpenAI...' : 'Probar Conexión con OpenAI'}</span>
              </button>
            )}
          </div>

          {aiTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                aiTestResult.success
                  ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-600/60 text-red-200'
              }`}
            >
              {aiTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{aiTestResult.message}</span>
            </div>
          )}

          {/* OpenAI Exclusive Banner Card */}
          <div className="p-4 rounded-xl border bg-[#131F14] border-lime-500/80 shadow-lg shadow-lime-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold text-white">OpenAI (ChatGPT Oficial)</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-lime-500/20 text-lime-300 border border-lime-500/40">
                  Motor Único Activo
                </span>
              </div>
              <span className="text-[11px] font-mono text-lime-400 block mb-1">
                GPT-4o-mini / GPT-4o / o3-mini + Whisper-1 (Audio)
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                Google Gemini y DeepSeek han sido eliminados del sistema. Todas las consultas de clientes en WhatsApp se procesan exclusivamente con tu cuenta de OpenAI.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                openaiApiKey && openaiApiKey.trim().startsWith('sk-')
                  ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/80 border-amber-500/40 text-amber-300'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  openaiApiKey && openaiApiKey.trim().startsWith('sk-') ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`} />
                <span>
                  {openaiApiKey && openaiApiKey.trim().startsWith('sk-')
                    ? 'Clave sk-... Configurada'
                    : 'Requiere API Key sk-...'}
                </span>
              </span>
            </div>
          </div>

          {/* OpenAI Connection Credentials Box */}
          <div className="p-4 rounded-xl bg-[#121822] border border-white/[0.07] space-y-3 text-xs">
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    OpenAI API Key / Token de Conexión (debe comenzar con sk-... o sk-proj-...)
                  </label>
                  <input
                    type="text"
                    placeholder="sk-proj-..."
                    value={openaiApiKey}
                    onFocus={() => {
                      isEditingAiInputRef.current = true;
                    }}
                    onChange={e => {
                      const val = e.target.value;
                      setOpenaiApiKey(val);
                      handleAiFieldChange({ openaiApiKey: val });
                    }}
                    onBlur={e => {
                      isEditingAiInputRef.current = false;
                      syncAiConfigImmediately({ openaiApiKey: e.target.value.trim() });
                    }}
                    className={`w-full bg-[#090D12] border rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${
                      openaiApiKey && !openaiApiKey.trim().startsWith('sk-')
                        ? 'border-amber-500/60 focus:border-amber-400'
                        : 'border-white/[0.08] focus:border-lime-500'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Endpoint API de OpenAI
                  </label>
                  <input
                    type="text"
                    value={openaiBaseUrl}
                    onFocus={() => {
                      isEditingAiInputRef.current = true;
                    }}
                    onChange={e => {
                      const val = e.target.value;
                      setOpenaiBaseUrl(val);
                      handleAiFieldChange({ openaiBaseUrl: val });
                    }}
                    onBlur={e => {
                      isEditingAiInputRef.current = false;
                      syncAiConfigImmediately({ openaiBaseUrl: e.target.value.trim() });
                    }}
                    className="w-full bg-[#090D12] border border-white/[0.08] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
                  />
                </div>
              </div>
              {openaiApiKey && !openaiApiKey.trim().startsWith('sk-') && (
                <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-amber-300 text-[11px] leading-relaxed">
                  <strong>Atención:</strong> La clave ingresada (<code>{openaiApiKey.slice(0, 12)}...</code>) no comienza con <code>sk-</code> ni <code>sk-proj-</code>. Ingresa una clave válida de OpenAI para que el Bot responda en WhatsApp.
                </div>
              )}
            </div>

            <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {aiKeySavedBanner ? (
                  <span className="text-[11px] font-semibold text-lime-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {aiKeySavedBanner}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Las credenciales de OpenAI se guardan automáticamente al pegarlas o con el botón Guardar.
                  </span>
                )}
              </div>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={handleSaveAiCredentials}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#65D30F] hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Credenciales de OpenAI</span>
                </button>
              )}
            </div>
          </div>

          {/* Model & Temperature Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Modelo Activo de OpenAI
              </label>
              <select
                value={aiModel}
                onChange={e => {
                  setAiModel(e.target.value);
                  syncAiConfigImmediately({ model: e.target.value });
                }}
                className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-lime-500"
              >
                {AI_MODELS_BY_PROVIDER.openai.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label} [{m.badge}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 font-semibold">
                  Temperatura / Creatividad de Respuesta
                </label>
                <span className="font-mono text-lime-400 font-bold">{aiTemperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={aiTemperature}
                onChange={e => setAiTemperature(parseFloat(e.target.value))}
                className="w-full accent-lime-500 cursor-pointer mt-2"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>0.1 (Más estricto al stock)</span>
                <span>0.35 (Equilibrado Ventas)</span>
                <span>0.9 (Más creativo)</span>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-400 mb-1 font-semibold">
                Instrucciones Personalizadas Adicionales para el Vendedor IA (Opcional)
              </label>
              <textarea
                rows={2}
                value={customInstructions}
                onChange={e => setCustomInstructions(e.target.value)}
                placeholder="Ej: Prioriza ofrecer envío gratis en compras mayores a RD$25,000 en Santo Domingo o menciona promociones vigentes..."
                className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500 resize-none"
              />
            </div>
          </div>
        </div>
        )}

        {/* SECTION 2: Evolution API WhatsApp + Direct QR Code Scanner */}
        <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-lime-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Evolution API (WhatsApp Gateway) & Escáner de Código QR Integrado
                </h2>
                <span className="text-[11px] text-slate-400">
                  Verifica el estado de vinculación o escanea el código QR directamente aquí sin salir del CRM
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fetchQrAndState(true)}
                disabled={qrStatus.loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-lime-400 ${qrStatus.loading ? 'animate-spin' : ''}`} />
                <span>Actualizar Estado / QR</span>
              </button>

              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={handleTestEvolution}
                  disabled={isTestingEvolution}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lime-950/80 hover:bg-lime-900 border border-lime-700/60 text-lime-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{isTestingEvolution ? 'Probando...' : 'Probar Evolution API'}</span>
                </button>
              )}
            </div>
          </div>

          {evolutionTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                evolutionTestResult.success
                  ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-600/60 text-red-200'
              }`}
            >
              {evolutionTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{evolutionTestResult.message}</span>
            </div>
          )}

          {/* LIVE WHATSAPP CONNECTION & QR SCANNER BOX */}
          <div className="p-4 rounded-2xl bg-[#121822] border border-white/[0.07] grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Left Side: Status & Account Details */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                    qrStatus.connected
                      ? 'bg-lime-950/80 border-lime-500/40 text-lime-400'
                      : 'bg-amber-950/80 border-amber-500/40 text-amber-400'
                  }`}
                >
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      Instancia: <code className="text-lime-400 font-mono">{evolutionInstance}</code>
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        qrStatus.connected
                          ? 'bg-lime-500/20 text-lime-300 border border-lime-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {qrStatus.connected ? 'CONECTADO (OPEN)' : `DESCONECTADO (${qrStatus.state})`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {qrStatus.connected
                      ? 'Tu cuenta de WhatsApp está vinculada y recibiendo mensajes, audios, fotos y videos en tiempo real.'
                      : 'La sesión de WhatsApp no está vinculada. Escanea el código QR de la derecha desde tu teléfono para activarla.'}
                  </p>
                </div>
              </div>

              {qrStatus.connected && (
                <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06] flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {qrStatus.profilePicUrl ? (
                      <img
                        src={qrStatus.profilePicUrl}
                        alt="WhatsApp Profile"
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-full object-cover border border-lime-500/40"
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      style={{ display: qrStatus.profilePicUrl ? 'none' : 'flex' }}
                      className="w-10 h-10 rounded-full bg-lime-950 text-lime-400 items-center justify-center font-bold text-sm"
                    >
                      W
                    </div>
                    <div className="text-xs">
                      <span className="text-slate-400 block text-[10px]">Cuenta Vinculada Activa:</span>
                      <span className="font-bold text-white block">
                        {qrStatus.profileName || 'Todo LAPTO Oficial'}
                      </span>
                      {qrStatus.ownerJid && (
                        <span className="font-mono text-lime-400 text-[11px]">
                          +{qrStatus.ownerJid.replace(/@.*$/, '')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestartInstance}
                      title="Reiniciar conexión de WhatsApp"
                      className="px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs flex items-center gap-1 border border-white/[0.07]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reiniciar</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleLogoutAndGetNewQr}
                      title="Cerrar sesión actual para escanear otro número por QR"
                      className="px-2.5 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/50 text-xs flex items-center gap-1 font-medium"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cambiar WhatsApp / Generar QR</span>
                    </button>
                  </div>
                </div>
              )}

              {!qrStatus.connected && (
                <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200 space-y-1">
                  <div className="font-bold text-amber-300">Pasos para vincular tu WhatsApp:</div>
                  <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-300">
                    <li>Abre <strong>WhatsApp</strong> en el teléfono del negocio.</li>
                    <li>Toca <strong>Menú (⋮) o Configuración</strong> &gt; <strong>Dispositivos vinculados</strong>.</li>
                    <li>Toca <strong>Vincular un dispositivo</strong> y apunta al código QR del recuadro.</li>
                  </ol>
                </div>
              )}

              {qrStatus.message && (
                <div className="text-xs text-lime-300 font-medium">{qrStatus.message}</div>
              )}
            </div>

            {/* Right Side: QR Code Display Box */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center p-4 rounded-xl bg-[#090D12] border border-white/[0.06] min-h-[220px]">
              {qrStatus.loading ? (
                <div className="flex flex-col items-center gap-2 text-xs text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-lime-400" />
                  <span>Consultando Evolution API...</span>
                </div>
              ) : qrStatus.qrBase64 ? (
                <div className="flex flex-col items-center space-y-2.5">
                  <div className="p-3 bg-white rounded-2xl shadow-xl">
                    <img
                      src={
                        qrStatus.qrBase64.startsWith('data:')
                          ? qrStatus.qrBase64
                          : `data:image/png;base64,${qrStatus.qrBase64}`
                      }
                      alt="Código QR de WhatsApp Evolution API"
                      className="w-48 h-48 object-contain"
                    />
                  </div>
                  <span className="text-[11px] text-lime-400 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping" />
                    Escanea este Código QR con tu WhatsApp
                  </span>
                  {qrStatus.pairingCode && (
                    <span className="text-[11px] font-mono text-slate-300 bg-white/[0.06] px-2.5 py-1 rounded">
                      Código de vinculación: <strong>{qrStatus.pairingCode}</strong>
                    </span>
                  )}
                </div>
              ) : qrStatus.connected ? (
                <div className="flex flex-col items-center text-center space-y-2 p-4">
                  <div className="w-12 h-12 rounded-full bg-lime-500/20 border border-lime-500/40 flex items-center justify-center text-lime-400">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-white">
                    WhatsApp Escaneado y Activo
                  </span>
                  <p className="text-[11px] text-slate-400 max-w-xs">
                    No necesitas escanear código QR porque la instancia ya está conectada. Si deseas vincular otro teléfono, usa el botón "Cambiar WhatsApp / Generar QR".
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center space-y-3 p-4">
                  <QrCode className="w-10 h-10 text-slate-500" />
                  <p className="text-xs text-slate-400">
                    Haz clic abajo para solicitar un nuevo código QR a Evolution API:
                  </p>
                  <button
                    type="button"
                    onClick={() => fetchQrAndState(true)}
                    className="px-4 py-2 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors"
                  >
                    Generar Código QR Ahora
                  </button>
                </div>
              )}
            </div>
          </div>

          {isSuperAdmin && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Servidor Evolution API</label>
                  <input
                    type="text"
                    value={evolutionUrl}
                    onChange={e => setEvolutionUrl(e.target.value)}
                    className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">Instancia</label>
                  <input
                    type="text"
                    value={evolutionInstance}
                    onChange={e => setEvolutionInstance(e.target.value)}
                    className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">API Key de Evolution</label>
                  <input
                    type="password"
                    value={evolutionApiKey}
                    onChange={e => setEvolutionApiKey(e.target.value)}
                    className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
                  />
                </div>
              </div>

              {/* Webhook Configuration helper */}
              <div className="p-3.5 bg-[#121822] rounded-xl border border-white/[0.06] space-y-2.5 text-xs">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-200 block">
                      URL de Webhook en Tiempo Real (Recibe mensajes, audios, fotos y videos al instante):
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Permite que el bot responda en menos de 1 segundo al recibir el mensaje de WhatsApp.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleRegisterWebhook}
                      disabled={isRegisteringWebhook}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lime-950/80 hover:bg-lime-900 border border-lime-700/60 text-lime-300 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isRegisteringWebhook ? 'animate-spin' : ''}`} />
                      <span>{isRegisteringWebhook ? 'Vinculando...' : 'Vincular Webhook en Evolution API'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={copyWebhook}
                      className="flex items-center gap-1 text-[11px] text-lime-400 hover:text-lime-300 font-semibold px-2 py-1 rounded bg-white/[0.04]"
                    >
                      {copiedWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedWebhook ? 'Copiado' : 'Copiar'}</span>
                    </button>
                  </div>
                </div>

                <div className="p-2 bg-black/50 rounded font-mono text-slate-300 select-all overflow-x-auto text-[11px]">
                  {webhookUrl}
                </div>

                {webhookRegisterResult && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                      webhookRegisterResult.success
                        ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
                        : 'bg-red-950/60 border-red-600/60 text-red-200'
                    }`}
                  >
                    {webhookRegisterResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>{webhookRegisterResult.message}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveEvolution}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar WhatsApp Evolution</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* SECTION 3, 4 & 5: Odoo ERP, Supabase & Notification Numbers — SUPER ADMIN ONLY */}
        {isSuperAdmin && (
          <>
        {/* SECTION 3: Central ERP / JSON-RPC Configuration */}
        <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-lime-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-100">
                  Servidor Central de Inventario (JSON-RPC en Tiempo Real)
                </h2>
                <span className="text-[11px] text-slate-500">
                  Sincroniza automáticamente los 607+ productos vendibles y stock por ubicación (Vitrina y Almacén)
                </span>
              </div>
            </div>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={handleTestOdoo}
                disabled={isTestingOdoo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lime-950/80 hover:bg-lime-900 border border-lime-700/60 text-lime-300 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingOdoo ? 'animate-spin' : ''}`} />
                <span>{isTestingOdoo ? 'Probando conexión...' : 'Probar Conexión'}</span>
              </button>
            )}
          </div>

          {odooTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                odooTestResult.success
                  ? 'bg-emerald-950/60 border-emerald-600/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-600/60 text-red-200'
              }`}
            >
              {odooTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{odooTestResult.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">URL del Servidor JSON-RPC</label>
              <input
                type="text"
                value={odooUrl}
                readOnly={isReadOnly}
                onChange={e => setOdooUrl(e.target.value)}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-lime-500'}`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Base de Datos</label>
              <input
                type="text"
                value={odooDb}
                readOnly={isReadOnly}
                onChange={e => setOdooDb(e.target.value)}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-lime-500'}`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">User ID (UID)</label>
              <input
                type="number"
                value={odooUid}
                readOnly={isReadOnly}
                onChange={e => setOdooUid(Number(e.target.value))}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-lime-500'}`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">API Key / Token de Acceso</label>
              <input
                type="password"
                value={odooApiKey}
                readOnly={isReadOnly}
                onChange={e => setOdooApiKey(e.target.value)}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-lime-500'}`}
              />
            </div>

            {isSuperAdmin && (
              <div className="md:col-span-2 flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveOdoo}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Conexión Odoo</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 4: Supabase Database Sync */}
        <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <div>
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <span>Base de Datos Supabase (PostgreSQL)</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono ${
                      config.supabase?.connected
                        ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 text-slate-400 border border-white/[0.06]'
                    }`}
                  >
                    {config.supabase?.connected ? 'Conectado' : 'Pendiente'}
                  </span>
                </h2>
                <span className="text-[11px] text-slate-400">
                  Respaldo y persistencia en la nube (9 tablas): usuarios, calendario_feriados, configuración, productos, pedidos, clientes de WhatsApp, mensajes, recordatorios y aprendizajes de IA.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFetchSqlSchema}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08] transition-colors"
                title="Ver o copiar el script SQL de creación de tablas para el SQL Editor de Supabase"
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Script SQL de Tablas</span>
              </button>

              {isSuperAdmin && (
                <>
                  <button
                    type="button"
                    onClick={handleTestSupabase}
                    disabled={isTestingSupabase}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingSupabase ? 'animate-spin' : ''}`} />
                    <span>{isTestingSupabase ? 'Probando...' : 'Probar Conexión'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncAllSupabase}
                    disabled={isSyncingAllSupabase}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-md shadow-emerald-500/20 disabled:opacity-50"
                  >
                    <UploadCloud className={`w-3.5 h-3.5 ${isSyncingAllSupabase ? 'animate-spin' : ''}`} />
                    <span>{isSyncingAllSupabase ? 'Subiendo todo...' : 'Subir Todo a Supabase'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Test connection alert */}
          {supabaseTestResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                supabaseTestResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              }`}
            >
              {supabaseTestResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <span className="font-semibold block">{supabaseTestResult.message}</span>
                {supabaseTestResult.accessibleTables && supabaseTestResult.accessibleTables.length > 0 && (
                  <span className="text-[11px] text-slate-400 block font-mono">
                    Tablas sincronizables: {supabaseTestResult.accessibleTables.join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Sync All Result Alert */}
          {supabaseSyncResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs ${
                supabaseSyncResult.success
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                  : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold">
                  {supabaseSyncResult.success ? '¡Sincronización completa con Supabase exitosa!' : 'Sincronización parcial completada'}
                </span>
              </div>
              {supabaseSyncResult.stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-[11px] font-mono mt-2">
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Usuarios</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.usersSynced ?? 0}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Feriados RD</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.holidaysSynced ?? 0}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Pedidos</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.ordersSynced}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Clientes</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.customersSynced}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Mensajes</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.messagesSynced}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Productos</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.productsSynced ?? 0}</span>
                  </div>
                  <div className="p-2 rounded bg-black/40 border border-white/[0.04]">
                    <span className="text-slate-400 block">Aprendizajes IA</span>
                    <span className="text-emerald-400 font-bold text-sm">{supabaseSyncResult.stats.insightsSynced}</span>
                  </div>
                </div>
              )}
              {supabaseSyncResult.stats?.errors?.length > 0 && (
                <div className="mt-2 text-[11px] text-amber-300/90 font-mono space-y-0.5">
                  <span className="font-bold block">Avisos de tablas no creadas aún (usa el botón "Script SQL de Tablas" para crearlas):</span>
                  {supabaseSyncResult.stats.errors.slice(0, 3).map((err: string, i: number) => (
                    <div key={i}>• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold flex items-center justify-between">
                <span>Supabase Project URL</span>
                <span className="text-[10px] text-slate-500 font-mono">https://xxxx.supabase.co</span>
              </label>
              <input
                type="text"
                placeholder="https://xyzcompany.supabase.co"
                value={supabaseUrl}
                readOnly={isReadOnly}
                onChange={e => setSupabaseUrl(e.target.value)}
                onBlur={e => {
                  if (isSuperAdmin) syncSupabaseConfigImmediately({ url: e.target.value.trim() });
                }}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-emerald-500'}`}
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold flex items-center justify-between">
                <span>Supabase Anon / Public Key (o Service Role)</span>
                <span className="text-[10px] text-slate-500 font-mono">eyJhbGciOi...</span>
              </label>
              <input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={supabaseAnonKey}
                readOnly={isReadOnly}
                onChange={e => setSupabaseAnonKey(e.target.value)}
                onBlur={e => {
                  if (isSuperAdmin) syncSupabaseConfigImmediately({ anonKey: e.target.value.trim() });
                }}
                className={`w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none ${isReadOnly ? 'opacity-80 cursor-not-allowed' : 'focus:border-emerald-500'}`}
              />
            </div>

            <div className="md:col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-emerald-300 text-[11px] font-mono">
              <span className="shrink-0">🔒</span>
              <span>Guardado en variables de entorno: <strong className="text-emerald-200">SUPABASE_URL</strong> y <strong className="text-emerald-200">SUPABASE_ANON_KEY</strong> (persistencia en <code className="bg-emerald-950/80 px-1 py-0.5 rounded text-emerald-400">.env</code> y servidor).</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
              <input
                type="checkbox"
                checked={supabaseAutoSync}
                disabled={isReadOnly}
                onChange={e => setSupabaseAutoSync(e.target.checked)}
                className="rounded border-white/20 bg-slate-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-50"
              />
              <span>Sincronizar automáticamente en tiempo real (nuevos pedidos, clientes y mensajes)</span>
            </label>

            <div className="flex items-center gap-3">
              {config.supabase?.lastSync && (
                <span className="text-[11px] text-slate-500 font-mono">
                  Última subida (RD): {new Date(config.supabase.lastSync).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}
                </span>
              )}
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={handleSaveSupabase}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-md shadow-emerald-600/20 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Guardar Credenciales Supabase</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 5: Notification Numbers */}
        <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-white/[0.06]">
            <PhoneCall className="w-4 h-4 text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Teléfonos de Notificación WhatsApp
              </h2>
              <span className="text-[11px] text-slate-500">
                Alertas automáticas para servicio técnico, pedidos y aprobaciones
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Teléfono del Equipo de Soporte / Técnico
              </label>
              <input
                type="text"
                value={teamPhone}
                onChange={e => setTeamPhone(e.target.value)}
                className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Teléfono del Administrador / Gerencia
              </label>
              <input
                type="text"
                value={adminPhone}
                onChange={e => setAdminPhone(e.target.value)}
                className="w-full bg-[#121822] border border-white/[0.07] rounded-lg px-3 py-2 text-slate-200 font-mono focus:outline-none focus:border-lime-500"
              />
            </div>
          </div>
        </div>
          </>
        )}

        {/* SECTION 6: Active Session & Logout */}
        {currentUser && (
          <div className="p-5 rounded-2xl bg-[#0F141C] border border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-950/70 border border-purple-500/40 flex items-center justify-center text-purple-300 font-black text-sm uppercase">
                {currentUser.nombre.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{currentUser.nombre}</span>
                  <span className="text-xs text-lime-400 font-mono">(@{currentUser.username})</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-white/[0.05] border border-white/[0.08] text-slate-300">
                    {currentUser.role === 'super_admin' ? 'Super Admin' : currentUser.role === 'dueno' ? 'Dueño' : 'Empleado'}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400">
                  WhatsApp: +{currentUser.whatsapp} · Sesión actual en Vendemá CRM
                </span>
              </div>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 hover:border-rose-400 text-rose-200 hover:text-white text-xs font-bold transition-all shadow-md shadow-rose-950/40 cursor-pointer"
                title="Cerrar sesión de forma segura y volver a la pantalla de acceso"
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>Cerrar Sesión / Salir del Sistema</span>
              </button>
            )}
          </div>
        )}

        {/* Submit (Super Admin Only) */}
        {isSuperAdmin && (
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-lime-500/20 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Guardando Ajustes...' : 'Guardar Configuración'}</span>
            </button>
          </div>
        )}
      </form>
      )}

      {/* SQL Schema Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D1219] border border-white/[0.1] rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-950/70 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    Script SQL para Crear Tablas en Supabase
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Copia y ejecuta este script en el SQL Editor de tu proyecto en Supabase para habilitar todas las tablas.
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

            {/* Step-by-step guidance */}
            <div className="px-4 py-3 bg-cyan-950/20 border-b border-cyan-900/30 text-xs text-cyan-200/90 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                <strong>Pasos:</strong> 1. Abre Supabase &gt; <strong>SQL Editor</strong> &gt; <strong>New Query</strong>. 2. Pega este código SQL. 3. Haz clic en <strong>Run</strong>. ¡Listo!
              </span>
            </div>

            {/* SQL Content Area */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#080B10]">
              <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed p-4 rounded-xl bg-black/60 border border-white/[0.05] overflow-x-auto select-all whitespace-pre">
                {schemaSql}
              </pre>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-4 border-t border-white/[0.08] bg-[#0A0E14] rounded-b-2xl">
              <span className="text-[11px] text-slate-400">
                Crea 9 tablas: <code>usuarios</code>, <code>calendario_feriados</code>, <code>configuracion_sistema</code>, <code>catalogo_productos</code>, <code>pedidos</code>, <code>contactos_whatsapp</code>, <code>conversaciones_todolapto</code>, <code>recordatorios_seguimiento</code> y <code>cerebro_ia_aprendizajes</code>.
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
