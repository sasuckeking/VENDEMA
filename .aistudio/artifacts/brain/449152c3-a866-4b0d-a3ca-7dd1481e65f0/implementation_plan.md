# Auditoría Técnica y Plan Maestro — Reestructuración de Vendemá CRM (Fase 1)

## 1. Resumen Ejecutivo y Auditoría del Despliegue Actual

Tras inspeccionar el repositorio y la arquitectura en ejecución de **Vendemá CRM**, se verificó el estado real del entorno de producción, sus puntos de entrada y su persistencia:

- **Arquitectura y Compilación (`package.json`)**:
  - **Fuente principal del backend**: `server.ts` (monolito de ~9,728 líneas en Express + TypeScript).
  - **Compilación a producción**: `npm run build` ejecuta `vite build` (frontend en `dist/`) seguido de `esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.js`.
  - **Puntos de entrada para Hosting (`app.js`, `index.js`, `server.js`)**: `app.js` e `index.js` son adaptadores de 4 líneas (`import app from './server.js'; export default app;`) diseñados para compatibilidad con entornos Phusion Passenger / LiteSpeed / Hostinger, mientras que `"start": "node server.ts"` (o `node server.js`) ejecuta el servidor directamente. **Regla crítica**: Toda modificación en `server.ts` debe compilarse con `npm run build` para regenerar `server.js` y mantener sincronizados `app.js` e `index.js`.
- **Persistencia Híbrida Actual (Supabase + Archivos JSON Locales)**:
  - `.vendema-config.json`: Configuración general, credenciales de integraciones, prompt maestro, feriados RD y estados de WhatsApp.
  - `.vendema-users.json`: Usuarios del CRM, roles (`admin`, `supervisor`, `agent`), permisos y contraseñas (actualmente en texto plano).
  - `.vendema-outbound-locks.json`: Bloqueos de conversación para evitar respuestas simultáneas.
  - `.vendema-processed-ids.json`: IDs de mensajes de WhatsApp procesados para deduplicación.
  - `.vendema-bot-audit.json`: Historial de auditoría de decisiones del bot.
  - **Tablas en Supabase**: `conversations`, `messages`, `customers`, `orders`, `products`, `quotations` y respaldos dentro de `conversations` con IDs reservados (`00000000-0000-0000-0000-000000000001` para configuración y `00000000-0000-0000-0000-000000000009` para usuarios).

---

## 2. Inventario Técnico de Responsabilidades y Diagnóstico de Riesgos

