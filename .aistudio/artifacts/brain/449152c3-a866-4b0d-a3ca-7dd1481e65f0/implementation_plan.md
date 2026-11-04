# Corrección de Auto-Bloqueo (Self-Lock) en Respuestas del Bot de WhatsApp

El nuevo **Panel de Auditoría & Anti-Duplicados** permitió identificar con exactitud matemática por qué el bot no respondió al mensaje *"Están abiertos?"* de **Sr Amarante** a las 10:15 AM: el panel registró `Respuesta en Proceso — Ya hay una respuesta generándose concurrentemente para este contacto. Bloqueo atómico activo`.

---

### Diagnóstico Exacto Detectado por la Auditoría

> [!IMPORTANT]
> **Causa raíz encontrada gracias al registro de auditoría:**
> 1. En el ciclo de sincronización de Evolution API (`syncEvolutionChats`), el código agregaba las llaves del contacto a `inFlightBotKeys` **antes** de invocar a `triggerSalesBotReplyForConversation`.
> 2. Inmediatamente después, al entrar en `triggerSalesBotReplyForConversation`, la función llamaba a `acquireBotLock(conv)`, la cual verificaba si el contacto ya estaba en `inFlightBotKeys`.
> 3. Al encontrar la llave que el propio ciclo acababa de insertar un milisegundo antes, `acquireBotLock` interpretaba erróneamente que había otra respuesta en curso, bloqueaba el envío (`blocked_in_flight`) y salía antes del bloque `try / finally`, dejando el candado activo permanentemente.

---

### 1. Solución Técnica y Arquitectura de Desbloqueo

```
┌─────────────────────────────────────────────────────────────────────────┐
│             Ciclo de Sincronización Evolution API (Cada 2s)             │
│  1. Detecta mensaje entrante sin responder ("Están abiertos?")          │
│  2. Verifica shouldSkipBotReply() y que no tenga candado activo         │
│  3. Marca handledContactsThisCycle (solo para el bucle actual)          │
│  4. Invoca triggerSalesBotReplyForConversation()                        │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               triggerSalesBotReplyForConversation()                     │
│  1. ÚNICO punto que adquiere acquireBotLock(conv) con TTL de 20s        │
│  2. Registra processedMessageIds al iniciar el procesamiento real       │
│  3. Genera respuesta instantánea (< 50ms para "¿Están abiertos?")       │
│  4. Despacha a WhatsApp vía Evolution API (1 sola vez garantizada)      │
│  5. Registra "Respuesta Entregada" en el Panel de Auditoría             │
│  6. Bloque finally {} libera SIEMPRE releaseBotLock(conv)               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Cambios Clave a Ejecutar

- **Unificación del Candado Atómico (`acquireBotLock`):**
  - Eliminar la inserción prematura de `inFlightBotKeys.add(k)` dentro de `syncEvolutionChats` para que no colisione con `acquireBotLock(conv)` dentro de `triggerSalesBotReplyForConversation`.
- **Expiración Automática de Seguridad (TTL de 20 segundos):**
  - Convertir `inFlightBotKeys` de un `Set` estático a un `Map<string, number>` con marca de tiempo (`Date.now()`). Si por cualquier corte de red un proceso tarda más de 20 segundos, el candado se libera automáticamente para que ningún contacto quede congelado.
- **Limpieza de Registros Bloqueados por el Self-Lock:**
  - Al aplicar el cambio, el servidor limpiará los bloqueos previos en memoria para que el bot procese y responda de inmediato a los mensajes pendientes.
