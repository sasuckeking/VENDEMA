import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Search, 
  Send, 
  Bot, 
  UserCheck, 
  Pause, 
  Play, 
  Sparkles, 
  Package, 
  CreditCard, 
  BrainCircuit, 
  CheckCircle2, 
  Eye, 
  User,
  Mic,
  Square,
  Image as ImageIcon,
  Video,
  FileText,
  RefreshCw,
  Volume2,
  Wand2,
  Reply,
  MapPin,
  ShieldCheck,
  Truck,
  Zap,
  Clock,
  X
} from 'lucide-react';
import type { Conversation, ProductItem, CustomerLead, ChatMessage } from '../types';
import { getDominicanTimeContext, formatDominicanTimeOnly } from '../utils/businessSchedule';
import { BotAuditLogPanel } from './BotAuditLogPanel';

interface LiveInboxProps {
  conversations: Conversation[];
  selectedSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onToggleAiForChat: (sessionId: string) => void;
  onSendMessage: (
    sessionId: string,
    text: string,
    quotedMessage?: ChatMessage['quotedMessage']
  ) => Promise<void>;
  onSendMedia: (
    sessionId: string,
    payload: { mediaType: 'image' | 'video' | 'audio' | 'document'; base64Data: string; mimeType: string; caption?: string; fileName?: string }
  ) => Promise<void>;
  onRefreshMessages: (sessionId: string) => Promise<void>;
  onSyncEvolution: () => Promise<void>;
  isSyncingEvolution?: boolean;
  isLoadingMessages?: boolean;
  onTriggerLearning: (sessionId: string) => Promise<void>;
  onOpenCreateOrder: (prefill: { clientName: string; clientPhone: string; address?: string }) => void;
  products: ProductItem[];
  customers: CustomerLead[];
  globalAiActive: boolean;
}

const ContactAvatar: React.FC<{
  src?: string;
  name?: string;
  className?: string;
  fallbackClassName?: string;
}> = ({
  src,
  name,
  className = 'w-10 h-10 rounded-full object-cover border border-white/[0.08]',
  fallbackClassName = 'w-10 h-10 rounded-full bg-[#18212E] border border-white/[0.06] flex items-center justify-center font-bold text-slate-200 text-sm shrink-0',
}) => {
  const [hasError, setHasError] = useState(false);
  const initial = (name || 'C').trim().charAt(0).toUpperCase() || 'C';

  if (!src || hasError) {
    return <div className={fallbackClassName}>{initial}</div>;
  }

  return (
    <img
      src={src}
      alt={name || 'Avatar'}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onError={() => setHasError(true)}
    />
  );
};