| Módulo / Componente | Responsabilidad Actual | Dependencias | Riesgo Detectado | Modificación Necesaria (Fase 1) |
| :--- | :--- | :--- | :--- | :--- |
| **Autenticación y Usuarios** (`server.ts` `/api/auth/login`, `/api/users`, `.vendema-users.json`) | Inicio de sesión, gestión de usuarios, roles y permisos modulares. | `.vendema-users.json`, Supabase backup (`0000...0009`), `crypto`. | **CRÍTICO**: Contraseñas en texto plano; tokens sin firma criptográfica ni expiración; ausencia de middleware RBAC en rutas administrativas; sin rate-limit contra fuerza bruta. | Hash seguro (`scrypt` + salt con migración transparente al iniciar sesión), sesiones firmadas con HMAC-SHA256 + cookie `HttpOnly`/`SameSite`, expiración de sesión, rate-limiter en `/api/auth/login` y middleware RBAC. |
| **Configuración y Secretos** (`server.ts` `/api/config`, `.vendema-config.json`) | Lectura y guardado de parámetros de Odoo, Evolution API, OpenAI, Supabase y horarios. | `.vendema-config.json`, Supabase backup (`0000...0001`). | **CRÍTICO**: `GET /api/config` devuelve todas las API keys y contraseñas en texto plano al navegador; CORS abierto (`*`). | Separar configuración pública vs. privada; enmascarar secretos en `GET /api/config` (`********` + indicador booleano `hasApiKey`); preservar secreto existente en `POST /api/config` si el cliente envía máscara vacía/oculta; restringir CORS. |
| **Ciclo de Vida del Servidor** (`server.ts` arranque, intervalos, `SIGTERM`/`SIGINT`) | Inicialización de Express, SSE (`/api/events`), intervalos de sincronización y cierre. | Express, timers en memoria, conexiones SSE. | **ALTO**: El apagado cierra el proceso sin drenar trabajos activos ni limpiar todos los `setInterval`; falta diferenciación entre `/health` y `/ready`. | Implementar apagado elegante (`gracefulShutdown`), pausar nuevos trabajos de la cola, persistir estado en curso, limpiar timers y exponer `GET /health` y `GET /ready`. |
| **Recepción Webhook WhatsApp** (`server.ts` `handleEvolutionWebhook`, `/api/webhooks/evolution`) | Recepción de eventos `messages.upsert` desde Evolution API v2, normalización de `@lid` y disparo del bot. | Evolution API v2, caché en memoria, Supabase. | **CRÍTICO**: Solo procesa `body.data[0]` o `body.data.messages[0]`, descartando mensajes cuando Evolution envía lotes; lanza el bot en memoria sin persistir antes en una cola de trabajos. | Iterar sobre la totalidad de elementos del lote (`data` o `data.messages`), validar estructura, persistir evento y encolar trabajo en disco antes de ejecutar la IA. |
| **Cola de Procesamiento** (`server.ts` nuevo motor `.vendema-job-queue.json`) | Procesamiento asíncrono de mensajes entrantes hacia el asistente IA y WhatsApp. | Sistema de archivos (`fs`), Supabase, motor IA. | **CRÍTICO**: Actualmente se ejecuta en promesas volátiles (`setTimeout` / memoria); si el servidor se reinicia o falla la red, el mensaje queda sin respuesta. | Crear cola persistente atómica con estados (`RECEIVED`, `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `RETRY`, `DEAD_LETTER`), backoff exponencial, timeout por tarea y recuperación automática al iniciar. |
| **Control de Concurrencia e Idempotencia** (`.vendema-outbound-locks.json`, `.vendema-processed-ids.json`) | Evitar respuestas duplicadas o condiciones de carrera en la misma conversación. | Archivos JSON locales, memoria del proceso. | **ALTO**: Los locks no tienen renovación estructurada con propietario (`owner`) ni registro de idempotencia por acción comercial (cotización/pedido). | Locks atómicos por conversación (`conversationId`, `owner`, `acquiredAt`, `expiresAt`), liberación en `finally`, y registro de idempotencia que distinga reintentos de mensajes nuevos. |
| **Persistencia y Sincronización** (`server.ts` helpers de `fs.writeFileSync` y Supabase) | Escritura de archivos JSON locales y sincronización con tablas de Supabase. | `fs`, `@supabase/supabase-js`. | **ALTO**: `fs.writeFileSync` directo puede truncar o corromper el JSON si ocurre un corte de energía/proceso a mitad de escritura; fallos de Supabase no siempre encolan resincronización. | Escritura atómica universal (`writeFileAtomicSync`: escribir en `.tmp` + `fs.renameSync`), matriz explícita de fuente de verdad y cola de sincronización pendiente con trazabilidad. |
| **Logs y Diagnóstico Centralizado** (`server.ts` `apiLogs`, `SystemLogsView.tsx`) | Registro de llamadas API, errores de integración y vista de monitoreo en el CRM. | `server.ts`, `src/components/SystemLogsView.tsx`, `src/types.ts`. | **MEDIO**: Los eventos de un mismo mensaje no comparten un `correlation_id` único de extremo a extremo; falta clasificación de severidad y sonda unificada de los 5 servicios. | Trazabilidad completa por `correlation_id` en las 16 etapas del mensaje, redacción automática de secretos, monitor de salud de 5 servicios y panel de diagnóstico enriquecido. |

---

## 3. Plan de Implementación por Bloques (Fase 1.1 a 1.8)

### Bloque 1.1 — Seguridad, Autenticación, Sesiones y Protección de Configuración
1. **Hash de Contraseñas con Migración Transparente**:
   - Implementar hash criptográfico con `crypto.scryptSync` (con salt aleatorio de 16 bytes y prefijo `scrypt$`) para todas las contraseñas en `.vendema-users.json` y el respaldo de Supabase.
   - **Cero pérdida de acceso**: Al iniciar el servidor y durante `/api/auth/login`, si un usuario existente tiene una contraseña en texto plano, se verificará y migrará automáticamente a formato hasheado de forma atómica.
2. **Sesiones Firmadas, Expiración y Cookies Seguras**:
   - Emitir tokens de sesión firmados con HMAC-SHA256 (`sessionId.userId.role.expiresAt.signature`) con expiración configurable (24 horas por defecto) y registro en almacén de sesiones activas.
   - Enviar cookie `vendema_session` con atributos `HttpOnly`, `SameSite=Lax` y `Secure` (cuando sea HTTPS), además de mantener compatibilidad con el header `Authorization: Bearer <token>` y `x-session-token` para no romper el frontend actual.
3. **Middleware RBAC y Rate Limiting**:
   - Proteger rutas sensibles (`/api/config`, `/api/users`, `/api/system/logs/clear`, `/api/webhooks/register`) verificando sesión activa y rol (`admin` / `supervisor` / `agent`).
   - Implementar limitador de intentos fallidos en `/api/auth/login` (máximo 8 intentos fallidos por IP/usuario en ventana de 10 minutos con bloqueo temporal).
4. **Separación de Configuración Pública vs. Privada**:
   - `GET /api/config` nunca devolverá claves crudas (`openaiApiKey`, `geminiApiKey`, `odoo.apiKey`, `evolution.apiKey`, `supabase.anonKey`). En su lugar, devolverá valores enmascarados (`••••••••`) junto con metadatos booleanos (`secretStatus: { hasOpenaiKey, hasGeminiKey, hasOdooKey, hasEvolutionKey, hasSupabaseKey }`).
   - `POST /api/config` detectará si un campo de clave viene enmascarado o vacío y conservará intacta la clave privada almacenada en el servidor, actualizando únicamente si el administrador introduce una clave nueva.

### Bloque 1.2 — Estabilidad del Servidor y Endpoints de Salud
1. **Apagado Elegante (`Graceful Shutdown`)**:
   - Capturar `SIGTERM` y `SIGINT` para detener la admisión de nuevos trabajos en la cola, aguardar hasta 8 segundos a que finalicen los trabajos en estado `PROCESSING`, persistir en disco los estados de cola y bloqueos, limpiar todos los `setInterval` registrados y cerrar conexiones SSE/HTTP ordenadamente.
2. **Endpoints `/health` y `/ready`**:
   - `GET /health` y `GET /api/health`: Respuesta rápida (`200 OK`) indicando que el proceso Node.js está activo, su `uptime`, versión y uso de memoria, sin exponer variables privadas.
   - `GET /ready` y `GET /api/ready`: Verifica que la configuración local esté cargada, el sistema de archivos sea escribible y las dependencias críticas estén inicializadas.
3. **Manejadores Globales con Contexto**:
   - Enriquecer `uncaughtException` y `unhandledRejection` para registrar en el logger centralizado el módulo, stack resumido, severidad `CRITICAL` y marca de tiempo sin derribar el proceso salvo corrupción irrecuperable.

### Bloque 1.3 — Recepción Robusta de Mensajes de Evolution API v2
1. **Soporte Completo para Lotes (`Batch Messages`)**:
   - Refactorizar `handleEvolutionWebhook` (`server.ts`) para extraer todos los mensajes entrantes tanto cuando `body.data` es un arreglo como cuando `body.data.messages` contiene múltiples ítems, iterando sobre cada uno de forma independiente en lugar de tomar solo el índice `[0]`.
2. **Validación y Persistencia Previa al Procesamiento**:
   - Para cada mensaje del lote: validar instancia, remitente (`remoteJid` / `remoteJidAlt` / `@lid`), tipo de contenido, marca de tiempo, y descartar mensajes propios (`key.fromMe === true`) o de grupos (`@g.us`) según la configuración.
   - **Persistencia inmediata**: Guardar primero el mensaje entrante en la conversación y crear el registro en la cola persistente (`.vendema-job-queue.json`) en estado `RECEIVED` -> `PENDING` antes de invocar al trabajador de IA.
3. **Preservación de Identificadores de WhatsApp**:
   - Mantener intacto el mapeo bidireccional entre `@s.whatsapp.net` y `@lid` para garantizar que la respuesta se envíe al JID exacto del cliente.

### Bloque 1.4 — Cola Persistente de Procesamiento (`.vendema-job-queue.json`)
1. **Estructura y Ciclo de Estados**:
   - Implementar el gestor de cola persistente en `.vendema-job-queue.json` (con escritura atómica y respaldo opcional en Supabase) donde cada trabajo incluye: `id`, `correlationId`, `messageId`, `conversationId`, `customer`, `instance`, `contentType`, `receivedAt`, `status` (`RECEIVED` | `PENDING` | `PROCESSING` | `COMPLETED` | `FAILED` | `RETRY` | `DEAD_LETTER`), `attempts`, `maxAttempts`, `nextRetryAt`, `lastError`, `startedAt` y `completedAt`.
2. **Política de Reintentos, Backoff Exponencial y Recuperación**:
   - Tiempo máximo de ejecución por tarea (90 segundos).
   - Si falla por error transitorio (red, timeout, socket desconectado en Evolution API o límite de tasa), pasa a `RETRY` con backoff exponencial (`5s`, `15s`, `45s`). Si supera `maxAttempts` (3 intentos) o es un error definitivo de configuración (ej. `401 Unauthorized` de API Key inválida), pasa a `DEAD_LETTER` con causa explícita.
   - **Recuperación tras reinicio**: Al arrancar el servidor, cualquier trabajo que haya quedado en estado `PROCESSING` por un reinicio previo se restablece automáticamente a `RETRY` para no perder ningún mensaje.

### Bloque 1.5 — Control de Concurrencia e Idempotencia
1. **Bloqueos Atómicos por Conversación (`Conversation Locks`)**:
   - Mejorar `.vendema-outbound-locks.json` con la estructura obligatoria: `conversationId`, `owner` (`jobId` / `correlationId`), `acquiredAt`, `expiresAt` (TTL de 90s con renovación automática mientras el job siga activo) y liberación garantizada en bloque `finally`.
   - Si llega un segundo mensaje del mismo cliente mientras el primero está en `PROCESSING`, el nuevo trabajo permanece en `PENDING` hasta que se libere el bloqueo y luego consolida el contexto reciente para responder sin duplicar mensajes.
2. **Registro de Idempotencia**:
   - Mantener `.vendema-processed-ids.json` con metadatos de estado (`messageId`, `correlationId`, `processedAt`, `responseSent`, `orderOrQuoteCreated`) para distinguir entre un reintento legítimo de un trabajo fallido (`responseSent: false`) y un webhook duplicado de Evolution API (`responseSent: true`).

### Bloque 1.6 — Integridad de Archivos Locales y Sincronización con Supabase
1. **Matriz de Fuente de Verdad**:
   - **Configuración y Usuarios**: Archivo local atómico (`.vendema-config.json`, `.vendema-users.json`) sincronizado bidireccionalmente con el respaldo en Supabase.
   - **Conversaciones, Mensajes, Clientes, Pedidos y Cotizaciones**: Supabase como fuente primaria en la nube con caché local y cola de sincronización diferida en caso de caída de red.
   - **Cola de Trabajos, Locks e Idempotencia**: Archivos locales atómicos de baja latencia con instantánea periódica.
2. **Escritura Atómica (`writeFileAtomicSync`)**:
   - Reemplazar todas las llamadas directas a `fs.writeFileSync` sobre archivos `.vendema-*.json` por una función transaccional que escribe primero en `<archivo>.<pid>.tmp`, valida que el JSON sea íntegro y ejecuta `fs.renameSync` hacia el archivo final.
3. **Cola de Sincronización Pendiente**:
   - Registrar cualquier operación de Supabase que falle por red en una estructura de sincronización con `lastAttemptAt`, `attempts`, `lastError` y `syncStatus` (`SYNCED` | `PENDING_SYNC` | `SYNC_ERROR`), reintentando periódicamente en segundo plano.

### Bloque 1.7 — Sistema Central de Logs y Trazabilidad (`correlation_id`)
1. **Trazabilidad de 16 Etapas por Mensaje**:
   - Asignar un `correlation_id` único (`corr-<timestamp>-<hash>`) a cada mensaje entrante de WhatsApp y propagarlo por las 16 etapas del flujo:
     1. `WEBHOOK_RECEIVED`
     2. `WEBHOOK_VALIDATED`
     3. `MESSAGE_NORMALIZED`
     4. `MESSAGE_PERSISTED`
     5. `QUEUE_CREATED`
     6. `LOCK_ACQUIRED`
     7. `MEDIA_DOWNLOADED`
     8. `MEDIA_TRANSCRIBED`
     9. `AI_REQUEST_STARTED`
     10. `AI_REQUEST_COMPLETED`
     11. `ODOO_REQUEST_STARTED`
     12. `ODOO_REQUEST_COMPLETED`
     13. `RESPONSE_VALIDATED`
     14. `WHATSAPP_SEND_STARTED`
     15. `WHATSAPP_SEND_COMPLETED`
     16. `MESSAGE_COMPLETED`
2. **Clasificación de Severidad y Sanitización**:
   - Cada evento registrará `severity` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`), `module`, `service`, `customer`, `conversationId`, `messageId`, `durationMs` y `errorCategory`.
   - Sanitizador automático que redacta cualquier token Bearer, clave `sk-proj-...`, contraseña o API key antes de guardar en memoria o disco.

