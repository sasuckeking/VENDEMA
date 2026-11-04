# Plan de Corrección: Envío Único en WhatsApp Multi-Servidor y Espejo Exacto en CRM

## 1. Diagnóstico de la Causa Raíz (Por qué se enviaron 5 copias en WhatsApp y el CRM mostró 1)

1. **Colisión Multi-Servidor (Hostinger + AI Studio Dev/Preview) y Reintentos por Timeout (`9,619 ms`)**:
   - En el registro de auditoría de las `12:41 PM` (`Johanny♾️`, mensaje `"Está bien"`), el bot tardó **9,619 ms** en despachar una respuesta instantánea (`instant-fast-path`).
   - En `sendEvolutionMessageWithStatus`, la petición `POST /message/sendText` tenía un timeout corto de `6000 ms` con `maxAttempts = 2` y un fallback adicional hacia `conv.sessionId`. Cuando Evolution API tardó más de 6 segundos en confirmar el HTTP (aunque Baileys ya había entregado el mensaje a WhatsApp), el servidor abortó a los 6s y **reintentó el envío**, sumándose además las demás instancias activas (Hostinger / URL compartida) que hicieron polling al mismo WhatsApp (`todolapto`) al mismo tiempo.
2. **Ocultamiento de Duplicados en la Vista del CRM**:
   - En `mergeWithLocalMessages` (`server.ts`) y `mergeMessagesList` (`src/App.tsx`), el filtro de deduplicación agrupaba cualquier mensaje saliente (`sender !== 'customer'`) con el mismo texto dentro de una ventana de 5 minutos como si fuera el mismo mensaje local, ocultando en la interfaz del CRM las copias adicionales que sí existían en Evolution API / WhatsApp.
3. **Respuestas Innecesarias a Frases de Cierre y Falsos Positivos de Catálogo**:
   - Frases de cierre (`"Está bien"`, `"Ok"`, `"Listo"`, `"Gracias"`, `"Si"`, `"Lo se"`) o enlaces externos (`https://youtu.be/...`) disparaban respuestas automáticas o coincidencias accidentales de catálogo por subcadenas de 2 letras (`"si"`, `"lo"`, `"se"`, `"be"`).

---

## 2. Cambios Técnicos a Implementar

### A. Despacho Atómico de 1 Solo Intento (Cero Reintentos ciegos en `sendText`)
- **Archivo**: `server.ts` (`sendEvolutionMessageWithStatus` y `sendEvolutionMessageToConversation`)
- **Acción**:
  - Cambiar `maxAttempts = 1` y ampliar el timeout HTTP a `15,000 ms` para evitar que un retraso de red de Evolution API provoque un segundo `POST /message/sendText` duplicado.
  - Eliminar el segundo envío de respaldo a `conv.sessionId` cuando el primer envío expiró por timeout o ya fue despachado al mismo contacto.
  - Registrar todas las llaves de identidad del contacto (`getConversationContactKeys(conv)`: teléfono normalizado, `@s.whatsapp.net` y `@lid`) en `recentOutboundDispatches` **antes** de iniciar la llamada HTTP.

### B. Verificación Pre-Vuelo en Vivo contra Evolution API (Protección Multi-Servidor Hostinger + Cloud)
- **Archivo**: `server.ts` (`triggerSalesBotReplyForConversation` y `syncEvolutionChats`)
- **Acción**:
  - Cuando el origen sea `live_evolution_poll`, aplicar un escalonamiento determinístico por instancia y consultar en tiempo real los últimos mensajes del chat en Evolution API (`/chat/findMessages`) **justo antes** de despachar `sendEvolutionMessageToConversation`.
  - Si en Evolution API ya figura un mensaje saliente (`fromMe: true`) posterior al mensaje del cliente (enviado por el servidor de Hostinger o por otra instancia hace milisegundos), abortar inmediatamente el envío, sincronizar ese mensaje en el CRM y registrar el bloqueo en Auditoría Bot como `Bloqueado: Ya respondido por otra instancia activa`.

### C. Silencio Inteligente en Frases de Cierre y Precisión de Catálogo
- **Archivo**: `server.ts` (`resolveInstantRuleReply`, `getRelevantProductsHighlight`, `resolveDirectCatalogReply`, `triggerSalesBotReplyForConversation`)
- **Acción**:
  - Si el cliente envía una confirmación corta de cierre (`"Está bien"`, `"Ok"`, `"Okay"`, `"Listo"`, `"Vale"`, `"Perfecto"`, `"Gracias"`, `"Muchas gracias"`, `" Dale"`, `"Si"`, `"Lo se"`, emojis sueltos o enlaces de YouTube/redes sin pregunta) cuando **ya existe conversación previa**, el bot no enviará mensajes repetitivos ni activará el catálogo. Solo responderá una vez si es el saludo inicial o una consulta real.
  - En `getRelevantProductsHighlight`, exigir coincidencia de palabra completa o tokens de modelo específicos (`>= 4` caracteres con intención comercial) para impedir que palabras de 2 letras (`"si"`, `"lo"`, `"se"`) o URLs disparen productos al azar.

### D. Espejo Exacto 1:1 de WhatsApp en el Chat del CRM
- **Archivo**: `server.ts` (`mergeWithLocalMessages`, `loadEvolutionMessagesForChat`) y `src/App.tsx` (`mergeMessagesList`)
- **Acción**:
  - Preservar **todos** los mensajes con `evolutionMessageId` distinto provenientes de WhatsApp sin colapsarlos entre sí aunque tengan el mismo texto.
  - Al reconciliar un mensaje optimista local (`msg-...` sin `evolutionMessageId`) con los mensajes reales de Evolution API (`evo-...`), vincularlo como máximo con **un único** mensaje real (`usedLocalIds`) dentro de una ventana estricta de 30 segundos, mostrando en el CRM exactamente la misma cantidad de burbujas que aparecen en el teléfono con WhatsApp.
