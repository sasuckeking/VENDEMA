# CHANGELOG — Vendemá CRM

## [Fase 1] — Estabilidad, Seguridad, Cola Persistente y Control de Errores (2026-11-08)

### 1.1 Seguridad y Autenticación
- **Enmascaramiento de secretos en cliente**: `GET /api/config` oculta todas las llaves sensibles (`openaiApiKey`, `geminiApiKey`, `evolutionApiKey`, `odooApiKey`, `supabaseAnonKey`, `webhookSecret`, `adminSetupPin`) reemplazándolas con `••••` en tránsito hacia el navegador.
- **Eliminación de credenciales expuestas en frontend**: Eliminadas las llaves por defecto de `src/App.tsx` y `src/components/SettingsView.tsx`; la hidratación de `localStorage` preserva las credenciales del backend sin sobrescribirlas con máscaras.
- **Hash criptográfico de contraseñas (`scrypt`)**: Todas las contraseñas en `.vendema-users.json` y Supabase se almacenan con `crypto.scryptSync` + sal aleatoria de 16 bytes y verificación en tiempo constante (`crypto.timingSafeEqual`). Migración automática transparente de contraseñas legadas en texto plano al iniciar el servidor o autenticar.
- **Sesiones firmadas y cookies `HttpOnly`**: Implementados tokens firmados con `HMAC-SHA256`, expiración de 24 horas, cookie `vendema_session` (`HttpOnly`, `SameSite=Lax`), validación de sesión en rutas administrativas y limitador de intentos de login por IP/usuario.

### 1.2 Estabilidad del Servidor y Ciclo de Vida
- **Endpoints de salud**: Añadidos `GET /health` y `GET /ready` con verificación de almacenamiento, cola de trabajos y estado de apagado.
- **Cierre controlado (`Graceful Shutdown`)**: Manejadores para `SIGTERM` y `SIGINT` que detienen los ciclos de sondeo, liberan locks activos de conversación, persisten de forma atómica el estado en disco y cierran el servidor HTTP limpiamente.
- **Captura estructurada de excepciones**: `uncaughtException` y `unhandledRejection` registran trazas completas con severidad `CRITICAL` en el sistema central de logs sin ocultar la causa raíz.

### 1.3 Recepción de Mensajes de Evolution API v2
- **Soporte completo para lotes (`Batch Webhooks`)**: `handleEvolutionWebhook` procesa todos los elementos cuando `payload.data` o `payload.data.messages` contienen múltiples mensajes, eliminando la pérdida de mensajes por lectura exclusiva de `data[0]`.
- **Persistencia previa al procesamiento IA**: Cada mensaje entrante se guarda primero en la conversación y se registra en la cola persistente antes de invocar cualquier llamada a OpenAI, Gemini, Whisper u Odoo.
- **Preservación de identidad**: Mantenido y reforzado el mapeo bidireccional entre `@s.whatsapp.net` y `@lid`.

### 1.4 Cola Persistente de Procesamiento (`.vendema-job-queue.json`)
- **Estados formales del ciclo de vida**: `RECEIVED`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRY`, `DEAD_LETTER`.
- **Backoff exponencial y recuperación**: Reintentos automáticos programados a `5s`, `15s` y `45s` con límite máximo de intentos (`maxAttempts = 3`), timeout por ejecución (`90s`) y recuperación automática de trabajos huérfanos (`PROCESSING -> RETRY`) al reiniciar el proceso.
- **Errores reales sin silenciamiento**: Cuando falla la descarga de audio de Evolution API o la transcripción de OpenAI Whisper (`HTTP 401/500`), el trabajo registra la etapa fallida (`MEDIA_DOWNLOADED` / `MEDIA_TRANSCRIBED`) y pasa a `RETRY`/`FAILED` en lugar de inventar texto falso (`"Hola, buenas"`).

### 1.5 Control de Concurrencia e Idempotencia
- **Locks atómicos por conversación (`.vendema-outbound-locks.json`)**: Estructura formal con `conversationId`, `owner`, `acquiredAt` y `expiresAt` (TTL de 90s), renovación periódica durante ejecuciones válidas y liberación garantizada en bloque `finally`.
- **Idempotencia persistente (`.vendema-processed-ids.json`)**: Deduplicación por `messageId` y hash de contenido para evitar respuestas dobles ante reenvíos de webhooks de Evolution API.

### 1.6 Persistencia Atómica y Resiliencia con Supabase
- **Escritura atómica en disco (`writeFileAtomicSync`)**: Todos los archivos `.vendema-*.json` se escriben primero en un archivo temporal `.tmp` y se reemplazan mediante `fs.renameSync`, evitando corrupción de JSON ante cortes o reinicios.
- **Ledger de sincronización pendiente (`.vendema-pending-sync.json`)**: Registro automático cuando Supabase no está disponible temporalmente, con reintento periódico en segundo plano al restablecerse la conexión.

### 1.7 Sistema Central de Logs y Trazabilidad (`correlation_id`)
- **16 etapas trazables de extremo a extremo**:
  `WEBHOOK_RECEIVED`, `WEBHOOK_VALIDATED`, `MESSAGE_NORMALIZED`, `DUPLICATE_CHECK`, `CONVERSATION_LOCKED`, `MESSAGE_PERSISTED`, `MEDIA_DOWNLOADED`, `MEDIA_TRANSCRIBED`, `IMAGE_ANALYZED`, `CONTEXT_BUILT`, `ODOO_QUERY`, `AI_RESPONSE_GENERATED`, `WHATSAPP_SEND_ATTEMPT`, `WHATSAPP_SENT`, `CONVERSATION_UNLOCKED`, `MESSAGE_COMPLETED`.
- **Niveles de severidad**: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` con redacción automática de llaves API y tokens en los payloads registrados.

### 1.8 Monitor de 5 Servicios e Interfaz de Diagnóstico (`SystemLogsView.tsx`)
- **Monitoreo en tiempo real (`GET /api/system/diagnostics`)**: Estado (`CONNECTED`, `DISCONNECTED`, `DEGRADED`, `UNKNOWN`), latencia en ms, última verificación y último error de:
  1. **Backend**
  2. **Supabase**
  3. **Evolution API**
  4. **OpenAI**
  5. **Odoo**
- **Panel de Cola Persistente y Locks Activos**: Visualización de trabajos en cola, reintento manual de trabajos fallidos (`POST /api/system/queue/:jobId/retry`), liberación manual de locks (`DELETE /api/system/locks/:conversationId`) y trazabilidad por `correlation_id`.