### Bloque 1.8 — Monitor de Salud de los 5 Servicios e Interfaz de Diagnóstico
1. **Sonda Unificada de Servicios (`GET /api/system/diagnostics`)**:
   - Monitorear de forma independiente: **Backend**, **Supabase**, **Evolution API**, **OpenAI / Motor IA** y **Odoo**.
   - Cada servicio reportará estado (`CONNECTED`, `DISCONNECTED`, `DEGRADED`, `UNKNOWN`), latencia en ms, marca de tiempo de última verificación, último error clasificado (`AUTH_ERROR`, `CONNECTION_CLOSED`, `TIMEOUT`, `RATE_LIMIT`, `CONFIG_MISSING`, `UPSTREAM_5XX`) y acción recomendada.
2. **Expansión de la Vista de Diagnóstico (`src/components/SystemLogsView.tsx`)**:
   - Conservar el diseño dark de alta densidad existente e incorporar:
     - **Tarjetas de Estado de los 5 Servicios** (Backend, Supabase, Evolution API, OpenAI, Odoo) con botón de verificación en vivo.
     - **Métricas de Cola y Resiliencia**: Trabajos en cola (`PENDING` / `PROCESSING`), en reintento (`RETRY`), en `DEAD_LETTER`, bloqueos activos, sincronizaciones pendientes de Supabase y último webhook recibido.
     - **Explorador de Trazabilidad por `correlation_id`**: Vista cronológica de las 16 etapas de cada mensaje y filtros combinables por fecha, cliente/número de WhatsApp, módulo, servicio, severidad y estado.
     - **Acciones operativas**: Reintentar trabajos en `DEAD_LETTER` y liberar bloqueos huérfanos manualmente si un administrador lo requiere.

