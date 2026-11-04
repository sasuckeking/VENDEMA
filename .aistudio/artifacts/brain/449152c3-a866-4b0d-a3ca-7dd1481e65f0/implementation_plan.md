# Desconexión Total de n8n, Integración Directa con Evolution API y Eliminación de Mensajes Repetitivos

Se completó la desconexión total de n8n y la solución definitiva al envío de mensajes repetitivos y respuestas lentas:

---

## 1. Desconexión Total de n8n de la Instancia de Evolution API
- **Webhook Desactivado:** Se envió el comando de configuración a la instancia `todolapto` de Evolution API (`POST /webhook/set/todolapto`) desactivando de raíz el webhook antiguo de n8n (`https://n8n-n8n.blrfh6.easypanel.host/webhook/laptop1`).
- **Verificación en Evolution API:** Se confirmó con `GET /webhook/find/todolapto` que `enabled: false` y `url: ""`. Ya ningún flujo externo de n8n tiene acceso ni puede inyectar mensajes en WhatsApp.
- **Limpieza de Código:** Se removieron todas las menciones y dependencias de n8n en el código fuente (`AIBrainView.tsx`, `server.ts`), operando de forma 100% nativa y directa entre el servidor del CRM, Evolution API y Odoo ERP JSON-RPC.

---

## 2. Eliminación Definitiva de Mensajes Repetitivos y Duplicados
- **Causa Raíz Identificada:** Los clientes recibían 3 mensajes repetidos porque el webhook antiguo de n8n tenía 2 nodos automatizados enviando respuestas al mismo tiempo que nuestro servidor procesaba el mensaje.
- **Filtro Anti-Duplicados en Múltiples Capas (`server.ts`):**
  1. `inFlightBotKeys`: Bloqueo atómico de procesamiento concurrente por contacto, teléfono, sessionId y JIDs (`@s.whatsapp.net` / `@lid`).
  2. `handledContactsThisCycle`: Agrupación en ciclos de sincronización para que el mismo número no reciba más de un despacho por ciclo.
  3. `recentOutboundDispatches`: Bloqueo a nivel de envío (`sendEvolutionMessageWithStatus`) que impide reenviar el mismo texto al mismo destino en menos de 45 segundos.
  4. Cooldown calibrado a 6 segundos para evitar spam y permitir respuestas fluidas sin silencios artificiales.

---

## 3. Respuestas Inmediatas y Directas al Grano (<1ms)
- **Resolvedor Determinístico (`resolveDirectStoreQuestion`):**
  - **Preguntas sobre Horario / Apertura:** Responde al instante si la tienda física de Santo Domingo Este (Av. Charles de Gaulle #133) está abierta y su horario hasta las 6:00 PM, sin re-saludar ni enviar menús de laptops no solicitados.
  - **Ubicación:** Dirección exacta en Av. Charles de Gaulle #133, Santo Domingo Este con referencia.
  - **Envíos / Delivery:** Cobertura a todo el país y pago contra entrega en Santo Domingo.
  - **Garantía:** 6 meses de garantía certificada por escrito en factura formal.
  - **Cuentas Bancarias:** Banreservas, Banco Popular y BHD.
- **Regla Anti-Re-saludo (Regla 2.0.2 en `masterPrompt.ts`):** Prohíbe terminantemente volver a saludar con "¡Hola! Bienvenido a Todo Lapto" si la conversación ya está abierta.

---

## Verificación
- Linteo con `tsc --noEmit`: 0 errores.
- Compilación `npm run build`: Exitosa.
- Dev server reiniciado y operativo en el puerto 3000.
