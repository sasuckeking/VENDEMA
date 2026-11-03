# Auditoría y Plan de Optimización de Recursos: Vendemá CRM en Hostinger

## 1. Diagnóstico Técnico del Sistema Actual

### A. Causa Raíz de los Registros `[Odoo Real-Time Sync]: Loaded 609 ...`
- **Frecuencia Excesiva de Polling:** En `server.ts`, se estaba ejecutando `setInterval(syncOdooInventory, 60000)`. Cada 60 segundos (1 minuto), el servidor Node.js ejecutaba de forma ininterrumpida la función `syncOdooInventory()`.
- **Sobrecarga de Peticiones en Paralelo:** Cada ciclo de `syncOdooInventory()` lanzaba simultáneamente entre 4 y 6 peticiones JSON-RPC a Odoo (`Promise.all`):
  1. `product.template.search_read`: Descarga de los 609 productos vendibles completos con descripciones, categorías y precios.
  2. Consulta de stock en ubicación *Vitrina*.
  3. Consulta de stock en ubicación *Almacén*.
  4. Consulta de stock en ubicación *Recepción*.
  5. Consulta de valores de atributos (`product.attribute.value`).
  6. Consulta de líneas de atributos (`product.template.attribute.line`).
- **Impacto en Hostinger:** Este ciclo continuo saturaba el pool de sockets y consumía ciclos de CPU y memoria RAM en el contenedor compartido de Hostinger, generando picos de consumo constantes incluso sin visitas ni usuarios conectados.
- **Sincronización de Clientes:** Adicionalmente, `syncOdooCustomers()` se disparaba cada 5 minutos (`300000 ms`), agregando más consultas pesadas a la base de datos de Odoo.

---

### B. Causa del Polling Constante de WhatsApp (Evolution API)
- En `server.ts`, se ejecutaba `setInterval(syncEvolutionChats, 5000)` cada 5 segundos (720 peticiones HTTP por hora).
- Dado que el CRM ya cuenta con receptor de Webhooks para Evolution API (`/api/webhook/evolution`), mantener este polling en segundo plano cada 5 segundos mantenía la CPU activa y generaba tráfico recurrente innecesario.

---

### C. Causa del Error `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` en Supabase
- En la interfaz de configuración (`src/components/SettingsView.tsx`), los botones **"Probar Conexión"** y **"Subir Todo a Supabase"** hacían solicitudes `POST` a:
  - `/api/supabase/test-connection`
  - `/api/supabase/sync-all`
  - `/api/supabase/schema-sql`
- **Comportamiento en Hostinger:** Cuando el proxy de Nginx / LiteSpeed de Hostinger devolvía un error temporal 502/503/504 en formato HTML, la llamada `res.json()` fallaba al intentar parsear el tag `<!DOCTYPE html>`.
- **Solución implementada:** Se agregó validación del `content-type` y un fallback automático que ejecuta la verificación con `@supabase/supabase-js` directamente desde el navegador del usuario si el backend devuelve HTML.

---

## 2. Optimizaciones Implementadas

1. **Optimización de Odoo:**
   - Ampliado el intervalo en segundo plano a **30 minutos** (`1000 * 60 * 30 = 1,800,000 ms`).
   - Mantenido el botón y parámetro de refresco manual (`/api/odoo/products?refresh=true`) para cuando un vendedor necesite actualizar el inventario inmediatamente.
   - Extendida la vigencia del caché de clientes de Odoo a 30 minutos.

2. **Optimización de WhatsApp Evolution API:**
   - **Eliminado el polling cada 5 segundos** en segundo plano (ahorro de más de 17,000 peticiones diarias).
   - Activada la sincronización **bajo demanda**: solo se consulta a Evolution API cuando un usuario accede a la lista de conversaciones y han transcurrido más de 30 segundos, o cuando presiona refrescar.
   - Los mensajes entrantes en tiempo real se reciben instantáneamente mediante el Webhook `/api/webhook/evolution`.

3. **Corrección de Supabase:**
   - Endpoints activos en `server.ts`:
     - `POST /api/supabase/test-connection`: Ejecuta `testSupabaseConnection()` y valida las 9 tablas del sistema devolviendo JSON estricto.
     - `POST /api/supabase/sync-all`: Sincroniza usuarios, feriados, pedidos, clientes y configuración en Supabase.
     - `GET /api/supabase/schema-sql`: Retorna el script SQL completo de las 9 tablas.
   - Doble capa en `SettingsView.tsx`: Si el backend devuelve una página de error HTML del proxy (502/503/504), el cliente ejecuta la prueba directamente contra Supabase con el SDK de browser, garantizando que nunca se produzca un error `Unexpected token '<'`.

4. **Blindaje de Servidor en Hostinger (LiteSpeed / lsnode.js):**
   - No hay escrituras de disco en el arranque que disparen reinicios del file-watcher.
   - Respuestas estáticas desde búfer en memoria (`res.status(200).send(buffer)`).
   - Generación del bundle de producción optimizado en `dist/` y `server.js`.

---

## 3. Estado de los Pasos de Ejecución

- [x] **Paso 1:** Implementar y verificar endpoints `/api/supabase/test-connection`, `/api/supabase/sync-all` y `/api/supabase/schema-sql` en `server.ts` con tipado riguroso y respuesta JSON garantizada.
- [x] **Paso 2:** Modificar `SettingsView.tsx` para manejar las respuestas de conexión a Supabase con soporte de prueba directa en el cliente si es necesario.
- [x] **Paso 3:** Reconfigurar los intervalos de `server.ts`:
  - Cambiar el intervalo de `syncOdooInventory` a 30 minutos.
  - Eliminar el `setInterval` de 5 segundos de Evolution API y activar la sincronización bajo demanda y por webhook.
  - Ajustar el intervalo de clientes de Odoo a 30 minutos coordinado.
- [x] **Paso 4:** Compilar y verificar el sistema con `npm run build`, `compile_applet` y `lint_applet`.