---

## 4. Plan de Verificación (10 Pruebas Obligatorias) y Entregables

Al finalizar la implementación de los bloques, se ejecutarán y verificarán las 10 pruebas técnicas exigidas:
1. **Prueba 1 (Texto simple)**: Flujo completo desde `WEBHOOK_RECEIVED` hasta `MESSAGE_COMPLETED` con su `correlation_id`.
2. **Prueba 2 (Lote de mensajes)**: Envío de un payload `messages.upsert` con múltiples mensajes en `data.messages[]` verificando que todos se encolen y ninguno se pierda.
3. **Prueba 3 (Duplicados)**: Envío del mismo `key.id` dos veces verificando que el registro de idempotencia bloquee el segundo procesamiento sin duplicar respuesta.
4. **Prueba 4 (Concurrencia)**: Dos mensajes simultáneos del mismo cliente verificando que el lock atómico serialice el procesamiento sin condición de carrera.
5. **Prueba 5 (Fallo de OpenAI / 401)**: Simulación/detección de clave inválida verificando clasificación `AUTH_ERROR`, severidad `CRITICAL` y transición controlada en la cola sin colapsar el servidor.
6. **Prueba 6 (Fallo de Evolution API / Connection Closed)**: Simulación de caída de socket verificando paso a `RETRY` con backoff exponencial.
7. **Prueba 7 (Fallo de Odoo)**: Verificación de degradación elegante cuando Odoo no responde, manteniendo operativa la atención por WhatsApp.
8. **Prueba 8 (Fallo de Supabase)**: Verificación de respaldo en archivo local atómico y encolado en `PENDING_SYNC`.
9. **Prueba 9 (Reinicio con cola activa)**: Verificación de recuperación automática de trabajos en `PROCESSING` -> `RETRY` al reiniciar el servidor.
10. **Prueba 10 (Seguridad)**: Verificación de que `GET /api/config` oculta todas las claves secretas, contraseñas migradas a `scrypt` y rutas administrativas protegidas por sesión/rol.

Finalmente, se generará el archivo `CHANGELOG.md` documentando cada problema corregido, los archivos modificados y el resultado de las 10 pruebas, y se ejecutará `npm run build` + `compile_applet` + `lint_applet` para garantizar compatibilidad total en producción.
