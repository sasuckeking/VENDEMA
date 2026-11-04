# Plan de Implementación: Filtrado de Productos Genéricos Multimarca y Pureza Categórica (Cero Cables)

Optimización de la búsqueda en inventario Odoo y comportamiento del agente de ventas de IA en WhatsApp para que cuando un cliente pregunte por un producto genérico (ej. mouse, impresora, teclado, bocina, etc.):
1. Envíe **todos los productos disponibles en stock de todas las marcas** (multimarca total).
2. **Sin límite arbitrario** de productos (no truncar en 4 ni en 10).
3. **Pureza categórica estricta (Cero cables):** Ningún cable, cordón ni adaptador de corriente se mezcla en los resultados de un producto específico, salvo que el cliente haya preguntado expresamente por cables.

---

## Tareas Implementadas

- [x] **1. Detector de Cables y Pureza Categórica (`isCableOrWiringItem` en `server.ts`)**
  - Implementación de filtro regex exhaustivo para detectar cables, cordones, cables de poder, patch cords, cables HDMI, VGA, USB, adaptadores de cable y extensiones.
  - Asegura que cualquier producto catalogado como cable o con palabras clave de cableado sea excluido rigurosamente cuando la búsqueda no sea de cables.

- [x] **2. Detector de Familias de Productos Genéricos (`detectGenericProductFamily` en `server.ts`)**
  - Identificación dinámica de familias:
    - `mouse` (mouse ópticos, inalámbricos, gamer; excluye alfombrillas o pads solos y excluye cables).
    - `impresora` (impresoras y multifuncionales; excluye botellas de tinta o tóners sueltos y excluye cables).
    - `teclado` (teclados USB, inalámbricos y combos; excluye repuestos internos de laptops y cables).
    - `monitor` (monitores y pantallas de PC; excluye cables HDMI/VGA).
    - `bocina` (bocinas, parlantes y speakers; excluye cables).
    - `audifonos` (audífonos, headsets y auriculares; excluye cables).
    - `cargador` (cargadores de laptop).
    - `mochila` (mochilas, bultos y maletines).
    - `disco` (discos SSD, NVMe y discos duros).
    - `ram` (memorias RAM).
    - `tablet` (tablets e iPads).
    - `red` (routers, repetidores, access points).
    - `cable` (solo cuando el cliente pregunta expresamente por cables o adaptadores, `isCable: true`).

- [x] **3. Catálogo Genérico Completo Multimarca en `getRelevantProductsHighlight` (`server.ts`)**
  - Generación de bloque prioritario: `=== 🎯 CATÁLOGO COMPLETO DE [FAMILIA] ([TOTAL] DISPONIBLES EN STOCK) — ENVIAR TODOS SIN EXCLUIR NINGUNO ===`.
  - Ordenamiento por precio ascendente (de menor a mayor).
  - Admite filtro de marca si el usuario lo especificó (ej. "mouse logitech"), o devuelve todas las marcas si la consulta fue genérica (ej. "tienen mouse?").
  - Formato listo para WhatsApp con enlaces directos limpios `🔗 https://...` (sin corchetes Markdown).
  - Filtrado de cables también en la búsqueda secundaria por palabras clave (`topMatches`).

- [x] **4. Regla 7.3 en el Prompt Maestro Oficial (`src/masterPrompt.ts`)**
  - Incorporación de la regla `### 7.3 CONSULTAS POR PRODUCTOS GENÉRICOS (MOUSE, IMPRESORAS, TECLADOS, BOCINAS, ETC.) Y PUREZA CATEGÓRICA (CERO CABLES)`:
    - Multimarca total.
    - Todos los productos disponibles sin límite de cantidad.
    - Cero cables salvo petición explícita de cables.
    - Formato de enlace limpio para WhatsApp y pregunta de cierre activo.

---

## Verificación

- `npm run build` ejecutado exitosamente con código 0.
- `lint_applet` (`tsc --noEmit`) verificado con 0 errores.
- Servidor dev reiniciado y activo.
