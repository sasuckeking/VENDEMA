import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { LiveInbox } from './components/LiveInbox';
import { InventoryView } from './components/InventoryView';
import { OrdersPipeline } from './components/OrdersPipeline';
import { CustomersView } from './components/CustomersView';
import { AIBrainView } from './components/AIBrainView';
import { SettingsView } from './components/SettingsView';
import { CreateOrderModal } from './components/CreateOrderModal';
import { LoginView } from './components/LoginView';
import { UsersView } from './components/UsersView';
import type { 
  AppConfig, 
  ProductItem, 
  Conversation, 
  CustomerLead, 
  SalesOrder, 
  AILearnedInsight, 
  OrderStatus,
  UserAccount
} from './types';
import { setGlobalHolidayOverrides } from './utils/businessSchedule';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem('vendema_auth_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('vendema_auth_token');
    } catch {
      return null;
    }
  });

  const [currentTab, setCurrentTab] = useState<string>('inbox');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    selectedSessionRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (currentUser?.role === 'empleado' && (currentTab === 'brain' || currentTab === 'users')) {
      setCurrentTab('inbox');
    }
  }, [currentUser, currentTab]);

  const handleLoginSuccess = (user: UserAccount, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    try {
      localStorage.setItem('vendema_auth_user', JSON.stringify(user));
      localStorage.setItem('vendema_auth_token', token);
    } catch {}
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setCurrentUser(null);
    setAuthToken(null);
    try {
      localStorage.removeItem('vendema_auth_user');
      localStorage.removeItem('vendema_auth_token');
    } catch {}
  };

  const lastConfigSaveRef = useRef<number>(0);
  const hasHydratedLocalConfigRef = useRef<boolean>(false);

  // App Configuration (initialized with localStorage AI credentials if available)
  const [config, setConfig] = useState<AppConfig>(() => {
    let savedAi: AppConfig['aiProvider'] | undefined = undefined;
    try {
      const raw = localStorage.getItem('vendema_ai_provider_config');
      if (raw) {
        savedAi = JSON.parse(raw);
      }
    } catch {}
    return {
      globalAiActive: true,
      ...(savedAi ? { aiProvider: savedAi } : {}),
      odoo: {
        url: 'https://todolapto.com.do/jsonrpc',
        db: 'odoo',
        uid: 22,
        apiKey: '',
        connected: true,
      },
      evolution: {
        serverUrl: 'https://evolution-evolution-api.blrfh6.easypanel.host',
        instance: 'todolapto',
        apiKey: '',
        teamPhone: '18492588738',
        adminPhone: '18496260800',
        connected: true,
      },
      holidayOverrides: [],
    };
  });

  useEffect(() => {
    setGlobalHolidayOverrides(config.holidayOverrides || []);
  }, [config.holidayOverrides]);

  // State
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [customers, setCustomers] = useState<CustomerLead[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [insights, setInsights] = useState<AILearnedInsight[]>([]);
  const [isSyncingOdoo, setIsSyncingOdoo] = useState(false);
  const [isSyncingEvolution, setIsSyncingEvolution] = useState(false);
  const [isSyncingCustomers, setIsSyncingCustomers] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Order modal state
  const [createOrderModalOpen, setCreateOrderModalOpen] = useState(false);
  const [orderPrefill, setOrderPrefill] = useState<any>({});

  // Smart 1:1 WhatsApp mirror merger: preserves every real WhatsApp message (evolutionMessageId) without hiding duplicates,
  // Smart 1:1 WhatsApp mirror merger: preserves every real WhatsApp message (evolutionMessageId) without hiding duplicates,
  // while keeping recent optimistic local messages until Evolution API indexes them
  const mergeMessagesList = (
    existing: Conversation['messages'] = [],
    incoming: Conversation['messages'] = [],
    isAuthoritativeFullLoad = false
  ) => {
    const combined = [...incoming];
    const claimedIncomingIndices = new Set<number>();
    const isFullIncomingRefresh = isAuthoritativeFullLoad || incoming.length >= 2;
    const nowMs = Date.now();

    for (const oldMsg of existing) {
      const oldTime = new Date(oldMsg.timestamp).getTime();
      const oldText = (oldMsg.content || '').trim();

      // 1. Exact ID or evolutionMessageId match
      let existsIdx = combined.findIndex(inc => {
        if (inc.id === oldMsg.id) return true;
        if (oldMsg.evolutionMessageId && inc.evolutionMessageId === oldMsg.evolutionMessageId) return true;
        return false;
      });

      // 2. Semantic content proximity match (prevent identical messages sent/received within 45s from duplicating)
      if (existsIdx < 0) {
        existsIdx = combined.findIndex((inc, idx) => {
          if (claimedIncomingIndices.has(idx)) return false;
          if (
            inc.sender === oldMsg.sender &&
            inc.type === oldMsg.type &&
            oldText.length > 0 &&
            (inc.content || '').trim() === oldText &&
            Math.abs(new Date(inc.timestamp).getTime() - oldTime) < 45000
          ) {
            return true;
          }
          return false;
        });
        if (existsIdx >= 0) {
          claimedIncomingIndices.add(existsIdx);
        }
      }

      if (existsIdx >= 0) {
        if (oldMsg.quotedMessage && !combined[existsIdx].quotedMessage) {
          combined[existsIdx] = { ...combined[existsIdx], quotedMessage: oldMsg.quotedMessage };
        }
        if (oldMsg.mediaUrl && !combined[existsIdx].mediaUrl) {
          combined[existsIdx] = { ...combined[existsIdx], mediaUrl: oldMsg.mediaUrl };
        }
        if (oldMsg.transcription && !combined[existsIdx].transcription) {
          combined[existsIdx] = { ...combined[existsIdx], transcription: oldMsg.transcription };
        }
        if (oldMsg.aiAnalysis && !combined[existsIdx].aiAnalysis) {
          combined[existsIdx] = { ...combined[existsIdx], aiAnalysis: oldMsg.aiAnalysis };
        }
      } else {
        // When incoming is a full authoritative load from /messages, do NOT keep old unmatched evolutionMessageId messages
        // unless they arrived in the last 25 seconds (e.g., via SSE before Evolution API indexed them)
        if ((!isAuthoritativeFullLoad && oldMsg.evolutionMessageId) || !isFullIncomingRefresh || nowMs - oldTime < 25000) {
          combined.push(oldMsg);
        }
      }
    }
    combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Strict deduplication pass: discard duplicate IDs or identical content within 45s
    const deduped: Conversation['messages'] = [];
    const seenIds = new Set<string>();

    for (const m of combined) {
      const evoId = m.evolutionMessageId || '';
      const mId = m.id || '';
      if (evoId && seenIds.has(evoId)) continue;
      if (mId && seenIds.has(mId)) continue;

      const mText = (m.content || '').trim();
      const mTime = new Date(m.timestamp).getTime();

      const isSemanticDupe = deduped.some(
        d =>
          d.sender === m.sender &&
          d.type === m.type &&
          mText.length > 0 &&
          (d.content || '').trim() === mText &&
          Math.abs(new Date(d.timestamp).getTime() - mTime) < 45000
      );

      if (isSemanticDupe) continue;

      if (evoId) seenIds.add(evoId);
      if (mId) seenIds.add(mId);
      deduped.push(m);
    }

    return deduped;
  };

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

  // Merge incoming conversation list while preserving already-loaded message histories, unifying LID/phone duplicates, and keeping order stable
  const mergeConversations = (incomingList: Conversation[]) => {
    setConversations(prev => {
      if (prev.length === 0) {
        // Deduplicate incomingList before returning
        const finalDedup: Conversation[] = [];
        const seenPhones = new Set<string>();
        const seenNames = new Set<string>();
        const seenSessions = new Set<string>();
        for (const c of incomingList) {
          if (seenSessions.has(c.sessionId)) continue;
          const phone = c.customerPhone && c.customerPhone.length <= 12 ? c.customerPhone : '';
          const nameKey = !isGenericContactName(c.customerName) ? c.customerName.trim().toLowerCase() : '';
          if (phone && seenPhones.has(phone)) continue;
          if (!phone && nameKey && seenNames.has(nameKey)) continue;
          seenSessions.add(c.sessionId);
          if (phone) seenPhones.add(phone);
          if (nameKey) seenNames.add(nameKey);
          finalDedup.push(c);
        }
        return finalDedup;
      }

      // Track consumed previous conversations so duplicates across prev and incoming are unified
      const claimedPrevSessionIds = new Set<string>();

      const findMatchingPrev = (inc: Conversation): Conversation | undefined => {
        // 1. Exact sessionId
        const exact = prev.find(p => !claimedPrevSessionIds.has(p.sessionId) && p.sessionId === inc.sessionId);
        if (exact) return exact;

        // 2. Exact real phone number (<= 12 digits) or matching phone digits in sessionId
        const incDigits = (inc.customerPhone || inc.sessionId || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (inc.customerPhone && inc.customerPhone.length <= 12) {
          const byPhone = prev.find(
            p =>
              !claimedPrevSessionIds.has(p.sessionId) &&
              ((p.customerPhone && p.customerPhone === inc.customerPhone) ||
                p.sessionId.replace(/@.*$/, '').replace(/\D/g, '') === inc.customerPhone)
          );
          if (byPhone) return byPhone;
        }
        if (incDigits) {
          const bySessionDigits = prev.find(p => {
            if (claimedPrevSessionIds.has(p.sessionId)) return false;
            const pDigits = (p.customerPhone || p.sessionId || '').replace(/@.*$/, '').replace(/\D/g, '');
            return pDigits === incDigits;
          });
          if (bySessionDigits) return bySessionDigits;
        }

        // 3. Non-generic customerName match ONLY if they don't have two different real phone numbers
        if (!isGenericContactName(inc.customerName)) {
          const incNorm = inc.customerName.trim().toLowerCase();
          const incRealPhone = inc.customerPhone && inc.customerPhone.length <= 12 ? inc.customerPhone : '';
          const byName = prev.find(p => {
            if (claimedPrevSessionIds.has(p.sessionId)) return false;
            if (isGenericContactName(p.customerName)) return false;
            if (p.customerName.trim().toLowerCase() !== incNorm) return false;
            const pRealPhone = p.customerPhone && p.customerPhone.length <= 12 ? p.customerPhone : '';
            if (incRealPhone && pRealPhone && incRealPhone !== pRealPhone) return false;
            return true;
          });
          if (byName) return byName;
        }

        return undefined;
      };

      const mergedList: Conversation[] = [];
      const sessionMigrationMap = new Map<string, string>(); // oldSessionId -> canonicalSessionId
      let anyNewerMessage = false;

      for (const inc of incomingList) {
        const existingPrev = findMatchingPrev(inc);
        if (existingPrev) {
          claimedPrevSessionIds.add(existingPrev.sessionId);
        }

        const mergedMessages = existingPrev
          ? mergeMessagesList(existingPrev.messages, inc.messages)
          : inc.messages || [];

        const prevTime = existingPrev ? new Date(existingPrev.lastTimestamp).getTime() : 0;
        const incTime = new Date(inc.lastTimestamp).getTime();
        const hasNewerIncoming = incTime > prevTime + 1000;
        if (!existingPrev || incTime > prevTime + 2000) {
          anyNewerMessage = true;
        }

        // Canonical sessionId: keep existingPrev.sessionId if already active to avoid JID flicker
        let canonicalSessionId = existingPrev?.sessionId || inc.sessionId;
        if (canonicalSessionId.endsWith('@lid') && inc.sessionId.endsWith('@s.whatsapp.net')) {
          canonicalSessionId = inc.sessionId;
        } else if (
          canonicalSessionId.endsWith('@lid') &&
          inc.customerPhone &&
          inc.customerPhone.length <= 12 &&
          inc.customerPhone.startsWith('1')
        ) {
          canonicalSessionId = `${inc.customerPhone}@s.whatsapp.net`;
        }

        if (existingPrev && existingPrev.sessionId !== canonicalSessionId) {
          sessionMigrationMap.set(existingPrev.sessionId, canonicalSessionId);
        }
        if (inc.sessionId !== canonicalSessionId) {
          sessionMigrationMap.set(inc.sessionId, canonicalSessionId);
        }

        // Canonical phone: prefer real phone (<= 12 digits) over raw LID (> 12 digits)
        const bestPhone =
          inc.customerPhone && inc.customerPhone.length <= 12
            ? inc.customerPhone
            : existingPrev?.customerPhone && existingPrev.customerPhone.length <= 12
            ? existingPrev.customerPhone
            : inc.customerPhone;

        const bestName =
          !isGenericContactName(inc.customerName)
            ? inc.customerName
            : existingPrev && !isGenericContactName(existingPrev.customerName)
            ? existingPrev.customerName
            : inc.customerName;

        const merged: Conversation = {
          ...inc,
          sessionId: canonicalSessionId,
          customerPhone: bestPhone,
          customerName: bestName,
          profilePicUrl: inc.profilePicUrl || existingPrev?.profilePicUrl,
          messages: mergedMessages,
          messagesLoaded: existingPrev?.messagesLoaded || inc.messagesLoaded,
          lastTimestamp: hasNewerIncoming ? inc.lastTimestamp : existingPrev?.lastTimestamp || inc.lastTimestamp,
          lastMessagePreview: hasNewerIncoming
            ? inc.lastMessagePreview
            : existingPrev?.lastMessagePreview || inc.lastMessagePreview,
          unreadCount:
            selectedSessionRef.current === canonicalSessionId ||
            selectedSessionRef.current === inc.sessionId ||
            (existingPrev && selectedSessionRef.current === existingPrev.sessionId)
              ? 0
              : inc.unreadCount,
        };

        mergedList.push(merged);
      }

      // If active session was an LID that migrated to a real phone session, update selectedSession
      if (selectedSessionRef.current && sessionMigrationMap.has(selectedSessionRef.current)) {
        const newId = sessionMigrationMap.get(selectedSessionRef.current)!;
        selectedSessionRef.current = newId;
        setSelectedSessionId(newId);
      }

      const incomingBySession = new Map<string, Conversation>(mergedList.map(c => [c.sessionId, c]));
      let candidateList: Conversation[] = [];

      if (!anyNewerMessage) {
        for (const oldConv of prev) {
          if (claimedPrevSessionIds.has(oldConv.sessionId)) {
            const migratedId = sessionMigrationMap.get(oldConv.sessionId) || oldConv.sessionId;
            const updated = incomingBySession.get(migratedId);
            if (updated) {
              candidateList.push(updated);
              incomingBySession.delete(migratedId);
            }
          } else {
            const updated = incomingBySession.get(oldConv.sessionId);
            if (updated) {
              candidateList.push(updated);
              incomingBySession.delete(oldConv.sessionId);
            } else {
              candidateList.push(oldConv);
            }
          }
        }
        for (const remaining of incomingBySession.values()) {
          candidateList.push(remaining);
        }
      } else {
        candidateList = Array.from(incomingBySession.values());
        candidateList.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
      }

      // Strict final deduplication pass: eliminate all duplicate contacts and merge matching LID/phone sessions
      const finalDedup: Conversation[] = [];
      const seenPhones = new Map<string, number>();
      const seenNames = new Map<string, number>();

      for (const c of candidateList) {
        const phone = c.customerPhone && c.customerPhone.length <= 12 ? c.customerPhone : '';
        const nameKey = !isGenericContactName(c.customerName) ? c.customerName.trim().toLowerCase() : '';

        const existingIdx = (phone && seenPhones.has(phone))
          ? seenPhones.get(phone)!
          : (nameKey && seenNames.has(nameKey))
          ? seenNames.get(nameKey)!
          : -1;

        if (existingIdx >= 0) {
          const existing = finalDedup[existingIdx];
          existing.messages = mergeMessagesList(existing.messages, c.messages);
          if (existing.sessionId.endsWith('@lid') && (c.sessionId.endsWith('@s.whatsapp.net') || phone)) {
            existing.sessionId = c.sessionId;
            existing.customerPhone = phone || existing.customerPhone;
          }
          if (isGenericContactName(existing.customerName) && !isGenericContactName(c.customerName)) {
            existing.customerName = c.customerName;
          }
          continue;
        }

        const newIdx = finalDedup.length;
        if (phone) seenPhones.set(phone, newIdx);
        if (nameKey) seenNames.set(nameKey, newIdx);
        finalDedup.push(c);
      }

      return finalDedup;
    });
  };

  // Safe JSON Fetch Helper to prevent SyntaxError: Unexpected token '<'
  const safeFetch = async (url: string, options?: RequestInit): Promise<any> => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Load full message thread (including voice notes, images, videos) for a specific chat
  const handleRefreshMessages = async (sessionId: string, silent = false) => {
    if (!sessionId || sessionId === 'undefined' || sessionId === 'null') return;
    if (!silent) {
      setIsLoadingMessages(true);
    }
    try {
      const refreshParam = !silent ? '?refresh=true' : '';
      let data = await safeFetch(`/api/conversations/${encodeURIComponent(sessionId)}/messages${refreshParam}`);
      if (!data) {
        data = await safeFetch(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`);
      }

      if (data && data.success && data.messages) {
        setConversations(prev =>
          prev.map(c => {
            const isTargetChat =
              c.sessionId === sessionId ||
              c.sessionId === data.sessionId ||
              (c.customerPhone &&
                data.customerPhone &&
                c.customerPhone.replace(/\D/g, '') === String(data.customerPhone).replace(/\D/g, ''));

            if (isTargetChat) {
              const mergedMsgs = mergeMessagesList(c.messages, data.messages, true);
              const isUnchanged =
                c.messagesLoaded &&
                c.unreadCount === 0 &&
                mergedMsgs.length === c.messages.length &&
                mergedMsgs.every((m, idx) => {
                  const old = c.messages[idx];
                  return (
                    old &&
                    old.id === m.id &&
                    old.content === m.content &&
                    old.transcription === m.transcription &&
                    old.aiAnalysis === m.aiAnalysis &&
                    old.quotedMessage?.text === m.quotedMessage?.text
                  );
                });

              if (isUnchanged) {
                return c;
              }

              return {
                ...c,
                messages: mergedMsgs,
                messagesLoaded: true,
                unreadCount: 0,
              };
            }
            return c;
          })
        );
      }
    } catch (err) {
      console.warn('Notice loading messages for chat:', err);
    } finally {
      if (!silent) {
        setIsLoadingMessages(false);
      }
    }
  };

  // Load initial data from server
  const loadData = async (isPoll = false) => {
    const fetchStartedAt = Date.now();
    try {
      const [configData, productsData, convData, custData, ordersData, insightsData] =
        await Promise.all([
          safeFetch('/api/config'),
          safeFetch('/api/odoo/products'),
          safeFetch('/api/conversations'),
          safeFetch('/api/customers'),
          safeFetch('/api/orders'),
          safeFetch('/api/ai/insights'),
        ]);

      // Do not let an in-flight background poll overwrite a config save that occurred after or within 10s of this poll
      const configRecentlySaved = Date.now() - lastConfigSaveRef.current < 10000 || fetchStartedAt < lastConfigSaveRef.current;

      if (configData && configData.success && configData.config && (!isPoll || !configRecentlySaved)) {
        let loadedConfig = configData.config;

        // Hydrate localStorage AI credentials only once on initial mount if server is missing keys that browser has
        if (!hasHydratedLocalConfigRef.current) {
          hasHydratedLocalConfigRef.current = true;
          try {
            const savedAiRaw = localStorage.getItem('vendema_ai_provider_config');
            if (savedAiRaw) {
              const savedAi = JSON.parse(savedAiRaw);
              const serverAi = loadedConfig.aiProvider || {};
              const isSavedRealKey = Boolean(
                savedAi.openaiApiKey &&
                !String(savedAi.openaiApiKey).includes('••••') &&
                !String(savedAi.openaiApiKey).includes('****')
              );
              const isServerMissingKey = !serverAi.openaiApiKey;
              const needsPushToServer = isSavedRealKey && isServerMissingKey;

              const validModels = ['gpt-4o-mini', 'gpt-4o', 'o3-mini'];
              const resolvedModel = validModels.includes(serverAi.model)
                ? serverAi.model
                : validModels.includes(savedAi.model)
                ? savedAi.model
                : 'gpt-4o-mini';

              const mergedAi = {
                ...savedAi,
                ...serverAi,
                provider: 'openai' as const,
                model: resolvedModel,
                openaiApiKey: (serverAi.openaiApiKey || (isSavedRealKey ? savedAi.openaiApiKey : '') || '').trim(),
                deepseekApiKey: '',
                geminiApiKey: '',
              };
              loadedConfig = { ...loadedConfig, aiProvider: mergedAi };

              if (needsPushToServer) {
                fetch('/api/ai/save-credentials', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...mergedAi, openaiApiKey: savedAi.openaiApiKey.trim() }),
                }).catch(() => {});
              }
            }
          } catch {}
        }

        setGlobalHolidayOverrides(loadedConfig.holidayOverrides || []);
        setConfig(prev => {
          if (JSON.stringify(prev) === JSON.stringify(loadedConfig)) {
            return prev;
          }
          return loadedConfig;
        });
      }
      if (productsData?.success && productsData.products) {
        setProducts(productsData.products);
      }
      if (convData?.success && convData.conversations) {
        mergeConversations(convData.conversations);
        if (convData.conversations.length === 0) {
          selectedSessionRef.current = null;
          setSelectedSessionId(null);
        } else if (!selectedSessionRef.current) {
          const firstId = convData.conversations[0].sessionId;
          setSelectedSessionId(firstId);
        }
      }
      if (custData?.success && custData.customers) {
        setCustomers(custData.customers);
      }
      if (ordersData?.success && ordersData.orders) {
        setOrders(ordersData.orders);
      }
      if (insightsData?.success && insightsData.insights) {
        setInsights(insightsData.insights);
      }
    } catch (err) {
      console.warn('Initial load error:', err);
    }
  };

  // Load full message history whenever user switches conversation
  useEffect(() => {
    if (selectedSessionId) {
      handleRefreshMessages(selectedSessionId);
    }
  }, [selectedSessionId]);

  // Subscribe to Server-Sent Events (SSE) + periodic poll for real-time updates
  useEffect(() => {
    loadData();

    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'inventory_update') {
          fetch('/api/odoo/products')
            .then(r => r.json())
            .then(d => {
              if (d.success && d.products) setProducts(d.products);
            });
        } else if (
          (payload.type === 'new_message' || payload.type === 'message_updated') &&
          payload.sessionId &&
          payload.message
        ) {
          setConversations(prev =>
            prev.map(c => {
              if (c.sessionId === payload.sessionId) {
                const mergedMsgs = mergeMessagesList(c.messages, [payload.message]);
                return {
                  ...c,
                  messages: mergedMsgs,
                  lastMessagePreview: payload.message.content || c.lastMessagePreview,
                  lastTimestamp: payload.message.timestamp || c.lastTimestamp,
                };
              }
              return c;
            })
          );
        } else if (payload.type === 'chat_ai_toggled') {
          setConversations(prev =>
            prev.map(c => {
              if (
                c.sessionId === payload.sessionId ||
                (payload.customerPhone && c.customerPhone === payload.customerPhone)
              ) {
                return { ...c, aiEnabled: payload.aiEnabled };
              }
              return c;
            })
          );
        } else if (payload.type === 'whatsapp_statuses_updated' && Array.isArray(payload.payload)) {
          setConfig(prev => ({ ...prev, activeWhatsAppStatuses: payload.payload }));
        } else if (payload.type === 'evolution_status' && payload.payload) {
          const isConnected = Boolean(payload.payload.connected);
          setConfig(prev => ({ ...prev, evolution: { ...prev.evolution, connected: isConnected } }));
          if (!isConnected) {
            setConversations([]);
            selectedSessionRef.current = null;
            setSelectedSessionId(null);
          }
        } else if (payload.type === 'conversations_update') {
          const isCleared = Boolean(payload.payload?.cleared);
          if (isCleared) {
            setConversations([]);
            selectedSessionRef.current = null;
            setSelectedSessionId(null);
          }
          fetch('/api/conversations')
            .then(r => r.json())
            .then(d => {
              if (d.success && d.conversations) {
                mergeConversations(d.conversations);
                if (d.conversations.length === 0) {
                  selectedSessionRef.current = null;
                  setSelectedSessionId(null);
                }
              }
            });
          if (selectedSessionRef.current && !isCleared) {
            handleRefreshMessages(selectedSessionRef.current, true);
          }
        } else if (payload.type === 'config_updated' && payload.payload) {
          setGlobalHolidayOverrides(payload.payload.holidayOverrides || []);
          setConfig(payload.payload);
        }
      } catch {
        // Ignore parse errors
      }
    };

    const interval = setInterval(() => {
      loadData(true);
      if (selectedSessionRef.current) {
        handleRefreshMessages(selectedSessionRef.current, true);
      }
    }, 4000);

    return () => {
      eventSource.close();
      clearInterval(interval);
    };
  }, []);

  // Handlers
  const handleToggleGlobalAi = async () => {
    const nextState = !config.globalAiActive;
    setConfig(prev => ({ ...prev, globalAiActive: nextState }));
    try {
      const token = localStorage.getItem('vendema_auth_token');
      await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ globalAiActive: nextState }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleAiForChat = async (sessionId: string) => {
    const current = conversations.find(c => c.sessionId === sessionId);
    const nextState = current ? !current.aiEnabled : false;
    setConversations(prev =>
      prev.map(c =>
        c.sessionId === sessionId || (current?.customerPhone && c.customerPhone === current.customerPhone)
          ? { ...c, aiEnabled: nextState }
          : c
      )
    );
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(sessionId)}/toggle-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState }),
      });
      const data = await res.json();
      if (data.success) {
        setConversations(prev =>
          prev.map(c =>
            c.sessionId === sessionId || (current?.customerPhone && c.customerPhone === current.customerPhone)
              ? { ...c, aiEnabled: data.aiEnabled }
              : c
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendMessage = async (
    sessionId: string,
    text: string,
    quotedMessage?: Conversation['messages'][number]['quotedMessage']
  ) => {
    const optimisticId = `msg-${Date.now()}-opt`;
    const optimisticMsg: Conversation['messages'][number] = {
      id: optimisticId,
      sender: 'agent',
      type: 'text',
      content: text,
      quotedMessage,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    // Optimistically add message immediately so UI is instant
    setConversations(prev =>
      prev.map(c => {
        if (c.sessionId === sessionId) {
          return {
            ...c,
            messages: mergeMessagesList(c.messages, [optimisticMsg]),
            lastMessagePreview: text,
            lastTimestamp: optimisticMsg.timestamp,
          };
        }
        return c;
      })
    );

    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(sessionId)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, quotedMessage }),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setConversations(prev =>
          prev.map(c => {
            if (c.sessionId === sessionId) {
              const withoutOpt = c.messages.filter(m => m.id !== optimisticId);
              return {
                ...c,
                messages: mergeMessagesList(withoutOpt, [data.message]),
                lastMessagePreview: text,
                lastTimestamp: data.message.timestamp,
              };
            }
            return c;
          })
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendMedia = async (
    sessionId: string,
    payload: {
      mediaType: 'image' | 'video' | 'audio' | 'document';
      base64Data: string;
      mimeType: string;
      caption?: string;
      fileName?: string;
    }
  ) => {
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(sessionId)}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setConversations(prev =>
          prev.map(c => {
            if (c.sessionId === sessionId) {
              return {
                ...c,
                messages: mergeMessagesList(c.messages, [data.message]),
                lastMessagePreview: data.message.content,
                lastTimestamp: data.message.timestamp,
              };
            }
            return c;
          })
        );
      }
    } catch (err) {
      console.error('Error sending media:', err);
    }
  };

  const handleSyncEvolution = async () => {
    setIsSyncingEvolution(true);
    try {
      const res = await fetch('/api/conversations?refresh=true');
      const data = await res.json();
      if (data.success && data.conversations) {
        mergeConversations(data.conversations);
      }
      if (selectedSessionId) {
        await handleRefreshMessages(selectedSessionId);
      }
    } catch (err) {
      console.error('Error syncing Evolution API:', err);
    } finally {
      setIsSyncingEvolution(false);
    }
  };

  const handleTriggerLearning = async (sessionId: string) => {
    const res = await fetch('/api/ai/learn-from-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const insRes = await fetch('/api/ai/insights');
    const insData = await insRes.json();
    if (insData.success) setInsights(insData.insights);
  };

  const handleTriggerGlobalLearning = async () => {
    if (conversations.length === 0) return;
    for (const conv of conversations.slice(0, 3)) {
      await fetch('/api/ai/learn-from-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: conv.sessionId }),
      });
    }
    const insRes = await fetch('/api/ai/insights');
    const insData = await insRes.json();
    if (insData.success) setInsights(insData.insights);
  };

  const handleAddInsight = async (newInsight: Partial<AILearnedInsight>) => {
    const res = await fetch('/api/ai/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newInsight),
    });
    const data = await res.json();
    if (data.success && data.insight) {
      setInsights(prev => [data.insight, ...prev]);
    }
  };

  const handleRefreshOdoo = async () => {
    setIsSyncingOdoo(true);
    try {
      const res = await fetch('/api/odoo/products?refresh=true');
      const data = await res.json();
      if (data.success && data.products) {
        setProducts(data.products);
        setConfig(prev => ({
          ...prev,
          odoo: { ...prev.odoo, lastSync: data.lastSync },
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncingOdoo(false);
    }
  };

  const handleCreateOrder = async (orderData: any) => {
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });
      const data = await res.json();
      if (data.success && data.order) {
        setOrders(prev => [data.order, ...prev]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus, adminNotes?: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNotes }),
      });
      const data = await res.json();
      if (data.success && data.order) {
        setOrders(prev => prev.map(o => (o.id === orderId ? data.order : o)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCustomer = async (custData: Partial<CustomerLead>) => {
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(custData),
      });
      const data = await res.json();
      if (data.success && data.customer) {
        setCustomers(prev => [data.customer, ...prev.filter(c => c.phone !== data.customer.phone)]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefreshCustomers = async () => {
    setIsSyncingCustomers(true);
    try {
      const res = await fetch('/api/customers');
      const data = await res.json();
      if (data.success && data.customers) {
        setCustomers(data.customers);
      }
    } catch (err) {
      console.error('Error refreshing customers:', err);
    } finally {
      setIsSyncingCustomers(false);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<AppConfig>) => {
    lastConfigSaveRef.current = Date.now();

    // Immediately update local state & localStorage so UI and refreshes never lose the saved API keys
    setConfig(prev => {
      const merged: AppConfig = {
        ...prev,
        ...newConfig,
        aiProvider: newConfig.aiProvider
          ? { ...prev.aiProvider, ...newConfig.aiProvider }
          : prev.aiProvider,
        odoo: newConfig.odoo ? { ...prev.odoo, ...newConfig.odoo } : prev.odoo,
        evolution: newConfig.evolution ? { ...prev.evolution, ...newConfig.evolution } : prev.evolution,
        supabase: newConfig.supabase ? { ...(prev.supabase || { url: '', anonKey: '' }), ...newConfig.supabase } : prev.supabase,
      };
      if (merged.aiProvider) {
        try {
          localStorage.setItem('vendema_ai_provider_config', JSON.stringify(merged.aiProvider));
        } catch {}
      }
      if (merged.supabase) {
        try {
          localStorage.setItem('vendema_supabase_config', JSON.stringify(merged.supabase));
        } catch {}
      }
      return merged;
    });

    try {
      const token = localStorage.getItem('vendema_auth_token');
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(newConfig),
      });
      const data = await res.json();
      if (data.success && data.config) {
        lastConfigSaveRef.current = Date.now();
        if (data.config.aiProvider) {
          try {
            localStorage.setItem('vendema_ai_provider_config', JSON.stringify(data.config.aiProvider));
          } catch {}
        }
        setConfig(data.config);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openCreateOrderModal = (prefillData: any = {}) => {
    setOrderPrefill(prefillData);
    setCreateOrderModalOpen(true);
  };

  const handleSelectCustomerChat = (phone: string) => {
    const target = conversations.find(c => c.customerPhone.includes(phone));
    if (target) {
      setSelectedSessionId(target.sessionId);
    }
    setCurrentTab('inbox');
  };

  if (!currentUser) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#090D12] text-slate-100 overflow-hidden">
      {/* Top Bar Navigation */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        config={config}
        onUpdateConfig={handleUpdateConfig}
        onToggleGlobalAi={handleToggleGlobalAi}
        isSyncing={isSyncingOdoo || isSyncingEvolution}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Workspace Views */}
      <main className="flex-1 flex overflow-hidden">
        {currentTab === 'users' && (
          <UsersView currentUser={currentUser} onLogout={handleLogout} />
        )}
        {currentTab === 'inbox' && (
          <LiveInbox
            conversations={conversations}
            selectedSessionId={selectedSessionId}
            onSelectConversation={setSelectedSessionId}
            onToggleAiForChat={handleToggleAiForChat}
            onSendMessage={handleSendMessage}
            onSendMedia={handleSendMedia}
            onRefreshMessages={handleRefreshMessages}
            onSyncEvolution={handleSyncEvolution}
            isSyncingEvolution={isSyncingEvolution}
            isLoadingMessages={isLoadingMessages}
            onTriggerLearning={handleTriggerLearning}
            onOpenCreateOrder={openCreateOrderModal}
            products={products}
            customers={customers}
            globalAiActive={config.globalAiActive}
          />
        )}

        {currentTab === 'inventory' && (
          <InventoryView
            products={products}
            onRefreshOdoo={handleRefreshOdoo}
            isSyncing={isSyncingOdoo}
            lastSync={config.odoo.lastSync}
            onOpenCreateOrder={openCreateOrderModal}
          />
        )}

        {currentTab === 'orders' && (
          <OrdersPipeline
            orders={orders}
            onUpdateOrderStatus={handleUpdateOrderStatus}
            onOpenCreateOrderModal={() => openCreateOrderModal()}
            onSelectChat={handleSelectCustomerChat}
          />
        )}

        {currentTab === 'customers' && (
          <CustomersView
            customers={customers}
            onSelectChat={handleSelectCustomerChat}
            onOpenCreateOrder={openCreateOrderModal}
            onCreateCustomer={handleCreateCustomer}
            onRefreshCustomers={handleRefreshCustomers}
            isSyncing={isSyncingCustomers}
          />
        )}

        {currentTab === 'brain' && (
          <AIBrainView
            insights={insights}
            config={config}
            onUpdateConfig={handleUpdateConfig}
            onAddInsight={handleAddInsight}
            onTriggerGlobalLearning={handleTriggerGlobalLearning}
            currentUser={currentUser}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            config={config}
            onUpdateConfig={handleUpdateConfig}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        )}
      </main>

      {/* Global Create Order in Odoo Modal */}
      <CreateOrderModal
        isOpen={createOrderModalOpen}
        onClose={() => setCreateOrderModalOpen(false)}
        products={products}
        customers={customers}
        prefill={orderPrefill}
        onCreateOrder={handleCreateOrder}
      />
    </div>
  );
}