export const LiveInbox: React.FC<LiveInboxProps> = ({
  conversations,
  selectedSessionId,
  onSelectConversation,
  onToggleAiForChat,
  onSendMessage,
  onSendMedia,
  onRefreshMessages,
  onSyncEvolution,
  isSyncingEvolution = false,
  isLoadingMessages = false,
  onTriggerLearning,
  onOpenCreateOrder,
  products,
  customers,
  globalAiActive,
}) => {
  const [liveRdTime, setLiveRdTime] = useState(() => getDominicanTimeContext());
  useEffect(() => {
    const update = () => setLiveRdTime(getDominicanTimeContext());
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'ai_active' | 'ai_paused' | 'media'>('all');
  const [inputMessage, setInputMessage] = useState('');
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);
  const [isAutoReplying, setIsAutoReplying] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [learningNotification, setLearningNotification] = useState<string | null>(null);
  const [selectedImageModal, setSelectedImageModal] = useState<string | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState<'all' | 'laptop' | 'accesorio'>('all');
  const [sendingProductId, setSendingProductId] = useState<number | null>(null);
  const [failedPickerImages, setFailedPickerImages] = useState<Record<number, boolean>>({});
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // Dominican Republic business schedule state
  const [rdTime, setRdTime] = useState(() => getDominicanTimeContext());
  useEffect(() => {
    const timer = setInterval(() => {
      setRdTime(getDominicanTimeContext());
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // AI Transcription & Image Analysis state per messageId
  const [transcribingIds, setTranscribingIds] = useState<Record<string, boolean>>({});
  const [localTranscriptions, setLocalTranscriptions] = useState<Record<string, string>>({});
  const [analyzingIds, setAnalyzingIds] = useState<Record<string, boolean>>({});
  const [localAnalyses, setLocalAnalyses] = useState<Record<string, string>>({});

  // Media upload & voice recording state
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Available for sale products only + smart budget/price matching in picker
  const saleProducts = products.filter(p => p.virtual_available > 0);
  const parsePickerBudget = (raw: string): { min: number; max: number } | null => {
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
      if ((singleM[2] === 'mil' || singleM[2] === 'k') && v < 1000) v *= 1000;
      if (v >= 1500 && v <= 150000) {
        if (s.startsWith('hasta') || s.startsWith('menos')) return { min: 1, max: v };
        return { min: Math.max(500, Math.round(v * 0.7)), max: v + 2500 };
      }
    }
    return null;
  };

  const pickerBudgetBounds = parsePickerBudget(productSearch);

  const filteredPickerProducts = saleProducts.filter(p => {
    if (pickerCategory === 'laptop' && p.category !== 'laptop') return false;
    if (pickerCategory === 'accesorio' && p.category === 'laptop') return false;
    if (!productSearch.trim()) return true;
    if (pickerBudgetBounds && p.list_price >= pickerBudgetBounds.min && p.list_price <= pickerBudgetBounds.max) {
      return true;
    }
    return (
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      String(p.id).includes(productSearch) ||
      String(p.list_price).includes(productSearch.replace(/[,.]/g, '')) ||
      (p.description_sale && p.description_sale.toLowerCase().includes(productSearch.toLowerCase()))
    );
  });

  const filteredConversations = useMemo(() => {
    const matched = conversations.filter(conv => {
      const matchesSearch =
        conv.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        conv.customerPhone.includes(searchTerm) ||
        conv.lastMessagePreview.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (filterType === 'ai_active') return conv.aiEnabled;
      if (filterType === 'ai_paused') return !conv.aiEnabled;
      if (filterType === 'media') {
        return (
          conv.intentStatus === 'comprobante_enviado' ||
          conv.lastMessagePreview.includes('🎤') ||
          conv.lastMessagePreview.includes('📷') ||
          conv.lastMessagePreview.includes('🎥') ||
          conv.messages.some(m => m.type === 'audio' || m.type === 'image' || m.type === 'video')
        );
      }
      return true;
    });

    const deduped: Conversation[] = [];
    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();
    const seenSessions = new Set<string>();

    for (const c of matched) {
      if (seenSessions.has(c.sessionId)) continue;
      const phone = c.customerPhone && c.customerPhone.length <= 12 ? c.customerPhone : '';
      const isGeneric =
        !c.customerName ||
        c.customerName === 'Você' ||
        c.customerName === 'Cliente' ||
        c.customerName.startsWith('Cliente +') ||
        c.customerName.startsWith('WhatsApp #') ||
        /^\+?\d+$/.test(c.customerName.trim());
      const nameKey = !isGeneric ? c.customerName.trim().toLowerCase() : '';

      if (phone && seenPhones.has(phone)) continue;
      if (nameKey && seenNames.has(nameKey)) continue;

      seenSessions.add(c.sessionId);
      if (phone) seenPhones.add(phone);
      if (nameKey) seenNames.add(nameKey);
      deduped.push(c);
    }
    return deduped;
  }, [conversations, searchTerm, filterType]);

  const activeConversation =
    conversations.find(c => c.sessionId === selectedSessionId) ||
    (selectedSessionId
      ? conversations.find(
          c =>
            c.customerPhone &&
            selectedSessionId.replace(/\D/g, '') === c.customerPhone.replace(/\D/g, '')
        )
      : undefined) ||
    conversations[0];
  const activeCustomer = customers.find(c =>
    c.phone.includes(activeConversation?.customerPhone || '')
  );

  const prevSelectedRef = useRef<string | undefined>(undefined);
  const prevMsgCountRef = useRef<number>(0);

  // Scroll to bottom only when switching chats or when a new message arrives in the active chat
  useEffect(() => {
    const currentId = activeConversation?.sessionId;
    const currentCount = activeConversation?.messages.length || 0;
    if (currentId !== prevSelectedRef.current || currentCount > prevMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: currentId !== prevSelectedRef.current ? 'auto' : 'smooth' });
    }
    prevSelectedRef.current = currentId;
    prevMsgCountRef.current = currentCount;
  }, [activeConversation?.sessionId, activeConversation?.messages.length]);

  const handleSend = async () => {
    if (!inputMessage.trim() || !activeConversation) return;
    const text = inputMessage.trim();
    setInputMessage('');
    const quotedPayload = replyingToMessage
      ? {
          id: replyingToMessage.evolutionMessageId || replyingToMessage.id,
          text: replyingToMessage.transcription || replyingToMessage.content,
          type: replyingToMessage.type,
          author:
            replyingToMessage.sender === 'customer'
              ? activeConversation.customerName
              : 'Todo Lapto',
        }
      : undefined;
    setReplyingToMessage(null);
    await onSendMessage(activeConversation.sessionId, text, quotedPayload);
  };

  // Handle File Upload (Photo / Video / Document)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversation) return;

    setIsSendingMedia(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');
        const mediaType = isVideo ? 'video' : isImage ? 'image' : 'document';

        await onSendMedia(activeConversation.sessionId, {
          mediaType,
          base64Data: base64String,
          mimeType: file.type || 'application/octet-stream',
          caption: inputMessage.trim() || undefined,
          fileName: file.name,
        });
        setInputMessage('');
        setIsSendingMedia(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error uploading media:', err);
      setIsSendingMedia(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle Voice Note Recording
  const startRecording = async () => {
    if (!activeConversation) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          setIsSendingMedia(true);
          try {
            await onSendMedia(activeConversation.sessionId, {
              mediaType: 'audio',
              base64Data: base64Audio,
              mimeType: 'audio/ogg; codecs=opus',
            });
          } finally {
            setIsSendingMedia(false);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingAudio) {
      mediaRecorderRef.current.stop();
      setIsRecordingAudio(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  // Transcribe Voice Note with Gemini
  const handleTranscribeVoiceNote = async (msg: ChatMessage) => {
    if (!activeConversation || !msg.evolutionMessageId) return;
    setTranscribingIds(prev => ({ ...prev, [msg.id]: true }));
    try {
      const res = await fetch('/api/ai/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeConversation.sessionId,
          messageId: msg.evolutionMessageId,
        }),
      });
      const data = await res.json();
      if (data.success && data.transcription) {
        setLocalTranscriptions(prev => ({ ...prev, [msg.id]: data.transcription }));
      } else {
        setLocalTranscriptions(prev => ({
          ...prev,
          [msg.id]: data.message || 'No se pudo transcribir el audio.',
        }));
      }
    } catch (err: any) {
      setLocalTranscriptions(prev => ({
        ...prev,
        [msg.id]: `Error al transcribir: ${err.message}`,
      }));
    } finally {
      setTranscribingIds(prev => ({ ...prev, [msg.id]: false }));
    }
  };

  // Analyze Photo / Receipt with Gemini Vision
  const handleAnalyzeImage = async (msg: ChatMessage) => {
    if (!activeConversation || !msg.evolutionMessageId) return;
    setAnalyzingIds(prev => ({ ...prev, [msg.id]: true }));
    try {
      const res = await fetch('/api/ai/analyze-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeConversation.sessionId,
          messageId: msg.evolutionMessageId,
        }),
      });
      const data = await res.json();
      if (data.success && data.analysis) {
        setLocalAnalyses(prev => ({ ...prev, [msg.id]: data.analysis }));
      } else {
        setLocalAnalyses(prev => ({
          ...prev,
          [msg.id]: data.message || 'No se pudo analizar la imagen.',
        }));
      }
    } catch (err: any) {
      setLocalAnalyses(prev => ({
        ...prev,
        [msg.id]: `Error al analizar imagen: ${err.message}`,
      }));
    } finally {
      setAnalyzingIds(prev => ({ ...prev, [msg.id]: false }));
    }
  };

  const handleSuggestAiReply = async () => {
    if (!activeConversation) return;
    setIsGeneratingSuggestion(true);
    try {
      const targetMsg = replyingToMessage
        ? `[MENSAJE CITADO DE ${
            replyingToMessage.sender === 'customer' ? activeConversation.customerName : 'Todo Lapto'
          }: "${replyingToMessage.transcription || replyingToMessage.content}"]\n${
            activeConversation.lastMessagePreview
          }`
        : activeConversation.lastMessagePreview;

      const res = await fetch('/api/ai/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeConversation.sessionId,
          userMessage: targetMsg,
        }),
      });
      const data = await res.json();
      if (data.success && data.reply) {
        setInputMessage(data.reply);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingSuggestion(false);
    }
  };

  const handleAutoSendBotReply = async () => {
    if (!activeConversation) return;
    setIsAutoReplying(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(activeConversation.sessionId)}/auto-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        await onRefreshMessages(activeConversation.sessionId);
        setLearningNotification(
          `✅ Bot de Ventas (${(data.providerUsed || 'IA').toUpperCase()} - ${data.modelUsed || ''}) respondió y envió el mensaje por WhatsApp.`
        );
        setTimeout(() => setLearningNotification(null), 5000);
      } else {
        setLearningNotification(`⚠️ No se pudo responder: ${data.message || data.error}`);
        setTimeout(() => setLearningNotification(null), 5000);
      }
    } catch (err: any) {
      setLearningNotification(`Error al responder con Bot: ${err.message}`);
    } finally {
      setIsAutoReplying(false);
    }
  };

  const handleLearnFromChat = async () => {
    if (!activeConversation) return;
    setIsLearning(true);
    try {
      await onTriggerLearning(activeConversation.sessionId);
      setLearningNotification(
        '¡Patrones de venta y objeciones analizados con éxito y guardados en el Cerebro IA!'
      );
      setTimeout(() => setLearningNotification(null), 4000);
    } catch (err: any) {
      setLearningNotification(`Error en análisis: ${err.message}`);
    } finally {
      setIsLearning(false);
    }
  };

  const insertBankDetails = () => {
    const bankText = `✅ *Datos oficiales para realizar tu pago bancario:*\n\n🏦 *Banreservas* — Cta. Corriente: 9603638702 | Todo Lapto' SRL\n🏦 *Banco Popular* — Cta. Ahorro: 852768712 | Dorys María Viola Suero\n🏦 *BHD* — Cta. Ahorro: 2923412015 | Juana Lucía Rodríguez V.\n🏦 *Santa Cruz* — Cta: 11432010004309 | Todo Lapto' SRL\n📋 RNC: 1-30-12345-6\n\n💡 Envíanos por aquí la captura del comprobante para procesar tu entrega de inmediato. 📸`;
    setInputMessage(prev => (prev ? prev + '\n\n' + bankText : bankText));
  };

  const insertLocationDetails = () => {
    const locText = `📍 *Visítanos en nuestra tienda física Todo Lapto:*\n\n🏢 *Dirección:* Av. Charles de Gaulle #133, Santo Domingo Este (frente a la Sirena / cerca de la Bomba Total).\n🗺️ *Ubicación GPS:* https://maps.google.com/?q=18.5085,-69.8520\n\n⏰ *Horario de Atención y Despacho:*\n• Lunes a Sábado: 8:30 AM a 6:00 PM\n• Domingos y Feriados Nacionales: Cerrado\n\n${rdTime.isOpen ? '🟢 *¡Estamos abiertos ahora mismo!*' : `🔴 *Actualmente cerrados:* ${rdTime.statusDetail}. Próxima apertura: ${rdTime.nextOpeningStr}.`}\n\n¡Puedes probar el equipo personalmente antes de comprarlo con cualquiera de nuestros asesores técnicos! 👨‍💻✨`;
    setInputMessage(prev => (prev ? prev + '\n\n' + locText : locText));
  };

  const insertScheduleNotice = () => {
    const currentRd = getDominicanTimeContext();
    const noticeText = currentRd.isOpen
      ? `⏰ *Horario de Atención Todo Lapto:*\n\n🟢 *Estamos ABIERTOS ahora mismo:* Lunes a Sábado de 8:30 AM a 6:00 PM.\n🛵 Realizamos entregas express a domicilio hoy mismo en Santo Domingo y envíos asegurados a todas las provincias del país.\n\n¿En qué laptop o equipo te gustaría que te asesoremos? 😊`
      : `⏰ *Horario de Atención y Despacho Todo Lapto:*\n\n🔴 *Estado actual:* Actualmente nos encontramos fuera de horario laboral (${currentRd.statusDetail}).\n\n📦 *¡Tomamos tu pedido con prioridad!* Podemos apartar tu equipo y formalizar tu orden de inmediato. El paquete será preparado y despachado a primera hora tan pronto abramos nuestras puertas (${currentRd.nextOpeningStr}).\n\n¿Deseas que dejemos tu orden apartada ahora mismo? 🤝`;
    setInputMessage(prev => (prev ? prev + '\n\n' + noticeText : noticeText));
  };

  const insertWarrantyDetails = () => {
    const warText = `🛡️ *Garantía Certificada Todo Lapto:*\n\n✅ *6 meses de garantía por escrito* con soporte técnico directo.\n🔍 *Checklist técnico de 25 puntos* (pantalla, teclado, batería, puertos, cámara, audio y temperaturas testeadas al 100%).\n🔌 *Incluye cargador original* y factura con RNC.\n🔄 Soporte y cambios inmediatos ante cualquier eventualidad.\n\nComprar en Todo Lapto es comprar con total seguridad y respaldo técnico profesional. 💻`;
    setInputMessage(prev => (prev ? prev + '\n\n' + warText : warText));
  };

  const insertShippingDetails = () => {
    const shipText = `🚚 *Modalidades de Entrega Todo Lapto:*\n\n🛵 *Gran Santo Domingo:* Entrega express a domicilio *Contra Entrega* (pagas en efectivo o transferencia al recibir tu laptop y revisarla).\n📦 *Provincias / Interior del País:* Envíos asegurados por *MetroPac, Caribe Tours o Transporte Blanco* con número de guía rastreable.\n\n¿A qué sector o municipio te gustaría recibir tu equipo? 😊`;
    setInputMessage(prev => (prev ? prev + '\n\n' + shipText : shipText));
  };

  const insertHoldDetails = () => {
    const holdText = `⚡ *¿Deseas apartar este equipo para que no se venda?*\n\nPuedes apartarlo formalmente por *48 horas* con un abono de solo *RD$1,000*.\nEse monto se te descuenta del total cuando pases por la tienda o al coordinar tu entrega.\n\n¿Te facilito los números de cuenta para reservártelo ahora mismo? 🤝`;
    setInputMessage(prev => (prev ? prev + '\n\n' + holdText : holdText));
  };

  const insertProduct = (p: ProductItem) => {
    const text = `💻 *${p.name}*\n💰 Precio: RD$${p.list_price.toLocaleString()}\n📦 Disponibilidad: ${p.virtual_available} unidad(es)${
      p.vitrinaStock ? ` (${p.vitrinaStock} en Tienda/Vitrina)` : ''
    }\n🔗 https://todolapto.com.do${p.website_url || ''}\n\n${
      p.description_sale || ''
    }\n\n¿Deseas que te la aparte ahora mismo?`;
    setInputMessage(prev => (prev ? prev + '\n\n' + text : text));
    setProductPickerOpen(false);
  };

  const handleSendProductWithPhoto = async (p: ProductItem) => {
    if (!activeConversation) return;
    setSendingProductId(p.id);
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(activeConversation.sessionId)}/send-product`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: p.id }),
        }
      );
      const data = await res.json();
      if (data.success) {
        setProductPickerOpen(false);
        await onRefreshMessages(activeConversation.sessionId);
        setLearningNotification(`📷 Foto y ficha de "${p.name}" enviadas al WhatsApp del cliente.`);
        setTimeout(() => setLearningNotification(null), 4000);
      }
    } catch (err: any) {
      console.error('Error sending product photo:', err);
    } finally {
      setSendingProductId(null);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#090D12]">
      {/* COLUMN 1: Conversation List */}
      <div className="w-80 lg:w-96 border-r border-white/[0.06] flex flex-col bg-[#0C1017] shrink-0">
        {/* Search & Sync Header */}
        <div className="p-3.5 border-b border-white/[0.06] space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-lime-400 animate-pulse" />
              <span className="text-xs font-bold text-slate-200 tracking-tight">
                WhatsApp Evolution API
              </span>
              <span className="text-[10px] font-mono text-lime-400 bg-lime-950/80 border border-lime-800/50 px-1.5 py-0.5 rounded">
                {conversations.length} chats
              </span>
            </div>

            <button
              onClick={onSyncEvolution}
              disabled={isSyncingEvolution}
              title="Sincronizar chats de Evolution API ahora"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-[11px] font-medium border border-white/[0.06] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 text-lime-400 ${isSyncingEvolution ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar cliente, teléfono o mensaje..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#121822] border border-white/[0.06] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500"
            />
          </div>

          {/* Clean Segmented Filter */}
          <div className="flex items-center gap-1 p-1 bg-[#121822] rounded-lg text-[11px]">
            <button
              onClick={() => setFilterType('all')}
              className={`flex-1 py-1 rounded text-center transition-colors font-medium ${
                filterType === 'all'
                  ? 'bg-white/[0.08] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Todos ({conversations.length})
            </button>
            <button
              onClick={() => setFilterType('ai_active')}
              className={`flex-1 py-1 rounded text-center transition-colors font-medium ${
                filterType === 'ai_active'
                  ? 'bg-lime-950/80 text-lime-300 shadow-sm border border-lime-800/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              IA Activa
            </button>
            <button
              onClick={() => setFilterType('ai_paused')}
              className={`flex-1 py-1 rounded text-center transition-colors font-medium ${
                filterType === 'ai_paused'
                  ? 'bg-amber-950/80 text-amber-300 shadow-sm border border-amber-800/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Humano
            </button>
            <button
              onClick={() => setFilterType('media')}
              className={`flex-1 py-1 rounded text-center transition-colors font-medium ${
                filterType === 'media'
                  ? 'bg-cyan-950/80 text-cyan-300 shadow-sm border border-cyan-800/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Multimedia
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.03]">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No hay conversaciones con el filtro seleccionado.
            </div>
          ) : (
            filteredConversations.map(conv => {
              const isSelected = activeConversation?.sessionId === conv.sessionId;
              const isAiOn = globalAiActive && conv.aiEnabled;

              return (
                <div
                  key={conv.sessionId}
                  onClick={() => onSelectConversation(conv.sessionId)}
                  className={`p-3.5 cursor-pointer transition-colors relative flex gap-3 ${
                    isSelected
                      ? 'bg-white/[0.06] border-l-2 border-lime-400'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <ContactAvatar
                      src={conv.profilePicUrl}
                      name={conv.customerName}
                    />
                    {/* Status dot */}
                    <span
                      title={isAiOn ? 'IA respondiendo' : 'Pausada: Agente humano'}
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0C1017] ${
                        isAiOn ? 'bg-lime-400' : 'bg-amber-400'
                      }`}
                    />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-slate-200 text-xs truncate">
                        {conv.customerName}
                      </span>
                      <span className="text-[10px] text-slate-500 tabular-nums" title="Hora de República Dominicana (UTC-4)">
                        {formatDominicanTimeOnly(conv.lastTimestamp)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 truncate mb-1.5">
                      {conv.lastMessagePreview}
                    </p>

                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 flex-wrap">
                      <span className="font-mono text-slate-400">{conv.customerPhone}</span>
                      <span>·</span>
                      <span
                        className={`font-medium ${
                          isAiOn ? 'text-lime-400' : 'text-amber-400'
                        }`}
                      >
                        {isAiOn ? 'IA Activa' : 'Humano'}
                      </span>
                      <span>·</span>
                      {conv.isOdooClient || conv.odooPartnerId ? (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 shadow-sm shrink-0"
                          title={`Cliente verificado (ID #${conv.odooPartnerId || ''})`}
                        >
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Cliente</span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/[0.04] text-slate-400 border border-white/[0.06] shrink-0"
                          title="Contacto aún no registrado en el directorio de clientes"
                        >
                          <span>Prospecto</span>
                        </span>
                      )}
                      {conv.unreadCount > 0 && (
                        <span className="ml-auto bg-lime-500 text-slate-950 rounded-full px-1.5 py-0.2 text-[9px] font-bold">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* COLUMN 2: Active Chat Thread */}
      {activeConversation ? (
        <div className="flex-1 flex flex-col bg-[#090D12] min-w-0">
          {/* Header of Active Chat */}
          <div className="p-3.5 border-b border-white/[0.06] bg-[#0C1017]/80 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <ContactAvatar
                src={activeConversation.profilePicUrl}
                name={activeConversation.customerName}
                className="w-9 h-9 rounded-full object-cover border border-white/[0.08] shrink-0"
                fallbackClassName="w-9 h-9 rounded-full bg-[#18212E] border border-white/[0.08] flex items-center justify-center font-bold text-slate-200 text-sm shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-100 truncate">
                    {activeConversation.customerName}
                  </h2>
                  <span className="text-xs text-slate-500 font-mono">
                    +{activeConversation.customerPhone}
                  </span>
                  {activeConversation.isOdooClient || activeConversation.odooPartnerId ? (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60 shadow-sm"
                      title={`Cliente registrado (ID #${activeConversation.odooPartnerId || ''})`}
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Cliente Registrado #{activeConversation.odooPartnerId || ''}</span>
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800/90 text-slate-400 border border-white/[0.06]"
                      title="Contacto de WhatsApp aún no registrado como cliente"
                    >
                      <span>Prospecto</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                  <span className="text-lime-400 font-medium">WhatsApp en Vivo</span>
                  <span>·</span>
                  <span className="capitalize">
                    {activeConversation.intentStatus.replace('_', ' ')}
                  </span>
                  <span>·</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {activeConversation.messages.length} mensajes
                  </span>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-full border ${
                      liveRdTime.isOpen
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/40'
                        : 'bg-rose-950/80 text-rose-300 border-rose-600/40'
                    }`}
                    title={`Hora oficial en RD: ${liveRdTime.fullDateStr} · ${liveRdTime.time12WithSeconds}\n${liveRdTime.statusDetail}\nTodo Lapto: Lunes a Sábado de 8:30 AM a 6:00 PM`}
                  >
                    <span>🇩🇴 {liveRdTime.time12}</span>
                    <span className="font-bold uppercase tracking-wider text-[9px]">
                      ({liveRdTime.isOpen ? 'Abierto' : 'Cerrado'})
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onRefreshMessages(activeConversation.sessionId)}
                disabled={isLoadingMessages}
                title="Recargar historial multimedia de este chat desde WhatsApp"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-lime-400 ${
                    isLoadingMessages ? 'animate-spin' : ''
                  }`}
                />
                <span className="hidden md:inline">Actualizar Chat</span>
              </button>

              {/* Bot Diagnostic Audit Modal Button */}
              <button
                onClick={() => setShowAuditModal(true)}
                title="Ver diagnósticos en tiempo real y auditoría anti-duplicados del bot"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-600/40 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Auditoría Bot</span>
              </button>

              {/* Individual AI Pause/Resume Button */}
              <button
                onClick={() => onToggleAiForChat(activeConversation.sessionId)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  activeConversation.aiEnabled && globalAiActive
                    ? 'bg-amber-950/60 border-amber-600/60 text-amber-300 hover:bg-amber-900/80'
                    : 'bg-[#152712] border-lime-500/50 text-lime-300 hover:bg-[#1a3317]'
                }`}
              >
                {activeConversation.aiEnabled && globalAiActive ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pausar IA en este chat</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Reanudar IA</span>
                  </>
                )}
              </button>

              <button
                onClick={() =>
                  onOpenCreateOrder({
                    clientName: activeConversation.customerName,
                    clientPhone: activeConversation.customerPhone,
                    address: activeCustomer?.address,
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.05] hover:bg-white/[0.08] text-slate-200 border border-white/[0.08] transition-colors"
              >
                <CreditCard className="w-3.5 h-3.5 text-lime-400" />
                <span className="hidden sm:inline">Crear Pedido</span>
              </button>
            </div>
          </div>

          {/* AI Banner Status Notice */}
          <div
            className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
              activeConversation.aiEnabled && globalAiActive
                ? 'bg-lime-950/30 border-lime-900/40 text-lime-300'
                : 'bg-amber-950/30 border-amber-900/40 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {activeConversation.aiEnabled && globalAiActive ? (
                <>
                  <Bot className="w-4 h-4 text-lime-400" />
                  <span>
                    <strong>IA Activa:</strong> Respondiendo automáticamente y procesando audios, fotos y stock en tiempo real.
                  </span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <span>
                    <strong>Intervención Humana:</strong> La IA está pausada. Tu respuesta o nota de voz se enviará directamente por WhatsApp.
                  </span>
                </>
              )}
            </div>
            <button
              onClick={() => onToggleAiForChat(activeConversation.sessionId)}
              className="underline text-[11px] font-semibold hover:opacity-80"
            >
              {activeConversation.aiEnabled && globalAiActive
                ? 'Pausar para intervenir'
                : 'Reactivar IA'}
            </button>
          </div>

          {/* Dominican Republic Business Schedule Notice when Closed */}
          {!rdTime.isOpen && (
            <div className="bg-amber-950/70 border-b border-amber-600/40 px-4 py-1.5 text-[11px] text-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  <strong>Horario RD ({rdTime.time12}):</strong> {rdTime.statusDetail}. Los pedidos tomados ahora se despacharán <strong>{rdTime.nextOpeningStr}</strong>.
                </span>
              </div>
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-900/80 text-amber-300 border border-amber-700/60 shrink-0">
                El bot toma y aparta pedidos
              </span>
            </div>
          )}

          {/* Learning Notification Toast */}
          {learningNotification && (
            <div className="bg-lime-950 border-b border-lime-700/60 px-4 py-2 text-xs text-lime-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-lime-400" />
                <span>{learningNotification}</span>
              </div>
              <button
                onClick={() => setLearningNotification(null)}
                className="text-lime-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* Messages Feed */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {isLoadingMessages && activeConversation.messages.length <= 1 && (
              <div className="flex items-center justify-center py-6 text-xs text-slate-400 gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-lime-400" />
                <span>Descargando mensajes, notas de voz, fotos y videos desde WhatsApp...</span>
              </div>
            )}

            {activeConversation.messages.map(msg => {
              const isCustomer = msg.sender === 'customer';
              const isAssistant = msg.sender === 'assistant';
              const transcriptText = localTranscriptions[msg.id] || msg.transcription;
              const analysisText = localAnalyses[msg.id] || msg.aiAnalysis;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isCustomer ? 'items-start' : 'items-end'
                  }`}
                >
                  {/* Sender label + Responder/Citar action */}
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-1 px-1">
                    {isCustomer ? (
                      <span>{activeConversation.customerName}</span>
                    ) : isAssistant ? (
                      <span className="text-lime-400 flex items-center gap-1 font-semibold">
                        <Bot className="w-3 h-3" /> IA / Bot WhatsApp
                      </span>
                    ) : (
                      <span className="text-cyan-400 flex items-center gap-1 font-semibold">
                        <UserCheck className="w-3 h-3" /> Asesor Humano
                      </span>
                    )}
                    <span>·</span>
                    <span className="tabular-nums" title="Hora de República Dominicana (UTC-4)">
                      {formatDominicanTimeOnly(msg.timestamp)}
                    </span>
                    <button
                      onClick={() => setReplyingToMessage(msg)}
                      title="Citar y responder a este mensaje"
                      className="ml-1.5 px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-lime-400 flex items-center gap-1 transition-colors"
                    >
                      <Reply className="w-2.5 h-2.5" />
                      <span>Citar</span>
                    </button>
                  </div>

                  {/* Message bubble */}
                  <div
                    className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                      isCustomer
                        ? 'bg-[#141C26] text-slate-100 rounded-tl-sm border border-white/[0.06]'
                        : isAssistant
                        ? 'bg-[#0E1B10] text-slate-100 border border-lime-500/30 rounded-tr-sm'
                        : 'bg-[#101D2E] text-slate-100 border border-cyan-700/40 rounded-tr-sm'
                    }`}
                  >
                    {/* Quoted message if any */}
                    {msg.quotedMessage && (
                      <div className="mb-2.5 p-2.5 rounded-xl bg-black/45 border-l-4 border-lime-400 text-[11px] text-slate-200 flex items-start gap-2.5">
                        {msg.quotedMessage.mediaUrl && msg.quotedMessage.type === 'image' && (
                          <img
                            src={msg.quotedMessage.mediaUrl}
                            alt="Cita"
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <span className="text-lime-400 font-bold flex items-center gap-1 text-[10px] mb-0.5">
                            <Reply className="w-3 h-3" />
                            <span>{msg.quotedMessage.author || 'Mensaje citado'}</span>
                          </span>
                          <p className="line-clamp-3 text-slate-300 whitespace-pre-wrap">
                            {msg.quotedMessage.text}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* VOICE NOTE / AUDIO PLAYER */}
                    {msg.type === 'audio' && msg.mediaUrl && (
                      <div className="mb-2 p-2.5 rounded-xl bg-black/30 border border-white/[0.08] space-y-2 min-w-[250px] sm:min-w-[300px]">
                        <div className="flex items-center justify-between text-[11px] text-lime-400 font-medium">
                          <span className="flex items-center gap-1.5">
                            <Volume2 className="w-3.5 h-3.5" />
                            Nota de Voz de WhatsApp
                          </span>
                          {msg.mediaDuration ? (
                            <span className="font-mono text-slate-400">{msg.mediaDuration}s</span>
                          ) : null}
                        </div>

                        <audio
                          controls
                          preload="none"
                          src={msg.mediaUrl}
                          className="w-full h-9 rounded-lg"
                        />

                        {msg.evolutionMessageId && (
                          <div className="pt-1 flex items-center justify-between">
                            <button
                              onClick={() => handleTranscribeVoiceNote(msg)}
                              disabled={transcribingIds[msg.id]}
                              className="flex items-center gap-1 text-[11px] text-lime-300 hover:text-lime-200 bg-lime-950/70 border border-lime-800/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <Wand2 className="w-3 h-3" />
                              <span>
                                {transcribingIds[msg.id]
                                  ? 'Transcribiendo con IA...'
                                  : transcriptText
                                  ? 'Volver a transcribir'
                                  : 'Transcribir Nota de Voz con IA'}
                              </span>
                            </button>
                          </div>
                        )}

                        {transcriptText && (
                          <div className="p-2 rounded-lg bg-lime-950/40 border border-lime-800/40 text-[11px] text-slate-200">
                            <span className="text-[10px] font-bold text-lime-400 uppercase block mb-0.5">
                              Transcripción IA:
                            </span>
                            <p className="italic">"{transcriptText}"</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* VIDEO PLAYER */}
                    {msg.type === 'video' && msg.mediaUrl && (
                      <div className="mb-2 rounded-xl overflow-hidden border border-white/[0.08] bg-black">
                        <video
                          controls
                          preload="metadata"
                          src={msg.mediaUrl}
                          className="max-h-72 w-full object-contain"
                        />
                      </div>
                    )}

                    {/* IMAGE / PHOTO / STICKER */}
                    {(msg.type === 'image' || msg.type === 'sticker') && msg.mediaUrl && (
                      <div className="mb-2 space-y-2">
                        <div className="rounded-xl overflow-hidden border border-white/[0.08] relative group bg-black/40">
                          <img
                            src={msg.mediaUrl}
                            alt="Imagen de WhatsApp"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="max-h-64 w-full object-contain cursor-pointer hover:opacity-95 transition-opacity"
                            onClick={() => setSelectedImageModal(msg.mediaUrl || null)}
                          />
                          <button
                            onClick={() => setSelectedImageModal(msg.mediaUrl || null)}
                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs gap-1.5 font-medium"
                          >
                            <Eye className="w-4 h-4" />
                            <span>Ampliar imagen</span>
                          </button>
                        </div>

                        {msg.evolutionMessageId && msg.type === 'image' && (
                          <button
                            onClick={() => handleAnalyzeImage(msg)}
                            disabled={analyzingIds[msg.id]}
                            className="flex items-center gap-1 text-[11px] text-lime-300 hover:text-lime-200 bg-lime-950/70 border border-lime-800/50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>
                              {analyzingIds[msg.id]
                                ? 'Analizando imagen con IA...'
                                : 'Analizar Foto / Comprobante con IA'}
                            </span>
                          </button>
                        )}

                        {analysisText && (
                          <div className="p-2.5 rounded-lg bg-lime-950/40 border border-lime-800/40 text-[11px] text-slate-200">
                            <span className="text-[10px] font-bold text-lime-400 uppercase block mb-0.5">
                              Visión IA (Gemini):
                            </span>
                            <p className="whitespace-pre-wrap">{analysisText}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* DOCUMENT LINK */}
                    {msg.type === 'document' && msg.mediaUrl && (
                      <a
                        href={msg.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-2 p-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] flex items-center gap-2 text-lime-300 font-medium"
                      >
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="truncate">Abrir documento adjunto</span>
                      </a>
                    )}

                    {/* Receipt Details Box if detected */}
                    {msg.metadata?.isReceipt && msg.metadata.receiptDetails && (
                      <div className="mb-2 p-2.5 rounded-lg bg-emerald-950/70 border border-emerald-600/50 text-emerald-200 text-[11px]">
                        <div className="flex items-center gap-1.5 font-bold text-emerald-300 mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Comprobante de Pago Validado</span>
                        </div>
                        <p>Banco: {msg.metadata.receiptDetails.bank || 'Banco Dominicano'}</p>
                        <p className="font-mono tabular-nums">
                          Monto: RD${msg.metadata.receiptDetails.amount?.toLocaleString()}
                        </p>
                        <p className="font-mono text-[10px] text-emerald-400">
                          Ref: {msg.metadata.receiptDetails.reference}
                        </p>
                      </div>
                    )}

                    {/* Main text */}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Product Drawer Popup with Real Product Images */}
          {productPickerOpen && (
            <div className="p-3.5 bg-[#0C1017] border-t border-white/[0.08] text-xs space-y-2.5 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-lime-400" />
                  <span className="font-bold text-slate-100">
                    Insertar Producto del Catálogo ({filteredPickerProducts.length} de {saleProducts.length} en stock):
                  </span>
                  <div className="flex items-center gap-1 ml-1">
                    {[
                      { id: 'all', label: 'Todos' },
                      { id: 'laptop', label: 'Laptops' },
                      { id: 'accesorio', label: 'Accesorios' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setPickerCategory(tab.id as any)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                          pickerCategory === tab.id
                            ? 'bg-lime-500 text-slate-950 font-bold'
                            : 'bg-[#141C26] text-slate-400 hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {pickerBudgetBounds && (
                    <span className="text-[11px] font-mono text-lime-400">
                      🎯 RD${pickerBudgetBounds.min.toLocaleString()} – RD${pickerBudgetBounds.max.toLocaleString()}
                    </span>
                  )}
                  <input
                    type="text"
                    placeholder="Buscar por modelo o presupuesto (ej: ThinkPad, 10000, 8 mil)..."
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="bg-[#121822] border border-white/[0.08] rounded-lg px-2.5 py-1 text-xs text-slate-200 w-72 focus:outline-none focus:border-lime-500"
                  />
                  <button
                    onClick={() => setProductPickerOpen(false)}
                    className="text-slate-400 hover:text-white px-1.5 py-0.5 text-sm"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                {filteredPickerProducts.slice(0, 36).map(p => {
                  const imgUrl = p.image_url || `https://todolapto.com.do/web/image/product.template/${p.id}/image_256`;
                  const hasFailedImg = failedPickerImages[p.id];

                  return (
                    <div
                      key={p.id}
                      className="p-2.5 bg-[#121822] border border-white/[0.06] rounded-xl hover:border-lime-500/60 transition-all flex gap-2.5 items-center group"
                    >
                      {/* Product Thumbnail */}
                      <div
                        onClick={() => setSelectedImageModal(`https://todolapto.com.do/web/image/product.template/${p.id}/image_512`)}
                        title="Ampliar foto del producto"
                        className="w-14 h-14 rounded-lg bg-white overflow-hidden shrink-0 flex items-center justify-center border border-white/10 cursor-pointer"
                      >
                        {!hasFailedImg ? (
                          <img
                            src={imgUrl}
                            alt={p.name}
                            loading="lazy"
                            onError={() => setFailedPickerImages(prev => ({ ...prev, [p.id]: true }))}
                            className="w-full h-full object-contain p-0.5"
                          />
                        ) : (
                          <Package className="w-5 h-5 text-slate-400" />
                        )}
                      </div>

                      {/* Info & Actions */}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-100 truncate text-xs" title={p.name}>
                          {p.name}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center justify-between mt-0.5">
                          <span className="text-lime-400 font-mono font-bold">
                            RD${p.list_price.toLocaleString()}
                          </span>
                          <span className="font-mono text-[10px]">
                            Stock: {p.virtual_available}
                            {p.vitrinaStock ? ` (Vit: ${p.vitrinaStock})` : ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-1.5">
                          <button
                            onClick={() => insertProduct(p)}
                            className="flex-1 py-1 px-2 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 text-[10px] font-semibold transition-colors text-center"
                          >
                            Insertar texto
                          </button>
                          <button
                            onClick={() => handleSendProductWithPhoto(p)}
                            disabled={sendingProductId === p.id}
                            title="Enviar foto real del producto + ficha directamente al WhatsApp del cliente"
                            className="py-1 px-2 rounded bg-lime-500 hover:bg-lime-400 text-slate-950 text-[10px] font-bold transition-colors flex items-center gap-1 disabled:opacity-50"
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>{sendingProductId === p.id ? 'Enviando...' : 'Foto + Info'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Replying To Quoted Message Banner */}
          {replyingToMessage && (
            <div className="px-3.5 py-2 bg-[#111923] border-t border-lime-500/40 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Reply className="w-4 h-4 text-lime-400 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] font-bold text-lime-400 block">
                    Respondiendo a {replyingToMessage.sender === 'customer' ? activeConversation.customerName : 'Todo Lapto'}:
                  </span>
                  <p className="text-slate-300 truncate text-[11px]">
                    {replyingToMessage.transcription || replyingToMessage.content}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setReplyingToMessage(null)}
                className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5"
              >
                ✕
              </button>
            </div>
          )}

          {/* Composer & Quick Actions */}
          <div className="p-3 border-t border-white/[0.06] bg-[#0C1017] space-y-2">
            {/* Quick Actions Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <button
                onClick={handleAutoSendBotReply}
                disabled={isAutoReplying}
                title="Genera y envía directamente al WhatsApp del cliente la respuesta del Bot de Ventas con el inventario disponible"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#65D30F] hover:bg-lime-400 text-slate-950 transition-colors shrink-0 disabled:opacity-50 font-bold shadow-sm"
              >
                <Bot className={`w-3.5 h-3.5 ${isAutoReplying ? 'animate-spin' : ''}`} />
                <span>
                  {isAutoReplying ? 'Bot respondiendo en WhatsApp...' : 'Responder con Bot IA Ahora'}
                </span>
              </button>

              <button
                onClick={handleSuggestAiReply}
                disabled={isGeneratingSuggestion}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/80 hover:bg-lime-900 text-lime-300 border border-lime-800/60 transition-colors shrink-0 disabled:opacity-50 font-medium"
              >
                <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                <span>
                  {isGeneratingSuggestion ? 'Redactando borrador...' : 'Sugerir borrador IA'}
                </span>
              </button>

              <button
                onClick={() => setProductPickerOpen(!productPickerOpen)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
              >
                <Package className="w-3.5 h-3.5 text-lime-400" />
                <span>Insertar producto</span>
              </button>

              <button
                onClick={insertBankDetails}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Insertar cuentas bancarias de Banreservas, Popular y BHD"
              >
                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                <span>Cuentas bancarias</span>
              </button>

              <button
                onClick={insertLocationDetails}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Insertar ubicación de la tienda en Av. Charles de Gaulle y horario"
              >
                <MapPin className="w-3.5 h-3.5 text-blue-400" />
                <span>Tienda & Ubicación</span>
              </button>

              <button
                onClick={insertScheduleNotice}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Insertar horario de atención y aviso de despacho según estado de apertura en RD"
              >
                <Clock className={`w-3.5 h-3.5 ${rdTime.isOpen ? 'text-lime-400' : 'text-amber-400'}`} />
                <span>Horario & Despacho</span>
              </button>

              <button
                onClick={insertWarrantyDetails}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Insertar garantía escrita de 6 meses y checklist de 25 puntos"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Garantía 6 meses</span>
              </button>

              <button
                onClick={insertShippingDetails}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Insertar modalidades de entrega contra entrega y envíos al interior"
              >
                <Truck className="w-3.5 h-3.5 text-cyan-400" />
                <span>Envíos</span>
              </button>

              <button
                onClick={insertHoldDetails}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0"
                title="Ofrecer apartado de equipo por 48 horas con RD$1,000"
              >
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                <span>Apartar equipo</span>
              </button>

              <button
                onClick={() =>
                  onOpenCreateOrder({
                    clientName: activeConversation.customerName,
                    clientPhone: activeConversation.customerPhone,
                    address: activeCustomer?.address,
                  })
                }
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-950/80 hover:bg-lime-900 text-lime-300 border border-lime-800/60 font-semibold transition-colors shrink-0"
                title="Abrir formulario para generar cotización o pedido"
              >
                <CreditCard className="w-3.5 h-3.5 text-lime-400" />
                <span>Cotizar / Pedido</span>
              </button>

              <button
                onClick={handleLearnFromChat}
                disabled={isLearning}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.06] transition-colors shrink-0 disabled:opacity-50 ml-auto"
                title="Analiza esta conversación para que la IA aprenda objeciones y cierres"
              >
                <BrainCircuit className="w-3.5 h-3.5 text-lime-400" />
                <span>{isLearning ? 'Analizando...' : 'Aprender de chat'}</span>
              </button>
            </div>

            {/* Hidden File Input for Image/Video/Document */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* Input area */}
            <div className="flex items-end gap-2">
              {/* Attach Image / Video Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSendingMedia}
                title="Enviar Foto, Video o PDF por WhatsApp"
                className="h-10 px-3 rounded-xl bg-[#121822] hover:bg-white/[0.08] text-slate-300 border border-white/[0.07] flex items-center justify-center gap-1.5 text-xs transition-colors shrink-0 disabled:opacity-50"
              >
                <ImageIcon className="w-4 h-4 text-lime-400" />
                <Video className="w-4 h-4 text-cyan-400 hidden sm:inline" />
              </button>

              {/* Record Voice Note Button */}
              {isRecordingAudio ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  title="Detener y enviar nota de voz"
                  className="h-10 px-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold flex items-center gap-2 text-xs animate-pulse shrink-0"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono">{recordingSeconds}s · Enviar Audio</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={isSendingMedia}
                  title="Grabar y enviar nota de voz por WhatsApp"
                  className="h-10 px-3 rounded-xl bg-[#121822] hover:bg-white/[0.08] text-slate-300 border border-white/[0.07] flex items-center justify-center transition-colors shrink-0 disabled:opacity-50"
                >
                  <Mic className="w-4 h-4 text-lime-400" />
                </button>
              )}

              <textarea
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                placeholder={
                  isSendingMedia
                    ? 'Enviando archivo multimedia a WhatsApp...'
                    : 'Escribe un mensaje o adjunta foto, video o nota de voz...'
                }
                className="flex-1 bg-[#121822] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-lime-500 resize-none"
              />

              <button
                onClick={handleSend}
                disabled={!inputMessage.trim() || isSendingMedia}
                className="h-10 px-4 rounded-xl bg-lime-500 hover:bg-lime-400 disabled:opacity-40 disabled:hover:bg-lime-500 text-slate-950 font-bold flex items-center justify-center transition-colors shadow-lg shadow-lime-500/20"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
          Selecciona una conversación para interactuar.
        </div>
      )}

      {/* COLUMN 3: Customer Context Drawer */}
      {activeConversation && (
        <div className="hidden 2xl:flex w-80 border-l border-white/[0.06] bg-[#0C1017] flex-col p-4 space-y-4 overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <User className="w-4 h-4 text-lime-400" />
              <span>Ficha del Cliente</span>
            </h3>
            <div className="p-3 bg-[#121822] border border-white/[0.06] rounded-xl space-y-2 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px]">Nombre en WhatsApp</span>
                <span className="font-semibold text-slate-200">
                  {activeConversation.customerName}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Teléfono WhatsApp</span>
                <span className="font-mono text-lime-400">+{activeConversation.customerPhone}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Estado del Cliente</span>
                {activeConversation.isOdooClient || activeConversation.odooPartnerId || activeCustomer?.odooPartnerId ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/60">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Cliente Registrado #{activeConversation.odooPartnerId || activeCustomer?.odooPartnerId}</span>
                    </span>
                  </div>
                ) : (
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Prospecto nuevo (sin registrar en directorio)
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Dirección Registrada</span>
                <span className="text-slate-300">
                  {activeCustomer?.address || 'Pendiente de confirmación'}
                </span>
              </div>
            </div>
          </div>

          {/* Multimedia Summary in this Chat */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-lime-400" />
              <span>Multimedia en este Chat</span>
            </h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-[#121822] border border-white/[0.06]">
                <span className="text-sm font-bold text-lime-400 font-mono block">
                  {activeConversation.messages.filter(m => m.type === 'audio').length}
                </span>
                <span className="text-[10px] text-slate-400">Audios</span>
              </div>
              <div className="p-2 rounded-xl bg-[#121822] border border-white/[0.06]">
                <span className="text-sm font-bold text-cyan-400 font-mono block">
                  {activeConversation.messages.filter(m => m.type === 'image').length}
                </span>
                <span className="text-[10px] text-slate-400">Fotos</span>
              </div>
              <div className="p-2 rounded-xl bg-[#121822] border border-white/[0.06]">
                <span className="text-sm font-bold text-purple-400 font-mono block">
                  {activeConversation.messages.filter(m => m.type === 'video').length}
                </span>
                <span className="text-[10px] text-slate-400">Videos</span>
              </div>
            </div>
          </div>

          {/* AI Sales Insights on this customer */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 mb-2 flex items-center gap-1.5">
              <BrainCircuit className="w-4 h-4 text-lime-400" />
              <span>Intereses & Objeciones IA</span>
            </h3>
            <div className="p-3 bg-[#121822] border border-white/[0.06] rounded-xl space-y-2 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px] mb-1">Productos Consultados</span>
                <div className="flex flex-wrap gap-1">
                  {activeConversation.detectedProducts.length > 0 ? (
                    activeConversation.detectedProducts.map((p, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-lime-950/80 text-lime-300 border border-lime-800/60 text-[10px]"
                      >
                        {p}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 text-[11px]">En exploración inicial</span>
                  )}
                </div>
              </div>

              {activeCustomer?.objectionsRecorded &&
                activeCustomer.objectionsRecorded.length > 0 && (
                  <div>
                    <span className="text-slate-500 block text-[10px] mb-1">
                      Objeciones Registradas
                    </span>
                    <div className="space-y-1">
                      {activeCustomer.objectionsRecorded.map((obj, i) => (
                        <div
                          key={i}
                          className="p-1.5 rounded bg-amber-950/40 border border-amber-900/40 text-[10px] text-amber-200"
                        >
                          ⚠️ {obj}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>

          {/* Direct CTA */}
          <button
            onClick={() =>
              onOpenCreateOrder({
                clientName: activeConversation.customerName,
                clientPhone: activeConversation.customerPhone,
                address: activeCustomer?.address,
              })
            }
            className="w-full py-2.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-lime-500/20 transition-all"
          >
            <CreditCard className="w-4 h-4" />
            <span>Generar Cotización</span>
          </button>
        </div>
      )}

      {/* Image Modal Preview */}
      {selectedImageModal && (
        <div
          onClick={() => setSelectedImageModal(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#0C1017] border border-white/[0.08] rounded-2xl max-w-2xl w-full p-4 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Vista Completa de Imagen / Comprobante</span>
              </h4>
              <button
                onClick={() => setSelectedImageModal(null)}
                className="text-slate-400 hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[70vh]">
              <img
                src={selectedImageModal}
                alt="Adjunto de WhatsApp"
                referrerPolicy="no-referrer"
                className="object-contain max-h-[70vh] w-auto"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setSelectedImageModal(null)}
                className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-slate-200"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bot Audit & Diagnostics Modal */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0B0F15] border border-white/[0.08] rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0F141C]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Auditoría del Bot {activeConversation?.customerName ? `— Chat: ${activeConversation.customerName}` : ''}
                </h3>
              </div>
              <button
                onClick={() => setShowAuditModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <BotAuditLogPanel
                initialSearchTerm={activeConversation?.customerName || ''}
                onClose={() => setShowAuditModal(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
