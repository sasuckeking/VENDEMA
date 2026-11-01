export type CategoryType = 'all' | 'laptops' | 'redes' | 'monitores' | 'impresoras' | 'accesorios';

export type AIProviderType = 'gemini' | 'openai' | 'deepseek';

export interface AIProviderConfig {
  provider: AIProviderType;
  model: string;
  temperature: number;
  customInstructions?: string;
  systemPrompt?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  geminiApiKey?: string;
}

export interface OdooConfig {
  url: string;
  db: string;
  uid: number;
  apiKey: string;
  connected?: boolean;
  lastSync?: string;
}

export interface EvolutionConfig {
  serverUrl: string;
  instance: string;
  apiKey: string;
  teamPhone: string;
  adminPhone: string;
  connected?: boolean;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  connected?: boolean;
  lastSync?: string;
  autoSync?: boolean;
}

export interface ProductItem {
  id: number;
  variantId?: number;
  name: string;
  list_price: number;
  virtual_available: number;
  vitrinaStock?: number;
  almacenStock?: number;
  recepcionStock?: number;
  odooCategory?: string;
  website_url?: string;
  description_sale?: string;
  category: 'laptop' | 'red' | 'monitor' | 'impresora' | 'accesorio';
  image_url?: string;
  website_published?: boolean;
  brand?: string;
  condition?: 'Nuevo' | 'Usado / Reacondicionado';
  conditionDetail?: string;
  specsSummary?: string;
  useCases?: string[];
}

export interface OdooCustomer {
  id: number;
  name: string;
  phone?: string;
  mobile?: string;
  email?: string;
  city?: string;
  street?: string;
  customer_rank?: number;
  sale_order_count?: number;
  total_invoiced?: number;
}

export interface CustomerLead {
  id: string;
  name: string;
  phone: string;
  lidJid?: string;
  odooPartnerId?: number;
  isOdooClient?: boolean;
  address?: string;
  zone: 'santo_domingo' | 'provincia' | 'desconocida';
  aiEnabled: boolean;
  totalSpent: number;
  ordersCount: number;
  detectedInterests: string[];
  objectionsRecorded: string[];
  notes?: string;
  createdAt: string;
  lastInteraction: string;
  profilePicUrl?: string;
}

export interface QuotedMessage {
  id?: string;
  text?: string;
  type?: string;
  author?: string;
  mediaUrl?: string;
}

export interface ChatMessage {
  id: string;
  evolutionMessageId?: string;
  sender: 'customer' | 'assistant' | 'agent' | 'admin';
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker';
  content: string;
  timestamp: string;
  quotedMessage?: QuotedMessage;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaDuration?: number;
  transcription?: string;
  aiAnalysis?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  metadata?: {
    isReceipt?: boolean;
    receiptDetails?: {
      bank?: string;
      amount?: number;
      reference?: string;
      verified?: boolean;
    };
    detectedCategory?: string;
    fileName?: string;
  };
}

export interface Conversation {
  sessionId: string;
  customerPhone: string;
  customerName: string;
  profilePicUrl?: string;
  messages: ChatMessage[];
  messagesLoaded?: boolean;
  aiEnabled: boolean;
  unreadCount: number;
  lastTimestamp: string;
  lastMessagePreview: string;
  lastMessageType?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'sticker';
  intentStatus: 'explorando' | 'interesado' | 'esperando_pago' | 'comprobante_enviado' | 'pedido_confirmado' | 'servicio_tecnico';
  detectedProducts: string[];
  zone?: 'santo_domingo' | 'provincia';
  odooPartnerId?: number;
  isOdooClient?: boolean;
  isLiveEvolution?: boolean;
}

export type OrderPaymentMethod = 'contra_entrega' | 'transferencia';
export type OrderStatus = 'pendiente' | 'comprobante_recibido' | 'aprobado' | 'en_camino' | 'entregado' | 'rechazado';

export interface SalesOrder {
  id: string;
  odooOrderId?: number;
  clientName: string;
  clientPhone: string;
  products: string;
  productId?: number;
  totalAmount: number;
  paymentMethod: OrderPaymentMethod;
  status: OrderStatus;
  address: string;
  deliveryNotes?: string;
  receiptImage?: string;
  receiptBank?: string;
  receiptRef?: string;
  createdAt: string;
  updatedAt: string;
  adminNotes?: string;
}

export interface AILearnedInsight {
  id: string;
  category: string;
  triggerPhrase: string;
  winningPitch: string;
  counterObjection: string;
  successRate: number;
  occurrences: number;
  tags: string[];
  updatedAt: string;
}

export interface FollowUpReminder {
  id: string;
  sessionId: string;
  customerPhone: string;
  customerName: string;
  productInterest: string;
  scheduledDate: string;
  status: 'pendiente' | 'contactado' | 'cancelado';
  origin: 'automatico' | 'manual';
  notes?: string;
}

export interface AppConfig {
  globalAiActive: boolean;
  aiProvider?: AIProviderConfig;
  odoo: OdooConfig;
  evolution: EvolutionConfig;
  supabase?: SupabaseConfig;
}

export type UserRole = 'super_admin' | 'dueno' | 'empleado';

export interface UserAccount {
  id: string;
  nombre: string;
  username: string;
  password?: string;
  whatsapp: string;
  role: UserRole;
  activo: boolean;
  createdAt: string;
  lastLogin?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: UserAccount | null;
  token?: string;
}

