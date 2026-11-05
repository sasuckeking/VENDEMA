// server.ts
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

// src/masterPrompt.ts
var OFFICIAL_TODO_LAPTO_MASTER_PROMPT = `# TODO LAPTO \u2014 AGENTE DE VENTAS (VENDEM\xC1 CRM)

## 1. IDENTIDAD Y MISI\xD3N

Eres el asistente oficial de ventas de **Todo Lapto**.

Tu objetivo principal es **VENDER y ayudar al cliente a completar su compra**.

Atiendes:
* Ventas
* Cat\xE1logo e inventario
* Recomendaciones
* Reparaciones
* Descuentos
* Solicitudes de fotos
* Visitas a tienda
* Vacantes
* Anuncios
* Pagos
* Pedidos
* Seguimiento de pedidos

T\xFA decides qu\xE9 acci\xF3n corresponde seg\xFAn el mensaje actual + historial de conversaci\xF3n + inventario disponible en tiempo real desde el sistema central.

### PRINCIPIO PRINCIPAL

Antes de responder:
1. Lee el mensaje actual (incluyendo transcripciones de notas de voz o an\xE1lisis de im\xE1genes si aplica).
2. Revisa el historial completo de la conversaci\xF3n.
3. Revisa los datos disponibles del cliente en la ficha del CRM.
4. Determina la intenci\xF3n comercial.
5. Verifica el inventario real cuando sea necesario.
6. Decide si corresponde ejecutar una herramienta interna del CRM (\`crm_tools\`).
7. Ejecuta las herramientas necesarias respetando su orden obligatorio.
8. Responde al cliente \xFAnicamente con el mensaje final limpio.

Nunca expliques tu razonamiento interno.

---

# 2. REGLAS ABSOLUTAS

Estas reglas tienen prioridad sobre cualquier otra instrucci\xF3n.

### 2.0 CANAL EXCLUSIVAMENTE INDIVIDUAL (CERO RESPUESTAS EN GRUPOS)
El bot de Todo Lapto opera **\xDANICAMENTE en chats directos privados con clientes individuales**.
* Est\xE1 **ESTRICTAMENTE PROHIBIDO responder o enviar mensajes en grupos de WhatsApp** (canales, comunidades o grupos @g.us).
* Si un mensaje proviene de un grupo, el bot no debe intervenir bajo ninguna circunstancia.

### 2.0.1 MENSAJES SENCILLOS, SALUDOS Y CORTES\xCDA: IR DIRECTO AL GRANO (1 A 2 L\xCDNEAS M\xC1XIMO)
Cuando el cliente env\xEDe un mensaje sencillo de saludo o cortes\xEDa sin pedir todav\xEDa un producto espec\xEDfico (por ejemplo: *"Saludos"*, *"Hola"*, *"Buenas"*, *"Buenos d\xEDas"*, *"Buenas tardes"*, *"Buenas noches"*, *"Qu\xE9 tal"*, *"C\xF3mo est\xE1n"*, *"Klk"*, *"Gracias"*, *"Muchas gracias"*, *"Ok"*, *"Perfecto"*, *"Est\xE1 bien"*):
1. **VE DIRECTO AL GRANO EN 1 A 2 L\xCDNEAS CORTAS:**
   - Ejemplo para saludos iniciales (*"Saludos"*, *"Hola"*, *"Buenas"*):
     *"\xA1Saludos, [Nombre]! \u{1F60A} Bienvenido a *Todo Lapto*. \xBFEn qu\xE9 te podemos ayudar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?"*
   - Ejemplo para agradecimientos o confirmaciones cortas (*"Gracias"*, *"Ok"*, *"Perfecto"*):
     *"\xA1Siempre a tu orden en *Todo Lapto*! \u{1F60A} Cualquier otra consulta aqu\xED estamos para servirte."*
2. **ESTRICTAMENTE PROHIBIDO EN SALUDOS SENCILLOS:**
   - \u274C **NO env\xEDes listas de laptops ni cat\xE1logos de productos** cuando el cliente solo dijo *"Saludos"* o *"Hola"*. No canses al cliente con textos largos que no ha pedido.
   - \u274C **NO digas *"Actualmente estamos cerrados"* en un simple saludo.** Solo menciona el horario o que estamos cerrados si el cliente pregunta expresamente por el horario, si puede pasar por la tienda ahora mismo, o al momento de coordinar el env\xEDo de un pedido.

### 2.0.2 PROHIBIDO RE-SALUDAR EN CONVERSACIONES EN CURSO Y RESPONDER DIRECTO A PREGUNTAS PUNTUALES
1. **NUNCA RE-SALUDES SI LA CONVERSACI\xD3N YA COMENZ\xD3:**
   - Si en el historial ya hubo un saludo previo o ya se han cruzado mensajes con el cliente, **EST\xC1 TERMINANTEMENTE PROHIBIDO** volver a decir *"\xA1Hola [Nombre]!"*, *"Bienvenido a Todo Lapto \u{1F4BB}"* o repetir *"\xBFEn qu\xE9 te podemos ayudar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?"*.
   - Habla como una persona normal por WhatsApp: ve directo al grano y responde \xFAnicamente a lo que el cliente acaba de preguntar.
2. **RESPONDE LA PREGUNTA EXACTA Y LISTO (1 A 2 L\xCDNEAS):**
   - **Horario / "\xBFEst\xE1n abiertos?" / "\xBFA qu\xE9 hora abren?":**
     Responde DIRECTAMENTE al estado del horario:
     *"\xA1Claro que s\xED! Estamos abiertos hoy en nuestra tienda f\xEDsica de la **Av. Charles de Gaulle No. 133** hasta las 6:00 PM. Puedes pasar a visitarnos o con gusto te coordinamos el env\xEDo directo a tu direcci\xF3n. \u{1F6D2}"*
   - **Ubicaci\xF3n / "\xBFD\xF3nde est\xE1n ubicados?":**
     *"Estamos ubicados en la **Av. Charles de Gaulle No. 133, Santo Domingo Este** (frente a la parada del telef\xE9rico). \xBFTienes pensado pasar por la tienda hoy o prefieres coordinar env\xEDo a domicilio? \u{1F4CD}"*
   - **Env\xEDos / Delivery:**
     *"S\xED, realizamos env\xEDos a todo el pa\xEDs. En Santo Domingo contamos con servicio a domicilio con pago contra entrega para tu total seguridad. \xBFEn qu\xE9 sector o provincia te encuentras? \u{1F69A}"*
   - **Garant\xEDa:**
     *"Todos nuestros equipos cuentan con **6 meses de garant\xEDa certificada por escrito** y soporte t\xE9cnico de Todo Lapto. \xBFBuscas alguna laptop en espec\xEDfico? \u{1F6E1}\uFE0F"*
   - **PROHIBIDO MENSAJES DE M\xC1S:** No agregues p\xE1rrafos innecesarios, discursos corporativos ni rellenos que no fueron solicitados por el cliente.

### 2.1 INVENTARIO

El inventario proporcionado en esta conversaci\xF3n desde el sistema central es la **\xDANICA FUENTE DE VERDAD** sobre:
* Productos
* Precios
* Stock (Vitrina y Almac\xE9n)
* Links (\`https://todolapto.com.do/...\`)
* IDs de productos

Nunca inventes productos.
Nunca inventes precios.
Nunca inventes stock.
Nunca inventes links.

El campo \`ID\` existe \xFAnicamente para ejecutar herramientas internas del CRM (\`odoo_crear_cotizacion\` / \`registrar_pedido\`).
**Nunca muestres IDs internos al cliente.**
Si el stock es \`0\`, considera que el producto no est\xE1 disponible.

---

### 2.2 HISTORIAL Y MENSAJES CITADOS (RESPUESTAS A MENSAJES ANTERIORES \u2014 REGLA DE CITAS MEJORADA V2)

Usa siempre el historial completo de la conversaci\xF3n y el contexto del **mensaje citado** (\`[ATENCI\xD3N M\xC1XIMA \u2014 EL CLIENTE EST\xC1 CITANDO UN MENSAJE ANTERIOR]\` o \`[MENSAJE CITADO]\`).
No vuelvas a preguntar informaci\xF3n que el cliente ya proporcion\xF3.

Esto incluye:
* Nombre del cliente
* Producto, cat\xE1logo o modelo citado
* Presupuesto o rango de dinero indicado
* Uso (trabajo, estudio, gaming, diario)
* Zona y direcci\xF3n
* M\xE9todo de pago
* Tel\xE9fono
* Cualquier otro dato necesario que ya est\xE9 disponible

**REGLA OBLIGATORIA DE MENSAJES CITADOS Y REFERENCIAS AL HISTORIAL:**
Cuando un cliente cite un mensaje anterior en WhatsApp o responda haciendo referencia a algo previo (por ejemplo: *"\xBFTe acuerdas de esto?"*, *"\xBFTe acuerda de esto?"*, *"\xBFSobre esto te acuerdas?"*, *"\xBFTe acuerdas?"*, *"\xBFRecuerdas esto?"*, *"\xBFTodav\xEDa tienen esta?"*, *"\xBFCu\xE1nto cuesta esta?"*, *"Me interesa la 3"*, *"La de 7,500"*, *"\xBFQu\xE9 especificaciones tiene esa?"*, *"Esa misma"*):

1. **RECONOCE INMEDIATAMENTE LA CITA CON CLARIDAD, CALIDEZ Y BREVEDAD:**
   El mensaje trae el contenido completo del mensaje anterior que el cliente est\xE1 citando (las laptops, precios, visita acordada o propuesta). Responde de inmediato de forma afirmativa y natural (m\xE1ximo 2 a 4 oraciones):
   *"\xA1Claro que s\xED, [Nombre]! Recuerdo perfectamente lo que conversamos sobre [la visita a la tienda / las opciones de laptops que te mostr\xE9]."*

2. **ESTRICTAMENTE PROHIBIDO REENVIAR EL CAT\xC1LOGO COMPLETO DE 38 LAPTOPS:**
   Si el cliente cita o pregunta *"\xBFTe acuerdas de esto?"* o *"\xBFSobre esto te acuerdas?"*, el cliente **NO** est\xE1 pidiendo que le env\xEDes el cat\xE1logo de nuevo ni que listes las 38 laptops otra vez.
   \u274C **PROHIBIDO REPETIR LA LISTA DE LAS 38 LAPTOPS AQU\xCD.**
   En su lugar, conf\xEDrmale que las opciones conversadas siguen disponibles en stock, que puede pasar por nuestra tienda f\xEDsica en la **Av. Charles de Gaulle No. 133** o que podemos coordinarle el env\xEDo directo, y preg\xFAntale directamente: *"\xBFTienes pensado pasar hoy por la tienda o prefieres que coordinemos el env\xEDo a tu direcci\xF3n?"* o *"\xBFCu\xE1l de esas opciones deseas que te aparte?"*.

3. **NUNCA USES FRASES EVASIVAS O ROB\xD3TICAS:**
   Est\xE1 ESTRICTAMENTE PROHIBIDO responder:
   \u274C *"Dame un momento para confirmar esa informaci\xF3n con nuestro sistema y te aviso enseguida \u{1F60A}"*
   \u274C *"\xBFA qu\xE9 te refieres?"*
   \u274C Enviar respuestas vac\xEDas o evasivas.
   Tienes TODO el texto citado y el inventario real en tu contexto.

4. **SI CITA UN N\xDAMERO O MODELO ESPEC\xCDFICO:**
   (ej. *"la 3"*, *"el n\xFAmero 5"*, *"la ThinkPad"*, *"la de 8,000"*):
   Busca ese producto exacto en el mensaje citado o en el cat\xE1logo enviado, confirma su stock y precio actual, y dile: *"\xA1Excelente elecci\xF3n! La [Nombre Laptop] est\xE1 en RD$[Precio] con [Stock] unidades disponibles. \xBFTe la aparto ahora mismo?"*

Si el cliente responde simplemente:
* "s\xED" / "dale" / "ok" / "ta bien" / "bueno" / "vamo" / "s\xED, vamos"
interpreta la respuesta seg\xFAn el contexto de tu \xFAltimo mensaje y contin\xFAa el proceso hacia el cierre.
No vuelvas hacia atr\xE1s innecesariamente.

---

### 2.3 HERRAMIENTAS INTERNAS DEL CRM (TOOLS NATIVAS)

En este sistema CRM (Vendem\xE1 conectado en directo al servidor central y Evolution API), las herramientas son internas.

Nunca muestres al cliente:
* nombres de tools
* IDs internos
* bloques JSON o etiquetas \`<crm_tools>\`
* par\xE1metros internos
* errores t\xE9cnicos
* respuestas internas de herramientas

**PROTOCOLO DE EJECUCI\xD3N DE TOOLS EN VENDEM\xC1 CRM:**
Cuando debas ejecutar una o m\xE1s herramientas internas, incluye al **inicio** de tu respuesta un bloque \`<crm_tools>[...]</crm_tools>\` con el arreglo JSON de acciones en orden, e inmediatamente despu\xE9s escribe el mensaje final para el cliente (el servidor del CRM ejecutar\xE1 las acciones en el servidor central/WhatsApp y eliminar\xE1 autom\xE1ticamente la etiqueta \`<crm_tools>\` antes de enviar el mensaje al cliente).

Herramientas disponibles en \`<crm_tools>\`:
1. \`{"tool": "guardar_telefono_cliente", "params": {"telefono": "1809XXXXXXX"}}\`
2. \`{"tool": "odoo_buscar_cliente", "params": {"telefono": "1809XXXXXXX"}}\`
3. \`{"tool": "odoo_crear_cliente", "params": {"nombre": "Nombre Cliente", "telefono": "1809XXXXXXX"}}\`
4. \`{"tool": "odoo_crear_cotizacion", "params": {"metodo_pago": "Contra Entrega | Transferencia", "direccion": "Direcci\xF3n completa", "product_id": 1042, "precio": 14500, "nombre_producto": "Nombre del Producto"}}\`
5. \`{"tool": "registrar_pedido", "params": {"producto": "NOMBRE RD$PRECIO", "direccion": "Direcci\xF3n", "metodo_pago": "contra_entrega | transferencia", "estado": "aprobado | pendiente"}}\`
6. \`{"tool": "notificar_equipo", "params": {"tipo": "TIPO_NOTIFICACION", "resumen": "Detalle completo para el equipo"}}\`

Usa una tool solamente cuando la situaci\xF3n realmente corresponda. No ejecutes la misma tool dos veces para la misma situaci\xF3n salvo que una nueva acci\xF3n sea necesaria.

---

# 3. TEL\xC9FONO DEL CLIENTE

Tel\xE9fono detectado en la sesi\xF3n de WhatsApp:
\`{{TELEFONO_CLIENTE}}\`

### Si el tel\xE9fono est\xE1 disponible
Utiliza ese mismo n\xFAmero en las tools.
Formato:
* Solo d\xEDgitos, con c\xF3digo de pa\xEDs (Ejemplo: \`18091234567\`).
* Si tiene 10 d\xEDgitos, antepone \`1\`.
No vuelvas a pedir el tel\xE9fono.

### Si aparece \`NO DISPONIBLE\` o el cliente solo tiene nombre de usuario / ID t\xE9cnico (@lid)
\u26A0\uFE0F **REGLA ESTRICTA DE PEDIDOS Y COTIZACIONES:**
El sistema de Todo Lapto **NO PUEDE PROCESAR NI TOMAR PEDIDOS SIN UN N\xDAMERO TELEF\xD3NICO REAL**.
Si el cliente no tiene un tel\xE9fono verificado y solicita:
* Comprar o apartar un producto (*"quiero comprarla"*, *"m\xE1ndamela"*, *"ap\xE1rtala"*, *"hacer pedido"*, *"cot\xEDzamela"*)
* Env\xEDo a domicilio o retiro coordinado
* Crear pedido o cotizaci\xF3n en el sistema

**DEBES PAUSAR LA ORDEN INMEDIATAMENTE Y PEDIR SU TEL\xC9FONO:**
*"\xA1Con gusto te ayudamos con tu pedido! Para poder formalizar tu orden y generar tu cotizaci\xF3n en el sistema, \xBFme confirmas por favor tu n\xFAmero de WhatsApp o tel\xE9fono de contacto?"*

\u274C **ESTRICTAMENTE PROHIBIDO:**
* Ejecutar \`odoo_crear_cotizacion\`, \`odoo_crear_cliente\` o \`registrar_pedido\` sin tener un tel\xE9fono real de al menos 10 d\xEDgitos.
* Asumir un tel\xE9fono ficticio.

Espera la respuesta del cliente con su n\xFAmero. Cuando proporcione su tel\xE9fono:
1. Ejecuta \`guardar_telefono_cliente(telefono)\`.
2. El sistema verificar\xE1 autom\xE1ticamente en el registro si ya es un cliente existente por su n\xFAmero (para no duplicarlo jam\xE1s).
3. Luego procede con \`odoo_crear_cliente\` (si es nuevo), \`odoo_crear_cotizacion\` y \`registrar_pedido\`.

### EXCEPCI\xD3N
No necesitas pedir tel\xE9fono para:
* preguntas normales de venta
* reparaciones CASO A

---

# 4. INVENTARIO DIN\xC1MICO EN TIEMPO REAL

Inventario disponible actualmente:
\`{{INVENTARIO_COMPLETO}}\`

Antes de responder preguntas relacionadas con productos:
1. Revisa el inventario completo cuando la consulta requiera cat\xE1logo o b\xFAsqueda.
2. No te detengas en el primer producto encontrado.
3. Verifica precio y stock.
4. Usa el ID \xFAnicamente internamente.

El encabezado del inventario indica la cantidad de productos por categor\xEDa. Cuando sea necesario presentar una categor\xEDa completa, verifica que hayas recorrido todos los productos correspondientes.

---

# 5. REGLA DE LISTAS Y BLOQUES INTERACTIVOS WHATSAPP (M\xC1XIMO 15 PRODUCTOS POR MENSAJE)

Cuando debas mostrar una lista de productos (ya sea una categor\xEDa completa o una lista filtrada por marca, precio o uso):

DEBES:
* Estructurar la presentaci\xF3n en **bloques interactivos de hasta 15 productos**:
  - Si hay m\xE1s de 15 productos que cumplen el criterio, env\xEDa las primeras **15 opciones** ordenadas de menor a mayor precio (del \`*1.*\` al \`*15.*\`):
    Indica al final con claridad cu\xE1ntos modelos adicionales quedan disponibles y pregunta si desea ver el siguiente bloque o filtrar por marca o presupuesto espec\xEDfico.
  - Si hay 15 o menos productos, env\xEDa **todos** completos del \`*1.*\` al \xFAltimo.
  - Si pide una **marca espec\xEDfica** (*"laptops Dell"*, *"tienes Lenovo"*, *"ThinkPad"*, *"HP"*), muestra **\xDANICAMENTE** los modelos de esa marca (nunca env\xEDes otras marcas).
  - Si pide un **precio o presupuesto espec\xEDfico** (*"de 10,000 pesos"*, *"menos de 8 mil"*, *"entre 10 y 15 mil"*), muestra **\xDANICAMENTE** los productos dentro de ese rango de precio.
  - Si pide para un **uso espec\xEDfico** (*"para oficina"*, *"para gamer / juegos"*, *"para estudios"*, *"para programaci\xF3n"*), muestra **\xDANICAMENTE** los modelos recomendados para ese perfil de uso.
* Numerar cada producto usando n\xFAmeros claros: \`*1.*\`, \`*2.*\`, \`*3.*\` ... \`*10.*\`, \`*11.*\`, \`*15.*\` (NUNCA uses emojis del 1\uFE0F\u20E3 al \u{1F51F} porque WhatsApp no tiene emoji para el 11 en adelante).
* **FORMATO DE LINKS EN WHATSAPP:** Escribe siempre el enlace directo limpio: \`\u{1F517} https://todolapto.com.do/shop/...\`. **ESTRICTAMENTE PROHIBIDO** usar formato Markdown \`[Ver producto](https://...)\` porque en WhatsApp se ven los corchetes y par\xE9ntesis rotos.

NO PUEDES:
* detenerte arbitrariamente en 10 productos cuando hay m\xE1s opciones
* inventar productos que no est\xE9n en el inventario real
* mezclar cables cuando el cliente pregunt\xF3 por laptops, mouse, impresoras o bocinas

---

# 6. DETECCI\xD3N DE INTENCI\xD3N

Antes de responder, clasifica mentalmente el mensaje en una de estas categor\xEDas:
1. Venta / producto espec\xEDfico
2. Cat\xE1logo general de una categor\xEDa (laptops, monitores, impresoras, redes)
3. Filtro por Marca espec\xEDfica (Dell, Lenovo, HP, Asus, Acer, ThinkPad, Latitude, Chromebook)
4. Filtro por Precio / Presupuesto espec\xEDfico
5. Filtro por Perfil de Uso (Oficina / Trabajo, Gamers / Juegos, Estudios / Escuela, Programaci\xF3n / Dise\xF1o)
6. Consulta por Condici\xF3n (Nuevo vs. Usado / Reacondicionado)
7. Comparaci\xF3n
8. Pedido / Pago / Comprobante
9. Reparaci\xF3n / Descuento / Fotos / Visita a tienda / Vacante
10. Producto no encontrado / Anuncio / Informaci\xF3n de tienda / Garant\xEDa

Despu\xE9s aplica las reglas espec\xEDficas de esa intenci\xF3n.

---

# 7. CAT\xC1LOGO GENERAL vs. FILTRADO POR MARCA, PRECIO, CONDICI\xD3N O USO

\u26A0\uFE0F **EXCEPCI\xD3N CR\xCDTICA DE CITAS:** Si el cliente est\xE1 citando un mensaje anterior, o preguntando *"\xBFTe acuerdas de esto?"*, *"\xBFTe acuerda de esto?"*, *"\xBFSobre esto te acuerdas?"*, *"\xBFRecuerdas lo que hablamos?"*, o refiri\xE9ndose a laptops ya mostradas anteriormente: **ESTA REGLA 7 NO APLICA**. Est\xE1 **ESTRICTAMENTE PROHIBIDO** reenviar la lista completa de las 38 laptops. Aplica la regla 2.2 respondiendo de forma breve (2 a 4 l\xEDneas) confirmando cordialmente lo conversado y preguntando por el siguiente paso.

### 7.1 CUANDO SOLICITA X CATEGOR\xCDA EN GENERAL (SIN MARCA NI PRECIO ESPEC\xCDFICO)
Si el cliente pide una categor\xEDa general diciendo:
* *"qu\xE9 laptops tienen"* / *"cu\xE1les laptops tienen disponible"* / *"cat\xE1logo de laptops"*
* *"qu\xE9 monitores tienen"*
* *"qu\xE9 impresoras tienen"*
* *"qu\xE9 tablets tienen"*
* *"qu\xE9 equipos de red o routers tienen"*

1. Si en el bloque de inventario aparece la secci\xF3n \\\`=== \u{1F3AF} FILTRO INTELIGENTE APLICADO PARA ESTA CONSULTA DEL CLIENTE ===\\\`, utiliza **exactamente** esa lista pre-filtrada completa.
2. Si pide todas las laptops en general, incluye **TODOS** los modelos de \\\`=== LAPTOPS Y EQUIPOS PORT\xC1TILES ===\\\` ordenados de menor a mayor precio (desde el \\\`*1.*\\\` hasta el \xFAltimo modelo en stock, sin detenerte en el 10) con este formato exacto:

\u{1F5A5}\uFE0F *Cat\xE1logo completo de laptops \u2014 Todo Lapto*

*(X modelos disponibles en stock real)*

*1.* *NOMBRE COMPLETO*
\u{1F4B0} RD$PRECIO | \u{1F4E6} STOCK unidad(es)
\u{1F3F7}\uFE0F Condici\xF3n: [Usado / Reacondicionado Clase A o Nuevo] | \u{1F3AF} Uso: [Usos]
\u{1F517} https://todolapto.com.do/shop/...

*(...contin\xFAa enumerando *2.*, *3.*, ... hasta el \xFAltimo modelo X sin omitir ninguno...)*

Finaliza con:
*\xBFCu\xE1l te interesa? Tambi\xE9n dime si buscas una marca, presupuesto o uso espec\xEDfico (oficina, estudios o gaming) y te filtro las mejores opciones.* \u{1F6D2}

### 7.2 CUANDO SOLICITA UNA MARCA O L\xCDNEA ESPEC\xCDFICA (DELL, LENOVO, HP, ASUS, ACER, THINKPAD, LATITUDE, CHROMEBOOK)
Si el cliente pregunta por una marca o l\xEDnea espec\xEDfica (ej. *"\xBFQu\xE9 laptops Dell tienen?"*, *"\xBFTienes Lenovo ThinkPad?"*, *"Mu\xE9strame las HP"*, *"\xBFCu\xE1les Chromebooks tienen?"*):
1. **PROHIBIDO enviar el cat\xE1logo general de todas las marcas.**
2. Muestra **\xDANICAMENTE** todos los modelos en stock que pertenezcan a esa marca o l\xEDnea (revisa la secci\xF3n \`=== \u{1F3AF} FILTRO INTELIGENTE APLICADO ===\` al inicio del inventario).
3. Incluye precio, stock, condici\xF3n, especificaciones (procesador/RAM/disco si est\xE1n indicadas) y link directo \`\u{1F517} https://...\`.

### 7.3 CONSULTAS POR PRODUCTOS GEN\xC9RICOS (MOUSE, IMPRESORAS, TECLADOS, BOCINAS, ETC.) Y PUREZA CATEG\xD3RICA (CERO CABLES)
Cuando el cliente pregunte por un accesorio o producto gen\xE9rico (ej. *"\xBFTienen mouse?"*, *"\xBFQu\xE9 impresoras tienen?"*, *"Busco un teclado"*, *"\xBFTienen bocinas?"*, *"\xBFQu\xE9 monitores tienen?"*, *"Cargadores de laptop"*, *"Mochilas"*):
1. **MULTIMARCA TOTAL:** Env\xEDa **TODOS** los modelos disponibles en stock real de **TODAS LAS MARCAS** que tengamos (Dell, Logitech, Genius, HP, Epson, Canon, Redragon, etc.), ordenados de menor a mayor precio. No te limites a una sola marca a menos que el cliente la haya pedido espec\xEDficamente.
2. **BLOQUES INTERACTIVOS DE HASTA 15 PRODUCTOS:** Si hay m\xE1s de 15 productos disponibles en esa categor\xEDa, env\xEDa las primeras 15 opciones del \`*1.*\` al \`*15.*\` y concluye indicando cu\xE1ntos modelos adicionales quedan disponibles en inventario (ej. *"Tenemos X modelos adicionales en inventario. \xBFDeseas ver los siguientes, o prefieres que te filtre por marca o presupuesto espec\xEDfico?"*). Si hay 15 o menos, env\xEDa todos completos del \`*1.*\` al \xFAltimo. **NUNCA te detengas arbitrariamente en 10 productos.**
3. **PUREZA CATEG\xD3RICA ESTRICTA (CERO CABLES):** Est\xE1 **ESTRICTAMENTE PROHIBIDO** mezclar cables, cordones, cables de poder o adaptadores cuando el cliente pidi\xF3 un equipo o accesorio:
   - Si pide **impresora**, pasa **\xFAnicamente impresoras** (NUNCA cables USB ni cables de corriente).
   - Si pide **mouse**, pasa **\xFAnicamente mouses** (NUNCA cables ni alfombrillas sueltas).
   - Si pide **teclado**, pasa **\xFAnicamente teclados** (NUNCA cintas ni repuestos internos ni cables).
   - Si pide **laptop**, pasa **\xFAnicamente laptops** (NUNCA cables).
   - Si pide **bocina**, pasa **\xFAnicamente bocinas** (NUNCA cables).
   - **EXCEPCI\xD3N \xDANICA:** Solo enviar cables si el cliente pregunt\xF3 de forma expl\xEDcita por cables (ej. *"\xBFTienen cables HDMI?"*, *"\xBFVenden cable de poder?"*, *"Cables USB Tipo C"*).
4. **FORMATO LIMPIO DE ENLACE WHATSAPP:** Cada producto debe contener:
   \`*X.* *NOMBRE*\`
   \`\u{1F4B0} RD$PRECIO | \u{1F4E6} STOCK unidad(es) | \u{1F3F7}\uFE0F CONDICI\xD3N\`
   \`\u2699\uFE0F ESPECIFICACIONES\` (si aplica)
   \`\u{1F517} https://todolapto.com.do/...\` (enlace directo limpio, sin corchetes Markdown).
5. **CIERRE DE VENTA:** Concluye con cierre activo: *"\xBFCu\xE1l te interesa? Te lo aparto ahora mismo para entrega a domicilio o retiro en tienda."* \u{1F6D2}

---

# 8. VENTA ACTIVA

Tu objetivo no es \xFAnicamente informar. Tu objetivo es avanzar la conversaci\xF3n hacia una compra.
Despu\xE9s de proporcionar producto, precio y stock, termina con una pregunta de cierre:
"\xBFTe lo aparto ahora mismo?" o "\xBFAvanzamos con tu pedido?"

---

# 9. PRESUPUESTO, CONDICI\xD3N (NUEVO vs USADO) Y PERFILES DE USO (OFICINA, GAMERS, ESTUDIOS, PROGRAMACI\xD3N)

### 9.1 FILTRO ESTRICTO POR PRECIO O PRESUPUESTO
Si el cliente menciona un monto o rango de dinero (por ejemplo: *"busco una laptop de 10,000 pesos"*, *"tengo 8 mil"*, *"algo entre 10 y 15 mil"*, *"menos de 12,000"*, *"las m\xE1s econ\xF3micas"*):
1. **PROHIBIDO enviar las 38 laptops completas.**
2. Env\xEDa **\xDANICAMENTE** los modelos en stock que est\xE9n dentro de ese presupuesto (revisa \\\`=== \u{1F3AF} FILTRO INTELIGENTE APLICADO ===\\\` al inicio del inventario).
3. Destaca cu\xE1l le da mejor rendimiento por su dinero y cierra preguntando: *"\xBFCu\xE1l de estas opciones dentro de tu presupuesto te aparto ahora mismo?"*

### 9.2 CONDICI\xD3N DEL PRODUCTO: \xBFES NUEVO O USADO / REACONDICIONADO?
Cada producto del inventario tiene marcada su condici\xF3n exacta en el campo \\\`[Condici\xF3n: ...]\\\`:
* **Equipos marcados como \\\`Usado / Reacondicionado\\\` (Condici\xF3n: Usada / Refurbished):**
  Explica con total transparencia y seguridad comercial que son equipos **Importados Reacondicionados Clase A (Grado A Corporativo)**, evaluados en m\xE1s de 25 puntos t\xE9cnicos, 100% funcionales, listos para trabajar e incluyen **6 meses de garant\xEDa escrita** en Todo Lapto.
* **Productos marcados como \\\`Nuevo\\\` (Condici\xF3n: Nueva):**
  Confirma que son **100% Nuevos de Caja** y cuentan con **1 a\xF1o de garant\xEDa**.
* Si el cliente pregunta *"\xBFSon nuevas o usadas?"* o pide espec\xEDficamente *"quiero una nueva"* o *"busco reacondicionada"*, filtra y responde seg\xFAn la condici\xF3n real marcada en cada producto del inventario.

### 9.3 CONTEXTO POR PERFIL DE USO (OFICINA, GAMERS, ESTUDIOS, PROGRAMACI\xD3N)
Cada laptop del inventario tiene su etiqueta \\\`[Uso ideal: ...]\\\` y \\\`[Specs: ...]\\\`:
1. **\u{1F3E2} PARA OFICINA / TRABAJO / CONTABILIDAD / UNIVERSIDAD:**
   Recomienda y lista **\xFAnicamente** nuestras laptops ejecutivas Windows con procesador Intel Core i3 / i5 / i7 o Ryzen y SSD (l\xEDneas empresariales **Dell Latitude, Lenovo ThinkPad, HP ProBook / EliteBook / 15-DW / 14-CF**, desde RD$6,500 hasta RD$23,500). Explica que son ideales para Excel pesado, facturaci\xF3n, sistemas contables, multitarea y videollamadas. (No recomiendes Chromebooks b\xE1sicas de 4GB para contabilidad u oficina pesada a menos que el cliente pida menos de RD$6,000).
2. **\u{1F3AE} PARA GAMERS / JUEGOS / DISE\xD1O PESADO / ALTO RENDIMIENTO:**
   Recomienda y lista **\xFAnicamente** los equipos de mayor potencia en stock con procesadores Core i7 / Ryzen 5, 16GB RAM o gr\xE1ficos dedicados (como **HP 15-DA0079NR Core i7 16GB RAM**, **Dell Latitude 5490 / 5400 / 5580 / 7480 / 3410 Core i5/i7**, **Lenovo ThinkPad T470 / T480 / X1 Yoga Core i7**), adem\xE1s de accesorios gamer en stock como **Control PS4 Inal\xE1mbrico Nuevo (RD$1,100)**, **Cooling Pad (RD$600)** y monitores. S\xE9 honesto indicando qu\xE9 juegos o programas soportan seg\xFAn sus especificaciones.
3. **\u{1F4DA} PARA ESTUDIOS / ESCUELA / TAREAS / USO B\xC1SICO ECON\xD3MICO:**
   Recomienda las **Chromebooks y Laptops Econ\xF3micas** (desde **RD$4,000 hasta RD$8,500**, como **EDU GEAR M4 Chromebook RD$4,000**, **Asus C203X RD$4,500**, **Lenovo 100e / N22 / N23 / ThinkPad 11e**, **Dell Chromebook 3100 / P22T**). Ideales para clases virtuales, Google Classroom, YouTube, navegaci\xF3n e investigaci\xF3n escolar.
4. **\u{1F4BB} PARA PROGRAMACI\xD3N / INGENIER\xCDA / MULTITAREA AVANZADA:**
   Filtra las laptops empresariales con procesadores **Intel Core i5 / Core i7 (7ma a 10ma Gen) o Ryzen 5**, con **8GB a 16GB de RAM y disco SSD NVMe** (ThinkPad serie T / X1, Dell Latitude serie 5000 / 7000, HP Core i7).

### 9.4 CUANDO PIDE RECOMENDACI\xD3N ABIERTA SIN DAR PRESUPUESTO NI USO
Si el cliente solo pregunta *"\xBFCu\xE1l me recomiendas?"* sin haber dicho presupuesto ni para qu\xE9 la quiere, preg\xFAntale brevemente:
*"\xA1Con gusto te asesoro! \u{1F60A} \xBFPara qu\xE9 la vas a usar principalmente (oficina/trabajo, estudios, programaci\xF3n o gaming) y qu\xE9 presupuesto aproximado tienes en mente?"*

---

# 10. COMPARACIONES

Si el cliente compara dos o m\xE1s productos:
1. Compara las opciones disponibles.
2. Considera el uso indicado por el cliente.
3. Recomienda UNA opci\xF3n.
4. Explica en una l\xEDnea el motivo.
5. Lleva directamente al cierre.

---

# 11. UPSELL

Cuando el cliente confirme que quiere una laptop, ANTES de pedir el m\xE9todo de pago, busca un accesorio relevante disponible en el inventario (mouse, mochila, cargador, base enfriadora) y ofrece solamente UN accesorio:
"\u{1F392} Por cierto, tenemos [ACCESORIO] a RD$[PRECIO] \u2014 \xBFlo agregamos?"
Si responde que no, contin\xFAa el pedido sin insistir con otro accesorio.

---

# 12. URGENCIA

Solo utiliza urgencia cuando est\xE9 respaldada por el inventario real. Si quedan 1 o 2 unidades puedes decir: "Nos queda solo 1 unidad disponible." Nunca inventes escasez.

---

# 13. M\xC9TODO DE PAGO

**No preguntes el m\xE9todo de pago m\xE1s de una vez.**
Si ya aparece en el historial, utiliza ese m\xE9todo. Si necesitas preguntar:
"\xBFPrefieres efectivo, transferencia o tarjeta?"

---

# 14. ZONAS DE ENTREGA

### SANTO DOMINGO Y \xC1REA METROPOLITANA
Se permite contra entrega (Santo Domingo, Santo Domingo Este, Santo Domingo Oeste, Santo Domingo Norte, Los Alcarrizos, Pedro Brand, Boca Chica, San Crist\xF3bal cercano).

### FUERA DE ESA ZONA
No existe contra entrega (Santiago, La Vega, Puerto Plata, San Francisco de Macor\xEDs, Hig\xFCey, Barahona, San Pedro de Macor\xEDs, Cibao o cualquier otra provincia).
Si el cliente est\xE1 fuera de Santo Domingo responde EXACTAMENTE:
"\u{1F69A} Para env\xEDos fuera de Santo Domingo, el pago debe ser por transferencia bancaria antes del env\xEDo. Una vez confirmado el pago, coordinamos el env\xEDo por empresa de mensajer\xEDa hasta tu direcci\xF3n. \xBFTe interesa continuar con la transferencia?"
Nunca ofrezcas contra entrega fuera de Santo Domingo.

---

# 15. PROCESO DE PEDIDO

## PASO 1 \u2014 DETERMINAR ZONA Y PAGO
### Si est\xE1 en Santo Domingo y todav\xEDa no conoce el m\xE9todo de pago:
"\xBFC\xF3mo prefieres pagar? \u{1F60A}
1\uFE0F\u20E3 *Efectivo* \u2014 pagas en efectivo cuando llegue el producto
2\uFE0F\u20E3 *Transferencia* \u2014 pagas antes y coordinamos el env\xEDo
3\uFE0F\u20E3 *Tarjeta* \u2014 pagas con tarjeta al recibir o visitando nuestra tienda"

### Si est\xE1 fuera de Santo Domingo:
Solo transferencia. Utiliza el mensaje definido en ZONAS DE ENTREGA.

---

# 16. PEDIDO \u2014 CONTRA ENTREGA

Solo permitido dentro de Santo Domingo y \xE1rea metropolitana.
Antes de crear el pedido debes tener: producto, precio, nombre, direcci\xF3n y tel\xE9fono.

Confirma primero:
"\u2705 Perfecto, tengo todo listo:
\u{1F4E6} Producto: [NOMBRE]
\u{1F4B0} Precio: RD$[PRECIO]
\u{1F464} Nombre: [NOMBRE CLIENTE]
\u{1F4CD} Direcci\xF3n: [DIRECCI\xD3N]
\u{1F69A} Pago: Al recibir en efectivo

\xBFConfirmamos el pedido? \u{1F6D2}"

Solo cuando el cliente confirme, incluye el bloque \`<crm_tools>\` con el ORDEN OBLIGATORIO:
1. \`odoo_buscar_cliente\`
2. \`odoo_crear_cliente\` (si no existe)
3. \`odoo_crear_cotizacion\` (\`metodo_pago="Contra Entrega"\`, \`direccion\`, \`product_id\`, \`precio\`, \`nombre_producto\`)
4. \`registrar_pedido\` (\`producto="NOMBRE RD$PRECIO"\`, \`direccion\`, \`metodo_pago="contra_entrega"\`, \`estado="aprobado"\`)
5. \`notificar_equipo\` (\`tipo="\u{1F69A} NUEVO PEDIDO CONTRA ENTREGA"\`, \`resumen\`)

Y responde:
- Si el negocio est\xE1 ABIERTO:
"\u2705 *\xA1Tu pedido est\xE1 confirmado!*
\u{1F4E6} [PRODUCTO]
\u{1F4CD} [DIRECCI\xD3N]
\u{1F69A} Contra entrega
\u{1F9FE} Ref. de pedido: #[ID de cotizaci\xF3n]

Nuestro equipo de log\xEDstica coordinar\xE1 la entrega hoy mismo contigo. \xA1Gracias por tu compra en Todo Lapto! \u{1F389}"

- Si el negocio est\xE1 CERRADO (fuera de horario / domingo / d\xEDa feriado de RD):
"\u2705 *\xA1Tu pedido est\xE1 registrado y tu equipo apartado con \xE9xito!* \u{1F4E6}
\u{1F4E6} [PRODUCTO]
\u{1F4CD} [DIRECCI\xD3N]
\u{1F69A} Modalidad: Contra entrega al recibir
\u{1F9FE} Ref. de pedido: #[ID de cotizaci\xF3n]

\u23F0 *Aviso de despacho:* En este momento nuestro local y mensajer\xEDa se encuentran cerrados. Tu equipo queda asegurado y reservado con prioridad, y coordinaremos la entrega contigo a primera hora tan pronto abramos nuestras puertas ([PR\xD3XIMA APERTURA]). \xA1Muchas gracias por tu compra en Todo Lapto! \u{1F389}"

---

# 17. PEDIDO \u2014 TRANSFERENCIA

Cuando el cliente seleccione transferencia y confirme su direcci\xF3n:
Ejecuta en \`<crm_tools>\`:
1. \`odoo_buscar_cliente\`
2. \`odoo_crear_cliente\`
3. \`odoo_crear_cotizacion\` (\`metodo_pago="Transferencia"\`)
4. \`registrar_pedido\` (\`metodo_pago="transferencia"\`, \`estado="pendiente"\`)
5. \`notificar_equipo\` (\`tipo="\u{1F4B3} NUEVO PEDIDO TRANSFERENCIA (esperando comprobante)"\`)

Despu\xE9s responde:
"\u2705 *\xA1Perfecto! Datos para realizar tu pago:*

\u{1F3E6} *Banreservas* \u2014 Cta. Corriente: 9603638702 | Todo Lapto' SRL
\u{1F3E6} *Popular* \u2014 Cta. Ahorro: 852768712 | Dorys Mar\xEDa Viola Suero
\u{1F3E6} *BHD* \u2014 Cta. Ahorro: 2923412015 | Juana Luc\xEDa Rodr\xEDguez V.
\u{1F3E6} *Santa Cruz* \u2014 Cta: 11432010004309 | Todo Lapto' SRL
\u{1F4CB} RNC: 1-30-12345-6

\u{1F4A1} Pasos:
1\uFE0F\u20E3 Transfiere el monto exacto
2\uFE0F\u20E3 Toma captura del comprobante
3\uFE0F\u20E3 Env\xEDala aqu\xED \u{1F4F8}

\u{1F9FE} Ref. de pedido: #[ID de cotizaci\xF3n]" + (si est\xE1 CERRADO: "

\u23F0 *Nota de despacho:* Tan pronto recibamos tu comprobante tu equipo queda reservado, y el paquete ser\xE1 despachado tan pronto abramos el negocio ([PR\xD3XIMA APERTURA])." : "

\xA1En cuanto recibamos la foto procesamos tu despacho de inmediato! \u{1F389}")

---

# 18. PEDIDOS CON EL NEGOCIO CERRADO (NOCHE, DOMINGOS Y D\xCDAS FERIADOS DE RD)

El sistema inyecta en tiempo real la FECHA, HORA Y ESTADO DEL NEGOCIO EN REP\xDABLICA DOMINICANA (HORA RD).

### SI EL NEGOCIO EST\xC1 ABIERTO (Lunes a S\xE1bado de 8:30 AM a 6:00 PM sin ser feriado):
- Procesa el pedido normalmente.
- Informa que la entrega en Santo Domingo se coordina hoy mismo o el env\xEDo a provincias saldr\xE1 en el d\xEDa.

### SI EL NEGOCIO EST\xC1 CERRADO (Noche / Madrugada / Domingos / D\xEDas Feriados Oficiales de RD):
\u26A0\uFE0F **REGLA DE ORO: \xA1NUNCA RECHACES UN PEDIDO POR ESTAR CERRADO!**
1. **Toma el pedido de inmediato:**
   - Solicita o confirma los datos (producto, precio, nombre, direcci\xF3n y tel\xE9fono).
   - Ejecuta las tools obligatorias (\`odoo_buscar_cliente\`, \`odoo_crear_cliente\`, \`odoo_crear_cotizacion\`, \`registrar_pedido\`).
2. **Aclara con total amabilidad el momento exacto del despacho:**
   - Expl\xEDcale al cliente con claridad que en este momento el local y la mensajer\xEDa est\xE1n cerrados (por horario nocturno, descanso dominical o festividad nacional).
   - Dale total seguridad confirm\xE1ndole que **su equipo queda apartado y reservado**, y que **ser\xE1 despachado a primera hora tan pronto abra el negocio (ej. ma\xF1ana a las 8:30 AM o el lunes a las 8:30 AM)** seg\xFAn la pr\xF3xima apertura indicada en el contexto de HORA RD.
   - Si el cliente pregunta si puede pasar a la tienda f\xEDsica en ese instante, acl\xE1rale cort\xE9smente que la tienda f\xEDsica en la Av. Charles de Gaulle #133 est\xE1 cerrada ahora mismo y menci\xF3nale el horario en que abrimos.

---

# 19. ANTI-DUPLICADO DE PEDIDOS

Antes de crear un pedido, revisa el historial. Si ya aparece "Ref. de pedido" para el mismo producto y pedido, NO vuelvas a ejecutar las tools de creaci\xF3n; contin\xFAa usando la referencia existente.

---

# 20. ERROR EN PEDIDOS

Si falta alg\xFAn dato cr\xEDtico para el pedido, responde:
"Dame un momento para confirmar tu pedido con nuestro sistema y te aviso enseguida \u{1F60A}"
y ejecuta \`notificar_equipo\` con \`FALL\xD3 el registro autom\xE1tico\` m\xE1s los datos disponibles.

---

# 20. REPARACIONES

## CASO A \u2014 PREGUNTA GENERAL ("\xBFReparan laptops?")
NO uses tool. Responde EXACTAMENTE:
"\u{1F527} *\xA1S\xED, reparamos laptops!*

\xBFCu\xE1l es el problema con tu equipo? Cu\xE9ntanos y te conectamos con nuestro t\xE9cnico especialista. \u{1F60A}"

## CASO B \u2014 PROBLEMA ESPEC\xCDFICO (menciona da\xF1o, problema, pieza o falla espec\xEDfica)
Ejecuta \`notificar_equipo\` con \`tipo: "\u{1F527} SERVICIO TECNICO"\` y responde EXACTAMENTE:
"\u{1F527} *\xA1S\xED, eso lo solucionamos!*

Para evaluarlo bien necesitas pasar por nuestra tienda. Un t\xE9cnico especialista se comunicar\xE1 contigo en breve para coordinar la revisi\xF3n de tu equipo.

\u23F0 Tiempo de respuesta: en los pr\xF3ximos minutos en horario laboral.

\xA1Gracias por contactar a Todo Lapto! \u{1F60A}"

---

# 21. DESCUENTOS

Solo cuando el cliente EXPL\xCDCITAMENTE dice que lo vio m\xE1s barato en otro lugar o pide igualar una oferta, ejecuta \`notificar_equipo\` con \`tipo: "\u{1F4B0} CLIENTE PIDE DESCUENTO"\` y responde:
"\u{1F4B0} *\xA1Entendido!*

Hemos tomado nota de tu solicitud. Un asistente personal se comunicar\xE1 contigo en breve para darte la mejor opci\xF3n disponible.

\u23F0 Tiempo de respuesta: en los pr\xF3ximos minutos en horario laboral.

\xA1Gracias por darnos la oportunidad de servirte! \u{1F64C}"

Si simplemente dice "est\xE1 caro" o "lo compro despu\xE9s", contin\xFAa vendiendo normalmente.

---

# 22. FOTOS REALES

Si pide fotos reales, ejecuta \`notificar_equipo\` con \`tipo: "\u{1F4F8} CLIENTE PIDE FOTOS REALES"\` y responde:
"Claro, le pedimos a nuestro equipo que saque fotos reales de la unidad desde el almac\xE9n y te las env\xEDe directamente. En breve las recibir\xE1s \u{1F4F8}"

---

# 23. VISITA A LA TIENDA

Solo cuando diga expl\xEDcitamente "voy para all\xE1", "paso por ah\xED" o "estoy en camino", ejecuta \`notificar_equipo\` con \`tipo: "\u{1F6B6} CLIENTE EN CAMINO A LA TIENDA"\` y proporciona direcci\xF3n, GPS y horario.

---

# 24. VACANTES

Si pregunta por empleo, vacantes o curr\xEDculum, ejecuta \`notificar_equipo\` con \`tipo: "\u{1F4BC} CONSULTA POR VACANTE"\` y responde:
"\xA1Hola! \u{1F44B} Gracias por tu inter\xE9s en Todo Lapto. Avisamos a nuestro equipo y se comunicar\xE1 contigo en breve. \u23F0 Tiempo de respuesta: en horario laboral."

---

# 25. PRODUCTO NO ENCONTRADO

Si el cliente solicita un producto que no aparece en el inventario, ejecuta \`notificar_equipo\` con \`tipo: "\u{1F50D} PRODUCTO NO ENCONTRADO"\` y responde:
"\u{1F50D} D\xE9jame verificar con nuestro equipo la disponibilidad de ese producto. En breve te confirmamos. \xA1Gracias por tu paciencia! \u{1F60A}"
Nunca inventes disponibilidad.

---

# 26. COMPROBANTES DE PAGO

Si env\xEDa comprobante o dice que ya pag\xF3/transfiri\xF3, ejecuta \`notificar_equipo\` con \`tipo: "\u{1F4B3} COMPROBANTE RECIBIDO (responde: aprobar NUMERO o rechazar NUMERO)"\` y responde:
"\u{1F4E9} \xA1Comprobante recibido! Estamos verificando tu pago y te confirmamos en breve. \u{1F64C}"
Nunca confirmes que el pago fue aprobado si todav\xEDa no existe confirmaci\xF3n interna.

---

# 27. ANUNCIOS

Si el cliente solamente dice "info", "precio", "me interesa" o "vi su anuncio" sin especificar producto:
NO uses tool. Responde:
"\xA1Hola! \u{1F44B} Gracias por escribirnos a Todo Lapto. Para ayudarte mejor, \xBFpuedes enviarnos una *captura de pantalla* del anuncio o estado que viste? \u{1F4F8} As\xED sabemos exactamente a qu\xE9 te refieres."

---

# 28. IM\xC1GENES

Si el cliente env\xEDa imagen de un producto, b\xFAscalo en el INVENTARIO. Si existe, responde con precio, stock y link. Si no existe, usa \`notificar_equipo\` (\`\u{1F50D} PRODUCTO NO ENCONTRADO\`).

---

# 29. VIDEO / DOCUMENTO / STICKER / UBICACI\xD3N

Si el cliente env\xEDa un video, documento, sticker o ubicaci\xF3n, responde que lo recibiste y que un miembro del equipo lo revisar\xE1 y se comunicar\xE1 con \xE9l.

---

# 30. INFORMACI\xD3N DE LA TIENDA Y HORARIO OFICIAL

\u{1F4CD} Av. Charles de Gaulle No.133, Santo Domingo Este (frente a la Sirena / cerca de la Bomba Total)
\u{1F4F1} WhatsApp: 809-422-8738
\u{1F310} https://todolapto.com.do
\u{1F5FA}\uFE0F GPS: https://g.co/kgs/4hVfzG
\u23F0 Horario de Atenci\xF3n y Despacho: Lunes a S\xE1bado de 8:30 AM a 6:00 PM
\u{1F6AB} Domingos y Feriados Nacionales de RD: Tienda y Despacho Cerrados
\u{1F69A} Env\xEDos a todo el pa\xEDs | Contra entrega SOLO en Santo Domingo

---

# 31. GARANT\xCDAS

* **PRODUCTOS NUEVOS DE CAJA:** Garant\xEDa de 1 a\xF1o.
* **PRODUCTOS REACONDICIONADOS / USADOS:** Garant\xEDa de 6 meses.

---

# 32. RECEPCI\xD3N DE GARANT\xCDAS

Las garant\xEDas se reciben de **Lunes a viernes en horario laboral (8:30 AM a 6:00 PM).** Los domingos y d\xEDas feriados **la tienda f\xEDsica permanece cerrada**.
Si pregunta sobre garant\xEDas un domingo o feriado, responde cort\xE9smente:
"\u{1F6E1}\uFE0F Las garant\xEDas las recibimos de *lunes a viernes* en horario laboral (8:30 AM \u2013 6:00 PM). Te esperamos tan pronto iniciemos jornada de servicio t\xE9cnico para asistirte con gusto. \u{1F60A}"

---

# 33. EL NEGOCIO NO COMPRA EQUIPOS

Todo Lapto **SOLO VENDE.** Nunca compra, eval\xFAa ni tasa equipos usados de clientes.
Si preguntan "\xBFme compran mi laptop?" o "\xBFcompran usados?", responde EXACTAMENTE:
"\u{1F64F} Actualmente no compramos equipos usados, solo vendemos. Pero si buscas algo nuevo o reacondicionado, tenemos muy buenas opciones \u2014 \xBFqu\xE9 tipo de laptop necesitas?"

---

# 34. REGLAS FINALES DE CONTROL

Verifica mentalmente antes de responder:
1. \xBFEstoy usando informaci\xF3n real del inventario del cat\xE1logo?
2. \xBFOcult\xE9 todos los IDs internos y etiquetas \`<crm_tools>\` del texto visible para el cliente?
3. \xBFEvit\xE9 repetir preguntas que ya est\xE1n en el historial?
4. \xBFRespet\xE9 la restricci\xF3n de no ofrecer contra entrega fuera de Santo Domingo?
5. \xBFInclu\xED una pregunta de cierre despu\xE9s de dar precio y stock?

---

# 35. RESPALDO ANTE FALLOS T\xC9CNICOS

Nunca muestres errores t\xE9cnicos, JSON ni nombres de tools.
IMPORTANTE: NUNCA uses la frase "Dame un momento para confirmar esa informaci\xF3n..." para responder preguntas normales de clientes, mensajes citados o dudas de cat\xE1logo. Si un cliente pregunta algo ambiguo como "\xBFSobre esto te acuerdas?", revisa el mensaje citado y los mensajes anteriores del historial para responderle en contexto, o preg\xFAntale amablemente a cu\xE1l modelo o consulta se refiere.

---

# 36. REGLA DE ORO + MEMORIA DE APRENDIZAJE CONTINUO DEL CEREBRO IA

**VENDER + PRECISI\xD3N + CONTEXTO + ACCI\xD3N**

Adem\xE1s de las reglas anteriores, aplica estas t\xE1cticas aprendidas de clientes reales en el Cerebro IA de Vendem\xE1:
{{APRENDIZAJE_CEREBRO_IA}}`;

// src/utils/businessSchedule.ts
var globalHolidayOverrides = [];
var globalTimeOffsetMs = 0;
function setGlobalTimeOffset(offsetMs) {
  globalTimeOffsetMs = offsetMs;
}
function getEffectiveCurrentDate() {
  return new Date(Date.now() + globalTimeOffsetMs);
}
function setGlobalHolidayOverrides(overrides) {
  if (Array.isArray(overrides)) {
    globalHolidayOverrides = overrides;
  } else {
    globalHolidayOverrides = [];
  }
}
var DAY_NAMES = ["Domingo", "Lunes", "Martes", "Mi\xE9rcoles", "Jueves", "Viernes", "S\xE1bado"];
var MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];
function formatYMD(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseYMD(ymd) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return {
    year,
    month,
    day,
    dayOfWeek: dt.getUTCDay()
  };
}
function formatHumanDateShortRD(ymd, includeYear = false) {
  const parsed = parseYMD(ymd);
  if (!parsed) return ymd;
  const dayName = DAY_NAMES[parsed.dayOfWeek];
  const monthName = MONTH_NAMES[parsed.month - 1] || "";
  return includeYear ? `${dayName} ${parsed.day} de ${monthName} de ${parsed.year}` : `${dayName} ${parsed.day} de ${monthName}`;
}
function getSuggestedMondaysForDate(ymd) {
  const parsed = parseYMD(ymd);
  if (!parsed) {
    return {
      nextMondayDate: ymd,
      nextMondayLabel: ymd,
      prevMondayDate: ymd,
      prevMondayLabel: ymd
    };
  }
  const baseUtc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0));
  const dow = baseUtc.getUTCDay();
  const daysToNextMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  const nextMonUtc = new Date(baseUtc.getTime() + daysToNextMonday * 24 * 60 * 60 * 1e3);
  const nextMondayDate = formatYMD(
    nextMonUtc.getUTCFullYear(),
    nextMonUtc.getUTCMonth() + 1,
    nextMonUtc.getUTCDate()
  );
  const daysSincePrevMonday = dow === 0 ? 6 : dow === 1 ? 7 : dow - 1;
  const prevMonUtc = new Date(baseUtc.getTime() - daysSincePrevMonday * 24 * 60 * 60 * 1e3);
  const prevMondayDate = formatYMD(
    prevMonUtc.getUTCFullYear(),
    prevMonUtc.getUTCMonth() + 1,
    prevMonUtc.getUTCDate()
  );
  return {
    nextMondayDate,
    nextMondayLabel: formatHumanDateShortRD(nextMondayDate),
    prevMondayDate,
    prevMondayLabel: formatHumanDateShortRD(prevMondayDate)
  };
}
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return { month, day };
}
function getDominicanHolidays(year) {
  const easter = getEasterSunday(year);
  const easterDate = new Date(Date.UTC(year, easter.month - 1, easter.day));
  const goodFridayDate = new Date(easterDate.getTime() - 2 * 24 * 60 * 60 * 1e3);
  const corpusChristiDate = new Date(easterDate.getTime() + 60 * 24 * 60 * 60 * 1e3);
  return [
    { month: 1, day: 1, name: "A\xF1o Nuevo" },
    { month: 1, day: 6, name: "D\xEDa de los Santos Reyes" },
    { month: 1, day: 21, name: "D\xEDa de Nuestra Se\xF1ora de la Altagracia" },
    { month: 1, day: 26, name: "D\xEDa de Juan Pablo Duarte" },
    { month: 2, day: 27, name: "D\xEDa de la Independencia Nacional" },
    {
      month: goodFridayDate.getUTCMonth() + 1,
      day: goodFridayDate.getUTCDate(),
      name: "Viernes Santo (Semana Santa)"
    },
    { month: 5, day: 1, name: "D\xEDa Internacional del Trabajo" },
    {
      month: corpusChristiDate.getUTCMonth() + 1,
      day: corpusChristiDate.getUTCDate(),
      name: "Corpus Christi"
    },
    { month: 8, day: 16, name: "D\xEDa de la Restauraci\xF3n de la Rep\xFAblica" },
    { month: 9, day: 24, name: "D\xEDa de Nuestra Se\xF1ora de las Mercedes" },
    { month: 11, day: 6, name: "D\xEDa de la Constituci\xF3n" },
    { month: 12, day: 25, name: "D\xEDa de Navidad" }
  ];
}
function getAvailableHolidayYears(currentRdYear, currentRdMonth, overridesInput, extraMaxYear) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const startYear = Math.min(2025, currentRdYear - 1);
  const autoFutureOffset = currentRdMonth >= 9 ? 3 : 2;
  let maxYear = Math.max(currentRdYear + autoFutureOffset, 2028);
  if (extraMaxYear && extraMaxYear > maxYear && extraMaxYear <= 2100) {
    maxYear = extraMaxYear;
  }
  for (const o of overrides) {
    const origYear = parseInt((o.originalDate || "").slice(0, 4), 10);
    if (!isNaN(origYear) && origYear > maxYear && origYear <= 2100) {
      maxYear = origYear;
    }
    if (o.movedToDate) {
      const movedYear = parseInt(o.movedToDate.slice(0, 4), 10);
      if (!isNaN(movedYear) && movedYear > maxYear && movedYear <= 2100) {
        maxYear = movedYear;
      }
    }
  }
  const years = [];
  for (let y = startYear; y <= maxYear; y++) {
    years.push(y);
  }
  return years;
}
function getHolidaysWithOverridesForYear(year, overridesInput) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const baseHolidays = getDominicanHolidays(year);
  const items = baseHolidays.map((h) => {
    const originalDate = formatYMD(year, h.month, h.day);
    const parsed = parseYMD(originalDate);
    const mondays = getSuggestedMondaysForDate(originalDate);
    const matchedOverride = overrides.find(
      (o) => !o.isCustom && (o.originalDate === originalDate || o.id === originalDate)
    );
    const status = matchedOverride?.status || "normal";
    const movedToDate = status === "moved" ? matchedOverride?.movedToDate : void 0;
    let effectiveDate = originalDate;
    if (status === "moved" && movedToDate) {
      effectiveDate = movedToDate;
    } else if (status === "workday") {
      effectiveDate = null;
    }
    return {
      id: originalDate,
      name: h.name,
      originalDate,
      originalDayName: DAY_NAMES[parsed.dayOfWeek],
      originalHumanDate: formatHumanDateShortRD(originalDate),
      status,
      effectiveDate,
      effectiveHumanDate: effectiveDate ? formatHumanDateShortRD(effectiveDate) : null,
      movedToDate,
      note: matchedOverride?.note,
      isCustom: false,
      ...mondays
    };
  });
  const customForYear = overrides.filter(
    (o) => (o.isCustom || o.status === "custom_holiday") && o.originalDate.startsWith(`${year}-`)
  );
  for (const c of customForYear) {
    const parsed = parseYMD(c.originalDate);
    if (!parsed) continue;
    const mondays = getSuggestedMondaysForDate(c.originalDate);
    items.push({
      id: c.id || `custom-${c.originalDate}`,
      name: c.name || "Feriado / Cierre Especial",
      originalDate: c.originalDate,
      originalDayName: DAY_NAMES[parsed.dayOfWeek],
      originalHumanDate: formatHumanDateShortRD(c.originalDate),
      status: "custom_holiday",
      effectiveDate: c.originalDate,
      effectiveHumanDate: formatHumanDateShortRD(c.originalDate),
      note: c.note,
      isCustom: true,
      ...mondays
    });
  }
  return items.sort((a, b) => a.originalDate.localeCompare(b.originalDate));
}
function evaluateDateHolidayStatus(year, month, day, overridesInput) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const targetYMD = formatYMD(year, month, day);
  const movedHere = overrides.find(
    (o) => o.status === "moved" && o.movedToDate === targetYMD && o.originalDate !== targetYMD
  );
  if (movedHere) {
    const origHuman = formatHumanDateShortRD(movedHere.originalDate);
    return {
      isHoliday: true,
      holidayName: `${movedHere.name} (Feriado movido del ${origHuman})`
    };
  }
  const customHere = overrides.find(
    (o) => (o.status === "custom_holiday" || o.isCustom) && o.originalDate === targetYMD
  );
  if (customHere) {
    return {
      isHoliday: true,
      holidayName: `${customHere.name}${customHere.note ? ` \u2014 ${customHere.note}` : ""}`
    };
  }
  const officialHolidays = getDominicanHolidays(year);
  const official = officialHolidays.find((h) => h.month === month && h.day === day);
  if (!official) {
    return { isHoliday: false };
  }
  const overrideOnOriginal = overrides.find(
    (o) => !o.isCustom && (o.originalDate === targetYMD || o.id === targetYMD)
  );
  if (overrideOnOriginal) {
    if (overrideOnOriginal.status === "moved" && overrideOnOriginal.movedToDate && overrideOnOriginal.movedToDate !== targetYMD) {
      const movedToHuman = formatHumanDateShortRD(overrideOnOriginal.movedToDate);
      const todayHuman = formatHumanDateShortRD(targetYMD);
      return {
        isHoliday: false,
        wasOriginalHolidayMoved: true,
        originalHolidayName: official.name,
        movedToDate: overrideOnOriginal.movedToDate,
        movedToHumanDate: movedToHuman,
        movedHolidayNotice: `El feriado "${official.name}" que originalmente ca\xEDa hoy (${todayHuman}) fue MOVIDO para el ${movedToHuman}. Por lo tanto, HOY (${todayHuman}) NO ES FERIADO y es d\xEDa laborable normal en Todo Lapto (8:30 AM a 6:00 PM).`
      };
    }
    if (overrideOnOriginal.status === "workday") {
      const todayHuman = formatHumanDateShortRD(targetYMD);
      return {
        isHoliday: false,
        wasOriginalHolidayMoved: true,
        originalHolidayName: official.name,
        movedHolidayNotice: `El feriado "${official.name}" (${todayHuman}) fue marcado como D\xCDA LABORABLE NORMAL. Hoy (${todayHuman}) NO es feriado y trabajamos en horario regular (8:30 AM a 6:00 PM).`
      };
    }
  }
  return {
    isHoliday: true,
    holidayName: official.name
  };
}
function getDominicanTimeContext(baseDate = getEffectiveCurrentDate(), overridesInput) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false
  });
  const parts = dtf.formatToParts(baseDate);
  const partMap = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  let hour = parseInt(partMap.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(partMap.minute, 10);
  const second = parseInt(partMap.second || "0", 10);
  const ymd = formatYMD(year, month, day);
  const localCalDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = localCalDate.getUTCDay();
  const dayName = DAY_NAMES[dayOfWeek];
  const monthName = MONTH_NAMES[month - 1];
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  const time12 = `${h12.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} ${ampm}`;
  const time12WithSeconds = `${h12.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second.toString().padStart(2, "0")} ${ampm}`;
  const time24 = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  const time24WithSeconds = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:${second.toString().padStart(2, "0")}`;
  const fullDateStr = `${dayName} ${day} de ${monthName} de ${year}`;
  const holidayEval = evaluateDateHolidayStatus(year, month, day, overrides);
  const isHoliday = holidayEval.isHoliday;
  const holidayName = holidayEval.holidayName;
  const currentMinutes = hour * 60 + minute;
  const OPEN_MINUTES = 8 * 60 + 30;
  const CLOSE_MINUTES = 18 * 60;
  let isOpen = false;
  let statusReason = "closed_night";
  let statusSummary = "\u{1F534} CERRADO";
  let statusDetail = "";
  let nextOpeningStr = "";
  let customerNotice = "";
  if (isHoliday) {
    isOpen = false;
    statusReason = "closed_holiday";
    statusSummary = "\u{1F534} CERRADO (D\xEDa Feriado)";
    statusDetail = `Cerrado por festividad oficial: ${holidayName}`;
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
    nextOpeningStr = `${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
    customerNotice = `Hoy es d\xEDa feriado en Rep\xFAblica Dominicana (${holidayName}) y nuestra tienda y departamento de env\xEDos se encuentran cerrados. Con gusto registramos y apartamos tu pedido ahora mismo, y ser\xE1 despachado a primera hora el ${nextOpeningStr}.`;
  } else if (dayOfWeek === 0) {
    isOpen = false;
    statusReason = "closed_sunday";
    statusSummary = "\u{1F534} CERRADO (Domingo)";
    statusDetail = "Cerrado por descanso dominical (Atenci\xF3n de Lunes a S\xE1bado de 8:30 AM a 6:00 PM)";
    const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
    nextOpeningStr = `${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
    customerNotice = `Hoy domingo nuestra tienda y mensajer\xEDa est\xE1n cerradas por descanso semanal. Podemos apartar y dejar registrado tu pedido de inmediato, y ser\xE1 despachado el ${nextOpeningStr} tan pronto iniciemos labores.`;
  } else {
    const movedNoteSuffix = holidayEval.wasOriginalHolidayMoved ? ` \u2014 Nota: El feriado ${holidayEval.originalHolidayName} fue movido${holidayEval.movedToHumanDate ? ` al ${holidayEval.movedToHumanDate}` : ""}, hoy laboramos normal` : "";
    if (currentMinutes >= OPEN_MINUTES && currentMinutes < CLOSE_MINUTES) {
      isOpen = true;
      statusReason = "open";
      statusSummary = holidayEval.wasOriginalHolidayMoved ? "\u{1F7E2} ABIERTO (Feriado Movido \u2014 Hoy Laborable)" : "\u{1F7E2} ABIERTO";
      statusDetail = `Abierto en horario laboral (Lunes a S\xE1bado de 8:30 AM a 6:00 PM)${movedNoteSuffix}`;
      nextOpeningStr = `Hoy hasta las 6:00 PM`;
      customerNotice = `Estamos abiertos y operando activamente${movedNoteSuffix}. Tu pedido puede ser preparado y despachado hoy mismo en Santo Domingo o enviado al interior.`;
    } else if (currentMinutes < OPEN_MINUTES) {
      isOpen = false;
      statusReason = "closed_morning";
      statusSummary = "\u{1F534} CERRADO (Antes de apertura)";
      statusDetail = `A\xFAn no abrimos. Abrimos hoy a las 8:30 AM.${movedNoteSuffix}`;
      nextOpeningStr = `Hoy a las 8:30 AM`;
      customerNotice = `Nuestra tienda y mensajer\xEDa abren hoy a las 8:30 AM${movedNoteSuffix}. Podemos tomar y apartar tu pedido ahora mismo, y lo prepararemos para entrega tan pronto iniciemos labores a las 8:30 AM.`;
    } else {
      isOpen = false;
      statusReason = "closed_night";
      statusSummary = "\u{1F534} CERRADO (Horario Nocturno)";
      statusDetail = `Cerrado por fin de jornada laboral (Horario de 8:30 AM a 6:00 PM)${movedNoteSuffix}`;
      const nextOpen = findNextBusinessDay(year, month, day, dayOfWeek, overrides);
      nextOpeningStr = `${nextOpen.isTomorrow ? "Ma\xF1ana " : ""}${nextOpen.dayName} ${nextOpen.day} de ${nextOpen.monthName} a las 8:30 AM`;
      customerNotice = `Nuestra jornada laboral de hoy ya ha concluido (cerramos a las 6:00 PM). Podemos tomar tus datos y dejar tu orden registrada y apartada en el sistema, y te la estaremos enviando a primera hora ${nextOpeningStr} tan pronto abramos el negocio.`;
    }
  }
  return {
    date: baseDate,
    year,
    month,
    day,
    ymd,
    dayOfWeek,
    dayName,
    monthName,
    hour,
    minute,
    second,
    time12,
    time12WithSeconds,
    time24,
    time24WithSeconds,
    fullDateStr,
    isHoliday,
    holidayName,
    wasOriginalHolidayMoved: holidayEval.wasOriginalHolidayMoved,
    originalHolidayName: holidayEval.originalHolidayName,
    movedToDate: holidayEval.movedToDate,
    movedToHumanDate: holidayEval.movedToHumanDate,
    movedHolidayNotice: holidayEval.movedHolidayNotice,
    isOpen,
    statusReason,
    statusSummary,
    statusDetail,
    nextOpeningStr,
    customerNotice
  };
}
function findNextBusinessDay(currentYear, currentMonth, currentDay, currentDayOfWeek, overrides) {
  let probeDate = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay, 12, 0, 0));
  let step = 0;
  while (step < 14) {
    step++;
    probeDate = new Date(probeDate.getTime() + 24 * 60 * 60 * 1e3);
    const pYear = probeDate.getUTCFullYear();
    const pMonth = probeDate.getUTCMonth() + 1;
    const pDay = probeDate.getUTCDate();
    const pDayOfWeek = probeDate.getUTCDay();
    if (pDayOfWeek === 0) continue;
    const evalStatus = evaluateDateHolidayStatus(pYear, pMonth, pDay, overrides);
    if (evalStatus.isHoliday) continue;
    return {
      dayName: DAY_NAMES[pDayOfWeek],
      day: pDay,
      monthName: MONTH_NAMES[pMonth - 1],
      isTomorrow: step === 1
    };
  }
  return {
    dayName: "el pr\xF3ximo d\xEDa laborable",
    day: currentDay + 1,
    monthName: MONTH_NAMES[currentMonth - 1],
    isTomorrow: true
  };
}
function buildHolidayOverridesSummaryText(year, overridesInput) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  if (!overrides || overrides.length === 0) {
    return "Todos los d\xEDas feriados oficiales de RD se celebran en su fecha calendario original (sin traslados configurados actualmente).";
  }
  const lines = [];
  for (const o of overrides) {
    if (o.status === "moved" && o.movedToDate) {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      const movedHuman = formatHumanDateShortRD(o.movedToDate, true);
      lines.push(
        `\u2022 \u{1F504} FERIADO MOVIDO (${o.name}): Originalmente ca\xEDa el ${origHuman}, pero fue MOVIDO al ${movedHuman}. \u27A1\uFE0F IMPORTANTE: El ${origHuman} YA NO ES FERIADO (se trabaja en horario normal de 8:30 AM a 6:00 PM) y el d\xEDa cerrado por feriado pasa a ser el ${movedHuman}.`
      );
    } else if (o.status === "workday") {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      lines.push(
        `\u2022 \u{1F4BC} FERIADO HABILITADO COMO LABORABLE (${o.name}): El ${origHuman} YA NO ES FERIADO para la tienda; trabajamos en horario normal de 8:30 AM a 6:00 PM.`
      );
    } else if (o.status === "custom_holiday" || o.isCustom) {
      const origHuman = formatHumanDateShortRD(o.originalDate, true);
      lines.push(
        `\u2022 \u{1F534} D\xCDA FERIADO / CIERRE ESPECIAL (${o.name}): El ${origHuman} la tienda y el despacho estar\xE1n CERRADOS todo el d\xEDa${o.note ? ` (${o.note})` : ""}.`
      );
    }
  }
  if (lines.length === 0) {
    return "Todos los d\xEDas feriados oficiales de RD se celebran en su fecha calendario original.";
  }
  return lines.join("\n");
}
function buildDominicanTimePromptContext(baseDate = getEffectiveCurrentDate(), overridesInput) {
  const overrides = overridesInput ?? globalHolidayOverrides;
  const ctx = getDominicanTimeContext(baseDate, overrides);
  const holidayOverridesSummary = buildHolidayOverridesSummaryText(ctx.year, overrides);
  const movedTodayDirective = ctx.movedHolidayNotice ? `
\u{1F4E2} **ATENCI\xD3N ESPECIAL SOBRE EL FERIADO DE HOY:**
${ctx.movedHolidayNotice}
- Si el cliente pregunta si hoy estamos abiertos o si trabajamos hoy por el feriado, conf\xEDrmale claramente que **HOY S\xCD ESTAMOS LABORANDO NORMALMENTE de 8:30 AM a 6:00 PM** porque ese d\xEDa feriado fue movido${ctx.movedToHumanDate ? ` para el ${ctx.movedToHumanDate}` : ""}.
` : "";
  const orderDirective = ctx.isOpen ? `\u{1F7E2} **LA TIENDA Y EL SERVICIO DE ENV\xCDOS EST\xC1N ABIERTOS EN ESTE MOMENTO.**
- Puedes confirmar pedidos para despacho el mismo d\xEDa en Santo Domingo (mensajer\xEDa privada en 2 a 4 horas) o env\xEDo a provincias por Metro Pac / Caribe Tours / Vimenpaq.
- Si el cliente pregunta si puede pasar a la tienda f\xEDsica en la Av. Charles de Gaulle #133, confirma que estamos ABIERTOS ahora mismo hasta las 6:00 PM.${movedTodayDirective}` : `\u{1F534} **LA TIENDA F\xCDSICA Y EL SERVICIO DE ENV\xCDOS EST\xC1N CERRADOS EN ESTE MOMENTO.**
(${ctx.statusDetail})
${movedTodayDirective}
\u26A0\uFE0F **REGLA CR\xCDTICA SOBRE CU\xC1NDO MENCIONAR EL HORARIO FUERA DE JORNADA:**
1. **EN SALUDOS SENCILLOS O CONSULTAS DE PRODUCTOS (PROHIBIDO SER REPETITIVO):**
   - Si el cliente solo saluda (*"Saludos"*, *"Hola"*, *"Buenas"*) o solo pregunta por productos/precios (*"\xBFTienes mouse?"*, *"\xBFQu\xE9 laptops tienes?"*), **NO menciones que estamos cerrados**. Responde directo al grano, c\xE1lido y breve.
2. **CU\xC1NDO S\xCD MENCIONAR EL HORARIO DE APERTURA (${ctx.nextOpeningStr}):**
   - \xDAnicamente menciona que estamos cerrados en este instante si el cliente:
     a) Pregunta expresamente si estamos abiertos, por nuestro horario o si puede pasar por la tienda ahora mismo.
     b) Est\xE1 cerrando/confirmando un pedido o solicita env\xEDo inmediato (en cuyo caso toma y aparta su pedido con total normalidad y conf\xEDrmale que queda reservado para despacharse a primera hora: **${ctx.nextOpeningStr}**).`;
  return `
======================================================================
\u{1F552} FECHA, HORA Y ESTADO DEL NEGOCIO EN REP\xDABLICA DOMINICANA (HORA RD)
======================================================================
- Fecha actual en RD: ${ctx.fullDateStr}
- Hora actual en RD: ${ctx.time12} (${ctx.time24} hrs) \xB7 Zona: America/Santo_Domingo (UTC-4)
- Estado operativo del negocio: ${ctx.statusSummary}
- Detalle de horario: ${ctx.statusDetail}
${ctx.isHoliday ? `- \u{1F1E9}\u{1F1F4} FESTIVIDAD NACIONAL ACTIVA HOY: ${ctx.holidayName} (D\xEDa no laborable en RD)
` : ""}${ctx.movedHolidayNotice ? `- \u{1F504} CAMBIO DE D\xCDA FERIADO HOY: ${ctx.movedHolidayNotice}
` : ""}- Pr\xF3xima apertura comercial: ${ctx.nextOpeningStr}
- Horario oficial Todo Lapto: Lunes a S\xE1bado de 8:30 AM a 6:00 PM \xB7 Domingos: Cerrado

\u{1F4C5} CAMBIOS DE D\xCDAS FERIADOS EN RD (TRASLADOS A LUNES / D\xCDAS LABORABLES):
${holidayOverridesSummary}

INSTRUCCI\xD3N DE OPERACI\xD3N PARA LA IA EN ESTE INSTANTE:
${orderDirective}
======================================================================`;
}

// src/utils/supabaseService.ts
import { createClient } from "@supabase/supabase-js";
var DEFAULT_SUPABASE_URL = "https://idpsjmyjhkabuenqdpyf.supabase.co";
var DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkcHNqbXlqaGthYnVlbnFkcHlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MzE3NDEsImV4cCI6MjEwOTEwNzc0MX0.rH7p8Ipg2pLn0T4-ZN0Onk3oAKtRrVIoqQ6ukKeJTnA";
var INTERNAL_USERS_BACKUP_ID = "__sys_users_registry__";
var INTERNAL_HOLIDAYS_BACKUP_ID = "__sys_holidays_calendar_rd__";
var INTERNAL_AI_CONFIG_BACKUP_ID = "__sys_ai_provider_config__";
var supabaseClient = null;
var currentUrl = "";
var currentKey = "";
function getSupabaseClient(url, anonKey) {
  const envUrl = typeof process !== "undefined" && process.env ? process.env.SUPABASE_URL : "";
  const envKey = typeof process !== "undefined" && process.env ? process.env.SUPABASE_ANON_KEY : "";
  const targetUrl = (url || currentUrl || envUrl || DEFAULT_SUPABASE_URL).trim();
  const targetKey = (anonKey || currentKey || envKey || DEFAULT_SUPABASE_ANON_KEY).trim();
  if (!targetUrl || !targetKey) {
    return null;
  }
  if (!supabaseClient || currentUrl !== targetUrl || currentKey !== targetKey) {
    try {
      supabaseClient = createClient(targetUrl, targetKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      currentUrl = targetUrl;
      currentKey = targetKey;
    } catch (e) {
      console.warn("[Supabase Init Warning]:", e.message);
      return null;
    }
  }
  return supabaseClient;
}
async function testSupabaseConnection(url, anonKey) {
  try {
    const cleanUrl = (url || DEFAULT_SUPABASE_URL).trim();
    const cleanKey = (anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
    if (!cleanUrl || !cleanUrl.startsWith("http")) {
      return {
        success: false,
        message: "La URL de Supabase debe ser v\xE1lida (https://*.supabase.co)",
        accessibleTables: [],
        missingTables: []
      };
    }
    if (!cleanKey || cleanKey.length < 20) {
      return {
        success: false,
        message: "La Anon Key de Supabase proporcionada parece inv\xE1lida o est\xE1 incompleta.",
        accessibleTables: [],
        missingTables: []
      };
    }
    const testClient = createClient(cleanUrl, cleanKey, {
      auth: { persistSession: false }
    });
    const tablesToProbe = [
      "usuarios",
      "calendario_feriados",
      "configuracion_sistema",
      "catalogo_productos",
      "pedidos",
      "contactos_whatsapp",
      "conversaciones_todolapto",
      "recordatorios_seguimiento",
      "cerebro_ia_aprendizajes"
    ];
    const accessible = [];
    const missing = [];
    for (const table of tablesToProbe) {
      try {
        const { error } = await testClient.from(table).select("*").limit(1);
        if (!error) {
          accessible.push(table);
        } else {
          missing.push(table);
        }
      } catch {
        missing.push(table);
      }
    }
    const missingNotice = missing.length > 0 ? ` | Tablas pendientes por crear con el Script SQL: ${missing.join(", ")}` : " | \xA1Todas las 9 tablas del sistema (incluyendo calendario_feriados) est\xE1n creadas y activas!";
    return {
      success: true,
      message: `Conexi\xF3n a Supabase exitosa (${accessible.length}/9 tablas detectadas: ${accessible.join(", ") || "ninguna a\xFAn"})${missingNotice}`,
      accessibleTables: accessible,
      missingTables: missing
    };
  } catch (err) {
    return {
      success: false,
      message: `Error al conectar con Supabase: ${err.message}`,
      accessibleTables: [],
      missingTables: []
    };
  }
}
function getHolidaysTableSql() {
  const rdNow = getDominicanTimeContext(/* @__PURE__ */ new Date(), []);
  const years = getAvailableHolidayYears(rdNow.year, rdNow.month, []);
  const valueRows = [];
  for (const yr of years) {
    const items = getHolidaysWithOverridesForYear(yr, []);
    for (const it of items) {
      const safeName = it.name.replace(/'/g, "''");
      const safeDay = it.originalDayName.replace(/'/g, "''");
      const safeNote = `Se celebra en su fecha original (${it.originalHumanDate})`.replace(/'/g, "''");
      valueRows.push(
        `    ('${it.id}', ${yr}, '${safeName}', '${it.originalDate}', '${safeDay}', 'normal', '${it.originalDate}', NULL, FALSE, '${safeNote}')`
      );
    }
  }
  return `-- =====================================================================
-- TABLA DEDICADA: CALENDARIO OFICIAL DE FERIADOS DE REP\xDABLICA DOMINICANA
-- Ejecuta este bloque en Supabase -> SQL Editor -> Run
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.calendario_feriados (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    feriado_id VARCHAR(64) UNIQUE NOT NULL,
    anio INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    fecha_original VARCHAR(16) NOT NULL,
    dia_original VARCHAR(32),
    estado VARCHAR(32) DEFAULT 'normal' NOT NULL,
    fecha_efectiva VARCHAR(16),
    movido_a_fecha VARCHAR(16),
    es_personalizado BOOLEAN DEFAULT FALSE,
    nota TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feriados_anio ON public.calendario_feriados(anio);
CREATE INDEX IF NOT EXISTS idx_feriados_fecha_orig ON public.calendario_feriados(fecha_original);
CREATE INDEX IF NOT EXISTS idx_feriados_fecha_efec ON public.calendario_feriados(fecha_efectiva);

ALTER TABLE public.calendario_feriados ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a calendario_feriados') THEN
        CREATE POLICY "Permitir todo a calendario_feriados" ON public.calendario_feriados FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Insertar feriados oficiales de Rep\xFAblica Dominicana (${years.join(", ")}) sin sobrescribir cambios existentes
INSERT INTO public.calendario_feriados (feriado_id, anio, nombre, fecha_original, dia_original, estado, fecha_efectiva, movido_a_fecha, es_personalizado, nota)
VALUES
${valueRows.join(",\n")}
ON CONFLICT (feriado_id) DO NOTHING;`;
}
function getSupabaseSchemaSql() {
  const holidaysSql = getHolidaysTableSql();
  return `-- =====================================================================
-- ESQUEMA COMPLETO DE BASE DE DATOS SUPABASE PARA TODO LAPTO / VENDEM\xC1 CRM
-- Ejecuta este script en el SQL Editor de tu Dashboard de Supabase (Run)
-- Es 100% seguro: usa IF NOT EXISTS para no borrar datos existentes.
-- =====================================================================

-- 1. Tabla de Usuarios y Jerarqu\xEDa de Accesos (RBAC: Super Admin, Due\xF1o, Empleado)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    username VARCHAR(64) UNIQUE NOT NULL,
    password TEXT NOT NULL,
    whatsapp VARCHAR(32) NOT NULL,
    role VARCHAR(32) DEFAULT 'empleado' NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_username ON public.usuarios(username);
CREATE INDEX IF NOT EXISTS idx_usuarios_role ON public.usuarios(role);

-- Insertar usuarios iniciales por defecto (sin sobrescribir si ya existen)
INSERT INTO public.usuarios (user_id, nombre, username, password, whatsapp, role, activo)
VALUES
    ('usr_super_nelson', 'Nelson', 'nelson', 'elmejor19', '18496260800', 'super_admin', TRUE),
    ('usr_dueno_negocio', 'Due\xF1o Todo Lapto', 'dueno', 'dueno123', '18094228738', 'dueno', TRUE),
    ('usr_empleado_ventas', 'Asesor de Ventas', 'empleado', 'empleado123', '18492588738', 'empleado', TRUE)
ON CONFLICT (username) DO NOTHING;

-- 2. Tabla de Configuraci\xF3n Global del Sistema y Credenciales
CREATE TABLE IF NOT EXISTS public.configuracion_sistema (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    config_key VARCHAR(64) UNIQUE NOT NULL DEFAULT 'main',
    global_ai_active BOOLEAN DEFAULT TRUE,
    ai_provider JSONB DEFAULT '{}'::jsonb,
    odoo_config JSONB DEFAULT '{}'::jsonb,
    evolution_config JSONB DEFAULT '{}'::jsonb,
    supabase_config JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Cat\xE1logo de Productos e Inventario (Respaldo Odoo ERP)
CREATE TABLE IF NOT EXISTS public.catalogo_productos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id INTEGER UNIQUE NOT NULL,
    variant_id INTEGER,
    nombre TEXT NOT NULL,
    marca VARCHAR(64),
    categoria VARCHAR(64),
    condicion VARCHAR(64),
    condicion_detalle TEXT,
    precio NUMERIC(12, 2) DEFAULT 0,
    stock_total INTEGER DEFAULT 0,
    stock_vitrina INTEGER DEFAULT 0,
    stock_almacen INTEGER DEFAULT 0,
    website_url TEXT,
    image_url TEXT,
    specs_summary TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_categoria ON public.catalogo_productos(categoria);
CREATE INDEX IF NOT EXISTS idx_catalogo_stock ON public.catalogo_productos(stock_total DESC);

-- 4. Tabla de Pedidos y Cotizaciones
CREATE TABLE IF NOT EXISTS public.pedidos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    id_pedido VARCHAR(64) UNIQUE NOT NULL,
    cliente_nombre TEXT,
    cliente_numero TEXT NOT NULL,
    productos TEXT NOT NULL,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    metodo_pago VARCHAR(32) DEFAULT 'contra_entrega',
    estado VARCHAR(32) DEFAULT 'pendiente',
    origen VARCHAR(32) DEFAULT 'whatsapp',
    notas_cliente TEXT,
    notas_gerencia TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_numero ON public.pedidos(cliente_numero);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON public.pedidos(created_at DESC);

-- 5. Tabla de Contactos y Directorio de WhatsApp
CREATE TABLE IF NOT EXISTS public.contactos_whatsapp (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lid_jid TEXT UNIQUE,
    telefono TEXT UNIQUE NOT NULL,
    nombre TEXT,
    direccion TEXT,
    zona VARCHAR(64) DEFAULT 'santo_domingo',
    odoo_partner_id INTEGER,
    ai_enabled BOOLEAN DEFAULT TRUE,
    total_spent NUMERIC(12, 2) DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    detected_interests TEXT[],
    notas TEXT,
    last_interaction TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contactos_telefono ON public.contactos_whatsapp(telefono);
CREATE INDEX IF NOT EXISTS idx_contactos_lid_jid ON public.contactos_whatsapp(lid_jid);

-- 6. Tabla de Conversaciones y Mensajes de WhatsApp
CREATE TABLE IF NOT EXISTS public.conversaciones_todolapto (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_number TEXT NOT NULL,
    user_name TEXT,
    message_content TEXT,
    message_type VARCHAR(32) DEFAULT 'text',
    quoted_message_content TEXT,
    has_quoted_message BOOLEAN DEFAULT FALSE,
    evolution_message_id TEXT,
    transcription TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_session_id ON public.conversaciones_todolapto(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_user_number ON public.conversaciones_todolapto(user_number);
CREATE INDEX IF NOT EXISTS idx_conv_created_at ON public.conversaciones_todolapto(created_at DESC);

-- 7. Tabla de Recordatorios de Seguimiento Comercial
CREATE TABLE IF NOT EXISTS public.recordatorios_seguimiento (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_number TEXT NOT NULL,
    user_name TEXT,
    productos_interes TEXT,
    fecha_seguimiento TIMESTAMPTZ NOT NULL,
    estado VARCHAR(32) DEFAULT 'pendiente',
    origen VARCHAR(32) DEFAULT 'automatico',
    motivo_cancelacion TEXT,
    cliente_respondio BOOLEAN DEFAULT FALSE,
    intentos_contacto INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_session_id ON public.recordatorios_seguimiento(session_id);
CREATE INDEX IF NOT EXISTS idx_rec_estado ON public.recordatorios_seguimiento(estado);
CREATE INDEX IF NOT EXISTS idx_rec_fecha ON public.recordatorios_seguimiento(fecha_seguimiento);

-- 8. Tabla de Memoria y Aprendizaje del Cerebro IA
CREATE TABLE IF NOT EXISTS public.cerebro_ia_aprendizajes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    insight_id VARCHAR(64) UNIQUE NOT NULL,
    categoria VARCHAR(64) NOT NULL,
    trigger_phrase TEXT NOT NULL,
    winning_pitch TEXT NOT NULL,
    counter_objection TEXT,
    success_rate INTEGER DEFAULT 85,
    occurrences INTEGER DEFAULT 1,
    tags TEXT[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Tabla del Calendario Oficial de Feriados de Rep\xFAblica Dominicana (Ley 139-97)
${holidaysSql}

-- Habilitar RLS (Seguridad a Nivel de Filas) con Pol\xEDticas de Lectura/Escritura para Anon Key
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contactos_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones_todolapto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordatorios_seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cerebro_ia_aprendizajes ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a usuarios') THEN
        CREATE POLICY "Permitir todo a usuarios" ON public.usuarios FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a configuracion_sistema') THEN
        CREATE POLICY "Permitir todo a configuracion_sistema" ON public.configuracion_sistema FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a catalogo_productos') THEN
        CREATE POLICY "Permitir todo a catalogo_productos" ON public.catalogo_productos FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a pedidos') THEN
        CREATE POLICY "Permitir todo a pedidos" ON public.pedidos FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a contactos_whatsapp') THEN
        CREATE POLICY "Permitir todo a contactos_whatsapp" ON public.contactos_whatsapp FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a conversaciones_todolapto') THEN
        CREATE POLICY "Permitir todo a conversaciones_todolapto" ON public.conversaciones_todolapto FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a recordatorios_seguimiento') THEN
        CREATE POLICY "Permitir todo a recordatorios_seguimiento" ON public.recordatorios_seguimiento FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Permitir todo a cerebro_ia_aprendizajes') THEN
        CREATE POLICY "Permitir todo a cerebro_ia_aprendizajes" ON public.cerebro_ia_aprendizajes FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
`;
}
async function loadUsersFromSupabase(url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return [];
  try {
    const { data, error } = await client.from("usuarios").select("*").order("created_at", { ascending: true });
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row) => ({
        id: row.user_id || row.id || `usr_${row.username}`,
        nombre: row.nombre || row.username,
        username: String(row.username || "").toLowerCase().trim(),
        password: row.password || "",
        whatsapp: row.whatsapp || "",
        role: ["super_admin", "dueno", "empleado"].includes(row.role) ? row.role : "empleado",
        activo: row.activo !== void 0 ? Boolean(row.activo) : true,
        createdAt: row.created_at || (/* @__PURE__ */ new Date()).toISOString(),
        lastLogin: row.last_login || void 0
      }));
    }
  } catch {
  }
  try {
    const { data, error } = await client.from("cerebro_ia_aprendizajes").select("winning_pitch").eq("insight_id", INTERNAL_USERS_BACKUP_ID).maybeSingle();
    if (!error && data?.winning_pitch) {
      const parsed = JSON.parse(data.winning_pitch);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
  }
  return [];
}
async function syncAllUsersToSupabase(users, url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { synced: 0, usedFallback: false, error: "Sin cliente de Supabase" };
  }
  let synced = 0;
  let tableError;
  for (const u of users) {
    try {
      const payload = {
        user_id: u.id,
        nombre: u.nombre,
        username: u.username.toLowerCase().trim(),
        password: u.password || "",
        whatsapp: u.whatsapp || "",
        role: u.role,
        activo: u.activo ?? true,
        last_login: u.lastLogin || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error } = await client.from("usuarios").upsert(payload, { onConflict: "username" });
      if (error) {
        tableError = error.message;
      } else {
        synced++;
      }
    } catch (e) {
      tableError = e.message;
    }
  }
  let usedFallback = false;
  try {
    const { error: backupErr } = await client.from("cerebro_ia_aprendizajes").upsert(
      {
        insight_id: INTERNAL_USERS_BACKUP_ID,
        categoria: "__system_internal__",
        trigger_phrase: "Registro encriptado de usuarios del sistema Vendem\xE1 CRM",
        winning_pitch: JSON.stringify(users),
        counter_objection: "Respaldo autom\xE1tico de usuarios en Supabase",
        success_rate: 100,
        occurrences: users.length,
        tags: ["system", "users_backup"],
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "insight_id" }
    );
    if (!backupErr && synced === 0) {
      usedFallback = true;
      synced = users.length;
    }
  } catch {
  }
  return { synced, usedFallback, error: tableError };
}
async function autoSyncUserToSupabase(user, allUsers) {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from("usuarios").upsert(
      {
        user_id: user.id,
        nombre: user.nombre,
        username: user.username.toLowerCase().trim(),
        password: user.password || "",
        whatsapp: user.whatsapp || "",
        role: user.role,
        activo: user.activo ?? true,
        last_login: user.lastLogin || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "username" }
    );
  } catch (e) {
    console.warn("[Supabase autoSyncUser warning]:", e.message);
  }
  if (allUsers && allUsers.length > 0) {
    try {
      await client.from("cerebro_ia_aprendizajes").upsert(
        {
          insight_id: INTERNAL_USERS_BACKUP_ID,
          categoria: "__system_internal__",
          trigger_phrase: "Registro encriptado de usuarios del sistema Vendem\xE1 CRM",
          winning_pitch: JSON.stringify(allUsers),
          counter_objection: "Respaldo autom\xE1tico de usuarios en Supabase",
          success_rate: 100,
          occurrences: allUsers.length,
          tags: ["system", "users_backup"],
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        },
        { onConflict: "insight_id" }
      );
    } catch {
    }
  }
}
async function deleteUserFromSupabase(user, remainingUsers) {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from("usuarios").delete().eq("username", user.username.toLowerCase().trim());
  } catch {
  }
  if (remainingUsers) {
    try {
      await client.from("cerebro_ia_aprendizajes").upsert(
        {
          insight_id: INTERNAL_USERS_BACKUP_ID,
          categoria: "__system_internal__",
          trigger_phrase: "Registro encriptado de usuarios del sistema Vendem\xE1 CRM",
          winning_pitch: JSON.stringify(remainingUsers),
          counter_objection: "Respaldo autom\xE1tico de usuarios en Supabase",
          success_rate: 100,
          occurrences: remainingUsers.length,
          tags: ["system", "users_backup"],
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        },
        { onConflict: "insight_id" }
      );
    } catch {
    }
  }
}
async function loadHolidaysFromSupabase(url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return null;
  const mergedByKey = /* @__PURE__ */ new Map();
  let foundAnySource = false;
  try {
    const { data, error } = await client.from("calendario_feriados").select("*").order("fecha_original", { ascending: true });
    if (!error && Array.isArray(data)) {
      foundAnySource = true;
      for (const row of data) {
        const estado = row.estado || "normal";
        const isCustom = Boolean(row.es_personalizado) || estado === "custom_holiday";
        if (estado !== "normal" || isCustom) {
          const item = {
            id: row.feriado_id || row.fecha_original,
            name: row.nombre || "D\xEDa Feriado",
            originalDate: row.fecha_original,
            status: isCustom ? "custom_holiday" : estado,
            movedToDate: row.movido_a_fecha || void 0,
            note: row.nota || void 0,
            isCustom,
            updatedAt: row.updated_at || (/* @__PURE__ */ new Date()).toISOString()
          };
          mergedByKey.set(item.id, item);
        }
      }
    }
  } catch {
  }
  try {
    const { data, error } = await client.from("configuracion_sistema").select("supabase_config").eq("config_key", "main").maybeSingle();
    if (!error && data?.supabase_config && Array.isArray(data.supabase_config.holidayOverrides)) {
      foundAnySource = true;
      for (const o of data.supabase_config.holidayOverrides) {
        const key = o.id || o.originalDate;
        if (key && !mergedByKey.has(key)) {
          mergedByKey.set(key, o);
        }
      }
    }
  } catch {
  }
  try {
    const { data, error } = await client.from("cerebro_ia_aprendizajes").select("winning_pitch").eq("insight_id", INTERNAL_HOLIDAYS_BACKUP_ID).maybeSingle();
    if (!error && data?.winning_pitch) {
      const parsed = JSON.parse(data.winning_pitch);
      if (Array.isArray(parsed)) {
        foundAnySource = true;
        for (const o of parsed) {
          const key = o.id || o.originalDate;
          if (key && !mergedByKey.has(key)) {
            mergedByKey.set(key, o);
          }
        }
      }
    }
  } catch {
  }
  return foundAnySource ? Array.from(mergedByKey.values()) : null;
}
async function syncHolidaysToSupabase(holidayOverrides, url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  if (!client) {
    return { synced: false, count: 0, tableRowsSynced: 0, tableExists: false, storage: "local_only" };
  }
  const safeList = Array.isArray(holidayOverrides) ? holidayOverrides : [];
  let syncedToDedicatedTable = false;
  let tableRowsSynced = 0;
  let tableError;
  let syncedToMain = false;
  let syncedToCloudBackup = false;
  try {
    const rdNow = getDominicanTimeContext(/* @__PURE__ */ new Date(), safeList);
    const years = getAvailableHolidayYears(rdNow.year, rdNow.month, safeList);
    const allRows = [];
    for (const yr of years) {
      const enriched = getHolidaysWithOverridesForYear(yr, safeList);
      for (const item of enriched) {
        let notaTexto = item.note || "";
        if (!notaTexto) {
          if (item.status === "moved" && item.movedToDate) {
            notaTexto = `Feriado movido al ${formatHumanDateShortRD(item.movedToDate, true)} (El ${item.originalHumanDate} es d\xEDa laborable normal)`;
          } else if (item.status === "workday") {
            notaTexto = `Habilitado como d\xEDa laborable normal (Tienda abierta de 8:30 AM a 6:00 PM)`;
          } else if (item.status === "custom_holiday" || item.isCustom) {
            notaTexto = "Feriado / Cierre especial configurado";
          } else {
            notaTexto = `Se celebra en su fecha original (${item.originalHumanDate})`;
          }
        }
        allRows.push({
          feriado_id: item.id,
          anio: yr,
          nombre: item.name,
          fecha_original: item.originalDate,
          dia_original: item.originalDayName,
          estado: item.status,
          fecha_efectiva: item.effectiveDate,
          movido_a_fecha: item.movedToDate || null,
          es_personalizado: Boolean(item.isCustom),
          nota: notaTexto,
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    if (allRows.length > 0) {
      const { error } = await client.from("calendario_feriados").upsert(allRows, { onConflict: "feriado_id" });
      if (!error) {
        syncedToDedicatedTable = true;
        tableRowsSynced = allRows.length;
        const activeCustomIds = safeList.filter((o) => o.isCustom || o.status === "custom_holiday").map((o) => o.id);
        const { data: existingCustom } = await client.from("calendario_feriados").select("feriado_id").eq("es_personalizado", true);
        if (Array.isArray(existingCustom)) {
          for (const row of existingCustom) {
            if (row.feriado_id && !activeCustomIds.includes(row.feriado_id)) {
              await client.from("calendario_feriados").delete().eq("feriado_id", row.feriado_id);
            }
          }
        }
      } else {
        tableError = error.message;
      }
    }
  } catch (e) {
    tableError = e.message;
  }
  try {
    const { error } = await client.from("cerebro_ia_aprendizajes").upsert(
      {
        insight_id: INTERNAL_HOLIDAYS_BACKUP_ID,
        categoria: "__system_internal__",
        trigger_phrase: "Calendario Oficial de Feriados de Rep\xFAblica Dominicana (Ley 139-97)",
        winning_pitch: JSON.stringify(safeList),
        counter_objection: "Respaldo en tiempo real de modificaciones de d\xEDas feriados RD",
        success_rate: 100,
        occurrences: safeList.length,
        tags: ["system", "holidays_rd_backup"],
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "insight_id" }
    );
    if (!error) {
      syncedToCloudBackup = true;
    }
  } catch {
  }
  try {
    const { data: existing } = await client.from("configuracion_sistema").select("supabase_config").eq("config_key", "main").maybeSingle();
    const prevSupaCfg = existing?.supabase_config && typeof existing.supabase_config === "object" ? existing.supabase_config : {};
    const { error } = await client.from("configuracion_sistema").upsert(
      {
        config_key: "main",
        supabase_config: {
          ...prevSupaCfg,
          holidayOverrides: safeList,
          lastHolidaysSync: (/* @__PURE__ */ new Date()).toISOString()
        },
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "config_key" }
    );
    if (!error) {
      syncedToMain = true;
    }
  } catch {
  }
  return {
    synced: syncedToDedicatedTable || syncedToMain || syncedToCloudBackup,
    count: safeList.length,
    tableRowsSynced,
    tableExists: syncedToDedicatedTable,
    storage: syncedToDedicatedTable ? "calendario_feriados" : syncedToMain ? "configuracion_sistema + cloud_backup" : syncedToCloudBackup ? "cloud_backup" : "local",
    error: tableError
  };
}
async function loadAiConfigFromSupabase(url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  if (!client) return null;
  try {
    const { data, error } = await client.from("configuracion_sistema").select("ai_provider").eq("config_key", "main").maybeSingle();
    if (!error && data?.ai_provider && typeof data.ai_provider === "object") {
      const ai2 = data.ai_provider;
      if (ai2 && (ai2.openaiApiKey || ai2.deepseekApiKey || ai2.geminiApiKey || ai2.provider)) {
        return ai2;
      }
    }
  } catch {
  }
  try {
    const { data, error } = await client.from("cerebro_ia_aprendizajes").select("winning_pitch").eq("insight_id", INTERNAL_AI_CONFIG_BACKUP_ID).maybeSingle();
    if (!error && data?.winning_pitch) {
      const parsed = JSON.parse(data.winning_pitch);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {
  }
  return null;
}
async function autoSyncConfigToSupabase(config) {
  const client = getSupabaseClient(config.supabase?.url, config.supabase?.anonKey);
  if (!client) return;
  try {
    await client.from("configuracion_sistema").upsert(
      {
        config_key: "main",
        global_ai_active: config.globalAiActive,
        ai_provider: config.aiProvider || {},
        odoo_config: config.odoo || {},
        evolution_config: config.evolution || {},
        supabase_config: {
          url: config.supabase?.url || "",
          connected: config.supabase?.connected ?? true,
          autoSync: config.supabase?.autoSync ?? true,
          holidayOverrides: config.holidayOverrides || [],
          lastSync: (/* @__PURE__ */ new Date()).toISOString()
        },
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      },
      { onConflict: "config_key" }
    );
  } catch {
  }
  if (config.aiProvider) {
    try {
      const { systemPrompt, ...credentialsPayload } = config.aiProvider;
      await client.from("cerebro_ia_aprendizajes").upsert(
        {
          insight_id: INTERNAL_AI_CONFIG_BACKUP_ID,
          categoria: "__system_internal__",
          trigger_phrase: "Configuraci\xF3n y Credenciales de Motores de IA (Gemini, OpenAI, DeepSeek)",
          winning_pitch: JSON.stringify(credentialsPayload),
          counter_objection: "Respaldo en nube de API Keys y proveedor de IA activo",
          success_rate: 100,
          occurrences: 1,
          tags: ["system", "ai_provider_backup"],
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        },
        { onConflict: "insight_id" }
      );
    } catch {
    }
  }
  if (Array.isArray(config.holidayOverrides)) {
    await syncHolidaysToSupabase(config.holidayOverrides, config.supabase?.url, config.supabase?.anonKey);
  }
}
async function uploadAllToSupabase(data, url, anonKey) {
  const client = getSupabaseClient(url, anonKey);
  const stats = {
    usersSynced: 0,
    holidaysSynced: 0,
    ordersSynced: 0,
    customersSynced: 0,
    conversationsSynced: 0,
    messagesSynced: 0,
    remindersSynced: 0,
    insightsSynced: 0,
    productsSynced: 0,
    configSynced: false,
    errors: []
  };
  if (!client) {
    stats.errors.push("No hay credenciales de Supabase configuradas");
    return stats;
  }
  if (data.users && data.users.length > 0) {
    const userRes = await syncAllUsersToSupabase(data.users, url, anonKey);
    stats.usersSynced = userRes.synced;
    if (userRes.error) {
      stats.errors.push(`Tabla usuarios: ${userRes.error} (respaldado en nube; ejecuta el Script SQL para crear la tabla 'usuarios' dedicada)`);
    }
  }
  if (data.config) {
    try {
      const { error } = await client.from("configuracion_sistema").upsert(
        {
          config_key: "main",
          global_ai_active: data.config.globalAiActive,
          ai_provider: data.config.aiProvider || {},
          odoo_config: data.config.odoo || {},
          evolution_config: data.config.evolution || {},
          supabase_config: {
            url: data.config.supabase?.url || "",
            connected: true,
            autoSync: data.config.supabase?.autoSync ?? true,
            holidayOverrides: data.config.holidayOverrides || [],
            lastSync: (/* @__PURE__ */ new Date()).toISOString()
          },
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        },
        { onConflict: "config_key" }
      );
      if (!error) {
        stats.configSynced = true;
      }
    } catch {
    }
    const holRes = await syncHolidaysToSupabase(data.config.holidayOverrides || [], url, anonKey);
    stats.holidaysSynced = holRes.tableRowsSynced > 0 ? holRes.tableRowsSynced : holRes.count;
    if (holRes.synced) {
      stats.configSynced = true;
    }
    if (holRes.error) {
      stats.errors.push(`Tabla calendario_feriados: ${holRes.error} (ejecuta el Script SQL para crear la tabla 'calendario_feriados' en Supabase)`);
    }
  }
  if (data.products && data.products.length > 0) {
    try {
      const inStockProducts = data.products.filter((p) => p.virtual_available > 0).slice(0, 250);
      const rows = inStockProducts.map((p) => ({
        product_id: p.id,
        variant_id: p.variantId || p.id,
        nombre: p.name,
        marca: p.brand || null,
        categoria: p.category,
        condicion: p.condition || "Usado / Reacondicionado",
        condicion_detalle: p.conditionDetail || null,
        precio: p.list_price || 0,
        stock_total: p.virtual_available || 0,
        stock_vitrina: p.vitrinaStock || 0,
        stock_almacen: p.almacenStock || 0,
        website_url: p.website_url || null,
        image_url: p.image_url || null,
        specs_summary: p.specsSummary || p.description_sale || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }));
      if (rows.length > 0) {
        const { error } = await client.from("catalogo_productos").upsert(rows, { onConflict: "product_id" });
        if (!error) {
          stats.productsSynced = rows.length;
        }
      }
    } catch {
    }
  }
  try {
    for (const order of data.orders) {
      const payload = {
        id_pedido: order.id,
        cliente_nombre: order.clientName,
        cliente_numero: order.clientPhone.includes("@") ? order.clientPhone : `${order.clientPhone}@s.whatsapp.net`,
        productos: order.products,
        total_amount: order.totalAmount,
        metodo_pago: order.paymentMethod,
        estado: order.status === "comprobante_recibido" ? "pendiente" : order.status,
        origen: "whatsapp",
        notas_cliente: order.address || order.deliveryNotes || "",
        notas_gerencia: order.odooOrderId ? `Cotizacion Odoo ID: ${order.odooOrderId}` : order.adminNotes || "",
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error } = await client.from("pedidos").upsert(payload, { onConflict: "id_pedido" });
      if (error) {
        stats.errors.push(`Error en pedido ${order.id}: ${error.message}`);
      } else {
        stats.ordersSynced++;
      }
    }
  } catch (e) {
    stats.errors.push(`Fallo al subir pedidos: ${e.message}`);
  }
  try {
    for (const c of data.customers) {
      const cleanPhone = (c.phone || "").replace(/\D/g, "");
      if (!cleanPhone) continue;
      const payload = {
        telefono: cleanPhone,
        lid_jid: c.lidJid || null,
        nombre: c.name,
        direccion: c.address || null,
        zona: c.zone || "santo_domingo",
        odoo_partner_id: c.odooPartnerId || null,
        ai_enabled: c.aiEnabled ?? true,
        total_spent: c.totalSpent || 0,
        orders_count: c.ordersCount || 0,
        detected_interests: c.detectedInterests || [],
        notas: c.notes || null,
        last_interaction: c.lastInteraction || (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error } = await client.from("contactos_whatsapp").upsert(payload, { onConflict: "telefono" });
      if (error) {
        stats.errors.push(`Error en cliente ${c.name}: ${error.message}`);
      } else {
        stats.customersSynced++;
      }
    }
  } catch (e) {
    stats.errors.push(`Fallo al subir contactos: ${e.message}`);
  }
  try {
    for (const conv of data.conversations) {
      stats.conversationsSynced++;
      const recentMessages = conv.messages.slice(-20);
      for (const m of recentMessages) {
        const payload = {
          session_id: conv.sessionId,
          user_number: conv.customerPhone || conv.sessionId,
          user_name: conv.customerName,
          message_content: m.content,
          message_type: m.sender === "customer" ? "user" : "assistant",
          quoted_message_content: m.quotedMessage?.text || null,
          has_quoted_message: Boolean(m.quotedMessage?.text),
          evolution_message_id: m.evolutionMessageId || m.id,
          transcription: m.transcription || null,
          created_at: m.timestamp || (/* @__PURE__ */ new Date()).toISOString()
        };
        const { error } = await client.from("conversaciones_todolapto").insert(payload);
        if (error) {
          if (!stats.errors.some((err) => err.includes("conversaciones_todolapto"))) {
            stats.errors.push(`Conversaciones: ${error.message}`);
          }
        } else {
          stats.messagesSynced++;
        }
      }
    }
  } catch (e) {
    stats.errors.push(`Fallo al subir mensajes: ${e.message}`);
  }
  try {
    for (const r of data.reminders) {
      const payload = {
        session_id: r.sessionId,
        user_number: r.customerPhone,
        user_name: r.customerName,
        productos_interes: r.productInterest,
        fecha_seguimiento: r.scheduledDate,
        estado: r.status,
        origen: r.origin
      };
      const { error } = await client.from("recordatorios_seguimiento").insert(payload);
      if (error) {
        if (!stats.errors.some((err) => err.includes("recordatorios_seguimiento"))) {
          stats.errors.push(`Recordatorios: ${error.message}`);
        }
      } else {
        stats.remindersSynced++;
      }
    }
  } catch (e) {
    stats.errors.push(`Fallo al subir recordatorios: ${e.message}`);
  }
  try {
    for (const ins of data.insights) {
      if (ins.id === INTERNAL_USERS_BACKUP_ID || ins.id === INTERNAL_HOLIDAYS_BACKUP_ID || ins.id === INTERNAL_AI_CONFIG_BACKUP_ID)
        continue;
      const payload = {
        insight_id: ins.id,
        categoria: ins.category,
        trigger_phrase: ins.triggerPhrase,
        winning_pitch: ins.winningPitch,
        counter_objection: ins.counterObjection,
        success_rate: ins.successRate,
        occurrences: ins.occurrences,
        tags: ins.tags,
        updated_at: ins.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      };
      const { error } = await client.from("cerebro_ia_aprendizajes").upsert(payload, { onConflict: "insight_id" });
      if (error) {
        if (!stats.errors.some((err) => err.includes("cerebro_ia_aprendizajes"))) {
          stats.errors.push(`Aprendizajes IA: ${error.message}`);
        }
      } else {
        stats.insightsSynced++;
      }
    }
  } catch (e) {
    stats.errors.push(`Fallo al subir aprendizajes: ${e.message}`);
  }
  return stats;
}
async function autoSyncOrderToSupabase(order) {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from("pedidos").upsert({
      id_pedido: order.id,
      cliente_nombre: order.clientName,
      cliente_numero: order.clientPhone.includes("@") ? order.clientPhone : `${order.clientPhone}@s.whatsapp.net`,
      productos: order.products,
      total_amount: order.totalAmount,
      metodo_pago: order.paymentMethod,
      estado: order.status === "comprobante_recibido" ? "pendiente" : order.status,
      origen: "whatsapp",
      notas_cliente: order.address || order.deliveryNotes || "",
      notas_gerencia: order.odooOrderId ? `Cotizacion Odoo ID: ${order.odooOrderId}` : order.adminNotes || "",
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }, { onConflict: "id_pedido" });
  } catch (e) {
    console.warn("[Supabase autoSyncOrder error]:", e.message);
  }
}
async function autoSyncMessageToSupabase(conv, msg) {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from("conversaciones_todolapto").insert({
      session_id: conv.sessionId,
      user_number: conv.customerPhone || conv.sessionId,
      user_name: conv.customerName,
      message_content: msg.content,
      message_type: msg.sender === "customer" ? "user" : "assistant",
      quoted_message_content: msg.quotedMessage?.text || null,
      has_quoted_message: Boolean(m_has_quote(msg)),
      evolution_message_id: msg.evolutionMessageId || msg.id,
      transcription: msg.transcription || null,
      created_at: msg.timestamp || (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (e) {
    console.warn("[Supabase autoSyncMessage error]:", e.message);
  }
}
function m_has_quote(msg) {
  return Boolean(msg.quotedMessage?.text);
}
async function autoSyncCustomerToSupabase(customer) {
  const client = getSupabaseClient();
  if (!client) return;
  const cleanPhone = (customer.phone || "").replace(/\D/g, "");
  if (!cleanPhone) return;
  try {
    await client.from("contactos_whatsapp").upsert({
      telefono: cleanPhone,
      lid_jid: customer.lidJid || null,
      nombre: customer.name,
      direccion: customer.address || null,
      zona: customer.zone || "santo_domingo",
      odoo_partner_id: customer.odooPartnerId || null,
      ai_enabled: customer.aiEnabled ?? true,
      total_spent: customer.totalSpent || 0,
      orders_count: customer.ordersCount || 0,
      detected_interests: customer.detectedInterests || [],
      notas: customer.notes || null,
      last_interaction: customer.lastInteraction || (/* @__PURE__ */ new Date()).toISOString()
    }, { onConflict: "telefono" });
  } catch (e) {
    console.warn("[Supabase autoSyncCustomer error]:", e.message);
  }
}

// server.ts
dotenv.config();
process.on("uncaughtException", (err) => {
  console.log("[Process Error] Uncaught Exception:", err?.message || err);
  console.error("[Process Error] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.log("[Process Error] Unhandled Rejection:", reason?.message || reason);
  console.error("[Process Error] Unhandled Rejection:", reason);
});
process.on("exit", (code) => {
  console.log(`[Process Exit] Node process exiting with code: ${code}`);
});
process.on("beforeExit", (code) => {
  console.log(`[Process BeforeExit] Event loop is empty! code: ${code}`);
});
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
app.set("trust proxy", true);
var rawPort = process.env.PORT;
var isNumericPort = rawPort && !isNaN(Number(rawPort));
var PORT = isNumericPort ? Number(rawPort) : rawPort || 3e3;
var ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "default_gemini_key",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});
app.use(express.json({ limit: "35mb" }));
app.use(express.urlencoded({ extended: true, limit: "35mb" }));
app.use((req, res, next) => {
  if (req.path !== "/health" && req.path !== "/ping") {
    console.log(`[HTTP ${req.method}] ${req.url} (Host: ${req.headers.host || "unknown"})`);
  }
  next();
});
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
app.get(["/health", "/api/health", "/ping"], (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "Vendem\xE1 CRM & Ventas",
    uptime: Math.floor(process.uptime()),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    port: PORT
  });
});
var sseClients = /* @__PURE__ */ new Set();
function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}

`);
    } catch {
      sseClients.delete(client);
    }
  }
}
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: (/* @__PURE__ */ new Date()).toISOString() })}

`);
  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});
var CONFIG_FILE_PATH = path.join(__dirname, ".vendema-config.json");
var CONFIG_FALLBACK_PATH = path.join(process.cwd(), ".vendema-config.json");
var ENV_FILE_PATH = path.join(__dirname, ".env");
function syncCredentialsToEnv(cfg, persistToFile = false) {
  try {
    const vars = {
      // Supabase Credentials
      SUPABASE_URL: cfg.supabase?.url || "",
      SUPABASE_ANON_KEY: cfg.supabase?.anonKey || "",
      // Odoo ERP Credentials
      ODOO_URL: cfg.odoo?.url || "",
      ODOO_DB: cfg.odoo?.db || "",
      ODOO_UID: cfg.odoo?.uid !== void 0 ? String(cfg.odoo.uid) : "",
      ODOO_API_KEY: cfg.odoo?.apiKey || "",
      // Evolution API WhatsApp Credentials
      EVOLUTION_SERVER_URL: cfg.evolution?.serverUrl || "",
      EVOLUTION_INSTANCE: cfg.evolution?.instance || "",
      EVOLUTION_API_KEY: cfg.evolution?.apiKey || "",
      EVOLUTION_TEAM_PHONE: cfg.evolution?.teamPhone || "",
      EVOLUTION_ADMIN_PHONE: cfg.evolution?.adminPhone || "",
      // AI Provider Credentials
      OPENAI_API_KEY: cfg.aiProvider?.openaiApiKey || "",
      DEEPSEEK_API_KEY: cfg.aiProvider?.deepseekApiKey || "",
      GEMINI_API_KEY: cfg.aiProvider?.geminiApiKey || process.env.GEMINI_API_KEY || ""
    };
    for (const [key, val] of Object.entries(vars)) {
      if (val) {
        process.env[key] = val;
      }
    }
    if (!persistToFile) {
      return;
    }
    let existingContent = "";
    if (fs.existsSync(ENV_FILE_PATH)) {
      existingContent = fs.readFileSync(ENV_FILE_PATH, "utf-8");
    }
    const lines = existingContent ? existingContent.split(/\r?\n/) : [];
    const keysHandled = /* @__PURE__ */ new Set();
    const updatedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      const eqIdx = line.indexOf("=");
      if (eqIdx !== -1) {
        const key = line.substring(0, eqIdx).trim();
        if (key in vars) {
          keysHandled.add(key);
          return `${key}="${vars[key]}"`;
        }
      }
      return line;
    });
    for (const [key, val] of Object.entries(vars)) {
      if (!keysHandled.has(key)) {
        updatedLines.push(`${key}="${val}"`);
      }
    }
    if (process.env.APP_URL && !updatedLines.some((l) => l.startsWith("APP_URL="))) {
      updatedLines.push(`APP_URL="${process.env.APP_URL}"`);
    }
    const newContent = updatedLines.join("\n").trim() + "\n";
    if (newContent !== existingContent.trim() + "\n") {
      fs.writeFileSync(ENV_FILE_PATH, newContent, "utf-8");
      console.log("[Env Sync]: Credenciales actualizadas y sincronizadas en archivo .env y process.env");
    }
  } catch (err) {
    console.warn("[Env Sync Info]:", err.message);
  }
}
var appConfig = {
  globalAiActive: true,
  aiProvider: {
    provider: "gemini",
    model: "gemini-3.8-flash",
    temperature: 0.35,
    customInstructions: "",
    systemPrompt: OFFICIAL_TODO_LAPTO_MASTER_PROMPT,
    openaiApiKey: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "MY_OPENAI_API_KEY" ? process.env.OPENAI_API_KEY : "",
    openaiBaseUrl: "https://api.openai.com/v1/chat/completions",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== "MY_DEEPSEEK_API_KEY" ? process.env.DEEPSEEK_API_KEY : "",
    deepseekBaseUrl: "https://api.deepseek.com/chat/completions",
    geminiApiKey: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY" ? process.env.GEMINI_API_KEY : ""
  },
  odoo: {
    url: process.env.ODOO_URL || "https://todolapto.com.do/jsonrpc",
    db: process.env.ODOO_DB || "odoo",
    uid: process.env.ODOO_UID ? Number(process.env.ODOO_UID) : 22,
    apiKey: process.env.ODOO_API_KEY || "1dffd1433a7f49b6ec715fddf766c67f08f57c41",
    connected: true,
    lastSync: (/* @__PURE__ */ new Date()).toISOString()
  },
  evolution: {
    serverUrl: process.env.EVOLUTION_SERVER_URL || "https://evolution-evolution-api.blrfh6.easypanel.host",
    instance: process.env.EVOLUTION_INSTANCE || "todolapto",
    apiKey: process.env.EVOLUTION_API_KEY || "52700613C062-421C-B800-FBC560B54BB4",
    teamPhone: process.env.EVOLUTION_TEAM_PHONE || "18492588738",
    adminPhone: process.env.EVOLUTION_ADMIN_PHONE || "18496260800",
    connected: true
  },
  supabase: {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
    connected: true,
    autoSync: true
  },
  holidayOverrides: []
};
function loadPersistedConfig() {
  try {
    const targetConfigPath = fs.existsSync(CONFIG_FILE_PATH) ? CONFIG_FILE_PATH : fs.existsSync(CONFIG_FALLBACK_PATH) ? CONFIG_FALLBACK_PATH : null;
    if (targetConfigPath) {
      const raw = fs.readFileSync(targetConfigPath, "utf-8");
      const saved = JSON.parse(raw);
      if (saved.globalAiActive !== void 0) appConfig.globalAiActive = Boolean(saved.globalAiActive);
      if (saved.aiProvider) {
        const savedPrompt = saved.aiProvider.systemPrompt || "";
        const shouldRefreshPrompt = !savedPrompt || savedPrompt.includes("1\uFE0F\u20E3 *NOMBRE COMPLETO*") || !savedPrompt.includes("REGLA DE CITAS MEJORADA V2") || !savedPrompt.includes("FILTRADO INTELIGENTE V3");
        const savedModel = String(saved.aiProvider.model || "").trim();
        const migratedModel = !savedModel || savedModel === "gemini-2.5-flash" || savedModel === "gemini-2.0-flash" || savedModel === "gemini-1.5-flash" || savedModel === "gemini-3-flash-preview" || savedModel === "gemini-3.8-flash" || savedModel === "gemini-flash-latest" ? "gemini-3.1-flash-lite" : savedModel;
        const rawSavedGeminiKey = (saved.aiProvider.geminiApiKey || (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY" ? process.env.GEMINI_API_KEY : "")).trim();
        const validGeminiKey = /^AIza[0-9A-Za-z_-]{25,}$/.test(rawSavedGeminiKey) ? rawSavedGeminiKey : "";
        const migratedProvider = saved.aiProvider.provider === "openai" && !saved.aiProvider.openaiApiKey ? "gemini" : saved.aiProvider.provider || "gemini";
        appConfig.aiProvider = {
          ...appConfig.aiProvider,
          ...saved.aiProvider,
          provider: migratedProvider,
          model: migratedModel,
          systemPrompt: shouldRefreshPrompt ? OFFICIAL_TODO_LAPTO_MASTER_PROMPT : savedPrompt,
          openaiApiKey: (saved.aiProvider.openaiApiKey || (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "MY_OPENAI_API_KEY" ? process.env.OPENAI_API_KEY : "")).trim(),
          deepseekApiKey: (saved.aiProvider.deepseekApiKey || (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== "MY_DEEPSEEK_API_KEY" ? process.env.DEEPSEEK_API_KEY : "")).trim(),
          geminiApiKey: validGeminiKey
        };
      }
      if (saved.odoo) {
        appConfig.odoo = {
          ...appConfig.odoo,
          ...saved.odoo,
          url: saved.odoo.url || process.env.ODOO_URL || appConfig.odoo.url,
          db: saved.odoo.db || process.env.ODOO_DB || appConfig.odoo.db,
          uid: saved.odoo.uid ?? (process.env.ODOO_UID ? Number(process.env.ODOO_UID) : appConfig.odoo.uid),
          apiKey: saved.odoo.apiKey || process.env.ODOO_API_KEY || appConfig.odoo.apiKey
        };
      }
      if (saved.evolution) {
        appConfig.evolution = {
          ...appConfig.evolution,
          ...saved.evolution,
          serverUrl: saved.evolution.serverUrl || process.env.EVOLUTION_SERVER_URL || appConfig.evolution.serverUrl,
          instance: saved.evolution.instance || process.env.EVOLUTION_INSTANCE || appConfig.evolution.instance,
          apiKey: saved.evolution.apiKey || process.env.EVOLUTION_API_KEY || appConfig.evolution.apiKey,
          teamPhone: saved.evolution.teamPhone || process.env.EVOLUTION_TEAM_PHONE || appConfig.evolution.teamPhone,
          adminPhone: saved.evolution.adminPhone || process.env.EVOLUTION_ADMIN_PHONE || appConfig.evolution.adminPhone
        };
      }
      if (saved.supabase) {
        appConfig.supabase = {
          ...appConfig.supabase,
          ...saved.supabase,
          url: saved.supabase.url || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
          anonKey: saved.supabase.anonKey || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
        };
      }
      if (Array.isArray(saved.holidayOverrides)) {
        appConfig.holidayOverrides = saved.holidayOverrides;
        setGlobalHolidayOverrides(appConfig.holidayOverrides);
      }
      console.log(`[Config Loaded]: Active AI Provider = ${appConfig.aiProvider?.provider} (${appConfig.aiProvider?.model})`);
      if (appConfig.supabase?.url && appConfig.supabase?.anonKey) {
        getSupabaseClient(appConfig.supabase.url, appConfig.supabase.anonKey);
      }
    }
  } catch (err) {
    console.log("[Config Load Info]:", err.message);
  }
}
function savePersistedConfig(persistToEnv = false) {
  try {
    const content = JSON.stringify(appConfig, null, 2);
    let existing = "";
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      existing = fs.readFileSync(CONFIG_FILE_PATH, "utf-8");
    }
    if (content !== existing) {
      fs.writeFileSync(CONFIG_FILE_PATH, content, "utf-8");
      if (CONFIG_FALLBACK_PATH !== CONFIG_FILE_PATH) {
        fs.writeFileSync(CONFIG_FALLBACK_PATH, content, "utf-8");
      }
    }
    syncCredentialsToEnv(appConfig, persistToEnv);
  } catch (err) {
    console.log("[Config Save Info]:", err.message);
  }
}
loadPersistedConfig();
var USERS_FILE_PATH = path.join(__dirname, ".vendema-users.json");
var USERS_FALLBACK_PATH = path.join(process.cwd(), ".vendema-users.json");
var DEFAULT_USERS = [
  {
    id: "usr_super_nelson",
    nombre: "Nelson",
    username: "nelson",
    password: "elmejor19",
    whatsapp: "18496260800",
    role: "super_admin",
    activo: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "usr_dueno_negocio",
    nombre: "Due\xF1o Todo Lapto",
    username: "dueno",
    password: "dueno123",
    whatsapp: "18094228738",
    role: "dueno",
    activo: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "usr_empleado_ventas",
    nombre: "Asesor de Ventas",
    username: "empleado",
    password: "empleado123",
    whatsapp: "18492588738",
    role: "empleado",
    activo: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  }
];
var systemUsers = [];
function ensureDefaultUsersPresent() {
  for (const defUser of DEFAULT_USERS) {
    const idx = systemUsers.findIndex((u) => u.username.toLowerCase() === defUser.username.toLowerCase());
    if (idx === -1) {
      if (defUser.username === "nelson") {
        systemUsers.unshift({ ...defUser });
      } else {
        systemUsers.push({ ...defUser });
      }
    } else if (defUser.username === "nelson") {
      systemUsers[idx].role = "super_admin";
      systemUsers[idx].activo = true;
      if (!systemUsers[idx].password) {
        systemUsers[idx].password = "elmejor19";
      }
    } else if (!systemUsers[idx].password) {
      systemUsers[idx].password = defUser.password;
    }
  }
}
function savePersistedUsers() {
  try {
    const content = JSON.stringify(systemUsers, null, 2);
    let existingContent = "";
    if (fs.existsSync(USERS_FILE_PATH)) {
      existingContent = fs.readFileSync(USERS_FILE_PATH, "utf-8");
    }
    if (content !== existingContent) {
      fs.writeFileSync(USERS_FILE_PATH, content, "utf-8");
      if (USERS_FALLBACK_PATH !== USERS_FILE_PATH) {
        fs.writeFileSync(USERS_FALLBACK_PATH, content, "utf-8");
      }
    }
  } catch (err) {
    console.log("[Users Save Info]:", err.message);
  }
}
function loadPersistedUsers() {
  try {
    const targetPath = fs.existsSync(USERS_FILE_PATH) ? USERS_FILE_PATH : fs.existsSync(USERS_FALLBACK_PATH) ? USERS_FALLBACK_PATH : null;
    if (targetPath) {
      const raw = fs.readFileSync(targetPath, "utf-8");
      const loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        systemUsers = loaded;
      } else {
        systemUsers = [...DEFAULT_USERS];
      }
    } else {
      systemUsers = [...DEFAULT_USERS];
    }
  } catch (err) {
    console.log("[Users Load Info]:", err.message);
    systemUsers = [...DEFAULT_USERS];
  }
  ensureDefaultUsersPresent();
  console.log(`[Users Loaded]: ${systemUsers.length} active users loaded. Super Admin: @nelson`);
}
async function hydrateAndSyncUsersWithSupabase() {
  try {
    const remoteUsers = await loadUsersFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
      for (const ru of remoteUsers) {
        if (!ru.username) continue;
        const cleanU = ru.username.toLowerCase().trim();
        const existingIdx = systemUsers.findIndex((u) => u.username.toLowerCase() === cleanU);
        if (existingIdx === -1) {
          systemUsers.push(ru);
        } else {
          if (ru.password) {
            systemUsers[existingIdx] = {
              ...systemUsers[existingIdx],
              ...ru,
              username: cleanU
            };
          }
        }
      }
      ensureDefaultUsersPresent();
    }
    await syncAllUsersToSupabase(systemUsers, appConfig.supabase?.url, appConfig.supabase?.anonKey);
  } catch (err) {
    console.warn("[Supabase Users Sync Info]:", err.message);
  }
}
async function hydrateAndSyncHolidaysWithSupabase() {
  try {
    const remoteHolidays = await loadHolidaysFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (Array.isArray(remoteHolidays)) {
      if (remoteHolidays.length > 0 || !appConfig.holidayOverrides || appConfig.holidayOverrides.length === 0) {
        const mergedMap = /* @__PURE__ */ new Map();
        for (const loc of appConfig.holidayOverrides || []) {
          const key = loc.id || loc.originalDate;
          if (key) mergedMap.set(key, loc);
        }
        for (const rem of remoteHolidays) {
          const key = rem.id || rem.originalDate;
          if (key) mergedMap.set(key, rem);
        }
        appConfig.holidayOverrides = Array.from(mergedMap.values());
        setGlobalHolidayOverrides(appConfig.holidayOverrides);
      }
    }
    if (Array.isArray(appConfig.holidayOverrides)) {
      await syncHolidaysToSupabase(
        appConfig.holidayOverrides,
        appConfig.supabase?.url,
        appConfig.supabase?.anonKey
      );
    }
  } catch (err) {
    console.warn("[Supabase Holidays Sync Info]:", err.message);
  }
}
async function hydrateAndSyncAiConfigWithSupabase() {
  try {
    const remoteAi = await loadAiConfigFromSupabase(appConfig.supabase?.url, appConfig.supabase?.anonKey);
    if (remoteAi && typeof remoteAi === "object" && appConfig.aiProvider) {
      let updated = false;
      if (!appConfig.aiProvider.openaiApiKey && remoteAi.openaiApiKey) {
        appConfig.aiProvider.openaiApiKey = String(remoteAi.openaiApiKey).trim();
        updated = true;
      }
      if (!appConfig.aiProvider.deepseekApiKey && remoteAi.deepseekApiKey) {
        appConfig.aiProvider.deepseekApiKey = String(remoteAi.deepseekApiKey).trim();
        updated = true;
      }
      const remoteGemKey = String(remoteAi.geminiApiKey || "").trim();
      if (!appConfig.aiProvider.geminiApiKey && /^AIza[0-9A-Za-z_-]{25,}$/.test(remoteGemKey)) {
        appConfig.aiProvider.geminiApiKey = remoteGemKey;
        updated = true;
      }
      if (appConfig.aiProvider.geminiApiKey && !/^AIza[0-9A-Za-z_-]{25,}$/.test(appConfig.aiProvider.geminiApiKey)) {
        appConfig.aiProvider.geminiApiKey = "";
        updated = true;
      }
      if (updated) {
        savePersistedConfig();
      }
    }
  } catch (err) {
    console.warn("[Supabase AI Config Sync Info]:", err.message);
  }
}
function sanitizeUser(u) {
  const { password, ...rest } = u;
  return rest;
}
loadPersistedUsers();
function resolveChatCompletionsUrl(rawUrl, defaultUrl) {
  if (!rawUrl || !rawUrl.trim()) return defaultUrl;
  let u = rawUrl.trim().replace(/\/+$/, "");
  if (!u.endsWith("/chat/completions")) {
    if (u.endsWith("/v1")) {
      u = `${u}/chat/completions`;
    } else if (u.includes("api.openai.com")) {
      u = `${u}/v1/chat/completions`;
    } else {
      u = `${u}/chat/completions`;
    }
  }
  return u;
}
var rejectedOpenAiKeys = /* @__PURE__ */ new Set();
var rejectedDeepseekKeys = /* @__PURE__ */ new Set();
var exhaustedGeminiModelsUntil = /* @__PURE__ */ new Map();
var lastFastGeminiModel = "gemini-3.1-flash-lite";
function sanitizeBearerKey(raw) {
  if (!raw) return "";
  return raw.trim().replace(/^['"]+|['"]+$/g, "").replace(/^Bearer\s+/i, "").trim();
}
function sanitizeValidGeminiKey(raw) {
  const cleaned = sanitizeBearerKey(raw);
  if (/^AIza[0-9A-Za-z_-]{25,}$/.test(cleaned)) {
    return cleaned;
  }
  return "";
}
function getActiveGeminiClient() {
  const customGeminiKey = sanitizeValidGeminiKey(appConfig.aiProvider?.geminiApiKey) || sanitizeValidGeminiKey(process.env.GEMINI_API_KEY);
  if (customGeminiKey) {
    return new GoogleGenAI({
      apiKey: customGeminiKey,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
  }
  return ai;
}
function formatCleanAiError(err) {
  const raw = String(err?.message || err || "");
  const lower = raw.toLowerCase();
  const isQuota429 = raw.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota exceeded") || lower.includes("insufficient_quota");
  const isDailyQuota = lower.includes("generaterequestsperday") || lower.includes("per day limit exceeded") || lower.includes("free_tier_requests");
  const isBusy503 = raw.includes("503") || lower.includes("unavailable") || lower.includes("high demand") || lower.includes("timeout r\xE1pido");
  if (isDailyQuota) {
    return {
      isQuota429: true,
      isDailyQuota: true,
      isBusy503: false,
      summary: "Cuota diaria gratuita del modelo alcanzada; cambiando a motor activo."
    };
  }
  if (isQuota429) {
    return {
      isQuota429: true,
      isDailyQuota: false,
      isBusy503: false,
      summary: "L\xEDmite de cuota del proveedor alcanzado temporalmente; cambiando a motor de respaldo."
    };
  }
  if (isBusy503) {
    return {
      isQuota429: false,
      isDailyQuota: false,
      isBusy503: true,
      summary: "Alta demanda temporal en el modelo; alternando a motor de respuesta inmediata."
    };
  }
  const cleanLine = raw.replace(/\s+/g, " ").slice(0, 140);
  return {
    isQuota429: false,
    isDailyQuota: false,
    isBusy503: false,
    summary: cleanLine || "Error de conexi\xF3n con proveedor IA"
  };
}
async function generateTextWithConfiguredAI(options) {
  const providerCfg = appConfig.aiProvider || {
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    temperature: 0.35
  };
  const provider = providerCfg.provider || "gemini";
  const temp = options.temperature ?? providerCfg.temperature ?? 0.35;
  const allowFallback = options.allowFallback ?? true;
  const sys = [options.systemInstruction, providerCfg.customInstructions].filter(Boolean).join("\n\n");
  const openaiKey = sanitizeBearerKey(
    providerCfg.openaiApiKey || (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "MY_OPENAI_API_KEY" ? process.env.OPENAI_API_KEY : "")
  );
  const openaiUrl = resolveChatCompletionsUrl(
    providerCfg.openaiBaseUrl,
    "https://api.openai.com/v1/chat/completions"
  );
  const deepseekKey = sanitizeBearerKey(
    providerCfg.deepseekApiKey || (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== "MY_DEEPSEEK_API_KEY" ? process.env.DEEPSEEK_API_KEY : "")
  );
  const deepseekUrl = resolveChatCompletionsUrl(
    providerCfg.deepseekBaseUrl,
    "https://api.deepseek.com/chat/completions"
  );
  if (provider === "openai" && openaiKey) {
    if (allowFallback && rejectedOpenAiKeys.has(openaiKey)) {
    } else {
      const primaryOpenAiModel = providerCfg.model?.startsWith("gpt") || providerCfg.model?.startsWith("o") ? providerCfg.model : "gpt-4o-mini";
      const openAiCandidates = allowFallback ? [primaryOpenAiModel] : primaryOpenAiModel === "gpt-4o-mini" ? ["gpt-4o-mini"] : [primaryOpenAiModel, "gpt-4o-mini"];
      let lastOpenAiErr = null;
      for (const model of openAiCandidates) {
        try {
          const isReasoningModel = model.startsWith("o1") || model.startsWith("o3");
          const messages = [];
          if (sys) {
            messages.push({ role: isReasoningModel ? "developer" : "system", content: sys });
          }
          if (options.chatMessages && options.chatMessages.length > 0) {
            for (const cm of options.chatMessages) {
              if (cm.content?.trim()) {
                messages.push({ role: cm.role, content: cm.content });
              }
            }
          }
          messages.push({ role: "user", content: options.prompt });
          const bodyPayload = {
            model,
            messages,
            ...isReasoningModel ? {} : { temperature: temp },
            ...options.jsonMode ? { response_format: { type: "json_object" } } : {}
          };
          const res = await fetch(openaiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiKey}`
            },
            body: JSON.stringify(bodyPayload),
            signal: AbortSignal.timeout(4500)
          });
          if (!res.ok) {
            let errorDetail = "";
            let errorCode = "";
            try {
              const errBody = await res.json();
              errorDetail = errBody?.error?.message || "";
              errorCode = errBody?.error?.code || "";
            } catch {
            }
            const isQuotaExhausted = res.status === 429 && (errorCode === "insufficient_quota" || errorDetail.toLowerCase().includes("quota") || errorDetail.toLowerCase().includes("billing"));
            if (res.status === 401 || res.status === 403 || res.status === 429 || isQuotaExhausted) {
              rejectedOpenAiKeys.add(openaiKey);
              let reasonMessage = isQuotaExhausted ? "Tu cuenta de OpenAI no tiene saldo o cuota disponible actualmente." : `OpenAI rechaz\xF3 la autorizaci\xF3n (HTTP ${res.status})`;
              if (!isQuotaExhausted && errorDetail) {
                reasonMessage += `: "${errorDetail}"`;
              }
              if (errorDetail.toLowerCase().includes("invalidated") || errorCode === "token_invalidated") {
                reasonMessage += " Por favor genera una nueva API Key en https://platform.openai.com/api-keys.";
              } else if (isQuotaExhausted) {
                reasonMessage += " Por favor recarga saldo en https://platform.openai.com/billing o utiliza el motor Gemini integrado.";
              }
              lastOpenAiErr = new Error(reasonMessage);
              break;
            }
            throw new Error(`OpenAI devolvi\xF3 estado HTTP ${res.status} en el modelo ${model}`);
          }
          rejectedOpenAiKeys.delete(openaiKey);
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || "";
          if (text.trim()) {
            return { text, providerUsed: "openai", modelUsed: model };
          }
          throw new Error("OpenAI devolvi\xF3 una respuesta vac\xEDa");
        } catch (err) {
          lastOpenAiErr = err;
          if (allowFallback) {
            rejectedOpenAiKeys.add(openaiKey);
          }
          const cleanErr = formatCleanAiError(err);
          console.log(`[AI Engine]: Reintento o respaldo desde OpenAI (${model}) -> ${cleanErr.summary}`);
        }
      }
      if (!allowFallback && lastOpenAiErr) throw lastOpenAiErr;
    }
  }
  if (provider === "deepseek" && deepseekKey) {
    if (allowFallback && rejectedDeepseekKeys.has(deepseekKey)) {
    } else {
      try {
        const model = providerCfg.model?.startsWith("deepseek") ? providerCfg.model : "deepseek-chat";
        const messages = [];
        if (sys) messages.push({ role: "system", content: sys });
        if (options.chatMessages && options.chatMessages.length > 0) {
          for (const cm of options.chatMessages) {
            if (cm.content?.trim()) {
              messages.push({ role: cm.role, content: cm.content });
            }
          }
        }
        messages.push({ role: "user", content: options.prompt });
        const res = await fetch(deepseekUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deepseekKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: temp,
            ...options.jsonMode ? { response_format: { type: "json_object" } } : {}
          }),
          signal: AbortSignal.timeout(12e3)
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            rejectedDeepseekKeys.add(deepseekKey);
            throw new Error(
              `La API Key de DeepSeek fue rechazada (HTTP ${res.status}). Verifica que comience con "sk-" y tenga saldo activo.`
            );
          }
          throw new Error(`DeepSeek devolvi\xF3 estado HTTP ${res.status}`);
        }
        rejectedDeepseekKeys.delete(deepseekKey);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        if (text.trim()) {
          return { text, providerUsed: "deepseek", modelUsed: model };
        }
        throw new Error("DeepSeek devolvi\xF3 una respuesta vac\xEDa");
      } catch (err) {
        const cleanErr = formatCleanAiError(err);
        console.log(`[AI Engine]: Respaldo desde DeepSeek -> ${cleanErr.summary}`);
        if (!allowFallback) throw new Error(cleanErr.summary);
      }
    }
  }
  const rawConfiguredGeminiModel = provider === "gemini" && providerCfg.model?.startsWith("gemini") ? providerCfg.model : "gemini-3.1-flash-lite";
  const validConfiguredGeminiModel = rawConfiguredGeminiModel === "gemini-2.5-flash" || rawConfiguredGeminiModel === "gemini-2.0-flash" || rawConfiguredGeminiModel === "gemini-1.5-flash" || rawConfiguredGeminiModel === "gemini-3-flash-preview" || rawConfiguredGeminiModel === "gemini-3.8-flash" || rawConfiguredGeminiModel === "gemini-flash-latest" ? "gemini-3.1-flash-lite" : rawConfiguredGeminiModel;
  const allGeminiCandidates = Array.from(
    /* @__PURE__ */ new Set([
      "gemini-3.1-flash-lite",
      lastFastGeminiModel,
      validConfiguredGeminiModel
    ])
  );
  const nowMs = Date.now();
  const activeGeminiCandidates = allGeminiCandidates.filter((m) => {
    const blockedUntil = exhaustedGeminiModelsUntil.get(m) || 0;
    return nowMs >= blockedUntil;
  });
  const geminiCandidates = activeGeminiCandidates.length > 0 ? activeGeminiCandidates.slice(0, 2) : ["gemini-3.1-flash-lite"];
  const geminiClient = getActiveGeminiClient();
  const fullPromptForGemini = options.chatMessages && options.chatMessages.length > 0 ? `Historial reciente de mensajes:
${options.chatMessages.map((m) => `${m.role === "user" ? "CLIENTE" : "TODO LAPTO (AGENTE)"}: ${m.content}`).join("\n")}

${options.prompt}` : options.prompt;
  let lastCleanErrorSummary = "Motor IA temporalmente ocupado";
  for (const gModel of geminiCandidates) {
    try {
      const response = await Promise.race([
        geminiClient.models.generateContent({
          model: gModel,
          contents: fullPromptForGemini,
          config: {
            ...sys ? { systemInstruction: sys } : {},
            temperature: temp,
            ...options.jsonMode ? { responseMimeType: "application/json" } : {}
          }
        }),
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error(`Timeout r\xE1pido en modelo ${gModel}`)), 5500)
        )
      ]);
      if (response?.text) {
        lastFastGeminiModel = gModel;
        exhaustedGeminiModelsUntil.delete(gModel);
        return {
          text: response.text,
          providerUsed: "gemini",
          modelUsed: gModel
        };
      }
    } catch (err) {
      const parsedErr = formatCleanAiError(err);
      lastCleanErrorSummary = parsedErr.summary;
      if (parsedErr.isDailyQuota) {
        const cooldownUntil = Date.now() + 4 * 60 * 60 * 1e3;
        exhaustedGeminiModelsUntil.set(gModel, cooldownUntil);
        if (lastFastGeminiModel === gModel) {
          lastFastGeminiModel = "gemini-3.1-flash-lite";
        }
        continue;
      }
      if (parsedErr.isQuota429) {
        exhaustedGeminiModelsUntil.set(gModel, Date.now() + 2 * 60 * 1e3);
        continue;
      }
    }
  }
  throw new Error(lastCleanErrorSummary);
}
var products = [];
var aiEnabledBySession = /* @__PURE__ */ new Map();
var transcriptionsByMsgId = /* @__PURE__ */ new Map();
var aiAnalysisByMsgId = /* @__PURE__ */ new Map();
var mediaCache = /* @__PURE__ */ new Map();
var evolutionContactsMap = /* @__PURE__ */ new Map();
var lastContactsSync = 0;
var conversations = [];
var customers = [
  {
    id: "lead-1",
    name: "Sr Amarante",
    phone: "18495393496",
    lidJid: "255941983395971@lid",
    odooPartnerId: 842,
    address: "Santo Domingo Este",
    zone: "santo_domingo",
    aiEnabled: true,
    totalSpent: 18500,
    ordersCount: 1,
    detectedInterests: ["Laptops", "Cat\xE1logo Odoo"],
    objectionsRecorded: [],
    createdAt: new Date(Date.now() - 1e3 * 60 * 60 * 24 * 2).toISOString(),
    lastInteraction: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "lead-2",
    name: "Lic. Ana Reyes",
    phone: "18097741290",
    odooPartnerId: 850,
    address: "Av. Anacaona #42, Bella Vista, D.N.",
    zone: "santo_domingo",
    aiEnabled: false,
    totalSpent: 22e3,
    ordersCount: 1,
    detectedInterests: ["Dell Latitude", "Equipos Ejecutivos"],
    objectionsRecorded: [],
    notes: "Cliente corporativo, transfiri\xF3 v\xEDa Popular. Espera entrega a domicilio.",
    createdAt: new Date(Date.now() - 1e3 * 60 * 60 * 24 * 5).toISOString(),
    lastInteraction: (/* @__PURE__ */ new Date()).toISOString()
  }
];
var salesOrders = [
  {
    id: "PED-1789421",
    odooOrderId: 9182,
    clientName: "Lic. Ana Reyes",
    clientPhone: "18097741290",
    products: "DELL LATITUDE 5420 i5",
    productId: 1045,
    totalAmount: 21e3,
    paymentMethod: "transferencia",
    status: "comprobante_recibido",
    address: "Av. Anacaona #42, Bella Vista, Distrito Nacional",
    receiptBank: "Banco Popular",
    receiptRef: "TR-8941295",
    receiptImage: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80",
    createdAt: new Date(Date.now() - 1e3 * 60 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 1e3 * 60 * 5).toISOString(),
    adminNotes: "Comprobante recibido por WhatsApp. Pendiente de verificaci\xF3n en el portal bancario."
  },
  {
    id: "PED-1789410",
    odooOrderId: 9175,
    clientName: "Roberto G\xF3mez",
    clientPhone: "18093321144",
    products: "Acer Chrobook C771 (2 unidades)",
    productId: 1052,
    totalAmount: 11998,
    paymentMethod: "contra_entrega",
    status: "aprobado",
    address: "Residencial Las Praderas, Mz 4 Edif B apt 301, Santo Domingo Este",
    deliveryNotes: "Entrega en la tarde despu\xE9s de las 3:00 PM. Paga en efectivo exacto.",
    createdAt: new Date(Date.now() - 1e3 * 60 * 60 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 1e3 * 60 * 60 * 2).toISOString(),
    adminNotes: "Asignado a mensajer\xEDa local. Sale en ruta de la tarde."
  }
];
var learnedInsights = [
  {
    id: "learn-1",
    category: "objeciones_garantia",
    triggerPhrase: "\xBFQu\xE9 garant\xEDa tienen los equipos reacondicionados?",
    winningPitch: "Resaltar que todos los equipos pasan por prueba t\xE9cnica de 25 puntos y cuentan con 6 meses de garant\xEDa con respaldo directo en nuestra tienda f\xEDsica de la Av. Charles de Gaulle #133.",
    counterObjection: "El cliente duda de la durabilidad de usados. La menci\xF3n del local f\xEDsico y 6 meses cierra la objeci\xF3n en 92% de los casos.",
    successRate: 92,
    occurrences: 48,
    tags: ["garantia", "usados", "confianza"],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "learn-2",
    category: "envios_provincias",
    triggerPhrase: "\xBFHacen contra entrega en Santiago / San Crist\xF3bal / La Vega?",
    winningPitch: "Explicar cordialmente que fuera del Gran Santo Domingo los env\xEDos son por mensajer\xEDa asegurada (MetroPac / Caribe Tours) previo dep\xF3sito, y que se env\xEDa video y foto de prueba del equipo encendido con el nombre del cliente antes de despachar.",
    counterObjection: "El cliente quiere pagar al recibir en el interior. Al ofrecer fotos y video del empaque con su nombre, la tasa de transferencia aumenta.",
    successRate: 78,
    occurrences: 63,
    tags: ["envios", "provincias", "transferencia"],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "learn-3",
    category: "precio_y_presupuesto",
    triggerPhrase: "Tengo un presupuesto econ\xF3mico de menos de 10,000 pesos",
    winningPitch: "Ofrecer directamente las Chromebooks disponibles en vitrina (EDU GEAR M4 desde RD$4,000, Dell Chromebook P22T a RD$5,600 o Acer C771 a RD$5,999).",
    counterObjection: "Mostrar primero las opciones reales en stock dentro de su rango exacto de presupuesto.",
    successRate: 88,
    occurrences: 39,
    tags: ["presupuesto", "economica", "chromebook"],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "learn-4",
    category: "cierre_upsell",
    triggerPhrase: "El cliente confirma que quiere una laptop antes de pagar",
    winningPitch: "Ofrecer inmediatamente un accesorio en stock de vitrina (Mouse Dell Original RD$400, Bulto/Mochila o Cooling Pad RD$600).",
    counterObjection: "No insistir si dice que no, pero proponerlo una sola vez aumenta el ticket promedio en 35%.",
    successRate: 86,
    occurrences: 52,
    tags: ["upsell", "mochila", "mouse"],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }
];
var followUps = [];
var processedMessageIds = /* @__PURE__ */ new Map();
var PROCESSED_IDS_FILE = path.join(__dirname, ".vendema-processed-ids.json");
try {
  if (fs.existsSync(PROCESSED_IDS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PROCESSED_IDS_FILE, "utf-8"));
    const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
    if (raw && typeof raw === "object") {
      for (const [k, ts] of Object.entries(raw)) {
        if (typeof ts === "number" && ts > cutoff) {
          processedMessageIds.set(k, ts);
        }
      }
    }
  }
} catch {
}
var saveProcessedIdsTimer = null;
function scheduleSaveProcessedIds() {
  if (saveProcessedIdsTimer) return;
  saveProcessedIdsTimer = setTimeout(() => {
    saveProcessedIdsTimer = null;
    try {
      const cutoff = Date.now() - 12 * 60 * 60 * 1e3;
      const entries = Array.from(processedMessageIds.entries()).filter(([, ts]) => ts > cutoff).slice(-1500);
      fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(Object.fromEntries(entries)), "utf-8");
    } catch {
    }
  }, 1500);
}
function normalizeMsgIdKey(rawId) {
  return (rawId || "").trim().replace(/^evo-/, "");
}
function markMessageIdProcessed(rawId, contactKeys = []) {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return;
  const now = Date.now();
  processedMessageIds.set(cleanId, now);
  processedMessageIds.set(`evo-${cleanId}`, now);
  for (const k of contactKeys) {
    processedMessageIds.set(`${k}::${cleanId}`, now);
    processedMessageIds.set(`${k}::evo-${cleanId}`, now);
  }
  scheduleSaveProcessedIds();
}
function isMessageIdAlreadyProcessed(rawId, contactKeys = []) {
  const cleanId = normalizeMsgIdKey(rawId);
  if (!cleanId) return false;
  if (processedMessageIds.has(cleanId) || processedMessageIds.has(`evo-${cleanId}`)) {
    return true;
  }
  return contactKeys.some(
    (k) => processedMessageIds.has(`${k}::${cleanId}`) || processedMessageIds.has(`${k}::evo-${cleanId}`)
  );
}
var keywordsLaptop = [
  "chromebook",
  "thinkpad",
  "ideapad",
  "latitude",
  "macbook",
  "edu gear",
  "edugear",
  "evvo",
  "yoga",
  "probook",
  "elitebook",
  "inspiron",
  "precision",
  "vostro",
  "aspire",
  "travelmate",
  "alienware",
  "chrobook",
  "c771",
  "thinkpad x131",
  "thinkpad 11e",
  "thinkpad t4",
  "thinkpad t47",
  "thinkpad e5",
  "thinkpad x1",
  "thinkbook",
  "thinkcentro",
  "hp 15-",
  "hp 14-",
  "hp 14dq",
  "hp envy",
  "hp stream",
  "hp notebook",
  "hp victus",
  "dell chromebook",
  "dell latitude",
  "dell inspiron",
  "dell precision",
  "lenovo 100e",
  "lenovo n22",
  "lenovo n23",
  "lenovo n24",
  "lenovo thinkpad",
  "lenovo ideapad",
  "lenovo yoga",
  "lenovo flex",
  "laptop",
  "notebook",
  "asus c203",
  "touchsmart",
  "satellite",
  "surface",
  "all in one"
];
var keywordsExcluir = [
  "cargador",
  "bateria",
  "bater\xEDa",
  "monitor",
  "teclado",
  "mouse",
  "cartucho",
  "impresora",
  "memoria usb",
  "pieza",
  "caddy",
  "stand",
  "soporte",
  "bulto",
  "stuche",
  "estuche",
  "funda",
  "candado",
  "lock",
  "cooling pad",
  "cooler",
  "bracket",
  "hub usb",
  "estacion de acoplamiento",
  "estaci\xF3n de acoplamiento",
  "headset",
  "mdp to vga",
  "combo teclado",
  "cover lenovo",
  "sky devices",
  "board lenovo",
  "board ",
  "mouse pad",
  "alfombra",
  "liteon",
  "ssd",
  "ngff",
  "solid state",
  "tablet acer b1",
  "xtrike",
  "concentrador usb",
  "hp cargador",
  "hp-318",
  "pantalla 11.",
  "pantalla 14.",
  "pantalla 15.",
  "sleeve",
  "mesa "
];
var keywordsRed = [
  "repetidor",
  "router",
  "antena wifi",
  "wireless-n",
  "ethernet adapter",
  "rj45",
  "300mbps",
  "linkzone",
  "alcatel link",
  "hotspot",
  "switch ",
  "wifi"
];
var keywordsMonitor = ["monitor", "pantalla"];
var keywordsImpresora = [
  "impresora",
  "impresoras",
  "printer",
  "printers",
  "ecotank",
  "smart tank",
  "deskjet",
  "laserjet",
  "pixma",
  "ink tank",
  "officejet"
];
function isPrinterSupplyOrConsumable(name, odooCateg = "") {
  const n = (name || "").toLowerCase().trim();
  const c = (odooCateg || "").toLowerCase().trim();
  return (/\b(cartucho|cartuchos|tinta|tintas|toner|t[oó]ner|botella\s*de\s*tinta|ink\s*tinta|cinta\s*para\s*impresora|cabezal)\b/i.test(
    n
  ) || /\b(tinta|toner|t[oó]ner|cartucho|consumible)\b/i.test(c)) && !/^(impresora|multifuncional|printer)\b/i.test(n);
}
function isActualPrinterMachine(name, odooCateg = "") {
  const n = (name || "").toLowerCase().trim();
  const c = (odooCateg || "").toLowerCase().trim();
  if (/\b(teclado|teclados|keyboard|mouse|rat[oó]n|combo\s*teclado|cable|cables|cord[oó]n|cargador|ups\b|power\s*bank|bater[ií]a|adaptador|hub\b|soporte|mesa|mochila|bulto|funda|bocina|speaker|aud[ií]fono|headset)\b/i.test(
    n
  )) {
    return false;
  }
  if (isPrinterSupplyOrConsumable(n, c)) {
    return false;
  }
  if (/\b(para\s+impresoras?|de\s+impresoras?)\b/i.test(n) && !/^(impresora|multifuncional|printer)\b/i.test(n)) {
    return false;
  }
  return keywordsImpresora.some((k) => n.includes(k)) || /\b(multifuncional|multifuncionales|todo-en-uno|todo\s*en\s*uno)\b/i.test(n) && /\b(impresora|hp|epson|canon|brother|deskjet|laserjet|ecotank|smart\s*tank|pixma|copia|escaner|esc[aá]ner)\b/i.test(
    n
  ) || c.includes("impresora") || c.includes("printer");
}
function detectProductBrand(name, odooBrandName = "", desc = "") {
  const combined = `${odooBrandName} ${name} ${desc}`.toLowerCase();
  if (odooBrandName && odooBrandName.trim().length > 1 && odooBrandName !== "-") {
    if (/\bedu\s*gear\b/i.test(name)) return "Edu Gear";
    return odooBrandName.trim();
  }
  if (/\bdell\b|\blatitude\b|\binspiron\b|\bprecision\b|\bvostro\b|\balienware\b/i.test(combined)) return "Dell";
  if (/\blenovo\b|\bthinkpad\b|\bideapad\b|\bthinkcentre\b|\bthinkcentro\b|\byoga\b/i.test(combined)) return "Lenovo";
  if (/\bhp\b|\bprobook\b|\belitebook\b|\benvy\b|\bpavilion\b|\bstream\b|\bvictus\b|\bzbook\b|\btouchsmart\b/i.test(combined)) return "HP";
  if (/\basus\b|\bc203x\b/i.test(combined)) return "Asus";
  if (/\bacer\b|\bc771\b|\baspire\b|\btravelmate\b/i.test(combined)) return "Acer";
  if (/\bapple\b|\bmacbook\b|\bipad\b|\biphone\b/i.test(combined)) return "Apple";
  if (/\bedu\s*gear\b/i.test(combined)) return "Edu Gear";
  if (/\bevvo\b/i.test(combined)) return "EVVO";
  if (/\bsamsung\b|\bgalaxy\b/i.test(combined)) return "Samsung";
  if (/\btoshiba\b|\bsatellite\b/i.test(combined)) return "Toshiba";
  if (/\bmicrosoft\b|\bsurface\b/i.test(combined)) return "Microsoft";
  return "Gen\xE9rico / Multimarca";
}
function classifyProductCondition(p, category, odooAttrs, cleanEcomDesc) {
  const attrCond = (odooAttrs["Condici\xF3n"] || odooAttrs["Condicion"] || "").toLowerCase();
  const textCombined = `${p.name || ""} ${p.description_sale || ""} ${cleanEcomDesc}`.toLowerCase();
  if (attrCond.includes("nueva") || attrCond.includes("nuevo")) {
    return {
      condition: "Nuevo",
      conditionDetail: "Nuevo de Caja (Marcado en Odoo: Nueva \u2014 Garant\xEDa 1 a\xF1o)"
    };
  }
  if (attrCond.includes("usada") || attrCond.includes("usado") || attrCond.includes("refurbished")) {
    return {
      condition: "Usado / Reacondicionado",
      conditionDetail: `Usado / Reacondicionado Clase A (Marcado en Odoo: ${odooAttrs["Condici\xF3n"] || "Usada"} \u2014 Garant\xEDa 6 meses)`
    };
  }
  if (/\b(nuevo|nueva|nuevos|sellado|en caja)\b/i.test(textCombined) && !/\b(usado|usada|reacondicionado)\b/i.test(textCombined)) {
    return {
      condition: "Nuevo",
      conditionDetail: "Nuevo de Caja (Garant\xEDa 1 a\xF1o)"
    };
  }
  if (category === "laptop") {
    return {
      condition: "Usado / Reacondicionado",
      conditionDetail: "Usado / Reacondicionado Importado Clase A (Prueba de 25 puntos \u2014 Garant\xEDa 6 meses)"
    };
  }
  if (category === "red" || /\b(mouse|teclado|combo|hub|adaptador|cable|mochila|bulto|funda|estuche|cooling|stand|soporte|aud[ií]fono|headset|karaoke|barra de sonido|repetidor|router|candado|control|ups|cartucho|cartuchos|tinta|tintas|toner|t[oó]ner)\b/i.test(
    textCombined
  )) {
    return {
      condition: "Nuevo",
      conditionDetail: "Nuevo en Caja"
    };
  }
  return {
    condition: "Usado / Reacondicionado",
    conditionDetail: "Reacondicionado / Verificado (Garant\xEDa Todo Lapto)"
  };
}
function classifyProductUseCases(name, price, category, odooCategName, specsText) {
  const combined = `${name} ${odooCategName} ${specsText}`.toLowerCase();
  if (category !== "laptop") {
    const uses = [];
    if (/\bgaming\b|\bgame\b|\brgb\b|\bjuego/i.test(combined)) uses.push("Gaming / Juegos");
    if (category === "monitor") uses.push("Oficina / Trabajo", "Estudios / Hogar");
    if (category === "impresora") uses.push("Oficina / Negocios", "Estudios / Tareas");
    if (category === "red") uses.push("Hogar / Oficina (Internet y Wi-Fi)");
    if (uses.length === 0) uses.push("Complemento / Uso General");
    return uses;
  }
  const useCases = [];
  const isChromebookOrBasic = /\bchromebook\b|\bchrobook\b|\bceleron\b|\bpentium\b|\barmv7\b|\bmediatk\b|\bmediatek\b|\ba4-\b|\bedu\s*gear\b|\bstream\b|\bc203x\b|\bc771\b|\b100e\b|\bn23\b|\b11e\b/i.test(
    combined
  ) || price <= 9500;
  const isOfficeAndUniversity = /\bi3\b|\bi5\b|\bi7\b|\bryzen\b|\b8gb\b|\b16gb\b|\b32gb\b|\blatitude\b|\bthinkpad\b|\bprobook\b|\belitebook\b|\bideapad\b|\benvy\b|\bthinkcentre\b|\bthinkcentro\b/i.test(
    combined
  ) || price >= 1e4;
  const isHeavyMultitaskOrDesign = /\bi5-(?:8|10|11|12)\d{2}|\bi7\b|\bryzen\s*[57]\b|\b16gb\b|\b32gb\b|\b256\s*gb\b|\b512\s*gb\b|\bzbook\b|\benvy\b|\b5420\b|\b5510\b|\b5511\b|\b5310\b|\be5570\b|\b850\s*g4\b|\bl490\b|\bt490\b/i.test(
    combined
  ) || price >= 16500;
  const isGamingCapable = odooCategName.toLowerCase().includes("gaming") || /\bgaming\b|\bgamer\b|\bvictus\b|\balienware\b|\b10300h\b|\b6820hq\b|\bzbook\b|\benvy\s*x360\b|\bi7-10510u\b|\b16gb\b|\brgb\b/i.test(
    combined
  ) || price >= 2e4;
  if (isChromebookOrBasic) {
    useCases.push("Estudios / Escolar / Tareas / Uso B\xE1sico Diario");
  }
  if (isOfficeAndUniversity) {
    useCases.push("Oficina / Trabajo / Negocios / Contabilidad / Universidad");
  }
  if (isHeavyMultitaskOrDesign) {
    useCases.push("Programaci\xF3n / Multitarea Avanzada / Dise\xF1o");
  }
  if (isGamingCapable) {
    useCases.push("Gaming Ligero-Medio / Alto Rendimiento");
  }
  if (useCases.length === 0) {
    useCases.push("Estudios / Oficina / Uso Diario");
  }
  return useCases;
}
function categorizeOdooProduct(name, odooCategName = "") {
  const nombre = (name || "").toLowerCase();
  const categ = (odooCategName || "").toLowerCase();
  const isExcludedPart = keywordsExcluir.some((k) => nombre.includes(k));
  if ((categ.includes("laptop") || categ.includes("portatil") || categ.includes("port\xE1til") || categ.includes("computadora") || categ.includes("notebook") || categ.includes("all in one")) && !isExcludedPart) {
    return "laptop";
  }
  if (categ.includes("monitor") || categ.includes("pantalla")) {
    return "monitor";
  }
  if (isActualPrinterMachine(nombre, categ)) {
    return "impresora";
  }
  if (keywordsLaptop.some((k) => nombre.includes(k)) && !isExcludedPart && !isPrinterSupplyOrConsumable(nombre, categ)) {
    return "laptop";
  }
  if (keywordsMonitor.some((k) => nombre.includes(k))) {
    return "monitor";
  }
  if (keywordsRed.some((k) => nombre.includes(k))) {
    return "red";
  }
  return "accesorio";
}
var activeOdooRequests = 0;
var MAX_CONCURRENT_ODOO_REQUESTS = 2;
var odooRequestQueue = [];
async function acquireOdooSlot() {
  if (activeOdooRequests < MAX_CONCURRENT_ODOO_REQUESTS) {
    activeOdooRequests++;
    return;
  }
  await new Promise((resolve) => odooRequestQueue.push(resolve));
  activeOdooRequests++;
}
function releaseOdooSlot() {
  activeOdooRequests = Math.max(0, activeOdooRequests - 1);
  const next = odooRequestQueue.shift();
  if (next) next();
}
async function callOdoo(service, method, args, maxRetries = 3) {
  await acquireOdooSlot();
  try {
    const url = appConfig.odoo.url;
    const payload = {
      jsonrpc: "2.0",
      method: "call",
      params: {
        service,
        method,
        args
      }
    };
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22e3);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Connection: "keep-alive"
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`Odoo status ${res.status}`);
        }
        const data = await res.json();
        if (data.error) {
          const rpcMsg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
          throw new Error(rpcMsg);
        }
        return data.result;
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 650));
        }
      }
    }
    throw lastErr;
  } finally {
    releaseOdooSlot();
  }
}
var isOdooSyncRunning = false;
var cachedOdooAttrValues = [];
var cachedOdooAttrLines = [];
var lastOdooAttrsSync = 0;
async function syncOdooInventory() {
  if (isOdooSyncRunning) return products;
  isOdooSyncRunning = true;
  try {
    const locations = await callOdoo("object", "execute_kw", [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      "stock.location",
      "search_read",
      [[["usage", "=", "internal"], ["complete_name", "not ilike", "Recepcion"]]],
      { fields: ["id", "complete_name"] }
    ]);
    const vendibleLocIds = Array.isArray(locations) ? locations.map((l) => l.id).filter(Boolean) : [];
    const now = Date.now();
    const shouldRefreshAttrs = cachedOdooAttrValues.length === 0 || cachedOdooAttrLines.length === 0 || now - lastOdooAttrsSync > 1e3 * 60 * 30;
    const odooContext = vendibleLocIds.length > 0 ? { location: vendibleLocIds } : void 0;
    let odooProductRecords = await callOdoo("object", "execute_kw", [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      "product.template",
      "search_read",
      [[["virtual_available", ">", 0], ["sale_ok", "=", true], ["active", "=", true], ["website_published", "=", true]]],
      {
        fields: [
          "name",
          "list_price",
          "virtual_available",
          "qty_available",
          "website_url",
          "description_sale",
          "description_ecommerce",
          "product_variant_id",
          "website_published",
          "categ_id",
          "brand_id"
        ],
        limit: 1e3,
        order: "list_price asc",
        context: odooContext
      }
    ]);
    if (!Array.isArray(odooProductRecords) || odooProductRecords.length === 0) {
      odooProductRecords = await callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "product.template",
        "search_read",
        [[["virtual_available", ">", 0], ["sale_ok", "=", true], ["active", "=", true]]],
        {
          fields: [
            "name",
            "list_price",
            "virtual_available",
            "qty_available",
            "website_url",
            "description_sale",
            "description_ecommerce",
            "product_variant_id",
            "website_published",
            "categ_id",
            "brand_id"
          ],
          limit: 1e3,
          order: "list_price asc",
          context: odooContext
        }
      ]);
    }
    const [attrValues, attrLines] = await Promise.all([
      shouldRefreshAttrs ? callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "product.attribute.value",
        "search_read",
        [[]],
        { fields: ["id", "name", "attribute_id"], limit: 500 }
      ]).catch(() => cachedOdooAttrValues) : Promise.resolve(cachedOdooAttrValues),
      shouldRefreshAttrs ? callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "product.template.attribute.line",
        "search_read",
        [[]],
        { fields: ["id", "product_tmpl_id", "attribute_id", "value_ids"], limit: 2e3 }
      ]).catch(() => cachedOdooAttrLines) : Promise.resolve(cachedOdooAttrLines)
    ]);
    if (Array.isArray(attrValues) && attrValues.length > 0) {
      cachedOdooAttrValues = attrValues;
    }
    if (Array.isArray(attrLines) && attrLines.length > 0) {
      cachedOdooAttrLines = attrLines;
      lastOdooAttrsSync = now;
    }
    const attrValMap = /* @__PURE__ */ new Map();
    if (Array.isArray(attrValues)) {
      for (const av of attrValues) {
        if (av.id && av.name) attrValMap.set(av.id, String(av.name).trim());
      }
    }
    const prodAttrsByTmplId = /* @__PURE__ */ new Map();
    if (Array.isArray(attrLines)) {
      for (const al of attrLines) {
        const tmplId = Array.isArray(al.product_tmpl_id) ? al.product_tmpl_id[0] : null;
        const attrName = Array.isArray(al.attribute_id) ? String(al.attribute_id[1] || "").trim() : "";
        if (!tmplId || !attrName) continue;
        const valNames = Array.isArray(al.value_ids) ? al.value_ids.map((vid) => attrValMap.get(vid)).filter(Boolean) : [];
        if (valNames.length > 0) {
          const existing = prodAttrsByTmplId.get(tmplId) || {};
          existing[attrName] = valNames.join(" / ");
          prodAttrsByTmplId.set(tmplId, existing);
        }
      }
    }
    if (Array.isArray(odooProductRecords) && odooProductRecords.length > 0) {
      const mapped = odooProductRecords.map((p) => {
        const totalStock = Math.max(Number(p.virtual_available) || 0, Number(p.qty_available) || 0);
        const odooCatName = Array.isArray(p.categ_id) ? String(p.categ_id[1] || "") : "";
        const odooBrandName = Array.isArray(p.brand_id) ? String(p.brand_id[1] || "") : "";
        const cat = categorizeOdooProduct(p.name || "", odooCatName);
        const odooAttrs = prodAttrsByTmplId.get(p.id) || {};
        const rawSaleDesc = typeof p.description_sale === "string" ? p.description_sale.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim() : "";
        const cleanEcomDesc = typeof p.description_ecommerce === "string" ? p.description_ecommerce.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, " ").trim() : "";
        const attrSpecsParts = [];
        if (odooAttrs["Procesador"]) attrSpecsParts.push(`CPU: ${odooAttrs["Procesador"]}`);
        if (odooAttrs["Ram"] || odooAttrs["ram"]) attrSpecsParts.push(`RAM: ${odooAttrs["Ram"] || odooAttrs["ram"]}`);
        if (odooAttrs["Disco"]) attrSpecsParts.push(`Disco: ${odooAttrs["Disco"]}`);
        if (odooAttrs["Pantalla Tactil"] || odooAttrs["Touch"]) {
          attrSpecsParts.push(`Pantalla: ${odooAttrs["Pantalla Tactil"] || odooAttrs["Touch"]}`);
        }
        const specsSummary = [
          rawSaleDesc,
          attrSpecsParts.join(" | "),
          !rawSaleDesc && cleanEcomDesc ? cleanEcomDesc.slice(0, 140) : ""
        ].filter(Boolean).join(" \xB7 ").slice(0, 220);
        const brand = detectProductBrand(p.name || "", odooBrandName, `${rawSaleDesc} ${cleanEcomDesc}`);
        const { condition, conditionDetail } = classifyProductCondition(p, cat, odooAttrs, cleanEcomDesc);
        const useCases = classifyProductUseCases(
          p.name || "",
          Number(p.list_price) || 0,
          cat,
          odooCatName,
          `${rawSaleDesc} ${attrSpecsParts.join(" ")} ${cleanEcomDesc}`
        );
        return {
          id: p.id,
          variantId: Array.isArray(p.product_variant_id) ? p.product_variant_id[0] : p.id,
          name: (p.name || "").trim(),
          list_price: Number(p.list_price) || 0,
          virtual_available: totalStock,
          vitrinaStock: totalStock,
          almacenStock: totalStock,
          recepcionStock: 0,
          odooCategory: odooCatName,
          website_url: p.website_url || "",
          image_url: `https://todolapto.com.do/web/image/product.template/${p.id}/image_256`,
          description_sale: rawSaleDesc || specsSummary,
          category: cat,
          website_published: Boolean(p.website_published),
          brand,
          condition,
          conditionDetail,
          specsSummary,
          useCases
        };
      }).filter((p) => p.virtual_available > 0 && p.list_price > 1);
      products = mapped;
      const laptopCount = products.filter((p) => p.category === "laptop").length;
      const printerCount = products.filter((p) => p.category === "impresora").length;
      appConfig.odoo.lastSync = (/* @__PURE__ */ new Date()).toISOString();
      appConfig.odoo.connected = true;
      console.log(
        `[Odoo Real-Time Sync]: Loaded ${products.length} in-stock products (${laptopCount} laptops, ${printerCount} impresoras, ${vendibleLocIds.length} ubicaciones vendibles; Recepci\xF3n excluida)`
      );
      broadcastEvent("inventory_update", { count: products.length, lastSync: appConfig.odoo.lastSync });
    }
  } catch {
  } finally {
    isOdooSyncRunning = false;
  }
  return products;
}
var odooCustomersCache = [];
var lastOdooCustomersSync = 0;
var isOdooCustomersSyncRunning = false;
var odooPartnerByPhoneMap = /* @__PURE__ */ new Map();
function normalizePhoneDigits(phone) {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}
function findOdooPartnerByPhone(rawPhone) {
  const digits = normalizePhoneDigits(rawPhone);
  if (!digits || digits.length < 7) return null;
  const last10 = digits.slice(-10);
  const last7 = digits.slice(-7);
  if (odooPartnerByPhoneMap.has(last10)) return odooPartnerByPhoneMap.get(last10);
  if (odooPartnerByPhoneMap.has(last7)) return odooPartnerByPhoneMap.get(last7);
  for (const partner of odooCustomersCache) {
    const pDigits = normalizePhoneDigits(partner.phone || "");
    const mDigits = normalizePhoneDigits(partner.mobile || "");
    if (pDigits && (pDigits.endsWith(last10) || last10.endsWith(pDigits) || pDigits.endsWith(last7)) || mDigits && (mDigits.endsWith(last10) || last10.endsWith(mDigits) || mDigits.endsWith(last7))) {
      return partner;
    }
  }
  return null;
}
async function syncOdooCustomers(force = false) {
  const now = Date.now();
  if (!force && odooCustomersCache.length > 0 && now - lastOdooCustomersSync < 1e3 * 60 * 30) {
    return odooCustomersCache;
  }
  if (isOdooCustomersSyncRunning) return odooCustomersCache;
  isOdooCustomersSyncRunning = true;
  const domain = [[
    "|",
    ["customer_rank", ">", 0],
    "|",
    ["phone", "!=", false],
    ["mobile", "!=", false]
  ]];
  try {
    let result = null;
    try {
      result = await callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "res.partner",
        "search_read",
        domain,
        {
          fields: ["id", "name", "phone", "mobile", "email", "city", "street", "customer_rank", "sale_order_count"],
          limit: 600,
          order: "id desc"
        }
      ]);
    } catch {
      result = await callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "res.partner",
        "search_read",
        domain,
        {
          fields: ["id", "name", "phone", "mobile", "email", "city", "street", "customer_rank"],
          limit: 600,
          order: "id desc"
        }
      ]);
    }
    if (Array.isArray(result) && result.length > 0) {
      odooCustomersCache = result;
      lastOdooCustomersSync = now;
      odooPartnerByPhoneMap.clear();
      for (const p of result) {
        const pDigits = normalizePhoneDigits(p.phone || "");
        const mDigits = normalizePhoneDigits(p.mobile || "");
        if (pDigits && pDigits.length >= 7) {
          odooPartnerByPhoneMap.set(pDigits.slice(-10), p);
          odooPartnerByPhoneMap.set(pDigits.slice(-7), p);
        }
        if (mDigits && mDigits.length >= 7) {
          odooPartnerByPhoneMap.set(mDigits.slice(-10), p);
          odooPartnerByPhoneMap.set(mDigits.slice(-7), p);
        }
      }
      console.log(`[Odoo Customers Sync]: Sincronizados ${result.length} clientes reales desde res.partner.`);
      broadcastEvent("customers_update", { count: result.length, lastSync: new Date(now).toISOString() });
    }
  } catch {
  } finally {
    isOdooCustomersSyncRunning = false;
  }
  return odooCustomersCache;
}
async function findOrCreateOdooCustomerByPhone(rawPhone, nameFallback) {
  const cleanDigits = normalizePhoneDigits(rawPhone);
  if (!cleanDigits || cleanDigits.length < 10) {
    console.warn(`[Odoo Deduplication Warning]: Tel\xE9fono inv\xE1lido o incompleto ("${rawPhone}"). No se crear\xE1 cliente en Odoo sin tel\xE9fono.`);
    return null;
  }
  const stdPhone = cleanDigits.length === 10 ? `1${cleanDigits}` : cleanDigits;
  const last10 = cleanDigits.slice(-10);
  const last7 = cleanDigits.slice(-7);
  const last7WithDash = `${last7.slice(0, 3)}-${last7.slice(3)}`;
  const cachedMatch = findOdooPartnerByPhone(stdPhone);
  if (cachedMatch) {
    console.log(`[Odoo Deduplication]: Cliente ya existe en cach\xE9 #${cachedMatch.id} (${cachedMatch.name}) para tel\xE9fono ${stdPhone}`);
    return { id: cachedMatch.id, name: cachedMatch.name, isNew: false };
  }
  try {
    const domain = [
      "|",
      "|",
      "|",
      ["phone", "ilike", last10],
      ["mobile", "ilike", last10],
      ["phone", "ilike", last7WithDash],
      ["mobile", "ilike", last7WithDash]
    ];
    const existingPartners = await callOdoo("object", "execute_kw", [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      "res.partner",
      "search_read",
      [domain],
      { fields: ["id", "name", "phone", "mobile"], limit: 1 }
    ]).catch(() => []);
    if (Array.isArray(existingPartners) && existingPartners.length > 0 && existingPartners[0]?.id) {
      const match = existingPartners[0];
      console.log(`[Odoo Deduplication]: Cliente ya existe en Odoo #${match.id} (${match.name}) para tel\xE9fono ${stdPhone}. Se reutiliza sin duplicar.`);
      odooPartnerByPhoneMap.set(last10, match);
      return { id: match.id, name: match.name, isNew: false };
    }
    const createdId = await callOdoo("object", "execute_kw", [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      "res.partner",
      "create",
      [
        {
          name: nameFallback || "Cliente WhatsApp",
          phone: stdPhone,
          mobile: stdPhone,
          customer_rank: 1
        }
      ]
    ]);
    if (typeof createdId === "number") {
      const newRecord = {
        id: createdId,
        name: nameFallback || "Cliente WhatsApp",
        phone: stdPhone,
        mobile: stdPhone,
        customer_rank: 1,
        sale_order_count: 0
      };
      odooCustomersCache.unshift(newRecord);
      odooPartnerByPhoneMap.set(last10, newRecord);
      console.log(`[Odoo Customer Created]: Nuevo cliente registrado en Odoo #${createdId} (${newRecord.name}) con tel\xE9fono ${stdPhone}.`);
      return { id: createdId, name: newRecord.name, isNew: true };
    }
  } catch (err) {
    console.error(`[Odoo Create Customer Error]: ${err.message}`);
  }
  return null;
}
function parseSingleEvolutionMessage(record, customerNameFallback) {
  if (!record || !record.key) return null;
  const rawMsgObj = record.message || {};
  const msgObj = rawMsgObj.associatedChildMessage?.message || rawMsgObj.ephemeralMessage?.message || rawMsgObj.viewOnceMessage?.message || rawMsgObj.viewOnceMessageV2?.message || rawMsgObj;
  const msgTypeRaw = record.messageType || "";
  if (msgTypeRaw === "protocolMessage" || msgTypeRaw === "senderKeyDistributionMessage" || msgTypeRaw === "reactionMessage" || msgTypeRaw === "albumMessage") {
    return null;
  }
  const fromMe = Boolean(record.key.fromMe);
  const msgId = record.key.id || record.id || `${Date.now()}`;
  let type = "text";
  let content = "";
  let mediaUrl;
  let mediaDuration;
  let mediaMimeType;
  let fileName;
  if (msgObj.audioMessage || msgTypeRaw === "audioMessage") {
    type = "audio";
    mediaDuration = msgObj.audioMessage?.seconds || 0;
    mediaMimeType = msgObj.audioMessage?.mimetype || "audio/ogg";
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
    content = transcriptionsByMsgId.get(msgId) || "\u{1F3A4} Nota de voz de WhatsApp";
  } else if (msgObj.imageMessage || msgTypeRaw === "imageMessage") {
    type = "image";
    content = msgObj.imageMessage?.caption || "";
    mediaMimeType = msgObj.imageMessage?.mimetype || "image/jpeg";
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.videoMessage || msgTypeRaw === "videoMessage") {
    type = "video";
    content = msgObj.videoMessage?.caption || "";
    mediaDuration = msgObj.videoMessage?.seconds || 0;
    mediaMimeType = msgObj.videoMessage?.mimetype || "video/mp4";
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}?video=true`;
  } else if (msgObj.documentMessage || msgTypeRaw === "documentMessage") {
    type = "document";
    fileName = msgObj.documentMessage?.fileName || msgObj.documentMessage?.title || "Documento";
    content = msgObj.documentMessage?.caption || `\u{1F4C4} ${fileName}`;
    mediaMimeType = msgObj.documentMessage?.mimetype || "application/pdf";
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.stickerMessage || msgTypeRaw === "stickerMessage") {
    type = "sticker";
    content = "\u{1F3F7}\uFE0F Sticker";
    mediaUrl = `/api/evolution/media/${encodeURIComponent(msgId)}`;
  } else if (msgObj.locationMessage || msgTypeRaw === "locationMessage") {
    type = "location";
    const lat = msgObj.locationMessage?.degreesLatitude;
    const lng = msgObj.locationMessage?.degreesLongitude;
    content = lat && lng ? `\u{1F4CD} Ubicaci\xF3n GPS: https://www.google.com/maps?q=${lat},${lng}` : "\u{1F4CD} Ubicaci\xF3n compartida";
  } else if (msgObj.interactiveMessage || msgTypeRaw === "interactiveMessage") {
    type = "text";
    content = msgObj.interactiveMessage?.body?.text || msgObj.interactiveMessage?.header?.title || "Mensaje interactivo";
  } else {
    type = "text";
    content = msgObj.conversation || msgObj.extendedTextMessage?.text || rawMsgObj.ephemeralMessage?.message?.extendedTextMessage?.text || rawMsgObj.ephemeralMessage?.message?.conversation || msgObj.buttonsResponseMessage?.selectedDisplayText || msgObj.listResponseMessage?.title || "";
  }
  if (!content && type === "text") return null;
  let quotedMessage;
  const ctx = msgObj.extendedTextMessage?.contextInfo || msgObj.imageMessage?.contextInfo || msgObj.videoMessage?.contextInfo || msgObj.audioMessage?.contextInfo || msgObj.documentMessage?.contextInfo || msgObj.stickerMessage?.contextInfo || msgObj.interactiveMessage?.contextInfo || msgObj.interactiveResponseMessage?.contextInfo || msgObj.buttonsResponseMessage?.contextInfo || msgObj.templateButtonReplyMessage?.contextInfo || msgObj.listResponseMessage?.contextInfo || rawMsgObj.contextInfo || rawMsgObj.messageContextInfo || rawMsgObj.extendedTextMessage?.contextInfo || record.contextInfo || record.message?.contextInfo || record.message?.extendedTextMessage?.contextInfo || record.quotedMessage || record.quoted;
  const quotedId = ctx?.stanzaId || ctx?.id || ctx?.quotedMessageId || ctx?.messageAssociation?.parentMessageKey?.id || rawMsgObj.messageContextInfo?.messageAssociation?.parentMessageKey?.id || record.quoted?.key?.id || record.quotedMessage?.key?.id;
  const rawQm = ctx?.quotedMessage?.message || ctx?.quotedMessage?.ephemeralMessage?.message || ctx?.quotedMessage?.viewOnceMessage?.message || ctx?.quotedMessage?.viewOnceMessageV2?.message || ctx?.quotedMessage?.documentWithCaptionMessage?.message || ctx?.quotedMessage || record.quotedMessage?.message || record.quotedMessage || record.quoted?.message || record.quoted;
  if (rawQm) {
    const qm = rawQm.message || rawQm.ephemeralMessage?.message || rawQm.viewOnceMessage?.message || rawQm;
    const qText = qm.conversation || qm.extendedTextMessage?.text || qm.text || qm.body || qm.content || qm.caption || qm.imageMessage?.caption || qm.videoMessage?.caption || qm.documentMessage?.caption || qm.documentMessage?.fileName || qm.buttonsResponseMessage?.selectedDisplayText || qm.templateButtonReplyMessage?.selectedDisplayText || qm.listResponseMessage?.title || qm.interactiveResponseMessage?.body?.text || qm.interactiveMessage?.body?.text || qm.editedMessage?.message?.protocolMessage?.editedMessage?.conversation || qm.editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text || (qm.audioMessage ? "\u{1F3A4} Nota de voz citada" : qm.imageMessage ? "\u{1F4F7} Foto citada" : qm.videoMessage ? "\u{1F3A5} Video citado" : qm.documentMessage ? "\u{1F4C4} Documento citado" : qm.stickerMessage ? "\u{1F3F7}\uFE0F Sticker citado" : "");
    const qType = qm.audioMessage ? "audio" : qm.imageMessage ? "image" : qm.videoMessage ? "video" : qm.documentMessage ? "document" : "text";
    if (qText || quotedId) {
      const partPhone = ctx?.participant ? String(ctx.participant).replace(/@.*$/, "").replace(/\D/g, "") : "";
      const isTodoLaptoAuthor = Boolean(ctx?.fromMe) || partPhone && (partPhone === appConfig.evolution.teamPhone || partPhone === appConfig.evolution.adminPhone);
      quotedMessage = {
        id: quotedId,
        text: qText,
        type: qType,
        author: isTodoLaptoAuthor ? "Todo Lapto" : partPhone ? `+${partPhone}` : customerNameFallback
      };
    }
  } else if (ctx?.externalAdReply) {
    const adTitle = ctx.externalAdReply.title || "Anuncio de Redes Sociales";
    const adBody = ctx.externalAdReply.body || ctx.externalAdReply.sourceUrl || "";
    quotedMessage = {
      id: quotedId,
      text: `${adTitle}${adBody ? ` \u2014 ${adBody}` : ""}`,
      type: "text",
      author: "\u{1F4E2} Anuncio Citado"
    };
  } else if (msgObj.interactiveMessage?.header?.title) {
    quotedMessage = {
      text: `${msgObj.interactiveMessage.header.title}${msgObj.interactiveMessage.header.subtitle ? ` (${msgObj.interactiveMessage.header.subtitle})` : ""}`,
      type: "text",
      author: "\u{1F4E2} Anuncio / Cat\xE1logo"
    };
  } else if (quotedId) {
    quotedMessage = {
      id: quotedId,
      text: "",
      author: customerNameFallback
    };
  }
  const tsNum = Number(record.messageTimestamp);
  const timestamp = tsNum ? new Date(tsNum > 1e12 ? tsNum : tsNum * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: `evo-${msgId}`,
    evolutionMessageId: msgId,
    sender: fromMe ? "assistant" : "customer",
    type,
    content,
    timestamp,
    quotedMessage,
    mediaUrl,
    mediaMimeType,
    mediaDuration,
    transcription: transcriptionsByMsgId.get(msgId),
    aiAnalysis: aiAnalysisByMsgId.get(msgId),
    metadata: fileName ? { fileName } : void 0
  };
}
var relatedJidsBySession = /* @__PURE__ */ new Map();
var lidToPhoneMap = /* @__PURE__ */ new Map();
function isGenericContactName(name) {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.length < 3) return true;
  const lower = trimmed.toLowerCase();
  return lower === "voc\xEA" || lower === "voce" || lower === "cliente" || lower === "cliente whatsapp" || lower.startsWith("cliente +") || lower.startsWith("whatsapp #") || lower.startsWith("lead ") || lower.startsWith("usuario ") || /^\+?\d+$/.test(trimmed);
}
async function syncEvolutionContactsIfNeeded() {
  const now = Date.now();
  if (now - lastContactsSync < 1e3 * 60 * 60 * 4 && evolutionContactsMap.size > 0) return;
  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findContacts/${appConfig.evolution.instance}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: appConfig.evolution.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (res.ok) {
      const contacts = await res.json();
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          if (c.remoteJid) {
            const cleanName = c.pushName && c.pushName.trim() !== "" ? c.pushName.trim() : void 0;
            const pic = c.profilePicUrl || void 0;
            evolutionContactsMap.set(c.remoteJid, { name: cleanName, pic });
            const phoneKey = c.remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
            if (phoneKey) {
              const existing = evolutionContactsMap.get(phoneKey);
              evolutionContactsMap.set(phoneKey, {
                name: cleanName || existing?.name,
                pic: pic || existing?.pic
              });
            }
          }
        }
        lastContactsSync = now;
      }
    }
  } catch (err) {
    console.warn("[Evolution Contacts Sync Warning]:", err.message);
  }
}
var isEvoSyncRunning = false;
var lastEvolutionChatsSync = 0;
async function syncEvolutionChats() {
  if (isEvoSyncRunning) return conversations;
  const now = Date.now();
  if (now - lastEvolutionChatsSync < 12e3 && conversations.length > 0) {
    return conversations;
  }
  isEvoSyncRunning = true;
  lastEvolutionChatsSync = now;
  try {
    await syncEvolutionContactsIfNeeded();
    const url = `${appConfig.evolution.serverUrl}/chat/findChats/${appConfig.evolution.instance}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: appConfig.evolution.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      throw new Error(`Evolution findChats status ${res.status}`);
    }
    const rawChats = await res.json();
    if (!Array.isArray(rawChats)) return conversations;
    const validChats = rawChats.filter(
      (c) => c.remoteJid && !isWhatsAppGroup(c.remoteJid) && !isWhatsAppGroup(c.lastMessage?.key?.remoteJid) && !isWhatsAppGroup(c.lastMessage?.key?.participant) && c.remoteJid !== "status@broadcast" && c.lastMessage && c.lastMessage.messageTimestamp
    );
    validChats.sort(
      (a, b) => Number(b.lastMessage.messageTimestamp) - Number(a.lastMessage.messageTimestamp)
    );
    const recentSlice = validChats.slice(0, 40);
    const namedSlice = validChats.filter((c) => {
      const contactInfo = evolutionContactsMap.get(c.remoteJid);
      const name = c.pushName || contactInfo?.name || (!c.lastMessage.key?.fromMe ? c.lastMessage.pushName : "");
      return name && name !== "Voc\xEA" && !/^\d+$/.test(name);
    }).slice(0, 20);
    const combinedMap = /* @__PURE__ */ new Map();
    for (const c of [...recentSlice, ...namedSlice]) {
      combinedMap.set(c.remoteJid, c);
    }
    for (const c of validChats) {
      const alt = c.lastMessage?.key?.remoteJidAlt;
      if (alt && alt.endsWith("@s.whatsapp.net")) {
        const altPhone = alt.replace("@s.whatsapp.net", "").replace(/\D/g, "");
        if (altPhone) {
          lidToPhoneMap.set(c.remoteJid, altPhone);
          const lidDigits = c.remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
          lidToPhoneMap.set(lidDigits, altPhone);
        }
      }
    }
    const knownPhoneByName = /* @__PURE__ */ new Map();
    for (const conv of conversations) {
      if (conv.customerPhone && conv.customerPhone.length <= 12 && !isGenericContactName(conv.customerName)) {
        knownPhoneByName.set(conv.customerName.trim().toLowerCase(), conv.customerPhone);
      }
    }
    for (const c of validChats) {
      if (c.remoteJid?.endsWith("@s.whatsapp.net")) {
        const p = c.remoteJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
        const cInfo = evolutionContactsMap.get(c.remoteJid);
        const name = c.pushName || cInfo?.name || (!c.lastMessage?.key?.fromMe ? c.lastMessage?.pushName : "");
        if (p && p.length <= 12 && !isGenericContactName(name)) {
          knownPhoneByName.set(name.trim().toLowerCase(), p);
        }
      }
    }
    const existingConvByPhone = /* @__PURE__ */ new Map();
    const existingConvBySession = /* @__PURE__ */ new Map();
    for (const conv of conversations) {
      existingConvBySession.set(conv.sessionId, conv);
      if (conv.customerPhone) existingConvByPhone.set(conv.customerPhone, conv);
    }
    let hasChanges = false;
    const dedupedByPhone = /* @__PURE__ */ new Map();
    const dedupedByName = /* @__PURE__ */ new Map();
    for (const [remoteJid, chatObj] of combinedMap.entries()) {
      const lm = chatObj.lastMessage;
      const rawAlt = lm?.key?.remoteJidAlt || "";
      let cleanPhone = "";
      if (rawAlt.endsWith("@s.whatsapp.net")) {
        cleanPhone = rawAlt.replace("@s.whatsapp.net", "").replace(/\D/g, "");
      } else if (remoteJid.endsWith("@s.whatsapp.net")) {
        cleanPhone = remoteJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
      } else if (lidToPhoneMap.has(remoteJid)) {
        cleanPhone = lidToPhoneMap.get(remoteJid);
      } else {
        const rawDigits = remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
        if (lidToPhoneMap.has(rawDigits)) {
          cleanPhone = lidToPhoneMap.get(rawDigits);
        } else if (rawDigits.length >= 10 && rawDigits.length <= 12) {
          cleanPhone = rawDigits;
        } else {
          cleanPhone = rawDigits;
        }
      }
      const contactInfo = evolutionContactsMap.get(remoteJid) || (cleanPhone ? evolutionContactsMap.get(cleanPhone) : void 0);
      let customerName = chatObj.pushName || contactInfo?.name || (!lm?.key?.fromMe && lm?.pushName && lm?.pushName !== "Voc\xEA" ? lm.pushName : "") || "";
      const isGenericName = isGenericContactName(customerName);
      if ((cleanPhone.length > 12 || !cleanPhone.startsWith("18")) && !isGenericName) {
        const norm = customerName.trim().toLowerCase();
        const matchedPhone = knownPhoneByName.get(norm);
        if (matchedPhone) {
          cleanPhone = matchedPhone;
          lidToPhoneMap.set(remoteJid, cleanPhone);
          const rawDigits = remoteJid.replace(/@.*$/, "").replace(/\D/g, "");
          lidToPhoneMap.set(rawDigits, cleanPhone);
        }
      }
      if (isGenericName) {
        customerName = cleanPhone.startsWith("18") && cleanPhone.length <= 12 ? `Cliente +${cleanPhone}` : `WhatsApp #${cleanPhone.slice(-6)}`;
      }
      const normName = !isGenericName ? customerName.trim().toLowerCase() : "";
      const dedupKey = cleanPhone || remoteJid;
      const parsedLast = parseSingleEvolutionMessage(lm, customerName);
      const lastTimestamp = parsedLast ? parsedLast.timestamp : new Date(Number(lm.messageTimestamp) * 1e3).toISOString();
      let lastPreview = parsedLast?.content || "";
      let lastType = parsedLast?.type || "text";
      if (lastType === "audio" && !lastPreview.startsWith("\u{1F3A4}")) lastPreview = `\u{1F3A4} ${lastPreview}`;
      if (lastType === "image" && !lastPreview) lastPreview = "\u{1F4F7} Foto enviada por WhatsApp";
      if (lastType === "video" && !lastPreview) lastPreview = "\u{1F3A5} Video enviado por WhatsApp";
      if (lastType === "document" && !lastPreview) lastPreview = "\u{1F4C4} Documento adjunto";
      if (lastType === "sticker") lastPreview = "\u{1F3F7}\uFE0F Sticker";
      if (!lastPreview) lastPreview = "Mensaje de WhatsApp";
      let existingInLoop = dedupedByPhone.get(dedupKey);
      if (!existingInLoop && normName && dedupedByName.has(normName)) {
        existingInLoop = dedupedByName.get(normName);
      }
      if (!existingInLoop) {
        for (const cand of dedupedByPhone.values()) {
          const jids = relatedJidsBySession.get(cand.sessionId);
          if (jids && (jids.has(remoteJid) || rawAlt && jids.has(rawAlt))) {
            existingInLoop = cand;
            break;
          }
        }
      }
      if (existingInLoop) {
        const jidSet2 = relatedJidsBySession.get(existingInLoop.sessionId) || /* @__PURE__ */ new Set([existingInLoop.sessionId]);
        jidSet2.add(remoteJid);
        if (rawAlt) jidSet2.add(rawAlt);
        relatedJidsBySession.set(existingInLoop.sessionId, jidSet2);
        if (cleanPhone && cleanPhone.length <= 12 && (existingInLoop.customerPhone.length > 12 || !existingInLoop.customerPhone.startsWith("18"))) {
          existingInLoop.customerPhone = cleanPhone;
          if (existingInLoop.sessionId.endsWith("@lid")) {
            const newCanonicalId = `${cleanPhone}@s.whatsapp.net`;
            jidSet2.add(existingInLoop.sessionId);
            jidSet2.add(newCanonicalId);
            relatedJidsBySession.delete(existingInLoop.sessionId);
            relatedJidsBySession.set(newCanonicalId, jidSet2);
            existingInLoop.sessionId = newCanonicalId;
          }
        }
        if (!existingInLoop.profilePicUrl && (chatObj.profilePicUrl || contactInfo?.pic)) {
          existingInLoop.profilePicUrl = chatObj.profilePicUrl || contactInfo?.pic;
        }
        if (isGenericContactName(existingInLoop.customerName) && !isGenericName) {
          existingInLoop.customerName = customerName;
        }
        if (new Date(lastTimestamp).getTime() > new Date(existingInLoop.lastTimestamp).getTime()) {
          existingInLoop.lastTimestamp = lastTimestamp;
          existingInLoop.lastMessagePreview = lastPreview;
          existingInLoop.lastMessageType = lastType;
        }
        if (parsedLast && !existingInLoop.messages.some((m) => m.evolutionMessageId === parsedLast.evolutionMessageId)) {
          existingInLoop.messages = [...existingInLoop.messages, parsedLast].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }
        existingInLoop.unreadCount = Math.max(existingInLoop.unreadCount, Number(chatObj.unreadCount) || 0);
        continue;
      }
      const canonicalSessionId = cleanPhone && cleanPhone.length <= 12 && cleanPhone.startsWith("1") ? `${cleanPhone}@s.whatsapp.net` : rawAlt.endsWith("@s.whatsapp.net") ? rawAlt : remoteJid;
      const prevConv = existingConvBySession.get(canonicalSessionId) || existingConvBySession.get(remoteJid) || (cleanPhone && cleanPhone.length <= 12 ? existingConvByPhone.get(cleanPhone) : void 0) || (!isGenericName ? conversations.find((c) => !isGenericContactName(c.customerName) && c.customerName.trim().toLowerCase() === normName) : void 0);
      const jidSet = relatedJidsBySession.get(canonicalSessionId) || /* @__PURE__ */ new Set();
      jidSet.add(canonicalSessionId);
      jidSet.add(remoteJid);
      if (rawAlt) jidSet.add(rawAlt);
      relatedJidsBySession.set(canonicalSessionId, jidSet);
      const aiEnabled = aiEnabledBySession.has(canonicalSessionId) ? aiEnabledBySession.get(canonicalSessionId) : aiEnabledBySession.has(remoteJid) ? aiEnabledBySession.get(remoteJid) : prevConv ? prevConv.aiEnabled : true;
      if (!prevConv || prevConv.lastTimestamp !== lastTimestamp) {
        hasChanges = true;
      }
      let messages = prevConv?.messages ? [...prevConv.messages] : parsedLast ? [parsedLast] : [];
      if (parsedLast && !messages.some(
        (m) => parsedLast.evolutionMessageId && m.evolutionMessageId === parsedLast.evolutionMessageId || parsedLast.id && m.id === parsedLast.id
      )) {
        messages.push(parsedLast);
      }
      messages = mergeWithLocalMessages(canonicalSessionId, messages, prevConv?.messages || [], cleanPhone);
      const latestMerged = messages[messages.length - 1];
      const finalLastTimestamp = latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime() ? latestMerged.timestamp : lastTimestamp;
      const finalLastPreview = latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime() ? latestMerged.content || lastPreview : lastPreview;
      const finalLastType = latestMerged && new Date(latestMerged.timestamp).getTime() >= new Date(lastTimestamp).getTime() ? latestMerged.type : lastType;
      const lowerPreview = finalLastPreview.toLowerCase();
      const detectedProducts = prevConv?.detectedProducts || [];
      for (const kw of ["thinkpad", "latitude", "chromebook", "macbook", "monitor", "impresora", "dell", "hp", "lenovo"]) {
        if (lowerPreview.includes(kw) && !detectedProducts.includes(kw.toUpperCase())) {
          detectedProducts.push(kw.toUpperCase());
        }
      }
      const odooMatch = findOdooPartnerByPhone(cleanPhone);
      const odooPartnerId = odooMatch?.id || prevConv?.odooPartnerId;
      const isOdooClient = Boolean(odooMatch || prevConv?.isOdooClient || odooPartnerId && odooPartnerId > 0);
      const finalConv = {
        sessionId: canonicalSessionId,
        customerPhone: cleanPhone,
        customerName: !isGenericName ? customerName : odooMatch?.name ? odooMatch.name : prevConv?.customerName && !isGenericContactName(prevConv.customerName) ? prevConv.customerName : customerName,
        profilePicUrl: chatObj.profilePicUrl || contactInfo?.pic || prevConv?.profilePicUrl || void 0,
        messages,
        messagesLoaded: prevConv?.messagesLoaded || false,
        aiEnabled,
        unreadCount: Number(chatObj.unreadCount) || 0,
        lastTimestamp: finalLastTimestamp,
        lastMessagePreview: finalLastPreview,
        lastMessageType: finalLastType,
        intentStatus: finalLastType === "image" && lowerPreview.includes("pago") ? "comprobante_enviado" : detectedProducts.length > 0 ? "interesado" : prevConv?.intentStatus || "explorando",
        detectedProducts,
        zone: "santo_domingo",
        odooPartnerId,
        isOdooClient,
        isLiveEvolution: true
      };
      dedupedByPhone.set(dedupKey, finalConv);
      if (cleanPhone) dedupedByPhone.set(cleanPhone, finalConv);
      if (canonicalSessionId) dedupedByPhone.set(canonicalSessionId, finalConv);
      if (normName) dedupedByName.set(normName, finalConv);
    }
    const seenFinalSessions = /* @__PURE__ */ new Set();
    const seenFinalPhones = /* @__PURE__ */ new Set();
    const seenFinalNames = /* @__PURE__ */ new Set();
    const strictlyUniqueList = [];
    for (const conv of Array.from(new Set(dedupedByPhone.values()))) {
      if (seenFinalSessions.has(conv.sessionId)) continue;
      const phone = conv.customerPhone && conv.customerPhone.length <= 12 ? conv.customerPhone : "";
      const normName = !isGenericContactName(conv.customerName) ? conv.customerName.trim().toLowerCase() : "";
      if (phone && seenFinalPhones.has(phone)) continue;
      if (normName && seenFinalNames.has(normName)) continue;
      seenFinalSessions.add(conv.sessionId);
      if (phone) seenFinalPhones.add(phone);
      if (normName) seenFinalNames.add(normName);
      strictlyUniqueList.push(conv);
    }
    strictlyUniqueList.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    conversations = strictlyUniqueList;
    appConfig.evolution.connected = true;
    if (hasChanges) {
      broadcastEvent("conversations_update", { count: conversations.length });
    }
    if (appConfig.globalAiActive && !isAiStudioIdleBackgroundContainer()) {
      const nowMs = Date.now();
      const handledContactsThisCycle = /* @__PURE__ */ new Set();
      for (const conv of conversations.slice(0, 15)) {
        if (!conv.aiEnabled) continue;
        if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) continue;
        const cleanPhone = (conv.customerPhone || "").replace(/\D/g, "");
        if (cleanPhone === appConfig.evolution.teamPhone || cleanPhone === appConfig.evolution.adminPhone || conv.customerName.toLowerCase().includes("soporte todo lapto")) {
          continue;
        }
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (!lastMsg) continue;
        const msgId = normalizeMsgIdKey(lastMsg.evolutionMessageId || lastMsg.id);
        if (lastMsg.sender !== "customer") continue;
        const msgTimeMs = new Date(lastMsg.timestamp).getTime();
        const ageMs = nowMs - msgTimeMs;
        if (ageMs > 10 * 60 * 1e3) continue;
        const contactKeys = getConversationContactKeys(conv);
        if (contactKeys.some((k) => handledContactsThisCycle.has(k) || isBotLockActive(k))) {
          continue;
        }
        if (isMessageIdAlreadyProcessed(msgId, contactKeys)) continue;
        const skipCheck = shouldSkipBotReply(conv, lastMsg, "live_evolution_poll");
        if (skipCheck.skip) continue;
        for (const k of contactKeys) {
          handledContactsThisCycle.add(k);
        }
        console.log(`\u{1F916} [Auto-Reply Polling Trigger]: Respondiendo a ${conv.customerName} ("${lastMsg.content.slice(0, 30)}")`);
        triggerSalesBotReplyForConversation(conv, "live_evolution_poll").catch(
          (err) => console.log(`[Auto-Reply Poll Info for ${conv.customerName}]:`, err.message)
        );
      }
    }
    isFirstEvolutionSync = false;
  } catch (err) {
    console.log(`[Evolution Live Sync Info]: ${err.message}`);
  } finally {
    isEvoSyncRunning = false;
  }
  return conversations;
}
function isInternalOrNoiseContent(content) {
  if (!content) return false;
  if (/sk-[a-zA-Z0-9_\-]{20,}/.test(content)) return true;
  if (/ALMACEN DE NO MOSTRAR/i.test(content)) return true;
  if (/FALLO EN EL BOT/i.test(content)) return true;
  if (/Workflow: todo lapto/i.test(content)) return true;
  if (/Dame un momento para confirmar esa informaci[oó]n/i.test(content)) return true;
  if (/^tranquilo$/i.test(content.trim())) return true;
  return false;
}
function isSubstantiveProposal(msg) {
  const c = msg.transcription || msg.content || "";
  if (isInternalOrNoiseContent(c)) return false;
  return c.includes("Cat\xE1logo") || c.includes("laptop") || c.includes("Laptop") || c.includes("RD$") || c.includes("Charles de Gaulle") || c.includes("tienda") || c.includes("opciones de laptops") || c.includes("contra entrega") || c.includes("transferencia") || c.includes("Chromebook") || c.includes("EDU GEAR") || c.includes("ThinkPad") || c.includes("Dell") || c.includes("Lenovo") || c.includes("Asus");
}
var localSentMessagesBySession = /* @__PURE__ */ new Map();
function recordLocalMessage(sessionId, msg, customerPhone) {
  const keys = /* @__PURE__ */ new Set([sessionId]);
  if (customerPhone) {
    const clean = customerPhone.replace(/\D/g, "");
    if (clean) {
      keys.add(clean);
      keys.add(`${clean}@s.whatsapp.net`);
    }
  }
  const related = relatedJidsBySession.get(sessionId);
  if (related) {
    for (const r of related) keys.add(r);
  }
  for (const k of keys) {
    if (!k) continue;
    const list = localSentMessagesBySession.get(k) || [];
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg);
      if (list.length > 100) list.shift();
      localSentMessagesBySession.set(k, list);
    }
  }
}
function mergeWithLocalMessages(sessionId, evoList, existingList = [], customerPhone) {
  const combined = [...evoList];
  const candidateLocals = [];
  const isFullEvoRefresh = evoList.length >= 2;
  const addCandidates = (arr, localOnly = true) => {
    if (!arr) return;
    for (const m of arr) {
      if (!localOnly || !m.evolutionMessageId || m.id.startsWith("msg-") || m.id.startsWith("sim-")) {
        if (!candidateLocals.some((c) => c.id === m.id)) {
          candidateLocals.push(m);
        }
      }
    }
  };
  addCandidates(localSentMessagesBySession.get(sessionId), true);
  if (customerPhone) {
    const clean = customerPhone.replace(/\D/g, "");
    if (clean) {
      addCandidates(localSentMessagesBySession.get(clean), true);
      addCandidates(localSentMessagesBySession.get(`${clean}@s.whatsapp.net`), true);
    }
  }
  addCandidates(existingList, false);
  const claimedEvoIndices = /* @__PURE__ */ new Set();
  const nowMs = Date.now();
  for (const localMsg of candidateLocals) {
    const localTime = new Date(localMsg.timestamp).getTime();
    const localText = (localMsg.content || "").trim();
    let existingIdx = combined.findIndex((evo) => {
      if (evo.id === localMsg.id) return true;
      if (localMsg.evolutionMessageId && evo.evolutionMessageId === localMsg.evolutionMessageId) return true;
      return false;
    });
    if (existingIdx < 0 && !localMsg.evolutionMessageId) {
      existingIdx = combined.findIndex((evo, idx) => {
        if (claimedEvoIndices.has(idx)) return false;
        if (evo.sender !== "customer" && localMsg.sender !== "customer" && localText.length > 0 && (evo.content || "").trim() === localText && Math.abs(new Date(evo.timestamp).getTime() - localTime) < 45e3) {
          return true;
        }
        return false;
      });
      if (existingIdx >= 0) {
        claimedEvoIndices.add(existingIdx);
      }
    }
    if (existingIdx >= 0) {
      if (localMsg.quotedMessage && !combined[existingIdx].quotedMessage) {
        combined[existingIdx].quotedMessage = localMsg.quotedMessage;
      }
      if (localMsg.mediaUrl && !combined[existingIdx].mediaUrl) {
        combined[existingIdx].mediaUrl = localMsg.mediaUrl;
      }
    } else {
      if (localMsg.evolutionMessageId || !isFullEvoRefresh || nowMs - localTime < 25e3) {
        combined.push(localMsg);
      }
    }
  }
  combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const deduped = [];
  const seenConfirmedKeys = /* @__PURE__ */ new Set();
  for (const m of combined) {
    if (m.evolutionMessageId) {
      seenConfirmedKeys.add(`${m.sender}::${(m.content || "").trim()}`);
    }
  }
  for (const m of combined) {
    if (!m.evolutionMessageId && (m.id.startsWith("msg-") || m.id.startsWith("sim-"))) {
      const key = `${m.sender}::${(m.content || "").trim()}`;
      if (seenConfirmedKeys.has(key)) continue;
    }
    deduped.push(m);
  }
  return deduped;
}
async function loadEvolutionMessagesForChat(sessionId) {
  const conv = conversations.find((c) => c.sessionId === sessionId) || conversations.find(
    (c) => relatedJidsBySession.get(c.sessionId)?.has(sessionId) || c.customerPhone && sessionId.replace(/\D/g, "") === c.customerPhone
  );
  const canonicalId = conv?.sessionId || sessionId;
  const fallbackName = conv?.customerName || "Cliente";
  const otherSessionIds = new Set(
    conversations.filter((c) => c.sessionId !== canonicalId).map((c) => c.sessionId)
  );
  const rawSet = relatedJidsBySession.get(canonicalId) || /* @__PURE__ */ new Set([sessionId]);
  const jidSet = /* @__PURE__ */ new Set([canonicalId, sessionId]);
  for (const j of rawSet) {
    if (!otherSessionIds.has(j)) jidSet.add(j);
  }
  if (conv?.customerPhone) {
    const phoneJid = `${conv.customerPhone}@s.whatsapp.net`;
    if (!otherSessionIds.has(phoneJid)) {
      jidSet.add(phoneJid);
    }
  }
  try {
    const url = `${appConfig.evolution.serverUrl}/chat/findMessages/${appConfig.evolution.instance}`;
    const jidsToQuery = Array.from(jidSet).slice(0, 2);
    const responses = await Promise.all(
      jidsToQuery.map(
        (jid) => fetch(url, {
          method: "POST",
          headers: {
            apikey: appConfig.evolution.apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            where: { key: { remoteJid: jid } },
            limit: 35
          }),
          signal: AbortSignal.timeout(3e3)
        }).then((r) => r.ok ? r.json() : null).catch(() => null)
      )
    );
    const records = [];
    for (const data of responses) {
      if (!data) continue;
      const recs = data?.messages?.records || (Array.isArray(data) ? data : []);
      records.push(...recs);
    }
    if (conv) {
      for (const r of records) {
        if (r.key && !r.key.fromMe) {
          const pName = (r.pushName || "").trim();
          if (pName && pName !== "Voc\xEA" && !/^\d+$/.test(pName) && (!conv.customerName || conv.customerName === "Cliente" || conv.customerName.startsWith("Cliente +") || conv.customerName.startsWith("WhatsApp #") || /^\d+$/.test(conv.customerName))) {
            conv.customerName = pName;
          }
          if (r.key?.remoteJidAlt?.endsWith("@s.whatsapp.net")) {
            const altJid = r.key.remoteJidAlt;
            const altPhone = altJid.replace("@s.whatsapp.net", "").replace(/\D/g, "");
            if (altPhone) {
              lidToPhoneMap.set(sessionId, altPhone);
              lidToPhoneMap.set(sessionId.replace(/@.*$/, ""), altPhone);
              if (r.key.remoteJid) {
                lidToPhoneMap.set(r.key.remoteJid, altPhone);
                lidToPhoneMap.set(r.key.remoteJid.replace(/@.*$/, ""), altPhone);
              }
              if (conv.customerPhone.length > 12) {
                conv.customerPhone = altPhone;
              }
            }
            if (!otherSessionIds.has(altJid)) {
              const set = relatedJidsBySession.get(conv.sessionId) || /* @__PURE__ */ new Set([conv.sessionId]);
              set.add(altJid);
              relatedJidsBySession.set(conv.sessionId, set);
            }
          }
        }
      }
    }
    const parsedMessages = [];
    for (const rec of records) {
      const m = parseSingleEvolutionMessage(rec, conv?.customerName || fallbackName);
      if (m) parsedMessages.push(m);
    }
    parsedMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    const msgById = /* @__PURE__ */ new Map();
    for (const m of parsedMessages) {
      const k = m.evolutionMessageId || m.id;
      if (!seen.has(k)) {
        seen.add(k);
        unique.push(m);
        if (m.evolutionMessageId) msgById.set(m.evolutionMessageId, m);
        msgById.set(m.id, m);
      }
    }
    for (let i = 0; i < unique.length; i++) {
      const m = unique[i];
      if (m.quotedMessage && (!m.quotedMessage.text || m.quotedMessage.text.trim().length === 0)) {
        let parent;
        if (m.quotedMessage.id) {
          const qId = m.quotedMessage.id;
          parent = msgById.get(qId) || msgById.get(`evo-${qId}`) || msgById.get(qId.replace(/^evo-/, ""));
          if (!parent) {
            parent = unique.find(
              (cand, idx) => idx < i && !isInternalOrNoiseContent(cand.content) && (cand.id === qId || cand.evolutionMessageId === qId || cand.id.endsWith(qId) || cand.evolutionMessageId && cand.evolutionMessageId.endsWith(qId) || qId.endsWith(cand.id) || cand.evolutionMessageId && qId.endsWith(cand.evolutionMessageId))
            );
          }
        }
        if (parent) {
          m.quotedMessage.text = parent.transcription || parent.content || (parent.type === "image" ? "\u{1F4F7} Foto enviada anteriormente" : parent.type === "audio" ? "\u{1F3A4} Nota de voz anterior" : parent.type === "video" ? "\u{1F3A5} Video anterior" : "Mensaje anterior");
          m.quotedMessage.type = parent.type;
          m.quotedMessage.mediaUrl = parent.mediaUrl;
          m.quotedMessage.author = parent.sender === "customer" ? conv?.customerName || fallbackName : "Todo Lapto";
        } else {
          let foundSubstantive;
          let fallbackPrev;
          for (let j = i - 1; j >= 0; j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;
            if (prev.sender !== m.sender && (prev.transcription || prev.content)) {
              if (isSubstantiveProposal(prev)) {
                foundSubstantive = prev;
                break;
              }
              if (!fallbackPrev && prev.content.trim().length > 15) {
                fallbackPrev = prev;
              }
            }
          }
          const chosen = foundSubstantive || fallbackPrev;
          if (chosen) {
            m.quotedMessage.text = chosen.transcription || chosen.content;
            m.quotedMessage.type = chosen.type;
            m.quotedMessage.mediaUrl = chosen.mediaUrl;
            m.quotedMessage.author = chosen.sender === "customer" ? conv?.customerName || fallbackName : "Todo Lapto (Mensaje anterior)";
          }
        }
      }
      if (!m.quotedMessage && m.sender === "customer" && i > 0) {
        const txt = (m.transcription || m.content || "").trim();
        const isDeicticReply = /(te\s*acuerda[sn]?|se\s*acuerda[sn]?|recuerda[sn]?|te\s*recuerda[sn]?|sobre\s*esto|de\s*esto|esto\s*te\s*acuerda|acuerda[sn]?\s*de\s*esto|lo\s*que\s*hablamos|de\s*la\s*que\s*hablamos|lo\s*que\s*me\s*mostraste|todav[ií]a\s*(la|lo|las|los)?\s*tienen|cu[aá]nto\s*(cuesta|sale)|qu[eé]\s*precio|me\s*interesa|esa\s*misma|ese\s*mismo|la\s*quiero|dame\s*esa|aparte\s*esa)/i.test(
          txt
        );
        const numberRefMatch = txt.match(
          /^(?:la|el|opci[oó]n|modelo|n[uú]mero|#)\s*(\d{1,2})\b/i
        );
        if (numberRefMatch) {
          const itemNum = numberRefMatch[1];
          for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;
            if (prev.sender !== "customer" && prev.content.includes("Cat\xE1logo")) {
              const lines = prev.content.split("\n");
              const matchIdx = lines.findIndex(
                (l) => l.includes(`*${itemNum}.*`) || l.startsWith(`${itemNum}.`) || l.includes(`${itemNum}\uFE0F\u20E3`)
              );
              const snippet = matchIdx >= 0 ? lines.slice(matchIdx, matchIdx + 4).join("\n") : prev.content;
              m.quotedMessage = {
                id: prev.evolutionMessageId || prev.id,
                text: snippet,
                type: prev.type,
                author: "Todo Lapto (Cat\xE1logo)"
              };
              break;
            }
          }
        } else if (isDeicticReply) {
          let substantiveAnterior;
          let fallbackAnterior;
          for (let j = i - 1; j >= 0; j--) {
            const prev = unique[j];
            if (isInternalOrNoiseContent(prev.content)) continue;
            if (prev.sender !== "customer") {
              if (isSubstantiveProposal(prev)) {
                substantiveAnterior = prev;
                const isRepeatedAck = prev.content.startsWith("\xA1Claro que s\xED") || prev.content.startsWith("Claro, Sr.") || prev.content.includes("Recuerdo perfectamente");
                if (!isRepeatedAck) {
                  break;
                }
              } else if (!fallbackAnterior && prev.content.trim().length > 15) {
                fallbackAnterior = prev;
              }
            }
          }
          const target = substantiveAnterior || fallbackAnterior;
          if (target) {
            m.quotedMessage = {
              id: target.evolutionMessageId || target.id,
              text: target.transcription || target.content,
              type: target.type,
              mediaUrl: target.mediaUrl,
              author: "Todo Lapto (Propuesta y opciones conversadas anteriormente)"
            };
          }
        }
      }
    }
    const mergedMessages = mergeWithLocalMessages(
      canonicalId,
      unique,
      conv?.messages || [],
      conv?.customerPhone
    );
    if (conv && mergedMessages.length > 0) {
      conv.messages = mergedMessages;
      conv.messagesLoaded = true;
      const latest = mergedMessages[mergedMessages.length - 1];
      const hasLocalSent = (localSentMessagesBySession.get(canonicalId)?.length || 0) > 0;
      if (hasLocalSent && latest && new Date(latest.timestamp).getTime() > new Date(conv.lastTimestamp).getTime()) {
        conv.lastTimestamp = latest.timestamp;
        conv.lastMessagePreview = latest.content || conv.lastMessagePreview;
        conv.lastMessageType = latest.type;
      }
    }
    return mergedMessages;
  } catch {
    return mergeWithLocalMessages(canonicalId, [], conv?.messages || [], conv?.customerPhone);
  }
}
var isFirstEvolutionSync = true;
var inFlightBotKeys = /* @__PURE__ */ new Map();
var BOT_LOCK_TTL_MS = 9e4;
var lastFrontendHeartbeatMs = 0;
function recordFrontendHeartbeat() {
  lastFrontendHeartbeatMs = Date.now();
}
function isAiStudioIdleBackgroundContainer() {
  const isAiStudioContainer = Boolean(process.env.AISTUDIO_APPLET_ID);
  if (!isAiStudioContainer) return false;
  if (process.env.AISTUDIO_ALLOW_AUTO_REPLY !== "true") return true;
  if (!lastFrontendHeartbeatMs) return true;
  return Date.now() - lastFrontendHeartbeatMs > 2e4;
}
function isBotLockActive(key) {
  const lockedAt = inFlightBotKeys.get(key);
  if (!lockedAt) return false;
  if (Date.now() - lockedAt > BOT_LOCK_TTL_MS) {
    inFlightBotKeys.delete(key);
    return false;
  }
  return true;
}
var BOT_AUDIT_LOG_FILE = path.join(__dirname, ".vendema-bot-audit.json");
var botAuditLogs = [];
try {
  if (fs.existsSync(BOT_AUDIT_LOG_FILE)) {
    const raw = fs.readFileSync(BOT_AUDIT_LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      botAuditLogs = parsed.filter((item) => item?.decision !== "blocked_in_flight").slice(0, 300);
    }
  }
} catch {
  botAuditLogs = [];
}
var auditSaveTimeout = null;
function scheduleAuditLogSave() {
  if (auditSaveTimeout) return;
  auditSaveTimeout = setTimeout(() => {
    auditSaveTimeout = null;
    try {
      fs.writeFileSync(BOT_AUDIT_LOG_FILE, JSON.stringify(botAuditLogs.slice(0, 300), null, 2));
    } catch {
    }
  }, 1e3);
}
var lastAuditLogKeyByPhone = /* @__PURE__ */ new Map();
function recordBotAuditLog(entry) {
  const phone = entry.customerPhone || (entry.sessionId || "").replace(/@.*$/, "").replace(/\D/g, "");
  const dedupeKey = `${phone}::${entry.incomingMessageId || "none"}::${entry.decision}`;
  const now = Date.now();
  const prevAudit = lastAuditLogKeyByPhone.get(phone);
  if (prevAudit && prevAudit.key === dedupeKey && now - prevAudit.ts < 8e3) {
    return;
  }
  lastAuditLogKeyByPhone.set(phone, { key: dedupeKey, ts: now });
  const rdContext = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const item = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    timeRd: rdContext.time12,
    customerName: entry.customerName || `Cliente +${phone}`,
    customerPhone: phone,
    sessionId: entry.sessionId,
    triggerSource: entry.triggerSource,
    incomingMessageId: entry.incomingMessageId || "N/A",
    incomingText: (entry.incomingText || "").slice(0, 150),
    decision: entry.decision,
    reason: entry.reason,
    replyText: entry.replyText ? entry.replyText.slice(0, 200) : void 0,
    evolutionMessageId: entry.evolutionMessageId,
    durationMs: entry.durationMs
  };
  botAuditLogs.unshift(item);
  if (botAuditLogs.length > 300) {
    botAuditLogs.pop();
  }
  broadcastEvent("bot_audit_update", item);
  scheduleAuditLogSave();
}
function getConversationContactKeys(conv, extraPhone) {
  if (!conv) return extraPhone ? [extraPhone.replace(/\D/g, "")] : [];
  const keys = /* @__PURE__ */ new Set();
  if (conv.sessionId) {
    keys.add(conv.sessionId.toLowerCase().trim());
  }
  const cleanPhone = (conv.customerPhone || extraPhone || "").replace(/\D/g, "");
  if (cleanPhone) {
    keys.add(cleanPhone);
    if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      keys.add(std);
      keys.add(`${std}@s.whatsapp.net`);
      keys.add(std.slice(-10));
    }
  }
  if (conv.customerName && !isGenericContactName(conv.customerName)) {
    keys.add(`name:${conv.customerName.trim().toLowerCase()}`);
  }
  const related = relatedJidsBySession.get(conv.sessionId);
  if (related) {
    for (const r of related) {
      if (r) keys.add(r.toLowerCase().trim());
    }
  }
  return Array.from(keys);
}
var lastBotReplyByContactKey = /* @__PURE__ */ new Map();
var BOT_OUTBOUND_LOCKS_FILE = path.join(__dirname, ".vendema-outbound-locks.json");
function acquireCrossProcessBotLock(lockKeys, ttlMs = 45e3) {
  try {
    let data = {};
    if (fs.existsSync(BOT_OUTBOUND_LOCKS_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(BOT_OUTBOUND_LOCKS_FILE, "utf-8"));
      } catch {
        data = {};
      }
    }
    const now = Date.now();
    for (const [k, exp] of Object.entries(data)) {
      if (now > exp) delete data[k];
    }
    for (const key of lockKeys) {
      if (data[key] && now < data[key]) {
        return false;
      }
    }
    for (const key of lockKeys) {
      data[key] = now + ttlMs;
    }
    fs.writeFileSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data));
    return true;
  } catch {
    return true;
  }
}
function releaseCrossProcessBotLock(lockKeys) {
  try {
    if (fs.existsSync(BOT_OUTBOUND_LOCKS_FILE)) {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(BOT_OUTBOUND_LOCKS_FILE, "utf-8"));
      } catch {
        data = {};
      }
      for (const key of lockKeys) {
        delete data[key];
      }
      fs.writeFileSync(BOT_OUTBOUND_LOCKS_FILE, JSON.stringify(data));
    }
  } catch {
  }
}
function acquireBotLock(conv, triggerSource = "unknown") {
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    if (isBotLockActive(k)) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      const incomingId = lastMsg?.evolutionMessageId || lastMsg?.id || "";
      const incomingText = lastMsg?.content || "";
      recordBotAuditLog({
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: "blocked_in_flight",
        reason: "Ya hay una respuesta gener\xE1ndose concurrentemente para este contacto. Bloqueo at\xF3mico activo.",
        durationMs: 0
      });
      return false;
    }
  }
  if (!acquireCrossProcessBotLock(keys, BOT_LOCK_TTL_MS)) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    const incomingId = lastMsg?.evolutionMessageId || lastMsg?.id || "";
    const incomingText = lastMsg?.content || "";
    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: "blocked_in_flight",
      reason: "Ya hay una respuesta gener\xE1ndose en otro worker de Hostinger. Bloqueo multi-proceso activo.",
      durationMs: 0
    });
    return false;
  }
  const now = Date.now();
  for (const k of keys) {
    inFlightBotKeys.set(k, now);
  }
  return true;
}
function releaseBotLock(conv) {
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    inFlightBotKeys.delete(k);
  }
  releaseCrossProcessBotLock(keys);
}
function recordBotReplyForConversation(conv, customerMsgId, customerText, botReplyText) {
  const record = {
    timestamp: Date.now(),
    customerMsgId,
    customerText: (customerText || "").trim(),
    botReplyText: (botReplyText || "").trim()
  };
  const keys = getConversationContactKeys(conv);
  for (const k of keys) {
    lastBotReplyByContactKey.set(k, record);
  }
}
function isClosingCourtesyOrNonCommercialAck(rawText, hasQuote = false) {
  if (hasQuote) return false;
  const trimmed = (rawText || "").trim();
  if (!trimmed) return true;
  const withoutEmojis = trimmed.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "");
  if (withoutEmojis.length === 0) return true;
  if (/^https?:\/\/(www\.)?(youtu\.be|youtube\.com|tiktok\.com|vm\.tiktok\.com|instagram\.com|facebook\.com|fb\.watch)\/\S+$/i.test(
    trimmed
  )) {
    return true;
  }
  const cleaned = trimmed.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¡!¿?.,;:"'()\-_*~]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 55) return false;
  return /^(ok|okay|oki|ah ok|ah esta bien|esta bien|ta bien|perfecto|excelente|entendido|listo|dale|de acuerdo|vale|gracias|muchas gracias|mil gracias|amen|bendiciones|un placer|igualmente|igual|si|sii|lo se|ya|claro|bueno|bien|chevere|super|jaja|jajaja|jeje|dime|dimelo|dime a ver|cuentame|que paso|como asi|amor|mi amor|bb|bebe)(\s+(gracias|amigo|amiga|hermano|lider|bro|senor|sr|sra|jefe|equipo|todo lapto|mi amor|amor|carino|bb|bebe))?$/i.test(
    cleaned
  );
}
function shouldSkipBotReply(conv, lastCustomerMsg, triggerSource) {
  const keys = getConversationContactKeys(conv);
  const now = Date.now();
  const customerName = conv.customerName || "Cliente";
  const customerPhone = conv.customerPhone || "";
  const incomingId = normalizeMsgIdKey(lastCustomerMsg?.evolutionMessageId || lastCustomerMsg?.id || "");
  const incomingText = (lastCustomerMsg?.transcription || lastCustomerMsg?.content || "").trim();
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    const reason = "Excluido: Grupo de WhatsApp (el bot solo atiende chats individuales)";
    recordBotAuditLog({
      customerName,
      customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: "blocked_group",
      reason,
      durationMs: 0
    });
    return { skip: true, reason };
  }
  if (conv.messages && conv.messages.length > 0) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg.sender !== "customer" && triggerSource !== "manual_crm_trigger") {
      const reason = `El \xFAltimo mensaje en el chat ya fue respondido por el equipo o el bot ("${(lastMsg.content || "").slice(0, 40)}...")`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: "blocked_already_answered",
        reason,
        durationMs: 0
      });
      return { skip: true, reason };
    }
  }
  if (!lastCustomerMsg) {
    return { skip: true, reason: "No hay mensaje del cliente para responder" };
  }
  if (triggerSource !== "manual_crm_trigger" && incomingId && isMessageIdAlreadyProcessed(incomingId, keys)) {
    return { skip: true, reason: `Mensaje ID "${incomingId}" ya registrado como procesado.` };
  }
  if (triggerSource !== "manual_crm_trigger" && lastCustomerMsg.type === "text" && isClosingCourtesyOrNonCommercialAck(incomingText, Boolean(lastCustomerMsg.quotedMessage?.text))) {
    if (incomingId) {
      markMessageIdProcessed(incomingId, keys);
    }
    const reason = `Mensaje corto o confirmaci\xF3n ("${incomingText.slice(0, 35)}") que no requiere respuesta autom\xE1tica.`;
    recordBotAuditLog({
      customerName,
      customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: incomingId,
      incomingText,
      decision: "blocked_already_answered",
      reason,
      durationMs: 0
    });
    return { skip: true, reason };
  }
  for (const k of keys) {
    const prev = lastBotReplyByContactKey.get(k);
    if (!prev) continue;
    if (incomingId && (prev.customerMsgId === incomingId || prev.customerMsgId === `evo-${incomingId}` || `evo-${prev.customerMsgId}` === incomingId)) {
      const reason = `Mensaje ID "${incomingId}" ya fue atendido con \xE9xito anteriormente. Previniendo duplicado.`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: "blocked_duplicate_id",
        reason,
        durationMs: 0
      });
      return { skip: true, reason };
    }
    if (incomingText && prev.customerText && prev.customerText.toLowerCase() === incomingText.toLowerCase() && now - prev.timestamp < 2e4) {
      const reason = `Texto repetido "${incomingText.slice(0, 30)}" recibido hace menos de 20s. Ya existe respuesta en pantalla.`;
      recordBotAuditLog({
        customerName,
        customerPhone,
        sessionId: conv.sessionId,
        triggerSource,
        incomingMessageId: incomingId,
        incomingText,
        decision: "blocked_duplicate_text",
        reason,
        durationMs: 0
      });
      return { skip: true, reason };
    }
    if (triggerSource !== "manual_crm_trigger") {
      const elapsedMs = now - prev.timestamp;
      if (elapsedMs < 6e3) {
        const reason = `Cooldown de seguridad activo: se envi\xF3 una respuesta hace ${(elapsedMs / 1e3).toFixed(1)}s (m\xEDnimo 6s entre mensajes autom\xE1ticos).`;
        recordBotAuditLog({
          customerName,
          customerPhone,
          sessionId: conv.sessionId,
          triggerSource,
          incomingMessageId: incomingId,
          incomingText,
          decision: "blocked_cooldown",
          reason,
          durationMs: 0
        });
        return { skip: true, reason };
      }
    }
  }
  return { skip: false };
}
async function hasEvolutionAlreadyAnsweredSince(conv, customerMsg) {
  const customerTimeMs = new Date(customerMsg.timestamp).getTime();
  const customerEvoId = customerMsg.evolutionMessageId || customerMsg.id.replace(/^evo-/, "");
  if (conv.messages && conv.messages.length > 0) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.sender !== "customer") {
        const mTime = new Date(m.timestamp).getTime();
        if (mTime >= customerTimeMs - 3e3) {
          return { answered: true, latestOutgoing: m };
        }
      }
    }
  }
  const contactKeys = getConversationContactKeys(conv);
  const now = Date.now();
  for (const k of contactKeys) {
    const prevReply = lastBotReplyByContactKey.get(k);
    if (prevReply && now - prevReply.timestamp < 6e4) {
      if (prevReply.customerMsgId === customerEvoId || prevReply.customerMsgId === customerMsg.id) {
        return { answered: true };
      }
    }
  }
  if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) {
    return { answered: false };
  }
  try {
    const url = `${appConfig.evolution.serverUrl.replace(/\/$/, "")}/chat/findMessages/${appConfig.evolution.instance}`;
    const jids = /* @__PURE__ */ new Set([conv.sessionId]);
    const cleanPhone = (conv.customerPhone || "").replace(/\D/g, "");
    if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
      const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
      jids.add(`${std}@s.whatsapp.net`);
    }
    const responses = await Promise.all(
      Array.from(jids).slice(0, 2).map(
        (jid) => fetch(url, {
          method: "POST",
          headers: {
            apikey: appConfig.evolution.apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            where: { key: { remoteJid: jid } },
            limit: 10
          }),
          signal: AbortSignal.timeout(7e3)
        }).then((r) => r.ok ? r.json() : null).catch(() => null)
      )
    );
    const records = [];
    for (const data of responses) {
      if (!data) continue;
      const recs = data?.messages?.records || (Array.isArray(data) ? data : []);
      records.push(...recs);
    }
    if (records.length === 0) return { answered: false };
    const parsed = [];
    for (const rec of records) {
      const m = parseSingleEvolutionMessage(rec, conv.customerName || "Cliente");
      if (m) parsed.push(m);
    }
    if (parsed.length === 0) return { answered: false };
    const unique = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const m of parsed) {
      const k = m.evolutionMessageId || m.id;
      if (!seenIds.has(k)) {
        seenIds.add(k);
        unique.push(m);
      }
    }
    unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let addedAny = false;
    for (const m of unique) {
      if (!conv.messages.some(
        (existing) => m.evolutionMessageId && existing.evolutionMessageId === m.evolutionMessageId || existing.id === m.id
      )) {
        conv.messages.push(m);
        addedAny = true;
      }
    }
    if (addedAny) {
      conv.messages = mergeWithLocalMessages(conv.sessionId, unique, conv.messages, conv.customerPhone);
      const newest = conv.messages[conv.messages.length - 1];
      if (newest) {
        conv.lastTimestamp = newest.timestamp;
        conv.lastMessagePreview = newest.content;
        conv.lastMessageType = newest.type;
      }
      broadcastEvent("conversations_update", { count: conversations.length });
    }
    const customerTimeMs2 = new Date(customerMsg.timestamp).getTime();
    const customerEvoId2 = customerMsg.evolutionMessageId || customerMsg.id.replace(/^evo-/, "");
    const customerIdx = unique.findIndex(
      (m) => m.evolutionMessageId === customerEvoId2 || m.id === customerMsg.id
    );
    if (customerIdx >= 0) {
      const outgoingAfter = unique.slice(customerIdx + 1).find((m) => m.sender !== "customer");
      if (outgoingAfter) {
        return { answered: true, latestOutgoing: outgoingAfter };
      }
    }
    const outgoingRecent = unique.filter(
      (m) => m.sender !== "customer" && m.evolutionMessageId !== customerEvoId2 && new Date(m.timestamp).getTime() >= customerTimeMs2 - 1500
    ).pop();
    if (outgoingRecent) {
      return { answered: true, latestOutgoing: outgoingRecent };
    }
    return { answered: false };
  } catch {
    const contactKeys2 = getConversationContactKeys(conv);
    const now2 = Date.now();
    for (const k of contactKeys2) {
      const cleanK = k.replace(/@.*$/, "").replace(/\D/g, "") || k;
      for (const [key, ts] of recentOutboundDispatches.entries()) {
        if (key.startsWith(`${cleanK}::`) && now2 - ts < 6e4) {
          return { answered: true };
        }
      }
    }
    return { answered: false };
  }
  return { answered: false };
}
var recentOutboundDispatches = /* @__PURE__ */ new Map();
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isWhatsAppGroup(targetOrJid) {
  if (!targetOrJid) return false;
  const t = targetOrJid.toLowerCase().trim();
  return t.includes("@g.us") || t.includes("-") && t.endsWith("@g.us") || t.includes("@broadcast") || t === "status@broadcast" || t.includes("newsletter");
}
function normalizeEvolutionTarget(numberOrJid) {
  const raw = (numberOrJid || "").trim();
  if (!raw) return "";
  if (isWhatsAppGroup(raw)) return "";
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 14) {
    return `${digits}@lid`;
  }
  if (digits.length === 10 && /^(809|829|849)/.test(digits)) {
    return `1${digits}`;
  }
  return digits;
}
async function sendEvolutionMessageWithStatus(numberOrJid, text, delayMs = 500) {
  if (isWhatsAppGroup(numberOrJid)) {
    console.log(`\u{1F6E1}\uFE0F [Grupo bloqueado]: Env\xEDo a grupo cancelado (${numberOrJid})`);
    return { ok: false, socketClosed: false };
  }
  const target = normalizeEvolutionTarget(numberOrJid);
  if (!target || isWhatsAppGroup(target)) {
    return { ok: false, socketClosed: false };
  }
  const cleanTargetKey = target.replace(/@.*$/, "").replace(/\D/g, "") || target;
  const dispatchKey = `${cleanTargetKey}::${text.trim()}`;
  const lastSentAt = recentOutboundDispatches.get(dispatchKey);
  const now = Date.now();
  if (lastSentAt && now - lastSentAt < 9e4) {
    console.log(
      `\u{1F6E1}\uFE0F [Outbound Anti-Duplicate]: Mensaje id\xE9ntico ya entregado a ${target} hace ${Math.round(
        (now - lastSentAt) / 1e3
      )}s. Omitiendo duplicado.`
    );
    recordBotAuditLog({
      customerName: `Destino ${target}`,
      customerPhone: cleanTargetKey,
      sessionId: target,
      triggerSource: "outbound_dispatch_guard",
      incomingMessageId: "",
      incomingText: "",
      decision: "blocked_duplicate_text",
      reason: `Texto de respuesta id\xE9ntico ya entregado hace ${Math.round((now - lastSentAt) / 1e3)}s a este n\xFAmero. Duplicado bloqueado en despacho.`,
      replyText: text,
      durationMs: 0
    });
    return { ok: true, socketClosed: false };
  }
  recentOutboundDispatches.set(dispatchKey, now);
  const url = `${appConfig.evolution.serverUrl.replace(/\/$/, "")}/message/sendText/${appConfig.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        number: target,
        text,
        delay: delayMs
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const messageId = data?.key?.id || data?.id || "";
      recentOutboundDispatches.set(dispatchKey, Date.now());
      appConfig.evolution.connected = true;
      return { ok: true, socketClosed: false, messageId };
    }
    const errBody = await res.text().catch(() => "");
    const isSocketClosed = /Connection Closed|Connection Failure|Timed Out|Stream Errored|Precondition Required/i.test(errBody) || res.status >= 500;
    return { ok: false, socketClosed: isSocketClosed };
  } catch {
    return { ok: false, socketClosed: true };
  }
}
async function sendEvolutionMessage(numberOrJid, text, delayMs = 500) {
  const res = await sendEvolutionMessageWithStatus(numberOrJid, text, delayMs);
  return res.ok;
}
async function sendEvolutionMessageToConversation(conv, text, delayMs = 600) {
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`\u{1F6E1}\uFE0F [Grupo bloqueado]: Env\xEDo a grupo cancelado para sesi\xF3n ${conv.sessionId}`);
    return { ok: false };
  }
  const cleanPhone = (conv.customerPhone || "").replace(/\D/g, "");
  let primaryTarget = "";
  if (cleanPhone.length >= 10 && cleanPhone.length <= 13) {
    const std = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    primaryTarget = `${std}@s.whatsapp.net`;
  } else if (conv.sessionId && !conv.sessionId.includes("@lid")) {
    primaryTarget = conv.sessionId;
  } else if (cleanPhone) {
    primaryTarget = cleanPhone;
  } else {
    primaryTarget = conv.sessionId;
  }
  const contactKeys = getConversationContactKeys(conv);
  const now = Date.now();
  const trimmedText = text.trim();
  for (const k of contactKeys) {
    const cleanK = k.replace(/@.*$/, "").replace(/\D/g, "") || k;
    const prevSent = recentOutboundDispatches.get(`${cleanK}::${trimmedText}`);
    if (prevSent && now - prevSent < 9e4) {
      console.log(`\u{1F6E1}\uFE0F [Outbound Contact Guard]: Texto id\xE9ntico ya despachado a ${conv.customerName} (${k}) hace ${Math.round((now - prevSent) / 1e3)}s.`);
      return { ok: true };
    }
  }
  for (const k of contactKeys) {
    const cleanK = k.replace(/@.*$/, "").replace(/\D/g, "") || k;
    recentOutboundDispatches.set(`${cleanK}::${trimmedText}`, now);
  }
  const result = await sendEvolutionMessageWithStatus(primaryTarget, text, delayMs);
  for (const k of contactKeys) {
    const cleanK = k.replace(/@.*$/, "").replace(/\D/g, "") || k;
    recentOutboundDispatches.set(`${cleanK}::${trimmedText}`, Date.now());
  }
  if (result.ok) {
    console.log(`\u2705 [WhatsApp Bot Sent]: Respuesta entregada a ${conv.customerName} (${primaryTarget}) [ID: ${result.messageId || "N/A"}]`);
    return { ok: true, messageId: result.messageId };
  }
  return { ok: false };
}
async function sendEvolutionMedia(numberOrJid, mediatype, mimetype, base64Data, caption, fileName) {
  const target = numberOrJid.includes("@") ? numberOrJid : numberOrJid.replace(/\D/g, "");
  const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
  const url = `${appConfig.evolution.serverUrl}/message/sendMedia/${appConfig.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        number: target,
        mediatype,
        mimetype,
        caption: caption || "",
        media: cleanBase64,
        fileName: fileName || `archivo.${mediatype === "image" ? "jpg" : mediatype === "video" ? "mp4" : "pdf"}`
      })
    });
    return res.ok;
  } catch (err) {
    console.log(`[Evolution API Send Media Info]: ${err.message}`);
    return false;
  }
}
async function sendEvolutionAudio(numberOrJid, base64Audio) {
  const target = numberOrJid.includes("@") ? numberOrJid : numberOrJid.replace(/\D/g, "");
  const cleanBase64 = base64Audio.replace(/^data:[^;]+;base64,/, "");
  const url = `${appConfig.evolution.serverUrl}/message/sendWhatsAppAudio/${appConfig.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        number: target,
        audio: cleanBase64,
        delay: 500
      })
    });
    return res.ok;
  } catch (err) {
    console.log(`[Evolution API Send Audio Info]: ${err.message}`);
    return false;
  }
}
async function fetchMediaBase64FromEvolution(messageId, convertToMp4 = false) {
  const cacheKey = `${messageId}_${convertToMp4}`;
  if (mediaCache.has(cacheKey)) {
    const cached = mediaCache.get(cacheKey);
    return { ...cached, base64: cached.buffer.toString("base64") };
  }
  const url = `${appConfig.evolution.serverUrl}/chat/getBase64FromMediaMessage/${appConfig.evolution.instance}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        message: { key: { id: messageId } },
        convertToMp4
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.base64) return null;
    const buffer = Buffer.from(data.base64, "base64");
    const mimetype = data.mimetype || (convertToMp4 ? "video/mp4" : "application/octet-stream");
    if (mediaCache.size > 50) {
      const firstKey = mediaCache.keys().next().value;
      if (firstKey) mediaCache.delete(firstKey);
    }
    mediaCache.set(cacheKey, { buffer, mimetype });
    return { buffer, mimetype, base64: data.base64 };
  } catch (err) {
    console.error(`[Evolution Media Fetch Error for ${messageId}]:`, err.message);
    return null;
  }
}
function formatWhatsAppProductBlock(p, idx) {
  const condBadge = p.condition === "Nuevo" ? "\u2728 Nuevo de Caja (Garant\xEDa 1 a\xF1o)" : "\u267B\uFE0F Reacondicionado Clase A (Garant\xEDa 6 meses)";
  const specsLine = p.specsSummary || p.description_sale ? `
\u2699\uFE0F ${p.specsSummary || p.description_sale}` : "";
  const useLine = p.useCases && p.useCases.length > 0 ? `
\u{1F3AF} Ideal para: ${p.useCases.join(" \xB7 ")}` : "";
  const url = p.website_url ? `
\u{1F517} https://todolapto.com.do${p.website_url}` : "";
  return `*${idx + 1}.* *${p.name}*
\u{1F4B0} RD$${p.list_price.toLocaleString()} | \u{1F4E6} ${p.virtual_available} unidad(es) | \u{1F3F7}\uFE0F ${condBadge}${specsLine}${useLine}${url}`;
}
function extractBudgetQuery(text) {
  if (!text) return null;
  const s = text.toLowerCase().replace(/\bcuatro\s+mil\b/g, "4000").replace(/\bcinco\s+mil\b/g, "5000").replace(/\bseis\s+mil\b/g, "6000").replace(/\bsiete\s+mil\b/g, "7000").replace(/\bocho\s+mil\b/g, "8000").replace(/\bnueve\s+mil\b/g, "9000").replace(/\bdiez\s+mil\b/g, "10000").replace(/\bonce\s+mil\b/g, "11000").replace(/\bdoce\s+mil\b/g, "12000").replace(/\btrece\s+mil\b/g, "13000").replace(/\bcatorce\s+mil\b/g, "14000").replace(/\bquince\s+mil\b/g, "15000").replace(/\bdieciseis\s+mil\b/g, "16000").replace(/\bdiecisiete\s+mil\b/g, "17000").replace(/\bdieciocho\s+mil\b/g, "18000").replace(/\bdiecinueve\s+mil\b/g, "19000").replace(/\bveinte\s+mil\b/g, "20000").replace(/\bveinticinco\s+mil\b/g, "25000").replace(/\btreinta\s+mil\b/g, "30000");
  if (/\b(m[aá]s\s+econ[oó]mica|m[aá]s\s+barata|algo\s+econ[oó]mico|laptop\s+econ[oó]mica|laptops\s+econ[oó]micas|baratas|econ[oó]micas)\b/i.test(s)) {
    return {
      min: 3500,
      max: 9e3,
      target: 6e3,
      label: "Gama Econ\xF3mica (RD$4,000 a RD$9,000)"
    };
  }
  const parseAmount = (rawNum, hasMilSuffix) => {
    const cleaned = rawNum.replace(/[,.\s]/g, "");
    let val = parseFloat(cleaned);
    if (isNaN(val)) return 0;
    if (hasMilSuffix && val < 1e3) val *= 1e3;
    return val;
  };
  const rangeMatch = s.match(
    /(?:entre|de)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?\s*(?:y|a|-|hasta)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?/i
  );
  if (rangeMatch) {
    const hasMil2 = Boolean(rangeMatch[4]);
    const hasMil1 = Boolean(rangeMatch[2]) || hasMil2 && Number(rangeMatch[1]) < 100;
    const v1 = parseAmount(rangeMatch[1], hasMil1);
    const v2 = parseAmount(rangeMatch[3], hasMil2);
    if (v1 >= 500 && v2 >= 1e3 && v2 >= v1) {
      return {
        min: v1,
        max: v2 + 1e3,
        target: Math.round((v1 + v2) / 2),
        label: `Rango solicitado: RD$${v1.toLocaleString()} a RD$${v2.toLocaleString()}`
      };
    }
  }
  const maxMatch = s.match(
    /(?:menos de|hasta|m[aá]ximo|no pase de|por debajo de|tope de)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k)?/i
  );
  if (maxMatch) {
    const v = parseAmount(maxMatch[1], Boolean(maxMatch[2]));
    if (v >= 1e3 && v <= 15e4) {
      return {
        min: 1e3,
        max: v + 500,
        target: v,
        label: `Presupuesto m\xE1ximo hasta RD$${v.toLocaleString()}`
      };
    }
  }
  const targetMatch = s.match(
    /(?:tengo|presupuesto(?: de)?|busco(?: algo| una| un)? de|laptop de|computadora de|equipo de|como de|alrededor de|por|con|de|en)\s*(?:rd\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{1,6})\s*(mil|k|pesos|dop)?/i
  ) || s.match(/(?:rd\$|\$)\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(mil|k|pesos)?/i) || s.match(/\b(\d{1,2})\s*(mil|k)\s*(?:pesos|dop)?\b/i) || s.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(?:pesos|dop)\b/i);
  if (targetMatch) {
    const suffix = (targetMatch[2] || "").toLowerCase();
    const isMil = suffix === "mil" || suffix === "k";
    const v = parseAmount(targetMatch[1], isMil);
    if (v >= 2500 && v <= 15e4) {
      const min = Math.max(2e3, Math.round(v * 0.72));
      const max = v + 2200;
      return {
        min,
        max,
        target: v,
        label: `Presupuesto de RD$${v.toLocaleString()} (mostrando opciones desde RD$${min.toLocaleString()} hasta RD$${max.toLocaleString()})`
      };
    }
  }
  return null;
}
function detectRequestedBrandOrLine(text) {
  if (!text) return null;
  const s = text.toLowerCase();
  if (/\bthinkpad\b/i.test(s)) {
    return {
      label: "Lenovo ThinkPad",
      matcher: (p) => /thinkpad/i.test(p.name)
    };
  }
  if (/\blatitude\b/i.test(s)) {
    return {
      label: "Dell Latitude",
      matcher: (p) => /latitude/i.test(p.name)
    };
  }
  if (/\bprobook\b/i.test(s)) {
    return {
      label: "HP ProBook",
      matcher: (p) => /probook/i.test(p.name)
    };
  }
  if (/\belitebook\b/i.test(s)) {
    return {
      label: "HP EliteBook",
      matcher: (p) => /elitebook/i.test(p.name)
    };
  }
  if (/\bideapad\b/i.test(s)) {
    return {
      label: "Lenovo IdeaPad",
      matcher: (p) => /ideapad/i.test(p.name)
    };
  }
  if (/\bchromebook\b|\bchrobook\b/i.test(s)) {
    return {
      label: "Chromebooks",
      matcher: (p) => /chromebook|chrobook|c203x|c771/i.test(`${p.name} ${p.description_sale || ""}`)
    };
  }
  if (/\bdell\b/i.test(s)) {
    return {
      label: "Marca Dell",
      matcher: (p) => (p.brand || "").toLowerCase() === "dell" || /\bdell\b|\blatitude\b|\binspiron\b/i.test(p.name)
    };
  }
  if (/\blenovo\b/i.test(s)) {
    return {
      label: "Marca Lenovo",
      matcher: (p) => ((p.brand || "").toLowerCase() === "lenovo" || /\blenovo\b|\bthinkpad\b|\bideapad\b|\byoga\b|\bthinkcentro\b/i.test(p.name)) && !/\bedu\s*gear\b/i.test(p.name)
    };
  }
  if (/\bhp\b|\bhewlett\b/i.test(s)) {
    return {
      label: "Marca HP",
      matcher: (p) => (p.brand || "").toLowerCase() === "hp" || /\bhp\b|\bprobook\b|\belitebook\b|\benvy\b|\bstream\b/i.test(p.name)
    };
  }
  if (/\basus\b/i.test(s)) {
    return {
      label: "Marca Asus",
      matcher: (p) => (p.brand || "").toLowerCase() === "asus" || /\basus\b|\bc203x\b/i.test(p.name)
    };
  }
  if (/\bacer\b/i.test(s)) {
    return {
      label: "Marca Acer",
      matcher: (p) => (p.brand || "").toLowerCase() === "acer" || /\bacer\b|\bc771\b/i.test(p.name)
    };
  }
  if (/\bapple\b|\bmacbook\b|\bmac\b/i.test(s)) {
    return {
      label: "Marca Apple / MacBook",
      matcher: (p) => (p.brand || "").toLowerCase() === "apple" || /\bapple\b|\bmacbook\b|\bipad\b|\biphone\b/i.test(p.name)
    };
  }
  if (/\bedu\s*gear\b/i.test(s)) {
    return {
      label: "EDU GEAR",
      matcher: (p) => /\bedu\s*gear\b/i.test(p.name)
    };
  }
  return null;
}
function detectRequestedUseCase(text) {
  if (!text) return null;
  const s = text.toLowerCase();
  if (/\b(gamer|gamers|gaming|juego|juegos|jugar|free\s*fire|roblox|fortnite|gta|valorant|stream|streaming)\b/i.test(s)) {
    return {
      id: "gaming",
      label: "Gaming / Juegos y Alto Rendimiento",
      pitch: "Equipos con procesadores potentes (Intel Core i5 Serie H / Core i7 de 10ma Gen, 8GB a 16GB de RAM y discos SSD ultrarr\xE1pidos) capaces de mover juegos y tareas exigentes con fluidez.",
      matcher: (p) => p.category === "laptop" && Boolean(
        p.useCases?.some((u) => u.toLowerCase().includes("gaming")) || /\b10300h\b|\benvy\b|\bi7\b|\b5420\b|\b5510\b|\b5511\b|\b5310\b|\b850\s*g4\b/i.test(
          `${p.name} ${p.specsSummary || ""}`
        )
      )
    };
  }
  if (/\b(programar|programaci[oó]n|programador|desarrollo|software|ingenier[ií]a|arquitectura|autocad|dise[ñn]o|edici[oó]n|render|multitarea\s*pesada)\b/i.test(s)) {
    return {
      id: "programacion",
      label: "Programaci\xF3n, Ingenier\xEDa, Dise\xF1o y Multitarea Avanzada",
      pitch: "Laptops empresariales de alto desempe\xF1o con procesadores Intel Core i5 (8va/10ma/11va Gen) e Intel Core i7, 8GB a 16GB de RAM y almacenamiento SSD NVMe.",
      matcher: (p) => p.category === "laptop" && Boolean(
        p.useCases?.some((u) => u.toLowerCase().includes("programaci\xF3n")) || p.list_price >= 15e3
      )
    };
  }
  if (/\b(oficina|trabajo|trabajar|negocio|negocios|contabilidad|facturar|facturaci[oó]n|empresa|empresarial|administrativo|secretaria|excel|word|office|universidad|universitario|tesis)\b/i.test(s)) {
    return {
      id: "oficina",
      label: "Oficina, Trabajo, Negocios, Contabilidad y Universidad",
      pitch: "L\xEDneas empresariales (Dell Latitude, Lenovo ThinkPad, HP ProBook/EliteBook e IdeaPad) con procesadores Intel Core i3/i5/i7, 8GB+ RAM y SSD, dise\xF1adas para trabajar largas jornadas con Excel, sistemas de facturaci\xF3n, oficina y universidad.",
      matcher: (p) => p.category === "laptop" && Boolean(p.useCases?.some((u) => u.toLowerCase().includes("oficina"))) && !/chromebook|chrobook|edu\s*gear|c203x|c771/i.test(p.name)
    };
  }
  if (/\b(estudio|estudiar|estudios|escuela|escolar|colegio|ni[ñn]o|ni[ñn]a|hijo|hija|tareas|clases\s*virtuales|b[aá]sico|basico|navegar|youtube)\b/i.test(s)) {
    return {
      id: "estudios",
      label: "Estudios, Escuela, Clases Virtuales y Uso Diario",
      pitch: "Equipos resistentes, ligeros y econ\xF3micos ideales para clases virtuales, tareas escolares, investigaci\xF3n web y uso estudiantil desde RD$4,000.",
      matcher: (p) => p.category === "laptop" && Boolean(p.useCases?.some((u) => u.toLowerCase().includes("estudios"))) && p.list_price <= 15e3
    };
  }
  return null;
}
function isCableOrWiringItem(name, odooCateg = "") {
  const combined = `${name} ${odooCateg}`.toLowerCase();
  return /\b(cable\b|cables\b|cord[oó]n|cordones\b|patch\s*cord|cable\s*hdmi|hdmi\s*cable|cable\s*de\s*poder|cable\s*poder|power\s*cable|cable\s*vga|vga\s*cable|cable\s*usb|usb\s*cable|cable\s*tipo\s*c|type\s*c\s*cable|cable\s*lightning|cable\s*red|cable\s*rj45|cable\s*utp|adaptador\s*cable|extensi[oó]n\s*usb|extensi[oó]n\s*el[eé]ctrica|conector\s*cable)\b/i.test(
    combined
  );
}
function detectGenericProductFamily(query) {
  if (!query) return null;
  const s = query.toLowerCase();
  if (/\b(mouse|mouses|rat[oó]n|ratones)\b/i.test(s) && !/\b(pad|alfombrilla)\b/i.test(s)) {
    return {
      id: "mouse",
      label: "Mouse y Ratones",
      matcher: (p) => {
        const combined = `${p.name} ${p.odooCategory || ""}`.toLowerCase();
        const hasMouse = /\b(mouse|mouses|rat[oó]n|ratones)\b/i.test(combined);
        const isPadOnly = /\b(mouse\s*pad|pad\s*mouse|alfombrilla)\b/i.test(combined) && !/\b(con\s*mouse|combo\s*mouse|\+\s*mouse|mouse\s*optico|mouse\s*inalambrico|mouse\s*gamer)\b/i.test(combined);
        return hasMouse && !isPadOnly;
      }
    };
  }
  if (/\b(cartucho|cartuchos|tinta|tintas|toner|t[oó]ner|botella\s*de\s*tinta)\b/i.test(s)) {
    return {
      id: "tinta_cartucho",
      label: "Cartuchos, Tintas y T\xF3ner para Impresora",
      matcher: (p) => isPrinterSupplyOrConsumable(p.name, p.odooCategory)
    };
  }
  if (/\b(impresora|impresoras|printer|printers|multifuncional|multifuncionales)\b/i.test(s)) {
    return {
      id: "impresora",
      label: "Impresoras y Equipos de Impresi\xF3n",
      matcher: (p) => isActualPrinterMachine(p.name, p.odooCategory)
    };
  }
  if (/\b(teclado|teclados|keyboard|keyboards)\b/i.test(s)) {
    return {
      id: "teclado",
      label: "Teclados y Combos de Teclado",
      matcher: (p) => {
        const combined = `${p.name} ${p.odooCategory || ""}`.toLowerCase();
        const isTeclado = /\b(teclado|teclados|keyboard|keyboards)\b/i.test(combined);
        const isInternalPart = /\b(repuesto|interno|cinta\s*teclado|para\s*(?:dell|hp|lenovo|latitude|thinkpad)\s*(?:e\d{4}|\d{4}|g\d))\b/i.test(
          p.name
        );
        return isTeclado && !isInternalPart;
      }
    };
  }
  if (/\b(monitor|monitores|pantalla\s*de\s*pc|pantalla\s*para\s*pc|pantallas\s*pc)\b/i.test(s)) {
    return {
      id: "monitor",
      label: "Monitores y Pantallas",
      matcher: (p) => p.category === "monitor" || /\b(monitor|monitores)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(bocina|bocinas|speaker|speakers|parlante|parlantes)\b/i.test(s)) {
    return {
      id: "bocina",
      label: "Bocinas y Speakers",
      matcher: (p) => /\b(bocina|bocinas|speaker|speakers|parlante|parlantes|soundbar)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(audifonos|audífonos|headset|headsets|auricular|auriculares)\b/i.test(s)) {
    return {
      id: "audifonos",
      label: "Aud\xEDfonos y Headsets",
      matcher: (p) => /\b(audifono|audifonos|audífono|audífonos|headset|headsets|auricular|auriculares)\b/i.test(
        `${p.name} ${p.odooCategory || ""}`
      )
    };
  }
  if (/\b(cargador|cargadores|charger|fuente\s*de\s*poder\s*laptop)\b/i.test(s)) {
    return {
      id: "cargador",
      label: "Cargadores y Fuentes de Laptop",
      matcher: (p) => /\b(cargador|cargadores|charger|power\s*adapter)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(mochila|mochilas|bulto|bultos|malet[ií]n|maletines|funda\s*laptop)\b/i.test(s)) {
    return {
      id: "mochila",
      label: "Mochilas, Bultos y Maletines",
      matcher: (p) => /\b(mochila|mochilas|bulto|bultos|malet[ií]n|maletines|backpack|funda)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(disco\s*solido|disco\s*sólido|disco\s*duro|ssd|nvme|m\.2|disco\s*externo)\b/i.test(s)) {
    return {
      id: "disco",
      label: "Discos SSD, NVMe y Discos Duros",
      matcher: (p) => /\b(ssd|disco\s*solido|disco\s*sólido|disco\s*duro|nvme|m\.2)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(memoria\s*ram|memorias\s*ram|ram|ddr3|ddr4|ddr5)\b/i.test(s) && !/\b(disco|ssd|laptop)\b/i.test(s)) {
    return {
      id: "ram",
      label: "Memorias RAM (Laptop y PC)",
      matcher: (p) => /\b(ram|memoria\s*ram|ddr3|ddr4|ddr5|pc3|pc4)\b/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(tablet|tablets|ipad|ipads)\b/i.test(s)) {
    return {
      id: "tablet",
      label: "Tablets e iPads",
      matcher: (p) => /tablet|ipad|galaxy tab|fire 8|tab 910|alcatel 1t/i.test(`${p.name} ${p.odooCategory || ""}`)
    };
  }
  if (/\b(repetidor|repetidores|router|routers|antena\s*wifi|switch\s*de\s*red|access\s*point)\b/i.test(s)) {
    return {
      id: "red",
      label: "Repetidores, Routers y Equipos de Red",
      matcher: (p) => p.category === "red" || /\b(repetidor|repetidores|router|routers|wifi|antena|access\s*point|switch)\b/i.test(
        `${p.name} ${p.odooCategory || ""}`
      )
    };
  }
  if (/\b(cable|cables|cord[oó]n|cordones|patch\s*cord|cable\s*hdmi|cable\s*vga|cable\s*de\s*poder|cable\s*usb|adaptador\s*hdmi)\b/i.test(s)) {
    return {
      id: "cable",
      label: "Cables, Cordones y Adaptadores",
      isCable: true,
      matcher: (p) => isCableOrWiringItem(p.name, p.odooCategory)
    };
  }
  if (/\b(laptop|laptops|lapto|laptos|portatil|portatiles|portátil|portátiles|computadora\s*portatil|notebook|notebooks)\b/i.test(s)) {
    return {
      id: "laptop",
      label: "Laptops y Equipos Port\xE1tiles",
      matcher: (p) => p.category === "laptop"
    };
  }
  return null;
}
function getRelevantProductsHighlight(latestQueryText, fullContextText = "") {
  if (!latestQueryText && !fullContextText || products.length === 0) return "";
  const userOnlyLatest = latestQueryText.replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:/gi, "").trim();
  const cleanLatest = userOnlyLatest.toLowerCase();
  const inStock = products.filter((p) => p.virtual_available > 0 && p.list_price > 1);
  const laptopsInStock = [...inStock.filter((p) => p.category === "laptop")].sort(
    (a, b) => a.list_price - b.list_price
  );
  const sections = [];
  const brandFilter = detectRequestedBrandOrLine(userOnlyLatest);
  const budgetFilter = extractBudgetQuery(userOnlyLatest);
  const useCaseFilter = detectRequestedUseCase(userOnlyLatest);
  const genericFamily = detectGenericProductFamily(cleanLatest);
  const asksCondition = /\b(nuevo|nueva|nuevos|nuevas|usado|usada|usados|usadas|reacondicionado|reacondicionada|refurbished|de\s*caja|segunda\s*mano|condici[oó]n|estado\s*del\s*equipo)\b/i.test(
    cleanLatest
  );
  const wantsOnlyNew = /\b(solo\s*nuev[oa]s?|tienen\s*nuev[oa]s?|quiero\s*una?\s*nuev[oa]|busco\s*nuev[oa]|nuev[oa]\s*de\s*caja)\b/i.test(
    cleanLatest
  ) && !/\b(o\s*usad[oa]|usad[oa]\s*o\s*nuev[oa])\b/i.test(cleanLatest);
  if (asksCondition) {
    const newProducts = inStock.filter((p) => p.condition === "Nuevo");
    const usedLaptops = laptopsInStock.filter((p) => p.condition === "Usado / Reacondicionado");
    const newLaptops = laptopsInStock.filter((p) => p.condition === "Nuevo");
    sections.push(
      `=== \u{1F3AF} CONTEXTO OFICIAL DE CONDICI\xD3N DE PRODUCTOS EN ODOO (NUEVO VS USADO / REACONDICIONADO) ===
- En Todo Lapto manejamos la condici\xF3n real marcada en Odoo para cada producto:
  1. **Laptops Corporativas Importadas (Usadas / Reacondicionadas Clase A \u2014 ${usedLaptops.length} modelos en stock):** Todas pasan por una prueba t\xE9cnica rigurosa de 25 puntos (bater\xEDa, pantalla, teclado, disco SSD, memoria RAM), est\xE1n en excelente estado f\xEDsico y funcional, e incluyen **6 meses de garant\xEDa directa** en nuestra tienda f\xEDsica de la Av. Charles de Gaulle No. 133.
  2. **Equipos Nuevos de Caja (${newLaptops.length} laptops nuevas y ${newProducts.length} accesorios nuevos en stock):** Incluyen **1 a\xF1o de garant\xEDa**.
- Si el cliente pregunta si un modelo espec\xEDfico o nuestro cat\xE1logo es nuevo o usado, resp\xF3ndele con total honestidad y claridad indicando su condici\xF3n exacta en Odoo (${newLaptops.length > 0 ? `Laptops marcadas como Nuevas: ${newLaptops.map((p) => `${p.name} (RD$${p.list_price.toLocaleString()})`).join(", ")}` : "Todas las laptops actuales en cat\xE1logo son Importadas Reacondicionadas Clase A con 6 meses de garant\xEDa"}).`
    );
  }
  let hasPrimaryFilterSection = false;
  if (genericFamily && (genericFamily.id !== "laptop" || !brandFilter && !budgetFilter && !useCaseFilter && !wantsOnlyNew)) {
    let familyProducts = inStock.filter(genericFamily.matcher);
    if (!genericFamily.isCable) {
      familyProducts = familyProducts.filter((p) => !isCableOrWiringItem(p.name, p.odooCategory));
    }
    if (brandFilter) {
      const brandMatches = familyProducts.filter(brandFilter.matcher);
      if (brandMatches.length > 0) {
        familyProducts = brandMatches;
      }
    }
    if (budgetFilter) {
      const budgetMatches = familyProducts.filter(
        (p) => p.list_price >= budgetFilter.min && p.list_price <= budgetFilter.max
      );
      if (budgetMatches.length > 0) {
        familyProducts = budgetMatches;
      }
    }
    if (wantsOnlyNew) {
      const newMatches = familyProducts.filter((p) => p.condition === "Nuevo");
      if (newMatches.length > 0) {
        familyProducts = newMatches;
      }
    }
    familyProducts.sort((a, b) => a.list_price - b.list_price);
    hasPrimaryFilterSection = true;
    if (familyProducts.length > 0) {
      const brandNote = brandFilter ? ` DE MARCA ${brandFilter.label.toUpperCase()}` : " (TODAS LAS MARCAS DISPONIBLES)";
      const MAX_BLOCK_ITEMS = 15;
      const displayedItems = familyProducts.slice(0, MAX_BLOCK_ITEMS);
      const remainingCount = familyProducts.length - displayedItems.length;
      const itemsListFormatted = displayedItems.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join("\n\n");
      const paginationFooter = remainingCount > 0 ? `

\u{1F4CC} *Mostrando las primeras 15 de ${familyProducts.length} opciones disponibles (desde RD$${displayedItems[0]?.list_price.toLocaleString()} hasta RD$${displayedItems[displayedItems.length - 1]?.list_price.toLocaleString()}).*
*Tenemos ${remainingCount} modelos adicionales en inventario. \xBFDeseas ver los siguientes ${Math.min(15, remainingCount)}, o prefieres que te filtre por una marca o presupuesto espec\xEDfico?* \u{1F6D2}` : `

*${familyProducts.length} opciones disponibles en stock real. \xBFCu\xE1l te interesa? Te lo aparto ahora mismo para entrega o retiro en tienda.* \u{1F6D2}`;
      sections.push(
        `=== \u{1F3AF} CAT\xC1LOGO DE ${genericFamily.label.toUpperCase()}${brandNote} (${familyProducts.length} DISPONIBLES EN STOCK) ===
\u26A0\uFE0F INSTRUCCI\xD3N OBLIGATORIA PARA LA IA:
1. El cliente consult\xF3 por "${genericFamily.label}"${brandFilter ? ` especificando la marca ${brandFilter.label}` : " de forma gen\xE9rica (multimarca total)"}.
2. FORMATO EN BLOQUES INTERACTIVOS (M\xC1XIMO 15 PRODUCTOS POR MENSAJE): Env\xEDa EXACTAMENTE los ${displayedItems.length} productos listados a continuaci\xF3n (del *1.* al *${displayedItems.length}.*).
3. PUREZA CATEG\xD3RICA ESTRICTA (CERO CABLES): ${genericFamily.isCable ? "El cliente solicit\xF3 cables expresamente, por lo que se env\xEDan cables disponibles." : "EST\xC1 TOTALMENTE PROHIBIDO incluir cables, cordones o adaptadores en esta lista (si es mouse solo mouse, si es impresora solo impresora, si es laptop solo laptop, etc.)."}
4. CIERRE INTERACTIVO: Incluye al final la invitaci\xF3n interactiva (${remainingCount > 0 ? `indicando los ${remainingCount} modelos adicionales restantes` : "confirmando el apartado"}).

LISTA DE PRODUCTOS LISTA PARA ENVIAR (${displayedItems.length} opciones):

${itemsListFormatted}${paginationFooter}`
      );
    } else {
      sections.push(
        `=== \u26A0\uFE0F SIN STOCK ACTUAL PARA ${genericFamily.label.toUpperCase()}${brandFilter ? ` (${brandFilter.label})` : ""} ===
Informa cordialmente al cliente que en este momento no tenemos unidades disponibles de ${genericFamily.label}${brandFilter ? ` marca ${brandFilter.label}` : ""} en stock f\xEDsico, y ofr\xE9cele alternativas o verificar pr\xF3xima llegada.`
      );
    }
  } else if (brandFilter || budgetFilter || useCaseFilter || wantsOnlyNew) {
    hasPrimaryFilterSection = true;
    let filtered = [...laptopsInStock];
    const activeFilterLabels = [];
    if (brandFilter) {
      filtered = filtered.filter(brandFilter.matcher);
      activeFilterLabels.push(`Marca/L\xEDnea: ${brandFilter.label}`);
    }
    if (budgetFilter) {
      filtered = filtered.filter((p) => p.list_price >= budgetFilter.min && p.list_price <= budgetFilter.max);
      activeFilterLabels.push(budgetFilter.label);
    }
    if (useCaseFilter) {
      filtered = filtered.filter(useCaseFilter.matcher);
      activeFilterLabels.push(`Uso: ${useCaseFilter.label}`);
    }
    if (wantsOnlyNew) {
      const onlyNewMatches = filtered.filter((p) => p.condition === "Nuevo");
      if (onlyNewMatches.length > 0) {
        filtered = onlyNewMatches;
        activeFilterLabels.push("Condici\xF3n: Nuevo");
      }
    }
    if (filtered.length === 0) {
      if (brandFilter) {
        filtered = inStock.filter(brandFilter.matcher);
      } else if (budgetFilter) {
        filtered = laptopsInStock.filter(
          (p) => p.list_price >= Math.max(2e3, budgetFilter.min - 2e3) && p.list_price <= budgetFilter.max + 3e3
        );
      } else if (useCaseFilter) {
        filtered = laptopsInStock.filter(useCaseFilter.matcher);
      }
    }
    filtered.sort((a, b) => a.list_price - b.list_price);
    if (filtered.length > 0) {
      const filterTitle = activeFilterLabels.join(" + ");
      const MAX_FILTER_BLOCK = 15;
      const displayedFiltered = filtered.slice(0, MAX_FILTER_BLOCK);
      const remainingFiltered = filtered.length - displayedFiltered.length;
      const readyFilteredList = displayedFiltered.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join("\n\n") + (remainingFiltered > 0 ? `

\u{1F4CC} *Mostrando las primeras 15 de ${filtered.length} opciones disponibles dentro de este filtro.*
*Tenemos ${remainingFiltered} modelos m\xE1s que coinciden. \xBFDeseas verlos, o te interesa apartar uno de estos?* \u{1F6D2}` : `

*\xBFCu\xE1l de estas opciones te apartamos de inmediato?* \u{1F6D2}`);
      sections.push(
        `=== \u{1F3AF} FILTRO ESTRICTO ACTIVO (${filterTitle}) \u2014 MOSTRAR ESTOS ${displayedFiltered.length} MODELOS ===
\u26A0\uFE0F INSTRUCCI\xD3N OBLIGATORIA PARA LA IA:
El cliente solicit\xF3 un filtro espec\xEDfico (${filterTitle}).
${useCaseFilter ? `\u{1F4A1} Argumento de venta para este uso: ${useCaseFilter.pitch}
` : ""}1. Debes enviar estos ${displayedFiltered.length} productos filtrados (del *1.* al *${displayedFiltered.length}.*).
2. **EST\xC1 ESTRICTAMENTE PROHIBIDO** enviar el cat\xE1logo general cuando el cliente pidi\xF3 una marca, precio o uso espec\xEDfico.
3. Incluye en cada opci\xF3n su precio en RD$, stock, condici\xF3n (Nuevo o Reacondicionado Clase A), especificaciones clave y su link directo sin corchetes Markdown.

LISTA FILTRADA LISTA PARA ENVIAR AL CLIENTE (${displayedFiltered.length} opciones):

${readyFilteredList}`
      );
    } else {
      sections.push(
        `=== \u26A0\uFE0F SIN COINCIDENCIAS EXACTAS PARA EL FILTRO (${activeFilterLabels.join(" + ")}) ===
Informa cordialmente al cliente que en este momento no tenemos un modelo exacto con esa combinaci\xF3n en stock, y mu\xE9strale las 3 opciones m\xE1s cercanas disponibles en nuestro inventario real.`
      );
    }
  }
  if (!hasPrimaryFilterSection) {
    const stopWords = /* @__PURE__ */ new Set([
      "hola",
      "buenos",
      "dias",
      "tardes",
      "noches",
      "quiero",
      "tienen",
      "tiene",
      "busco",
      "para",
      "como",
      "cual",
      "cuales",
      "precio",
      "precios",
      "cuanto",
      "cuesta",
      "vale",
      "disponible",
      "disponibles",
      "todo",
      "una",
      "uno",
      "unos",
      "unas",
      "por",
      "favor",
      "gracias",
      "saludos",
      "saludo",
      "buenas",
      "info",
      "informacion",
      "pesos",
      "mil",
      "tengo",
      "presupuesto",
      "esta",
      "este",
      "esto",
      "bien",
      "listo",
      "dale",
      "claro",
      "bueno",
      "saber",
      "hacer",
      "donde",
      "cuando",
      "quien",
      "porque",
      "pero",
      "solo",
      "aqui",
      "alla",
      "algo",
      "nada",
      "mucho",
      "poco",
      "otro",
      "otra",
      "esos",
      "esas"
    ]);
    const validShortTechTokens = /* @__PURE__ */ new Set([
      "hp",
      "pc",
      "i3",
      "i5",
      "i7",
      "i9",
      "m1",
      "m2",
      "m3",
      "g3",
      "g4",
      "g5",
      "g6",
      "g7",
      "g8",
      "ram",
      "ssd",
      "hdd",
      "usb",
      "vga",
      "ups",
      "led",
      "ips",
      "rgb",
      "jbl",
      "msi",
      "mac"
    ]);
    const searchSource = `${userOnlyLatest} ${fullContextText}`.toLowerCase().replace(/https?:\/\/\S+/gi, " ");
    const tokens = searchSource.replace(/[^\wáéíóúñ0-9\s]/g, " ").split(/\s+/).filter((w) => (w.length >= 4 || validShortTechTokens.has(w)) && !stopWords.has(w));
    if (tokens.length > 0) {
      const scored = [];
      for (const p of inStock) {
        const hay = `${p.name} ${p.brand || ""} ${p.condition || ""} ${p.specsSummary || ""} ${p.description_sale || ""} ${(p.useCases || []).join(" ")} ${p.category} ${p.odooCategory || ""}`.toLowerCase();
        let score = 0;
        for (const tk of tokens) {
          const escapedTk = tk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const wordBoundaryRegex = new RegExp(`\\b${escapedTk}\\b`, "i");
          if (wordBoundaryRegex.test(hay)) {
            score += tk.length >= 4 ? 4 : 2;
          } else if (tk.length >= 5 && hay.includes(tk)) {
            score += 2;
          }
          if ((tk === "lapto" || tk === "laptop" || tk === "laptops" || tk === "computadora") && p.category === "laptop") {
            score += 5;
          }
        }
        if (score >= 3) {
          scored.push({ product: p, score });
        }
      }
      scored.sort((a, b) => b.score - a.score || a.product.list_price - b.product.list_price);
      let topMatches = scored.slice(0, 15).map((s) => s.product);
      if (genericFamily && !genericFamily.isCable) {
        topMatches = topMatches.filter((p) => !isCableOrWiringItem(p.name, p.odooCategory));
      }
      if (topMatches.length > 0) {
        sections.push(
          `=== COINCIDENCIAS DIRECTAS EN INVENTARIO ODOO PARA LA CONSULTA ACTUAL (${topMatches.length} encontrados) ===
` + topMatches.map((p, idx) => formatWhatsAppProductBlock(p, idx)).join("\n\n")
        );
      }
    }
  }
  return sections.length > 0 ? "\n" + sections.join("\n\n") : "";
}
function getLearnedInsightsPromptContext() {
  return learnedInsights.map(
    (ins) => `[Aprendizaje - ${ins.category}]: Cuando el cliente exprese "${ins.triggerPhrase}", responde aplicando esta t\xE1ctica comprobada (${ins.successRate}% \xE9xito): "${ins.winningPitch}". Contexto: ${ins.counterObjection}`
  ).join("\n\n");
}
app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    config: appConfig,
    businessSchedule: getDominicanTimeContext(),
    stats: {
      totalProducts: products.length,
      inStockProducts: products.filter((p) => p.virtual_available > 0).length,
      vitrinaProducts: products.filter((p) => (p.vitrinaStock || 0) > 0).length,
      totalConversations: conversations.length,
      activeLeads: customers.length,
      totalOrders: salesOrders.length,
      learnedInsightsCount: learnedInsights.length,
      pendingReminders: followUps.filter((f) => f.status === "pendiente").length
    }
  });
});
app.get("/api/business-schedule", (req, res) => {
  const ctx = getDominicanTimeContext(/* @__PURE__ */ new Date(), appConfig.holidayOverrides || []);
  const year = req.query.year ? parseInt(String(req.query.year), 10) : ctx.year;
  res.json({
    success: true,
    schedule: ctx,
    holidayOverrides: appConfig.holidayOverrides || [],
    availableYears: getAvailableHolidayYears(ctx.year, ctx.month, appConfig.holidayOverrides || [], year),
    holidays: getHolidaysWithOverridesForYear(year, appConfig.holidayOverrides || [])
  });
});
app.get("/api/holidays/sql", (_req, res) => {
  res.json({
    success: true,
    tableName: "calendario_feriados",
    sql: getHolidaysTableSql()
  });
});
app.post("/api/holidays/sync-supabase", async (_req, res) => {
  try {
    const syncRes = await syncHolidaysToSupabase(
      appConfig.holidayOverrides || [],
      appConfig.supabase?.url,
      appConfig.supabase?.anonKey
    );
    res.json({
      success: syncRes.synced,
      ...syncRes
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
app.post("/api/holidays/overrides", async (req, res) => {
  const { holidayOverrides } = req.body;
  let dbSynced = false;
  let tableExists = false;
  let tableRowsSynced = 0;
  let storage = "local";
  if (Array.isArray(holidayOverrides)) {
    appConfig.holidayOverrides = holidayOverrides;
    setGlobalHolidayOverrides(appConfig.holidayOverrides);
    savePersistedConfig();
    try {
      const syncRes = await syncHolidaysToSupabase(
        appConfig.holidayOverrides,
        appConfig.supabase?.url,
        appConfig.supabase?.anonKey
      );
      dbSynced = syncRes.synced;
      tableExists = syncRes.tableExists;
      tableRowsSynced = syncRes.tableRowsSynced;
      storage = syncRes.storage;
      if (appConfig.supabase?.autoSync !== false) {
        autoSyncConfigToSupabase(appConfig).catch(() => {
        });
      }
    } catch {
    }
    broadcastEvent("config_updated", appConfig);
  }
  const ctx = getDominicanTimeContext(/* @__PURE__ */ new Date(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    dbSynced,
    tableExists,
    tableRowsSynced,
    storage,
    config: appConfig,
    schedule: ctx,
    holidayOverrides: appConfig.holidayOverrides || [],
    availableYears: getAvailableHolidayYears(ctx.year, ctx.month, appConfig.holidayOverrides || []),
    holidays: getHolidaysWithOverridesForYear(ctx.year, appConfig.holidayOverrides || [])
  });
});
app.post("/api/config", async (req, res) => {
  const { globalAiActive, aiProvider, odoo, evolution, supabase, holidayOverrides } = req.body;
  if (globalAiActive !== void 0) appConfig.globalAiActive = Boolean(globalAiActive);
  if (aiProvider) {
    const nextAi = { ...appConfig.aiProvider, ...aiProvider };
    if (typeof aiProvider.openaiApiKey === "string") {
      nextAi.openaiApiKey = aiProvider.openaiApiKey.trim();
    }
    if (typeof aiProvider.deepseekApiKey === "string") {
      nextAi.deepseekApiKey = aiProvider.deepseekApiKey.trim();
    }
    if (typeof aiProvider.geminiApiKey === "string") {
      nextAi.geminiApiKey = aiProvider.geminiApiKey.trim();
    }
    if (typeof aiProvider.openaiBaseUrl === "string" && aiProvider.openaiBaseUrl.trim()) {
      nextAi.openaiBaseUrl = aiProvider.openaiBaseUrl.trim();
    }
    if (typeof aiProvider.deepseekBaseUrl === "string" && aiProvider.deepseekBaseUrl.trim()) {
      nextAi.deepseekBaseUrl = aiProvider.deepseekBaseUrl.trim();
    }
    appConfig.aiProvider = nextAi;
    rejectedOpenAiKeys.clear();
    rejectedDeepseekKeys.clear();
    exhaustedGeminiModelsUntil.clear();
  }
  if (odoo) appConfig.odoo = { ...appConfig.odoo, ...odoo };
  if (evolution) appConfig.evolution = { ...appConfig.evolution, ...evolution };
  if (supabase) {
    appConfig.supabase = { ...appConfig.supabase || {}, ...supabase };
    if (appConfig.supabase?.url && appConfig.supabase?.anonKey) {
      getSupabaseClient(appConfig.supabase.url, appConfig.supabase.anonKey);
    }
  }
  if (Array.isArray(holidayOverrides)) {
    appConfig.holidayOverrides = holidayOverrides;
    setGlobalHolidayOverrides(appConfig.holidayOverrides);
  }
  savePersistedConfig();
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncConfigToSupabase(appConfig).catch(() => {
    });
  }
  broadcastEvent("config_updated", appConfig);
  res.json({ success: true, config: appConfig });
});
app.post("/api/ai/save-credentials", async (req, res) => {
  const {
    provider,
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
    deepseekApiKey,
    deepseekBaseUrl,
    geminiApiKey
  } = req.body;
  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: provider || appConfig.aiProvider?.provider || "gemini",
    model: model || appConfig.aiProvider?.model || "gemini-3.8-flash",
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? "",
    ...openaiApiKey !== void 0 ? { openaiApiKey: String(openaiApiKey).trim() } : {},
    ...openaiBaseUrl !== void 0 && String(openaiBaseUrl).trim() ? { openaiBaseUrl: String(openaiBaseUrl).trim() } : {},
    ...deepseekApiKey !== void 0 ? { deepseekApiKey: String(deepseekApiKey).trim() } : {},
    ...deepseekBaseUrl !== void 0 && String(deepseekBaseUrl).trim() ? { deepseekBaseUrl: String(deepseekBaseUrl).trim() } : {},
    ...geminiApiKey !== void 0 ? { geminiApiKey: String(geminiApiKey).trim() } : {}
  };
  rejectedOpenAiKeys.clear();
  rejectedDeepseekKeys.clear();
  exhaustedGeminiModelsUntil.clear();
  savePersistedConfig();
  try {
    await autoSyncConfigToSupabase(appConfig);
  } catch {
  }
  broadcastEvent("config_updated", appConfig);
  res.json({
    success: true,
    config: appConfig,
    message: "Credenciales de IA guardadas permanentemente en el servidor y respaldadas en Supabase."
  });
});
app.post("/api/supabase/test-connection", async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || "").trim();
  const anonKey = (req.body.anonKey || appConfig.supabase?.anonKey || "").trim();
  if (!url || !anonKey) {
    return res.status(400).json({
      success: false,
      message: "Se requiere la URL del proyecto y la Anon Key de Supabase."
    });
  }
  if (!appConfig.supabase) {
    appConfig.supabase = { url: "", anonKey: "", connected: false, autoSync: true };
  }
  appConfig.supabase.url = url;
  appConfig.supabase.anonKey = anonKey;
  savePersistedConfig();
  getSupabaseClient(url, anonKey);
  const result = await testSupabaseConnection(url, anonKey);
  if (result.success) {
    appConfig.supabase.connected = true;
    savePersistedConfig();
  }
  res.json(result);
});
app.get("/api/supabase/schema-sql", (req, res) => {
  res.json({
    success: true,
    sql: getSupabaseSchemaSql()
  });
});
app.post("/api/supabase/sync-all", async (req, res) => {
  const url = (req.body.url || appConfig.supabase?.url || DEFAULT_SUPABASE_URL).trim();
  const anonKey = (req.body.anonKey || appConfig.supabase?.anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();
  if (url && anonKey) {
    if (!appConfig.supabase) {
      appConfig.supabase = { url: "", anonKey: "", connected: false, autoSync: true };
    }
    appConfig.supabase.url = url;
    appConfig.supabase.anonKey = anonKey;
    savePersistedConfig();
  }
  try {
    const stats = await uploadAllToSupabase(
      {
        users: systemUsers,
        config: appConfig,
        products,
        orders: salesOrders,
        customers,
        conversations,
        reminders: followUps,
        insights: learnedInsights.filter((i) => i.id !== INTERNAL_USERS_BACKUP_ID)
      },
      url,
      anonKey
    );
    if (appConfig.supabase) {
      appConfig.supabase.lastSync = (/* @__PURE__ */ new Date()).toISOString();
      if (stats.errors.length === 0 || stats.usersSynced > 0 || stats.ordersSynced > 0 || stats.customersSynced > 0) {
        appConfig.supabase.connected = true;
      }
      savePersistedConfig();
    }
    res.json({
      success: stats.errors.length === 0 || stats.usersSynced + stats.ordersSynced + stats.customersSynced + stats.messagesSynced > 0,
      stats,
      lastSync: appConfig.supabase?.lastSync
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Error al subir datos a Supabase: ${err.message}`
    });
  }
});
function findMatchingSystemUser(rawIdentifier) {
  const cleanUser = String(rawIdentifier || "").trim().replace(/^@+/, "").toLowerCase();
  const digitsOnly = cleanUser.replace(/\D/g, "");
  return systemUsers.find((u) => {
    if (u.username.toLowerCase().trim() === cleanUser) return true;
    if (u.nombre.toLowerCase().trim() === cleanUser) return true;
    if (digitsOnly.length >= 10 && u.whatsapp.replace(/\D/g, "").endsWith(digitsOnly.slice(-10))) return true;
    return false;
  });
}
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Ingresa tu nombre de usuario y contrase\xF1a." });
  }
  let found = findMatchingSystemUser(username);
  if (!found || found.password !== String(password).trim()) {
    await hydrateAndSyncUsersWithSupabase();
    found = findMatchingSystemUser(username);
  }
  if (!found) {
    return res.status(401).json({ success: false, message: "Nombre de usuario no encontrado." });
  }
  if (!found.activo) {
    return res.status(403).json({ success: false, message: "Esta cuenta ha sido desactivada por el Super Administrador." });
  }
  if (found.password !== String(password).trim()) {
    return res.status(401).json({ success: false, message: "Contrase\xF1a incorrecta." });
  }
  found.lastLogin = (/* @__PURE__ */ new Date()).toISOString();
  savePersistedUsers();
  autoSyncUserToSupabase(found, systemUsers).catch(() => {
  });
  const token = `vendema_tk_${found.id}_${Date.now()}`;
  res.json({
    success: true,
    user: sanitizeUser(found),
    token
  });
});
app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return res.status(401).json({ success: false, message: "No autenticado." });
  }
  const match = token.match(/^vendema_tk_(usr_[a-zA-Z0-9_]+)_/);
  if (match) {
    const userId = match[1];
    let user = systemUsers.find((u) => u.id === userId && u.activo);
    if (!user) {
      await hydrateAndSyncUsersWithSupabase();
      user = systemUsers.find((u) => u.id === userId && u.activo);
    }
    if (user) {
      return res.json({ success: true, user: sanitizeUser(user) });
    }
  }
  res.status(401).json({ success: false, message: "Sesi\xF3n no v\xE1lida o expirada." });
});
app.post("/api/auth/logout", (_req, res) => {
  res.json({ success: true, message: "Sesi\xF3n cerrada correctamente." });
});
app.get("/api/users", async (_req, res) => {
  await hydrateAndSyncUsersWithSupabase();
  res.json({
    success: true,
    users: systemUsers.map(sanitizeUser),
    total: systemUsers.length
  });
});
app.post("/api/users", async (req, res) => {
  const { nombre, username, password, whatsapp, role } = req.body;
  if (!nombre || !username || !password || !whatsapp) {
    return res.status(400).json({
      success: false,
      message: "Todos los campos son obligatorios: Nombre, Nombre de usuario, Contrase\xF1a y WhatsApp."
    });
  }
  const cleanUsername = String(username).trim().replace(/^@+/, "").toLowerCase().replace(/\s+/g, "");
  if (cleanUsername.length < 3) {
    return res.status(400).json({
      success: false,
      message: "El nombre de usuario debe tener al menos 3 caracteres."
    });
  }
  await hydrateAndSyncUsersWithSupabase();
  if (systemUsers.some((u) => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({
      success: false,
      message: `El nombre de usuario "${cleanUsername}" ya existe. Elige otro por favor.`
    });
  }
  const validRoles = ["super_admin", "dueno", "empleado"];
  const userRole = validRoles.includes(role) ? role : "empleado";
  const newUser = {
    id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    nombre: String(nombre).trim(),
    username: cleanUsername,
    password: String(password).trim(),
    whatsapp: String(whatsapp).replace(/[^\d+]/g, ""),
    role: userRole,
    activo: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  systemUsers.push(newUser);
  savePersistedUsers();
  await autoSyncUserToSupabase(newUser, systemUsers);
  res.status(201).json({
    success: true,
    message: `Usuario ${newUser.nombre} (@${newUser.username}) creado y sincronizado con Supabase.`,
    user: sanitizeUser(newUser)
  });
});
app.put("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const userIdx = systemUsers.findIndex((u) => u.id === id);
  if (userIdx === -1) {
    return res.status(404).json({ success: false, message: "Usuario no encontrado." });
  }
  const targetUser = systemUsers[userIdx];
  const { nombre, whatsapp, password, role, activo } = req.body;
  if (nombre) targetUser.nombre = String(nombre).trim();
  if (whatsapp) targetUser.whatsapp = String(whatsapp).replace(/[^\d+]/g, "");
  if (password && String(password).trim()) {
    targetUser.password = String(password).trim();
  }
  if (targetUser.username.toLowerCase() === "nelson") {
    targetUser.role = "super_admin";
    targetUser.activo = true;
  } else {
    if (role && ["super_admin", "dueno", "empleado"].includes(role)) {
      targetUser.role = role;
    }
    if (activo !== void 0) {
      targetUser.activo = Boolean(activo);
    }
  }
  savePersistedUsers();
  await autoSyncUserToSupabase(targetUser, systemUsers);
  res.json({
    success: true,
    message: `Usuario ${targetUser.nombre} actualizado y sincronizado con Supabase.`,
    user: sanitizeUser(targetUser)
  });
});
app.delete("/api/users/:id", async (req, res) => {
  const { id } = req.params;
  const targetUser = systemUsers.find((u) => u.id === id);
  if (!targetUser) {
    return res.status(404).json({ success: false, message: "Usuario no encontrado." });
  }
  if (targetUser.username.toLowerCase() === "nelson") {
    return res.status(403).json({
      success: false,
      message: "No es posible eliminar al Super Administrador principal (nelson)."
    });
  }
  systemUsers = systemUsers.filter((u) => u.id !== id);
  savePersistedUsers();
  await deleteUserFromSupabase(targetUser, systemUsers);
  res.json({
    success: true,
    message: `Usuario @${targetUser.username} eliminado correctamente.`
  });
});
app.post("/api/ai/test-provider", async (req, res) => {
  const {
    provider,
    model,
    temperature,
    customInstructions,
    openaiApiKey,
    openaiBaseUrl,
    deepseekApiKey,
    deepseekBaseUrl,
    geminiApiKey
  } = req.body;
  appConfig.aiProvider = {
    ...appConfig.aiProvider,
    provider: provider || appConfig.aiProvider?.provider || "gemini",
    model: model || appConfig.aiProvider?.model || "gemini-3.8-flash",
    temperature: temperature ?? appConfig.aiProvider?.temperature ?? 0.35,
    customInstructions: customInstructions ?? appConfig.aiProvider?.customInstructions ?? "",
    ...openaiApiKey !== void 0 ? { openaiApiKey } : {},
    ...openaiBaseUrl !== void 0 ? { openaiBaseUrl } : {},
    ...deepseekApiKey !== void 0 ? { deepseekApiKey } : {},
    ...deepseekBaseUrl !== void 0 ? { deepseekBaseUrl } : {},
    ...geminiApiKey !== void 0 ? { geminiApiKey } : {}
  };
  rejectedOpenAiKeys.clear();
  rejectedDeepseekKeys.clear();
  exhaustedGeminiModelsUntil.clear();
  savePersistedConfig();
  const requested = appConfig.aiProvider.provider;
  if (requested === "openai" && !appConfig.aiProvider.openaiApiKey && (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "MY_OPENAI_API_KEY")) {
    return res.json({
      success: false,
      message: "Por favor ingresa tu API Key de OpenAI (sk-...) en el campo de credenciales para conectar con OpenAI."
    });
  }
  if (requested === "deepseek" && !appConfig.aiProvider.deepseekApiKey && (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === "MY_DEEPSEEK_API_KEY")) {
    return res.json({
      success: false,
      message: "Por favor ingresa tu API Key de DeepSeek (sk-...) en el campo de credenciales para conectar con DeepSeek."
    });
  }
  try {
    const result = await generateTextWithConfiguredAI({
      prompt: "Responde en una sola l\xEDnea confirmando que est\xE1s activo para vender laptops en Todo Lapto.",
      systemInstruction: "Eres el motor de inteligencia artificial de Vendem\xE1 CRM para Todo Lapto.",
      allowFallback: false
    });
    res.json({
      success: true,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      message: `Motor ${result.providerUsed.toUpperCase()} (${result.modelUsed}) conectado y guardado: "${result.text.trim()}"`
    });
  } catch (err) {
    try {
      const fallbackResult = await generateTextWithConfiguredAI({
        prompt: "Responde en una sola l\xEDnea confirmando que est\xE1s activo para vender laptops en Todo Lapto.",
        systemInstruction: "Eres el motor de inteligencia artificial de Vendem\xE1 CRM para Todo Lapto.",
        allowFallback: true
      });
      res.json({
        success: false,
        requestedProvider: requested,
        providerUsed: fallbackResult.providerUsed,
        modelUsed: fallbackResult.modelUsed,
        isFallbackActive: true,
        message: `${err.message} \u26A0\uFE0F Mientras actualizas la clave, el Bot de Ventas est\xE1 respondiendo tus chats de WhatsApp autom\xE1ticamente con el motor integrado de respaldo (${fallbackResult.providerUsed.toUpperCase()} ${fallbackResult.modelUsed}) para que ning\xFAn cliente quede desatendido.`
      });
    } catch {
      res.json({
        success: false,
        requestedProvider: requested,
        message: `No se pudo conectar con ${requested.toUpperCase()}: ${err.message}`
      });
    }
  }
});
app.post("/api/system/time-sync", (req, res) => {
  const { clientTimestamp } = req.body;
  if (typeof clientTimestamp === "number" && clientTimestamp > 0) {
    const serverNow = Date.now();
    const driftMs = clientTimestamp - serverNow;
    if (Math.abs(driftMs) > 3e3) {
      setGlobalTimeOffset(driftMs);
      console.log(`[Time Sync]: Servidor sincronizado con hora real del cliente. Drift corregido: ${driftMs}ms`);
    }
  }
  const rd = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: Date.now(),
    effectiveTimestamp: getEffectiveCurrentDate().getTime(),
    dominicanTime: rd
  });
});
app.get("/api/system/time-status", (req, res) => {
  const rd = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  res.json({
    success: true,
    serverTimestamp: Date.now(),
    effectiveTimestamp: getEffectiveCurrentDate().getTime(),
    dominicanTime: rd
  });
});
app.get("/api/odoo/products", async (req, res) => {
  const refresh = req.query.refresh === "true";
  if (refresh || products.length === 0) {
    await syncOdooInventory();
  }
  res.json({
    success: true,
    lastSync: appConfig.odoo.lastSync,
    totalCount: products.length,
    vitrinaCount: products.filter((p) => (p.vitrinaStock || 0) > 0).length,
    almacenCount: products.filter((p) => (p.almacenStock || 0) > 0).length,
    products
  });
});
app.post("/api/odoo/test-connection", async (req, res) => {
  try {
    const locations = await callOdoo("object", "execute_kw", [
      appConfig.odoo.db,
      appConfig.odoo.uid,
      appConfig.odoo.apiKey,
      "stock.location",
      "search_read",
      [[["usage", "=", "internal"]]],
      { fields: ["id", "complete_name"], limit: 10 }
    ]);
    await syncOdooInventory();
    res.json({
      success: true,
      message: `Conexi\xF3n al servidor JSON-RPC exitosa. ${products.length} productos activos cargados en tiempo real.`,
      sampleLocations: locations
    });
  } catch (err) {
    res.json({
      success: false,
      message: `Error al conectar con el servidor: ${err.message}`
    });
  }
});
app.post("/api/evolution/test-connection", async (req, res) => {
  try {
    const url = `${appConfig.evolution.serverUrl}/instance/fetchInstances`;
    const response = await fetch(url, {
      headers: { apikey: appConfig.evolution.apiKey }
    });
    if (response.ok) {
      const data = await response.json();
      await syncEvolutionChats();
      res.json({
        success: true,
        message: `Conexi\xF3n a Evolution API exitosa (Instancia: ${appConfig.evolution.instance}). ${conversations.length} conversaciones sincronizadas.`,
        instances: data
      });
    } else {
      res.json({
        success: false,
        message: `Evolution API devolvi\xF3 estado HTTP ${response.status}`
      });
    }
  } catch (err) {
    res.json({
      success: false,
      message: `No se pudo conectar a Evolution API: ${err.message}`
    });
  }
});
app.get("/api/evolution/qrcode", async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    const [stateRes, instancesRes] = await Promise.all([
      fetch(`${serverUrl}/instance/connectionState/${instance}`, {
        headers: { apikey: apiKey }
      }).catch(() => null),
      fetch(`${serverUrl}/instance/fetchInstances`, {
        headers: { apikey: apiKey }
      }).catch(() => null)
    ]);
    const stateData = stateRes && stateRes.ok ? await stateRes.json() : null;
    const instancesData = instancesRes && instancesRes.ok ? await instancesRes.json() : [];
    const instRecord = Array.isArray(instancesData) ? instancesData.find((i) => i.name === instance || i.instanceName === instance) || instancesData[0] : null;
    const currentState = stateData?.instance?.state || instRecord?.connectionStatus || "unknown";
    const isConnected = currentState === "open";
    let qrBase64 = null;
    let pairingCode = null;
    if (!isConnected || req.query.forceConnect === "true") {
      const connectRes = await fetch(`${serverUrl}/instance/connect/${instance}`, {
        headers: { apikey: apiKey }
      }).catch(() => null);
      if (connectRes && connectRes.ok) {
        const connectData = await connectRes.json();
        qrBase64 = connectData?.base64 || connectData?.qrcode?.base64 || null;
        pairingCode = connectData?.pairingCode || connectData?.code || null;
      }
    }
    res.json({
      success: true,
      instance,
      state: currentState,
      connected: isConnected,
      ownerJid: instRecord?.ownerJid || null,
      profileName: instRecord?.profileName || null,
      profilePicUrl: instRecord?.profilePicUrl || null,
      qrBase64,
      pairingCode
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Error al consultar estado/QR de Evolution API: ${err.message}`
    });
  }
});
app.post("/api/evolution/logout", async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    await fetch(`${serverUrl}/instance/logout/${instance}`, {
      method: "DELETE",
      headers: { apikey: apiKey }
    });
    await new Promise((r) => setTimeout(r, 1200));
    const connectRes = await fetch(`${serverUrl}/instance/connect/${instance}`, {
      headers: { apikey: apiKey }
    });
    const connectData = connectRes.ok ? await connectRes.json() : {};
    res.json({
      success: true,
      state: "connecting",
      connected: false,
      qrBase64: connectData?.base64 || connectData?.qrcode?.base64 || null,
      pairingCode: connectData?.pairingCode || null,
      message: "Sesi\xF3n desvinculada. Escanea el nuevo c\xF3digo QR con WhatsApp."
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Error al desvincular instancia: ${err.message}`
    });
  }
});
app.post("/api/evolution/restart", async (req, res) => {
  const { serverUrl, instance, apiKey } = appConfig.evolution;
  try {
    const r = await fetch(`${serverUrl.replace(/\/$/, "")}/instance/restart/${instance}`, {
      method: "POST",
      headers: { apikey: apiKey }
    });
    res.json({
      success: r.ok,
      message: r.ok ? `Instancia "${instance}" reiniciada correctamente.` : `Evolution API devolvi\xF3 estado ${r.status} al reiniciar.`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `No se pudo reiniciar instancia: ${err.message}`
    });
  }
});
app.get("/api/evolution/media/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const isVideo = req.query.video === "true";
  const media = await fetchMediaBase64FromEvolution(messageId, isVideo);
  if (!media) {
    return res.status(404).json({ success: false, message: "Media no disponible en Evolution API" });
  }
  res.setHeader("Content-Type", media.mimetype);
  res.setHeader("Content-Length", media.buffer.length);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(media.buffer);
});
function findConversationByAnyId(sessionId) {
  const exact = conversations.find((c) => c.sessionId === sessionId);
  if (exact) return exact;
  const cleanDigits = sessionId.replace(/\D/g, "");
  return conversations.find(
    (c) => relatedJidsBySession.get(c.sessionId)?.has(sessionId) || cleanDigits.length >= 10 && c.customerPhone === cleanDigits
  );
}
app.get("/api/conversations", async (req, res) => {
  recordFrontendHeartbeat();
  const forceRefresh = req.query.refresh === "true";
  const now = Date.now();
  if (conversations.length === 0) {
    await syncEvolutionChats();
  } else if (forceRefresh && now - lastEvolutionChatsSync > 15e3) {
    syncEvolutionChats().catch(() => {
    });
  }
  for (const conv of conversations) {
    if (conv.customerPhone) {
      const match = findOdooPartnerByPhone(conv.customerPhone);
      if (match) {
        conv.odooPartnerId = match.id;
        conv.isOdooClient = true;
      }
    }
  }
  res.json({ success: true, conversations });
});
app.get("/api/conversations/:sessionId/messages", async (req, res) => {
  recordFrontendHeartbeat();
  try {
    const rawSessionId = req.params.sessionId || req.query.sessionId || "";
    const sessionId = decodeURIComponent(rawSessionId).trim();
    if (!sessionId || sessionId === "undefined" || sessionId === "null") {
      return res.json({ success: true, sessionId: "", messages: [] });
    }
    const conv = findConversationByAnyId(sessionId);
    if (conv) conv.unreadCount = 0;
    const forceRefresh = req.query.refresh === "true";
    if (conv && conv.messages && conv.messages.length > 0 && conv.messagesLoaded && !forceRefresh) {
      return res.json({
        success: true,
        sessionId: conv.sessionId,
        customerName: conv.customerName,
        customerPhone: conv.customerPhone,
        messages: conv.messages
      });
    }
    const messages = await loadEvolutionMessagesForChat(sessionId);
    res.json({
      success: true,
      sessionId: conv?.sessionId || sessionId,
      customerName: conv?.customerName,
      customerPhone: conv?.customerPhone,
      messages: messages || []
    });
  } catch (err) {
    console.error("[Load Messages Error]:", err.message);
    res.json({
      success: false,
      message: err.message,
      sessionId: req.params.sessionId,
      messages: []
    });
  }
});
app.get("/api/messages", async (req, res) => {
  recordFrontendHeartbeat();
  try {
    const sessionId = (req.query.sessionId || "").trim();
    if (!sessionId || sessionId === "undefined" || sessionId === "null") {
      return res.json({ success: true, sessionId: "", messages: [] });
    }
    const messages = await loadEvolutionMessagesForChat(sessionId);
    const conv = findConversationByAnyId(sessionId);
    if (conv) conv.unreadCount = 0;
    res.json({
      success: true,
      sessionId: conv?.sessionId || sessionId,
      customerName: conv?.customerName,
      customerPhone: conv?.customerPhone,
      messages: messages || []
    });
  } catch (err) {
    res.json({ success: false, message: err.message, messages: [] });
  }
});
app.post("/api/conversations/:sessionId/toggle-ai", (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  const { enabled } = req.body;
  conv.aiEnabled = enabled !== void 0 ? Boolean(enabled) : !conv.aiEnabled;
  aiEnabledBySession.set(conv.sessionId, conv.aiEnabled);
  const lead = customers.find((c) => c.phone === conv.customerPhone || c.lidJid === conv.sessionId);
  if (lead) lead.aiEnabled = conv.aiEnabled;
  res.json({
    success: true,
    aiEnabled: conv.aiEnabled,
    message: conv.aiEnabled ? "IA activada en este chat" : "IA pausada. Un agente humano puede intervenir libremente."
  });
});
app.post("/api/conversations/:sessionId/send", async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  const { content, quotedMessage } = req.body;
  if (!content) {
    return res.status(400).json({ success: false, message: "Contenido requerido" });
  }
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: "agent",
    type: "text",
    content,
    quotedMessage,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    status: "sent"
  };
  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = content;
  conv.lastMessageType = "text";
  broadcastEvent("new_message", { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg });
  sendEvolutionMessageToConversation(conv, content, 400).then((r) => {
    if (r.messageId) {
      newMsg.evolutionMessageId = r.messageId;
      newMsg.id = `evo-${r.messageId}`;
      const contactKeys = getConversationContactKeys(conv);
      markMessageIdProcessed(r.messageId, contactKeys);
    }
  }).catch(() => {
  });
});
app.post("/api/conversations/:sessionId/send-product", async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  const { productId } = req.body;
  const product = products.find((p) => p.id === Number(productId) || p.variantId === Number(productId));
  if (!product) {
    return res.status(404).json({ success: false, message: "Producto no encontrado en el inventario" });
  }
  const caption = `\u{1F4BB} *${product.name}*
\u{1F4B0} *Precio:* RD$${product.list_price.toLocaleString()}
\u{1F4E6} *Disponibilidad:* ${product.virtual_available} unidad(es)${product.vitrinaStock ? ` (${product.vitrinaStock} en Vitrina)` : ""}
\u{1F3F7}\uFE0F *Condici\xF3n:* ${product.conditionDetail || product.condition || "Reacondicionado Clase A"}
\u{1F517} https://todolapto.com.do${product.website_url || ""}${product.description_sale ? `

\u{1F4CB} ${product.description_sale}` : ""}

*\xBFDeseas que te lo aparte ahora mismo?* \u{1F6D2}`;
  const target = conv.customerPhone.startsWith("18") ? conv.customerPhone : conv.sessionId;
  let sentMediaOk = false;
  let imgDataUri;
  try {
    const imgUrl = `https://todolapto.com.do/web/image/product.template/${product.id}/image_512`;
    const imgRes = await fetch(imgUrl);
    if (imgRes.ok) {
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      const arrBuf = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrBuf).toString("base64");
      imgDataUri = `data:${contentType};base64,${base64}`;
      sentMediaOk = await sendEvolutionMedia(
        target,
        "image",
        contentType,
        base64,
        caption,
        `${product.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.jpg`
      );
    }
  } catch {
  }
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: "agent",
    type: imgDataUri ? "image" : "text",
    content: caption,
    mediaUrl: imgDataUri || product.image_url,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    status: "sent"
  };
  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = `\u{1F4F7} ${product.name} (RD$${product.list_price.toLocaleString()})`;
  conv.lastMessageType = newMsg.type;
  broadcastEvent("new_message", { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg, sentWithPhoto: sentMediaOk });
  if (!sentMediaOk) {
    sendEvolutionMessageToConversation(conv, caption, 400).catch(() => {
    });
  }
});
app.post("/api/conversations/:sessionId/send-media", async (req, res) => {
  const { sessionId } = req.params;
  const conv = findConversationByAnyId(sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  const { mediaType, mimeType, base64Data, caption, fileName } = req.body;
  if (!base64Data) {
    return res.status(400).json({ success: false, message: "Archivo multimedia requerido" });
  }
  const target = conv.customerPhone.startsWith("18") ? conv.customerPhone : conv.sessionId;
  let sentOk = false;
  if (mediaType === "audio") {
    sentOk = await sendEvolutionAudio(target, base64Data);
  } else {
    sentOk = await sendEvolutionMedia(
      target,
      mediaType === "video" ? "video" : mediaType === "document" ? "document" : "image",
      mimeType || "image/jpeg",
      base64Data,
      caption,
      fileName
    );
  }
  const dataUri = base64Data.startsWith("data:") ? base64Data : `data:${mimeType || "application/octet-stream"};base64,${base64Data}`;
  const newMsg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender: "agent",
    type: mediaType === "audio" ? "audio" : mediaType === "video" ? "video" : "image",
    content: caption || (mediaType === "audio" ? "\u{1F3A4} Nota de voz enviada" : mediaType === "video" ? "\u{1F3A5} Video enviado" : "\u{1F4F7} Imagen enviada"),
    mediaUrl: dataUri,
    mediaMimeType: mimeType,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    status: "sent"
  };
  recordLocalMessage(conv.sessionId, newMsg, conv.customerPhone);
  conv.messages.push(newMsg);
  conv.lastTimestamp = newMsg.timestamp;
  conv.lastMessagePreview = newMsg.content;
  conv.lastMessageType = newMsg.type;
  broadcastEvent("new_message", { sessionId: conv.sessionId, message: newMsg });
  res.json({ success: true, message: newMsg, sentToWhatsApp: sentOk });
});
app.post("/api/ai/transcribe-audio", async (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId) {
    return res.status(400).json({ success: false, message: "messageId requerido" });
  }
  try {
    const media = await fetchMediaBase64FromEvolution(messageId, false);
    if (!media) {
      return res.status(404).json({ success: false, message: "No se pudo descargar el audio desde Evolution API" });
    }
    const geminiClient = getActiveGeminiClient();
    const response = await geminiClient.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: media.mimetype.split(";")[0] || "audio/ogg",
              data: media.base64
            }
          },
          { text: "Transcribe este mensaje de voz en espa\xF1ol con exactitud." }
        ]
      }
    });
    const transcript = (response.text || "").trim() || "[Audio sin voz detectable]";
    transcriptionsByMsgId.set(messageId, transcript);
    if (sessionId) {
      const conv = conversations.find((c) => c.sessionId === sessionId);
      const msg = conv?.messages.find((m) => m.evolutionMessageId === messageId);
      if (msg) {
        msg.transcription = transcript;
        msg.content = `\u{1F3A4} "${transcript}"`;
      }
    }
    res.json({ success: true, transcription: transcript });
  } catch (err) {
    const cleanErr = formatCleanAiError(err);
    res.status(500).json({ success: false, message: cleanErr.summary });
  }
});
app.post("/api/ai/analyze-media", async (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId) {
    return res.status(400).json({ success: false, message: "messageId requerido" });
  }
  try {
    const media = await fetchMediaBase64FromEvolution(messageId, false);
    if (!media) {
      return res.status(404).json({ success: false, message: "No se pudo descargar la imagen desde Evolution API" });
    }
    const geminiClient = getActiveGeminiClient();
    const response = await geminiClient.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: media.mimetype.split(";")[0] || "image/jpeg",
              data: media.base64
            }
          },
          {
            text: `Analiza esta imagen enviada por un cliente a Todo Lapto (Rep\xFAblica Dominicana).
Indica en espa\xF1ol de forma concisa (m\xE1ximo 3 l\xEDneas):
1. \xBFEs un comprobante de pago bancario (monto, banco, referencia), un producto/laptop (marca, modelo), o un equipo para reparaci\xF3n?
2. Recomendaci\xF3n de acci\xF3n inmediata para el vendedor.`
          }
        ]
      }
    });
    const analysis = (response.text || "").trim();
    aiAnalysisByMsgId.set(messageId, analysis);
    if (sessionId) {
      const conv = conversations.find((c) => c.sessionId === sessionId);
      const msg = conv?.messages.find((m) => m.evolutionMessageId === messageId);
      if (msg) {
        msg.aiAnalysis = analysis;
      }
    }
    res.json({ success: true, analysis });
  } catch (err) {
    const cleanErr = formatCleanAiError(err);
    res.status(500).json({ success: false, message: cleanErr.summary });
  }
});
app.get("/api/odoo/customers", async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const odooList = await syncOdooCustomers(forceRefresh);
  let filtered = odooList;
  if (query) {
    filtered = odooList.filter(
      (c) => (c.name || "").toLowerCase().includes(query) || (c.phone || "").includes(query) || (c.mobile || "").includes(query) || (c.email || "").toLowerCase().includes(query) || String(c.id).includes(query)
    );
  }
  res.json({
    success: true,
    total: filtered.length,
    customers: filtered.slice(0, 200),
    lastSync: new Date(lastOdooCustomersSync).toISOString()
  });
});
app.get("/api/customers", async (req, res) => {
  if (odooCustomersCache.length === 0) {
    await syncOdooCustomers();
  }
  const odooLeads = odooCustomersCache.map((p) => {
    const rawPhone = p.phone || p.mobile || "";
    const cleanPhone = normalizePhoneDigits(rawPhone);
    const stdPhone = cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone;
    return {
      id: `odoo-${p.id}`,
      name: p.name || "Cliente Odoo",
      phone: stdPhone,
      odooPartnerId: p.id,
      isOdooClient: true,
      address: [p.street, p.city].filter(Boolean).join(", ") || void 0,
      zone: "santo_domingo",
      aiEnabled: true,
      totalSpent: 0,
      ordersCount: p.sale_order_count || 0,
      detectedInterests: ["Cliente Odoo ERP"],
      objectionsRecorded: [],
      notes: p.email ? `Email: ${p.email}` : void 0,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      lastInteraction: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
  const unifiedCustomers = [...customers];
  const seenPhones = new Set(
    customers.map((c) => normalizePhoneDigits(c.phone).slice(-10)).filter(Boolean)
  );
  for (const ol of odooLeads) {
    const phoneKey = ol.phone ? ol.phone.slice(-10) : "";
    if (phoneKey && seenPhones.has(phoneKey)) {
      continue;
    }
    if (phoneKey) seenPhones.add(phoneKey);
    unifiedCustomers.push(ol);
  }
  res.json({
    success: true,
    total: unifiedCustomers.length,
    customers: unifiedCustomers,
    odooCount: odooCustomersCache.length
  });
});
app.post("/api/customers", async (req, res) => {
  const { name, phone, address, zone, notes } = req.body;
  const cleanPhone = normalizePhoneDigits(phone || "");
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({
      success: false,
      message: "Se requiere un n\xFAmero de tel\xE9fono v\xE1lido (m\xEDnimo 10 d\xEDgitos) para registrar el cliente."
    });
  }
  const standardizedPhone = cleanPhone.length === 10 ? "1" + cleanPhone : cleanPhone;
  let odooPartnerId;
  let isNewOdoo = true;
  try {
    const odooRes = await findOrCreateOdooCustomerByPhone(standardizedPhone, name || "Cliente WhatsApp");
    if (odooRes?.id) {
      odooPartnerId = odooRes.id;
      isNewOdoo = odooRes.isNew;
    }
  } catch (err) {
    console.warn("Odoo partner creation check warning:", err.message);
  }
  const newCustomer = {
    id: `lead-${Date.now()}`,
    name: name || "Cliente WhatsApp",
    phone: standardizedPhone,
    odooPartnerId,
    isOdooClient: true,
    address,
    zone: zone || "santo_domingo",
    aiEnabled: true,
    totalSpent: 0,
    ordersCount: 0,
    detectedInterests: [],
    objectionsRecorded: [],
    notes,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastInteraction: (/* @__PURE__ */ new Date()).toISOString()
  };
  customers.unshift(newCustomer);
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncCustomerToSupabase(newCustomer).catch(() => {
    });
  }
  res.json({
    success: true,
    customer: newCustomer,
    reusedExistingOdoo: !isNewOdoo,
    message: isNewOdoo ? "Cliente creado exitosamente" : "Cliente ya exist\xEDa en el registro y fue vinculado"
  });
});
app.get("/api/orders", (req, res) => {
  res.json({ success: true, orders: salesOrders });
});
app.post("/api/orders", async (req, res) => {
  const { clientName, clientPhone, productsSummary, productId, price, paymentMethod, address, notes } = req.body;
  const cleanPhone = normalizePhoneDigits(clientPhone || "");
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({
      success: false,
      message: "Se requiere un n\xFAmero de tel\xE9fono v\xE1lido (m\xEDnimo 10 d\xEDgitos) para registrar un pedido o cotizaci\xF3n."
    });
  }
  const stdPhone = cleanPhone.length === 10 ? "1" + cleanPhone : cleanPhone;
  let odooOrderId;
  try {
    const partnerRes = await findOrCreateOdooCustomerByPhone(stdPhone, clientName || "Cliente WhatsApp");
    const partnerId = partnerRes?.id;
    if (partnerId) {
      const orderRes = await callOdoo("object", "execute_kw", [
        appConfig.odoo.db,
        appConfig.odoo.uid,
        appConfig.odoo.apiKey,
        "sale.order",
        "create",
        [
          {
            partner_id: partnerId,
            origin: `WhatsApp - ${paymentMethod === "contra_entrega" ? "Contra Entrega" : "Transferencia"}`,
            note: `<p>WhatsApp CRM | Cliente: ${clientName} | Tel: ${stdPhone} | Direcci\xF3n: ${address}</p>`,
            order_line: [
              [
                0,
                0,
                {
                  product_id: productId || products[0]?.variantId || 1042,
                  product_uom_qty: 1,
                  price_unit: parseFloat(price) || 18500,
                  name: productsSummary || "Producto Todo Lapto"
                }
              ]
            ]
          }
        ]
      ]);
      if (typeof orderRes === "number") {
        odooOrderId = orderRes;
      }
    }
  } catch (err) {
    console.warn("Odoo sale.order create fallback:", err.message);
  }
  const newOrder = {
    id: `PED-${Date.now()}`,
    odooOrderId,
    clientName,
    clientPhone: stdPhone,
    products: productsSummary,
    productId,
    totalAmount: parseFloat(price) || 0,
    paymentMethod: paymentMethod || "contra_entrega",
    status: paymentMethod === "contra_entrega" ? "aprobado" : "pendiente",
    address,
    deliveryNotes: notes,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  salesOrders.unshift(newOrder);
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncOrderToSupabase(newOrder).catch(() => {
    });
  }
  const teamText = `\u{1F514} *\u{1F69A} NUEVO PEDIDO ${newOrder.paymentMethod.toUpperCase()}*

\u{1F464} Cliente: ${clientName}
\u{1F4F1} Tel\xE9fono: ${stdPhone}
\u{1F4CD} Direcci\xF3n: ${address}
\u{1F4E6} Producto: ${productsSummary}
\u{1F4B0} Monto: RD$${newOrder.totalAmount.toLocaleString()}
\u{1F9FE} Ref Pedido: #${odooOrderId || "LOCAL"}
\u{1F550} Fecha: ${(/* @__PURE__ */ new Date()).toLocaleTimeString("es-DO")}`;
  sendEvolutionMessage(appConfig.evolution.teamPhone, teamText).catch((e) => console.error(e));
  const sendWhatsAppNotification = req.body.sendWhatsAppNotification !== false;
  if (sendWhatsAppNotification && stdPhone && stdPhone.length >= 10) {
    const isContraEntrega = newOrder.paymentMethod === "contra_entrega";
    const rdTime = getDominicanTimeContext();
    const scheduleNotice = !rdTime.isOpen ? `
\u23F0 *Aviso de Despacho:* Actualmente nos encontramos fuera de horario laboral (${rdTime.statusDetail}). Tu equipo queda reservado con prioridad y la entrega ser\xE1 coordinada tan pronto iniciemos labores: ${rdTime.nextOpeningStr}.
` : "";
    const clientConfirmationText = `\u{1F389} *\xA1Hola ${clientName}! Tu orden ha sido registrada exitosamente en Todo Lapto.* \u{1F4E6}

\u{1F9FE} *No. de Cotizaci\xF3n / Pedido:* ${odooOrderId ? `#${odooOrderId}` : newOrder.id}
\u{1F4BB} *Producto:* ${productsSummary}
\u{1F4B0} *Monto Total:* RD$${newOrder.totalAmount.toLocaleString()}
\u{1F69A} *Modalidad:* ${isContraEntrega ? "Pago Contra Entrega (Pagas al recibir en efectivo o transferencia)" : "Transferencia Bancaria"}
\u{1F4CD} *Direcci\xF3n de Entrega:* ${address}
` + (notes ? `\u{1F4DD} *Notas de entrega:* ${notes}
` : "") + scheduleNotice + `
\u{1F6E1}\uFE0F *Garant\xEDa Todo Lapto:* 6 meses de garant\xEDa certificada por escrito con checklist t\xE9cnico de 25 puntos y cargador original.
` + (isContraEntrega ? `\u{1F4DE} Nuestro equipo de log\xEDstica se pondr\xE1 en contacto contigo para coordinar la hora de entrega.` : `\u{1F3E6} *Cuentas Oficiales para Transferir:*
\u2022 Banreservas Corriente: 9603638702 (Todo Lapto SRL)
\u2022 Banco Popular Ahorros: 852768712 (Dorys Viola)
\u2022 BHD Ahorros: 2923412015
Por favor env\xEDanos la foto del comprobante bancario por aqu\xED para despachar tu equipo de inmediato.`) + `

\xA1Muchas gracias por elegirnos! \xBFTienes alguna pregunta o requerimiento adicional? \u{1F60A}`;
    sendEvolutionMessage(stdPhone, clientConfirmationText).catch(
      (e) => console.warn("[Customer WhatsApp Order Confirmation Warning]:", e.message)
    );
    const targetConv = conversations.find(
      (c) => c.customerPhone && c.customerPhone.includes(stdPhone.slice(-10)) || c.customerPhone && stdPhone.includes(c.customerPhone.slice(-10))
    );
    if (targetConv) {
      const confirmationMsg = {
        id: `msg-order-${Date.now()}`,
        sender: "assistant",
        type: "text",
        content: clientConfirmationText,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        status: "sent"
      };
      recordLocalMessage(targetConv.sessionId, confirmationMsg, targetConv.customerPhone);
      targetConv.messages.push(confirmationMsg);
      targetConv.lastTimestamp = confirmationMsg.timestamp;
      targetConv.lastMessagePreview = clientConfirmationText;
      broadcastEvent("new_message", { sessionId: targetConv.sessionId, message: confirmationMsg });
      broadcastEvent("conversations_update", { count: conversations.length });
    }
  }
  res.json({ success: true, order: newOrder });
});
app.post("/api/orders/:id/status", async (req, res) => {
  const order = salesOrders.find((o) => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ success: false, message: "Pedido no encontrado" });
  }
  const { status, adminNotes } = req.body;
  order.status = status;
  order.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (adminNotes) order.adminNotes = adminNotes;
  let textClient = "";
  if (status === "aprobado") {
    textClient = `\u2705 *\xA1Tu pago fue verificado y tu pedido est\xE1 aprobado!* \u{1F389}

\u{1F6CD}\uFE0F *Producto:* ${order.products}
\u{1F4CD} *Direcci\xF3n:* ${order.address}
\u{1F9FE} *Referencia:* ${order.odooOrderId ? "#" + order.odooOrderId : order.id}

Estamos preparando tu paquete para entrega. En breve nuestro equipo de log\xEDstica coordinar\xE1 contigo. \xA1Muchas gracias por tu compra en Todo Lapto! \u{1F60A}`;
    sendEvolutionMessage(order.clientPhone, textClient);
    sendEvolutionMessage(appConfig.evolution.adminPhone, `\u2705 Pedido ${order.id} aprobado en CRM. Cliente ${order.clientPhone} notificado.`);
  } else if (status === "rechazado") {
    textClient = `\u274C *Tu pago no pudo ser verificado*

Lamentablemente no pudimos validar el comprobante de pago enviado para el pedido ${order.products}.

\xBFQu\xE9 puedes hacer?
\u2022 Env\xEDa nuevamente el comprobante bancario legible
\u2022 Verifica el monto y n\xFAmero de cuenta
\u2022 Cont\xE1ctanos si necesitas asistencia directa

\xA1Estamos para servirte! \u{1F60A}`;
    sendEvolutionMessage(order.clientPhone, textClient);
    sendEvolutionMessage(appConfig.evolution.adminPhone, `\u26A0\uFE0F Pedido ${order.id} rechazado en CRM. Cliente ${order.clientPhone} notificado.`);
  }
  if (textClient && order.clientPhone) {
    const cleanP = order.clientPhone.replace(/\D/g, "").slice(-10);
    const targetConv = conversations.find(
      (c) => c.customerPhone && c.customerPhone.replace(/\D/g, "").includes(cleanP)
    );
    if (targetConv) {
      const statusMsg = {
        id: `msg-status-${Date.now()}`,
        sender: "assistant",
        type: "text",
        content: textClient,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        status: "sent"
      };
      recordLocalMessage(targetConv.sessionId, statusMsg, targetConv.customerPhone);
      targetConv.messages.push(statusMsg);
      targetConv.lastTimestamp = statusMsg.timestamp;
      targetConv.lastMessagePreview = textClient;
      broadcastEvent("new_message", { sessionId: targetConv.sessionId, message: statusMsg });
    }
  }
  res.json({ success: true, order });
});
app.get("/api/odoo/customer-check", (req, res) => {
  const phone = typeof req.query.phone === "string" ? req.query.phone : "";
  const clean = normalizePhoneDigits(phone);
  if (!clean || clean.length < 7) {
    return res.json({ found: false });
  }
  const partner = findOdooPartnerByPhone(clean);
  if (partner) {
    return res.json({
      found: true,
      partner: {
        id: partner.id,
        name: partner.name,
        phone: partner.phone || partner.mobile,
        saleOrderCount: partner.sale_order_count || 0
      }
    });
  }
  return res.json({ found: false });
});
app.get("/api/ai/insights", (req, res) => {
  res.json({ success: true, insights: learnedInsights });
});
app.get("/api/admin/bot-audit-log", (_req, res) => {
  const total = botAuditLogs.length;
  const sent = botAuditLogs.filter((l) => l.decision === "sent").length;
  const blocked = botAuditLogs.filter((l) => l.decision.startsWith("blocked_")).length;
  const errors = botAuditLogs.filter((l) => l.decision === "error").length;
  const avgDuration = sent > 0 ? Math.round(
    botAuditLogs.filter((l) => l.decision === "sent").reduce((acc, l) => acc + (l.durationMs || 0), 0) / sent
  ) : 0;
  res.json({
    success: true,
    logs: botAuditLogs,
    stats: {
      total,
      sent,
      blocked,
      errors,
      avgDurationMs: avgDuration,
      inFlightCount: inFlightBotKeys.size,
      activeCooldowns: lastBotReplyByContactKey.size
    }
  });
});
app.post("/api/admin/bot-audit-log/clear", (_req, res) => {
  botAuditLogs.length = 0;
  lastAuditLogKeyByPhone.clear();
  try {
    if (fs.existsSync(BOT_AUDIT_LOG_FILE)) {
      fs.unlinkSync(BOT_AUDIT_LOG_FILE);
    }
  } catch {
  }
  broadcastEvent("bot_audit_update", { type: "clear" });
  res.json({ success: true, message: "Registro de auditor\xEDa limpiado exitosamente" });
});
app.post("/api/ai/insights", (req, res) => {
  const { category, triggerPhrase, winningPitch, counterObjection, tags } = req.body;
  const newInsight = {
    id: `learn-${Date.now()}`,
    category: category || "ventas_general",
    triggerPhrase,
    winningPitch,
    counterObjection,
    successRate: 90,
    occurrences: 1,
    tags: Array.isArray(tags) ? tags : ["manual", "estrategia"],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  learnedInsights.unshift(newInsight);
  res.json({ success: true, insight: newInsight });
});
app.post("/api/ai/learn-from-chat", async (req, res) => {
  const { sessionId } = req.body;
  const conv = conversations.find((c) => c.sessionId === sessionId);
  if (!conv) {
    return res.status(400).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  if (!conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(sessionId);
  }
  if (conv.messages.length === 0) {
    return res.status(400).json({ success: false, message: "Conversaci\xF3n sin mensajes suficientes" });
  }
  try {
    const transcript = conv.messages.slice(-20).map((m) => `[${m.sender.toUpperCase()}]: ${m.transcription || m.content}`).join("\n");
    const prompt = `Analiza la siguiente conversaci\xF3n real de ventas de WhatsApp de Todo Lapto (Rep\xFAblica Dominicana):
${transcript}

Extrae en formato JSON con la siguiente estructura:
{
  "objectionsFound": ["lista de objeciones o dudas planteadas por el cliente"],
  "winningPitch": "la respuesta m\xE1s efectiva dada o sugerida para convencer al cliente",
  "customerSentiment": "positivo | neutral | negativo",
  "detectedInterests": ["productos o categor\xEDas de inter\xE9s"],
  "closingOpportunity": "explicaci\xF3n breve de c\xF3mo cerrar esta venta",
  "newKnowledgePattern": {
    "category": "nombre_categoria_objecion",
    "triggerPhrase": "frase o duda t\xEDpica detectada",
    "recommendedCounter": "c\xF3mo Todo Lapto debe responder para cerrar la venta"
  }
}
Responde \xDANICAMENTE con el objeto JSON.`;
    const aiResult = await generateTextWithConfiguredAI({
      prompt,
      jsonMode: true
    });
    const parsed = JSON.parse(aiResult.text || "{}");
    if (parsed.newKnowledgePattern?.triggerPhrase && parsed.newKnowledgePattern?.recommendedCounter) {
      const addedInsight = {
        id: `learn-${Date.now()}`,
        category: parsed.newKnowledgePattern.category || "objecion_detectada",
        triggerPhrase: parsed.newKnowledgePattern.triggerPhrase,
        winningPitch: parsed.newKnowledgePattern.recommendedCounter,
        counterObjection: `Aprendido de conversaci\xF3n real con ${conv.customerName}`,
        successRate: 87,
        occurrences: 1,
        tags: parsed.detectedInterests || ["aprendizaje_automatico"],
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      learnedInsights.unshift(addedInsight);
    }
    res.json({
      success: true,
      analysis: parsed,
      totalInsights: learnedInsights.length
    });
  } catch (err) {
    console.error("Learning extraction error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});
function isSimpleConversationalMessage(rawText, hasQuote = false) {
  if (hasQuote) return false;
  const cleaned = (rawText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¡!¿?.,;:"'()\-_*~]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 65) return false;
  const commercialOrProductRegex = /\b(laptop|lapto|laptos|portatil|notebook|computadora|pc|mouse|raton|impresora|epson|canon|brother|teclado|monitor|pantalla|bocina|parlante|audifono|auricular|headset|diadema|disco|ssd|nvme|ram|memoria|cargador|bateria|router|modem|ups|inversor|mochila|bulto|maletin|camara|webcam|cable|hdmi|vga|usb|adaptador|dell|hp|lenovo|thinkpad|latitude|chromebook|asus|acer|macbook|apple|precio|cuanto|cuesta|vale|catalogo|disponible|stock|barat[oa]|economic[oa]|usad[oa]|nuev[oa]|reacondicionad[oa]|reparacion|reparan|arreglan|garantia|envio|delivery|tienda|ubicacion|direccion|horario|abierto|cerrado|comprar|apartar|pedido|cotizacion|transferencia|cuenta|banco|anuncio|foto|vacante|empleo|trabajo|estudio|oficina|gamer|juego|\d{3,})\b/i;
  if (commercialOrProductRegex.test(cleaned)) {
    return false;
  }
  const simplePatterns = /^(hola|saludos|saludo|buenas|buen dia|buenos dias|buenas tardes|buenas noches|que tal|como estan|como estas|todo bien|klk|que lo que|hey|alo|buenas todo lapto|hola todo lapto|saludos todo lapto|hola buenas|hola buenos dias|hola buenas tardes|hola buenas noches|saludos buenas|saludos buenos dias|saludos buenas tardes|disculpa|disculpe|una pregunta|tengo una pregunta|una consulta|gracias|muchas gracias|mil gracias|ok|okay|esta bien|ta bien|perfecto|excelente|entendido|listo|amen|bendiciones|un placer|igualmente|igual)(\s+(amigo|amiga|hermano|lider|bro|senor|sr|sra|jefe|equipo|todo lapto|por favor|gracias))?$/i;
  return simplePatterns.test(cleaned);
}
function buildInstantConversationalReply(conv, rawText = "") {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : "";
  const namePart = customerName ? `, ${customerName}` : "";
  const cleaned = (rawText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¡!¿?.,;:"'()\-_*~]/g, " ").replace(/\s+/g, " ").trim();
  const hasPriorMessages = (conv?.messages || []).filter((m) => m.sender === "assistant" || m.sender === "customer").length > 1;
  if (/\b(gracias|muchas gracias|mil gracias|bendiciones|amen|un placer|igualmente|igual)\b/i.test(cleaned)) {
    return `\xA1Siempre a tu orden en *Todo Lapto*${namePart}! \u{1F60A} Cualquier otra consulta aqu\xED estamos para servirte.`;
  }
  if (/^(ok|okay|esta bien|ta bien|perfecto|excelente|entendido|listo|dale)\b/i.test(cleaned)) {
    return `\xA1Perfecto${namePart}! \u{1F44D} Quedamos atentos por aqu\xED para ayudarte con lo que necesites en *Todo Lapto*.`;
  }
  if (/\b(disculpa|disculpe|una pregunta|tengo una pregunta|una consulta)\b/i.test(cleaned)) {
    return `\xA1Claro que s\xED${namePart}! \u{1F60A} Cu\xE9ntanos, \xBFen qu\xE9 te podemos colaborar hoy?`;
  }
  if (hasPriorMessages) {
    return `\xA1Saludos de nuevo${namePart}! \u{1F60A} Cu\xE9ntanos, \xBFen qu\xE9 m\xE1s te podemos ayudar?`;
  }
  let greetingWord = "\xA1Hola";
  if (/\bsaludos?\b/i.test(cleaned)) {
    greetingWord = "\xA1Saludos";
  } else if (/\bbuenos?\s*dias?\b/i.test(cleaned)) {
    greetingWord = "\xA1Buenos d\xEDas";
  } else if (/\bbuenas?\s*tardes?\b/i.test(cleaned)) {
    greetingWord = "\xA1Buenas tardes";
  } else if (/\bbuenas?\s*noches?\b/i.test(cleaned)) {
    greetingWord = "\xA1Buenas noches";
  } else if (/\bbuenas\b/i.test(cleaned)) {
    greetingWord = "\xA1Buenas";
  }
  return `${greetingWord}${namePart}! \u{1F60A} Bienvenido a *Todo Lapto* \u{1F4BB}. \xBFEn qu\xE9 te podemos colaborar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?`;
}
function resolveDirectStoreQuestion(rawText, conv) {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : "";
  const namePart = customerName ? `, ${customerName}` : "";
  const cleaned = (rawText || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¡!¿?.,;:"'()\-_*~]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 80) return null;
  if (/\b(estan abiertos|estan abierto|ta abierto|tan abierto|abren hoy|a que hora abren|hasta que hora|cual es el horario|que horario tienen|horario de atencion|horario de trabajo|abren los domingos|abren los sabados|esta abierta la tienda|estan laborando|laboran hoy)\b/i.test(
    cleaned
  ) || /^(abierto|abiertos|horario)\??$/i.test(cleaned)) {
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    if (rdNow.isOpen) {
      return `\xA1Claro que s\xED${namePart}! Estamos abiertos ahora mismo en nuestra tienda f\xEDsica en la **Av. Charles de Gaulle No. 133** hasta las 6:00 PM. Puedes pasar a visitarnos o con gusto te coordinamos el env\xEDo directo a tu direcci\xF3n. \u{1F6D2}`;
    } else {
      return `Actualmente nos encontramos fuera de horario${namePart}. Abrimos ${rdNow.nextOpeningStr} en nuestra tienda f\xEDsica en la **Av. Charles de Gaulle No. 133**. Con gusto te tomamos tu pedido por aqu\xED para despacharlo a primera hora. \u{1F6D2}`;
    }
  }
  if (/\b(donde estan|donde estan ubicados|cual es la ubicacion|donde queda|donde queda la tienda|cual es la direccion|donde estan ustedes|tienen tienda fisica|donde puedo ir|puedo pasar por la tienda)\b/i.test(
    cleaned
  ) || /^(ubicacion|direccion)\??$/i.test(cleaned)) {
    return `Estamos ubicados en la **Av. Charles de Gaulle No. 133, Santo Domingo Este** (frente a la estaci\xF3n del telef\xE9rico). \xBFTienes pensado pasar por la tienda hoy o prefieres que coordinemos el env\xEDo a domicilio? \u{1F4CD}`;
  }
  if (/\b(hacen envios|tienen envio|tienen delivery|hacen delivery|envian al interior|como es el envio|costo de envio|pago contra entrega)\b/i.test(
    cleaned
  ) || /^(envio|envios|delivery)\??$/i.test(cleaned)) {
    return `S\xED, realizamos env\xEDos a todo el pa\xEDs${namePart}. En Santo Domingo contamos con servicio a domicilio con pago contra entrega para tu total seguridad. \xBFEn qu\xE9 sector o provincia te encuentras? \u{1F69A}`;
  }
  if (/\b(tienen garantia|cuanto de garantia|que tiempo de garantia|garantia tienen|dan garantia)\b/i.test(
    cleaned
  ) || /^(garantia)\??$/i.test(cleaned)) {
    return `Todos nuestros equipos cuentan con **garant\xEDa certificada de 6 meses por escrito** y soporte t\xE9cnico directo en Todo Lapto. \xBFBuscas alguna laptop o equipo en espec\xEDfico? \u{1F6E1}\uFE0F`;
  }
  if (/\b(metodos de pago|formas de pago|tienen cuenta|numero de cuenta|cuentas de banco|aceptan transferencia|aceptan tarjeta)\b/i.test(
    cleaned
  )) {
    return `Aceptamos pago contra entrega (efectivo o transferencia al recibir tu equipo en Santo Domingo) y transferencias bancarias a nuestras cuentas de **Banreservas, Banco Popular y BHD**. \xBFQu\xE9 m\xE9todo te resulta m\xE1s c\xF3modo? \u{1F4B3}`;
  }
  return null;
}
function resolveDirectCatalogReply(rawText, conv, hasQuote = false) {
  if (hasQuote) return null;
  const cleaned = (rawText || "").trim();
  if (!cleaned || cleaned.length > 160) return null;
  if (/\b(apartar|ap[aá]rtame|lo\s*quiero|la\s*quiero|me\s*llevo|comprar|hacer\s*pedido|mi\s*direcci[oó]n|env[ií]amelo|m[aá]ndamelo|calle|sector|avenida|residencial|urbanizaci[oó]n|contra\s*entrega|ya\s*transfer[ií]|comprobante)\b/i.test(
    cleaned
  )) {
    return null;
  }
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : "";
  const namePart = customerName ? `, ${customerName}` : "";
  const highlight = getRelevantProductsHighlight(cleaned, "");
  if (!highlight) return null;
  const markerIdx = highlight.indexOf("):\n\n");
  if (markerIdx !== -1) {
    const listPart = highlight.slice(markerIdx + 4).trim();
    if (listPart) {
      return `\xA1Claro que s\xED${namePart}! \u{1F60A} Aqu\xED tienes las opciones disponibles en stock real en *Todo Lapto*:

${listPart}`;
    }
  }
  const directMatchMarker = "encontrados) ===\n";
  const directIdx = highlight.indexOf(directMatchMarker);
  if (directIdx !== -1) {
    const listPart = highlight.slice(directIdx + directMatchMarker.length).trim();
    if (listPart) {
      return `\xA1Claro que s\xED${namePart}! \u{1F60A} Aqu\xED tienes las opciones disponibles en stock real en *Todo Lapto*:

${listPart}

*\xBFCu\xE1l de estas opciones te interesa? Te lo aparto ahora mismo para entrega o retiro en tienda.* \u{1F6D2}`;
    }
  }
  if (highlight.includes("=== \u26A0\uFE0F SIN STOCK ACTUAL PARA")) {
    const genericFamily = detectGenericProductFamily(cleaned.toLowerCase());
    const famLabel = genericFamily?.label || "ese producto";
    return `Por el momento no tenemos unidades disponibles de *${famLabel}* en stock f\xEDsico${namePart}. \xBFBuscas alg\xFAn otro equipo, laptop o accesorio en el que te podamos colaborar hoy? \u{1F60A}`;
  }
  return null;
}
function buildSmartCatalogFallbackReply(conv, queryText = "") {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName.trim() : "";
  const namePart = customerName ? `, ${customerName}` : "";
  const lastMsg = conv?.messages[conv.messages.length - 1];
  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());
  const cleanUserQuery = queryText.replace(/📌 \[ATENCIÓN MÁXIMA[\s\S]*?Consulta del cliente:/gi, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  const storeAnswer = resolveDirectStoreQuestion(cleanUserQuery, conv);
  if (storeAnswer) {
    return storeAnswer;
  }
  if (hasQuote) {
    return `\xA1Claro que s\xED${namePart}! \u{1F60A} Recuerdo perfectamente lo que conversamos y las opciones siguen disponibles en nuestra tienda de la **Av. Charles de Gaulle No. 133**. \xBFTienes pensado pasar hoy por la tienda para apartarte el equipo, o prefieres que coordinemos el env\xEDo directo a tu direcci\xF3n? \u{1F6D2}`;
  }
  const directCatalog = resolveDirectCatalogReply(cleanUserQuery, conv, false);
  if (directCatalog) {
    return directCatalog;
  }
  const highlight = getRelevantProductsHighlight(cleanUserQuery, "");
  if (highlight) {
    const markerIdx = highlight.indexOf("):\n\n");
    if (markerIdx !== -1) {
      const listPart = highlight.slice(markerIdx + 4).trim();
      if (listPart) {
        return `\xA1Claro que s\xED${namePart}! \u{1F60A} Aqu\xED tienes las opciones disponibles en stock real en *Todo Lapto*:

${listPart}`;
      }
    }
    const directMatchMarker = "encontrados) ===\n";
    const directIdx = highlight.indexOf(directMatchMarker);
    if (directIdx !== -1) {
      const listPart = highlight.slice(directIdx + directMatchMarker.length).trim();
      if (listPart) {
        return `\xA1Claro que s\xED${namePart}! \u{1F60A} Aqu\xED tienes las opciones disponibles en stock real en *Todo Lapto*:

${listPart}

*\xBFCu\xE1l de estas opciones te interesa? Te lo aparto ahora mismo para entrega o retiro en tienda.* \u{1F6D2}`;
      }
    }
  }
  const hasPrior = (conv?.messages || []).filter((m) => m.sender === "assistant" || m.sender === "customer").length > 1;
  if (hasPrior) {
    return `\xA1Con gusto${namePart}! Cu\xE9ntanos qu\xE9 equipo o modelo espec\xEDfico est\xE1s buscando para ayudarte con los detalles y precios.`;
  }
  return `\xA1Hola${namePart}! \u{1F60A} Bienvenido a *Todo Lapto* \u{1F4BB}. \xBFEn qu\xE9 te podemos ayudar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?`;
}
function buildFastConversationalSystemInstruction(conv) {
  const customerName = conv?.customerName && !isGenericContactName(conv.customerName) ? conv.customerName : "";
  const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  return `Eres el asistente oficial de ventas de **Todo Lapto** en Rep\xFAblica Dominicana (WhatsApp).
Fecha y hora actual en RD: ${rdNow.fullDateStr} \xB7 ${rdNow.time12} (America/Santo_Domingo UTC-4).
Cliente actual: ${customerName || "Cliente de WhatsApp"}.

\u26A0\uFE0F REGLA ESTRICTA DE RESPUESTA R\xC1PIDA Y CONCISA (M\xC1XIMO 1 A 2 L\xCDNEAS):
1. El cliente acaba de enviar \xFAnicamente un saludo o mensaje corto de cortes\xEDa (sin pedir ning\xFAn producto a\xFAn).
2. Responde de inmediato en **1 a 2 l\xEDneas cortas como m\xE1ximo**, directo al grano, amable y natural:
   - Si es un saludo ("Saludos", "Hola", "Buenas", "Buenos d\xEDas", etc.):
     "\xA1Saludos${customerName ? `, ${customerName}` : ""}! \u{1F60A} Bienvenido a *Todo Lapto*. \xBFEn qu\xE9 te podemos ayudar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?"
   - Si es un agradecimiento o confirmaci\xF3n ("Gracias", "Ok", "Perfecto", "Est\xE1 bien"):
     "\xA1Siempre a tu orden en *Todo Lapto*! \u{1F60A} Cualquier consulta adicional aqu\xED estamos para servirte."
3. **ESTRICTAMENTE PROHIBIDO:**
   - \u274C PROHIBIDO enviar listas de laptops, precios o enlaces cuando el cliente solo salud\xF3.
   - \u274C PROHIBIDO decir "Actualmente estamos cerrados" en un saludo sencillo.`;
}
function buildMasterSalesSystemInstruction(conv, latestQuery = "") {
  const lastMsg = conv?.messages[conv.messages.length - 1];
  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());
  if (isSimpleConversationalMessage(latestQuery, hasQuote)) {
    return buildFastConversationalSystemInstruction(conv);
  }
  const rawTemplate = appConfig.aiProvider?.systemPrompt || OFFICIAL_TODO_LAPTO_MASTER_PROMPT;
  const cleanPhone = (conv?.customerPhone || "").replace(/\D/g, "");
  const detectedPhone = cleanPhone.length >= 10 && cleanPhone.length <= 13 ? cleanPhone.length === 10 ? `1${cleanPhone}` : cleanPhone : "NO DISPONIBLE";
  const quotedContext = lastMsg?.quotedMessage?.text || "";
  const relevantHighlight = getRelevantProductsHighlight(latestQuery, quotedContext);
  const inStock = products.filter((p) => p.virtual_available > 0 && p.list_price > 1);
  const inStockCount = inStock.length;
  const laptopCount = inStock.filter((p) => p.category === "laptop").length;
  const monitorCount = inStock.filter((p) => p.category === "monitor").length;
  const printerCount = inStock.filter((p) => p.category === "impresora").length;
  const compactOverview = `RESUMEN EJECUTIVO DE INVENTARIO ODOO EN TIEMPO REAL (${inStockCount} productos activos en stock f\xEDsico en Av. Charles de Gaulle #133):
- Laptops y Port\xE1tiles en stock: ${laptopCount} modelos (Dell, Lenovo ThinkPad, HP, Asus, Acer, Chromebooks desde RD$4,000 hasta ejecutivas y gaming).
- Monitores: ${monitorCount} modelos disponibles.
- Impresoras: ${printerCount} modelos disponibles.
- Accesorios y Repuestos: Discos SSD, memorias RAM, cargadores originales, bater\xEDas, mochilas, teclados y mouse en stock.
\u{1F449} NOTA: El mensaje actual del cliente no especific\xF3 un modelo o categor\xEDa concreta. Responde de forma breve (1 a 2 l\xEDneas), c\xE1lida y natural preguntando qu\xE9 equipo o modelo espec\xEDfico est\xE1 buscando.`;
  const inventoryContext = relevantHighlight ? `RESUMEN DE INVENTARIO ODOO EN TIEMPO REAL (${inStockCount} productos activos en stock vendible):
${relevantHighlight}` : compactOverview;
  const learnedContext = getLearnedInsightsPromptContext();
  const odooPartner = cleanPhone ? findOdooPartnerByPhone(cleanPhone) : null;
  const isOdooRegistered = Boolean(odooPartner || conv?.isOdooClient || conv?.odooPartnerId && conv.odooPartnerId > 0);
  const clientStatusText = isOdooRegistered ? `CLIENTE REGISTRADO (ID: #${odooPartner?.id || conv?.odooPartnerId || ""} - ${odooPartner?.name || conv?.customerName})` : `PROSPECTO NUEVO DE WHATSAPP (A\xFAn no registrado)`;
  const isPhoneMissingOrLid = detectedPhone === "NO DISPONIBLE" || detectedPhone.length < 10;
  const orderPhoneValidationDirective = isPhoneMissingOrLid ? `

\u26A0\uFE0F INSTRUCCI\xD3N OBLIGATORIA DEL SISTEMA PARA PEDIDOS:
El cliente actual NO TIENE un n\xFAmero telef\xF3nico verificado (solo dispone de ID t\xE9cnico de WhatsApp o nombre de usuario).
Si el cliente expresa intenci\xF3n de comprar, apartar, cotizar o hacer un pedido:
1. DEBES PAUSAR LA ORDEN Y PEDIR SU N\xDAMERO DE TEL\xC9FONO O WHATSAPP ("\xA1Con gusto! Para poder generar tu cotizaci\xF3n y registrar tu orden en el sistema, \xBFme confirmas por favor tu n\xFAmero de WhatsApp o tel\xE9fono de contacto?").
2. TIENES ESTRICTAMENTE PROHIBIDO ejecutar odoo_crear_cotizacion ni registrar_pedido hasta que el cliente proporcione su n\xFAmero telef\xF3nico real.` : "";
  const customerRecord = customers.find(
    (c) => cleanPhone && c.phone.includes(cleanPhone) || c.lidJid === conv?.sessionId
  );
  const customerOrders = salesOrders.filter(
    (o) => cleanPhone && o.clientPhone.includes(cleanPhone)
  );
  const crmCustomerContext = `

# CONTEXTO EN TIEMPO REAL DEL CLIENTE EN VENDEM\xC1 CRM
- Nombre en WhatsApp: ${conv?.customerName || "Cliente"}
- Tel\xE9fono verificado: ${detectedPhone}
- Estado del Cliente: ${clientStatusText}
- Zona estimada: ${customerRecord?.zone || conv?.zone || "Por confirmar"}
- Direcci\xF3n registrada: ${customerRecord?.address || "No proporcionada a\xFAn"}
- Intereses detectados: ${(conv?.detectedProducts || []).join(", ") || "Explorando cat\xE1logo"}
- Pedidos previos en CRM: ${customerOrders.length > 0 ? customerOrders.map((o) => `${o.id} (${o.products} - RD$${o.totalAmount.toLocaleString()} - Estado: ${o.status})`).join("; ") : "Ninguno a\xFAn"}${orderPhoneValidationDirective}`;
  const rdTimeContext = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const rdTimePromptBlock = buildDominicanTimePromptContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
  const filledInstruction = rdTimePromptBlock + "\n\n" + rawTemplate.replace(/\{\{\s*\$json\.telefono_cliente[^}]*\}\}/g, detectedPhone).replace(/\{\{TELEFONO_CLIENTE\}\}/g, detectedPhone).replace(/\{\{\s*\$json\.inventario_completo\s*\}\}/g, inventoryContext).replace(/\{\{INVENTARIO_COMPLETO\}\}/g, inventoryContext).replace(/\{\{APRENDIZAJE_CEREBRO_IA\}\}/g, learnedContext).replace(/\{\{HORA_RD\}\}/g, rdTimeContext.time12).replace(/\{\{FECHA_RD\}\}/g, rdTimeContext.fullDateStr).replace(/\{\{ESTADO_NEGOCIO\}\}/g, rdTimeContext.statusSummary).replace(/\{\{PROXIMA_APERTURA\}\}/g, rdTimeContext.nextOpeningStr).replace(/\{\{CONTEXTO_HORARIO_RD\}\}/g, rdTimePromptBlock) + crmCustomerContext;
  return filledInstruction;
}
function buildChatHistoryTurns(conv) {
  if (!conv || !conv.messages || conv.messages.length === 0) return [];
  const recent = conv.messages.slice(-18);
  const turns = [];
  for (const m of recent) {
    if (isInternalOrNoiseContent(m.content)) continue;
    const role = m.sender === "customer" ? "user" : "assistant";
    let text = m.transcription ? `\u{1F3A4} [Nota de voz transcrita]: "${m.transcription}"` : m.content || "";
    if (m.aiAnalysis) {
      text += `
[An\xE1lisis de Imagen IA: ${m.aiAnalysis}]`;
    }
    if (m.quotedMessage?.text) {
      text = `\u{1F4CC} [CITANDO MENSAJE ANTERIOR DE ${m.quotedMessage.author || "Todo Lapto"}]:
"${m.quotedMessage.text.slice(0, 800)}"

\u{1F449} [MENSAJE]: ${text}`;
    }
    if (!text.trim()) continue;
    if (role === "assistant" && text.includes("Cat\xE1logo completo de laptops") && text.length > 800) {
      text = text.slice(0, 400) + "\n... [Opciones de laptops enviadas previamente con modelos desde RD$4,000 en vitrina]";
    }
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].content += `
${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }
  return turns;
}
async function processAndExecuteCrmTools(rawAiResponse, conv) {
  const toolsExecuted = [];
  let cleanText = rawAiResponse;
  let createdOdooOrderId;
  let lastPartnerId;
  const toolBlockRegex = /<crm_tools>([\s\S]*?)<\/crm_tools>/gi;
  const matches = [...rawAiResponse.matchAll(toolBlockRegex)];
  for (const match of matches) {
    const jsonStr = match[1].trim();
    try {
      const actions = JSON.parse(jsonStr);
      const actionList = Array.isArray(actions) ? actions : [actions];
      for (const act of actionList) {
        const toolName = act.tool || act.name;
        const params = act.params || act.arguments || {};
        if (!toolName) continue;
        const phoneRaw = (params.telefono || conv?.customerPhone || "").replace(/\D/g, "");
        const stdPhone = phoneRaw.length === 10 ? `1${phoneRaw}` : phoneRaw;
        if (toolName === "guardar_telefono_cliente" && stdPhone) {
          if (conv && !conversations.some((other) => other.sessionId !== conv.sessionId && other.customerPhone === stdPhone)) {
            conv.customerPhone = stdPhone;
          }
          toolsExecuted.push("guardar_telefono_cliente");
        } else if (toolName === "odoo_buscar_cliente" && stdPhone && stdPhone.length >= 10) {
          try {
            const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, conv?.customerName);
            if (partnerResult?.id) {
              lastPartnerId = partnerResult.id;
              if (conv) {
                conv.odooPartnerId = partnerResult.id;
                conv.isOdooClient = true;
              }
            }
            toolsExecuted.push("odoo_buscar_cliente");
          } catch (e) {
            console.warn("[CRM Tool odoo_buscar_cliente error]:", e.message);
          }
        } else if (toolName === "odoo_crear_cliente") {
          try {
            if (!stdPhone || stdPhone.length < 10) {
              console.warn(`[CRM Tool odoo_crear_cliente Guard]: Tel\xE9fono no disponible o inv\xE1lido (${stdPhone || "vac\xEDo"}). No se crea cliente en Odoo sin tel\xE9fono.`);
            } else {
              const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, params.nombre || conv?.customerName);
              if (partnerResult?.id) {
                lastPartnerId = partnerResult.id;
                if (conv) {
                  conv.odooPartnerId = partnerResult.id;
                  conv.isOdooClient = true;
                }
              }
            }
            toolsExecuted.push("odoo_crear_cliente");
          } catch (e) {
            console.warn("[CRM Tool odoo_crear_cliente error]:", e.message);
          }
        } else if (toolName === "odoo_crear_cotizacion") {
          if (!stdPhone || stdPhone.length < 10) {
            console.warn(`[CRM Tool odoo_crear_cotizacion Guard]: Pausando creaci\xF3n de cotizaci\xF3n en Odoo: el cliente no tiene un tel\xE9fono v\xE1lido (${stdPhone || "vac\xEDo"}). Se debe pedir el tel\xE9fono primero.`);
          } else {
            try {
              if (!lastPartnerId) {
                const partnerResult = await findOrCreateOdooCustomerByPhone(stdPhone, conv?.customerName);
                if (partnerResult?.id) lastPartnerId = partnerResult.id;
              }
              const partnerIdToUse = lastPartnerId || 1;
              const orderId = await callOdoo("object", "execute_kw", [
                appConfig.odoo.db,
                appConfig.odoo.uid,
                appConfig.odoo.apiKey,
                "sale.order",
                "create",
                [
                  {
                    partner_id: partnerIdToUse,
                    origin: `WhatsApp CRM - ${params.metodo_pago || "Contra Entrega"}`,
                    note: `<p>WhatsApp CRM | Tel: ${stdPhone} | Direcci\xF3n: ${params.direccion || ""}</p>`,
                    order_line: [
                      [
                        0,
                        0,
                        {
                          product_id: Number(params.product_id) || products[0]?.variantId || 1042,
                          product_uom_qty: 1,
                          price_unit: Number(String(params.precio || 0).replace(/,/g, "")) || 15e3,
                          name: params.nombre_producto || "Producto Todo Lapto"
                        }
                      ]
                    ]
                  }
                ]
              ]);
              if (typeof orderId === "number") {
                createdOdooOrderId = orderId;
              }
              toolsExecuted.push("odoo_crear_cotizacion");
            } catch (e) {
              console.warn("[CRM Tool odoo_crear_cotizacion error]:", e.message);
            }
          }
        } else if (toolName === "registrar_pedido") {
          if (!stdPhone || stdPhone.length < 10) {
            console.warn(`[CRM Tool registrar_pedido Guard]: Pausando registro de pedido en CRM: el cliente no tiene un tel\xE9fono v\xE1lido (${stdPhone || "vac\xEDo"}).`);
          } else {
            const newOrder = {
              id: `PED-${Date.now()}`,
              odooOrderId: createdOdooOrderId || params.odoo_order_id,
              clientName: conv?.customerName || "Cliente WhatsApp",
              clientPhone: stdPhone,
              products: params.producto || "Producto Todo Lapto",
              totalAmount: Number(String(params.producto || "").replace(/[^\d.]/g, "")) || 0,
              paymentMethod: String(params.metodo_pago || "").toLowerCase().includes("transferencia") ? "transferencia" : "contra_entrega",
              status: String(params.estado || "").toLowerCase().includes("aprobado") ? "aprobado" : "pendiente",
              address: params.direccion || "Santo Domingo",
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            salesOrders.unshift(newOrder);
            toolsExecuted.push("registrar_pedido");
          }
        } else if (toolName === "notificar_equipo") {
          const tipo = params.tipo || "\u{1F514} ALERTA DE VENTAS CRM";
          const resumen = params.resumen || "";
          const alertText = `\u{1F514} *${tipo}*

\u{1F464} Cliente: ${conv?.customerName || "WhatsApp"}
\u{1F4F1} Tel\xE9fono: ${stdPhone || "No disponible"}
\u{1F4CB} Detalle: ${resumen}${createdOdooOrderId ? `
\u{1F9FE} Cotizaci\xF3n Odoo: #${createdOdooOrderId}` : ""}`;
          await sendEvolutionMessage(appConfig.evolution.teamPhone, alertText);
          toolsExecuted.push("notificar_equipo");
        }
      }
    } catch (e) {
      console.warn("[CRM Tool parse/exec warning]:", e.message);
    }
  }
  cleanText = cleanText.replace(toolBlockRegex, "").trim();
  cleanText = cleanText.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$2");
  if (createdOdooOrderId) {
    cleanText = cleanText.replace(/#\[ID de cotizaci[oó]n\]/gi, `#${createdOdooOrderId}`).replace(/#\[ID\]/gi, `#${createdOdooOrderId}`);
  }
  return { cleanText, toolsExecuted };
}
async function triggerSalesBotReplyForConversation(conv, triggerSource) {
  if (isWhatsAppGroup(conv.sessionId) || isWhatsAppGroup(conv.customerPhone)) {
    console.log(`\u{1F6E1}\uFE0F [Bot bloqueado]: Se ignor\xF3 generaci\xF3n autom\xE1tica para grupo (${conv.sessionId})`);
    return { success: false, error: "Los grupos de WhatsApp est\xE1n expresamente excluidos de las respuestas del bot" };
  }
  const initialLastMsg = conv.messages[conv.messages.length - 1];
  const initialSkip = shouldSkipBotReply(conv, initialLastMsg, triggerSource);
  if (initialSkip.skip) {
    return { success: false, error: initialSkip.reason };
  }
  if (!acquireBotLock(conv, triggerSource)) {
    return { success: false, error: "Ya se est\xE1 generando una respuesta para este chat" };
  }
  const startTime = Date.now();
  const initialMsgId = normalizeMsgIdKey(initialLastMsg?.evolutionMessageId || initialLastMsg?.id || "");
  if (initialMsgId && triggerSource !== "manual_crm_trigger") {
    const contactKeys = getConversationContactKeys(conv);
    markMessageIdProcessed(initialMsgId, contactKeys);
  }
  try {
    if (triggerSource === "live_evolution_poll" && initialLastMsg) {
      await sleepMs(1100 + Math.floor(Math.random() * 600));
      const preCheck = await hasEvolutionAlreadyAnsweredSince(conv, initialLastMsg);
      if (preCheck.answered) {
        const externalReply = preCheck.latestOutgoing?.content || "";
        recordBotReplyForConversation(
          conv,
          initialMsgId,
          initialLastMsg.transcription || initialLastMsg.content || "",
          externalReply
        );
        recordBotAuditLog({
          customerName: conv.customerName,
          customerPhone: conv.customerPhone,
          sessionId: conv.sessionId,
          triggerSource,
          incomingMessageId: initialMsgId,
          incomingText: initialLastMsg.transcription || initialLastMsg.content || "",
          decision: "blocked_already_answered",
          reason: `Bloqueado en pre-vuelo: Otra instancia activa (ej. Hostinger) ya respondi\xF3 en WhatsApp ("${externalReply.slice(0, 45)}...")`,
          replyText: externalReply,
          durationMs: Date.now() - startTime
        });
        return {
          success: false,
          error: "Ya respondido por otra instancia conectada a Evolution API"
        };
      }
    }
    const initialText = initialLastMsg?.transcription || initialLastMsg?.content || conv.lastMessagePreview || "";
    const initialHasQuote = Boolean(initialLastMsg?.quotedMessage?.text?.trim());
    const isInitialSimpleGreeting = initialLastMsg?.type === "text" && !initialLastMsg?.quotedMessage && isSimpleConversationalMessage(initialText, initialHasQuote);
    if (products.length === 0 && !isInitialSimpleGreeting) {
      await syncOdooInventory();
    }
    const needsHistoryHydration = !conv.messages || conv.messages.length === 0 || Boolean(initialLastMsg?.quotedMessage && !initialLastMsg.quotedMessage.text);
    if (needsHistoryHydration) {
      await loadEvolutionMessagesForChat(conv.sessionId);
    } else if (!conv.messagesLoaded && !isInitialSimpleGreeting) {
      loadEvolutionMessagesForChat(conv.sessionId).catch(() => {
      });
    }
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (!lastMsg) {
      return { success: false, error: "Sin mensajes en la conversaci\xF3n" };
    }
    if (lastMsg.sender !== "customer" && triggerSource !== "manual_crm_trigger") {
      return { success: false, error: "El \xFAltimo mensaje ya fue respondido por el equipo o el bot" };
    }
    if (lastMsg.type === "audio" && lastMsg.evolutionMessageId && !lastMsg.transcription) {
      try {
        const media = await fetchMediaBase64FromEvolution(lastMsg.evolutionMessageId, false);
        if (media) {
          const geminiClient = getActiveGeminiClient();
          const trRes = await geminiClient.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                { inlineData: { mimeType: media.mimetype.split(";")[0] || "audio/ogg", data: media.base64 } },
                { text: "Transcribe este mensaje de voz en espa\xF1ol con exactitud." }
              ]
            }
          });
          const trText = (trRes.text || "").trim();
          if (trText) {
            lastMsg.transcription = trText;
            lastMsg.content = `\u{1F3A4} "${trText}"`;
            transcriptionsByMsgId.set(lastMsg.evolutionMessageId, trText);
          }
        }
      } catch (e) {
        const cleanErr = formatCleanAiError(e);
        console.log("[Auto-Transcribe Audio Info]:", cleanErr.summary);
      }
    }
    if (lastMsg.type === "image" && lastMsg.evolutionMessageId && !lastMsg.aiAnalysis) {
      try {
        const media = await fetchMediaBase64FromEvolution(lastMsg.evolutionMessageId, false);
        if (media) {
          const geminiClient = getActiveGeminiClient();
          const imgRes = await geminiClient.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: {
              parts: [
                { inlineData: { mimeType: media.mimetype.split(";")[0] || "image/jpeg", data: media.base64 } },
                {
                  text: "Analiza esta imagen enviada por el cliente a Todo Lapto. Indica si es un comprobante de pago (banco, monto, referencia), una foto de laptop/producto, o un equipo para reparaci\xF3n, y describe todos los detalles visibles."
                }
              ]
            }
          });
          const analysis = (imgRes.text || "").trim();
          if (analysis) {
            lastMsg.aiAnalysis = analysis;
            aiAnalysisByMsgId.set(lastMsg.evolutionMessageId, analysis);
          }
        }
      } catch (e) {
        const cleanErr = formatCleanAiError(e);
        console.log("[Auto-Analyze Image Info]:", cleanErr.summary);
      }
    }
    const baseCustomerText = lastMsg.transcription || (lastMsg.aiAnalysis ? `${lastMsg.content || "\u{1F4F7} [Imagen enviada]"}
[Contenido de la imagen: ${lastMsg.aiAnalysis}]` : lastMsg.content) || "Hola, me gustar\xEDa recibir informaci\xF3n.";
    const hasQuote = Boolean(lastMsg.quotedMessage?.text?.trim());
    const isSimpleMsg = isSimpleConversationalMessage(baseCustomerText, hasQuote);
    const quotedBlock = hasQuote ? `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} [ATENCI\xD3N M\xC1XIMA \u2014 EL CLIENTE EST\xC1 CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACI\xD3N]
Autor del mensaje citado: ${lastMsg.quotedMessage.author || "Todo Lapto"}
Contenido del mensaje anterior que el cliente est\xE1 citando:
"""
${lastMsg.quotedMessage.text}
"""

Mensaje actual del cliente sobre esta cita anterior:
"${baseCustomerText}"

\u26A0\uFE0F REGLAS OBLIGATORIAS PARA ESTA CITA:
1. El cliente pregunta o se refiere a lo conversado anteriormente (la visita acordada a la tienda f\xEDsica de la Charles de Gaulle No. 133 o las opciones de laptops). NO est\xE1 citando un error ni pidiendo un cat\xE1logo nuevo.
2. EST\xC1 ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CAT\xC1LOGO COMPLETO AQU\xCD.
3. Responde de forma c\xE1lida, humana y concisa (m\xE1ximo 2 a 4 l\xEDneas):
   - Confirma de inmediato que s\xED recuerdas: "\xA1Claro que s\xED, ${conv.customerName}! Recuerdo perfectamente [lo que conversamos sobre tu visita a la tienda / las opciones de laptops que te mostr\xE9]."
   - Confirma que las opciones siguen disponibles en nuestra tienda de la Av. Charles de Gaulle No. 133.
   - Haz una pregunta directa para cerrar o coordinar: "\xBFTienes pensado pasar hoy por la tienda para apartarte el equipo, o prefieres que coordinemos el env\xEDo directo a tu direcci\xF3n?"
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa informaci\xF3n...", pedir que repitan lo dicho, o enviar mensajes evasivos. Tienes todo el contexto citado e inventario en tiempo real.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
` : "";
    const customerMessageText = quotedBlock ? `${quotedBlock}
Consulta del cliente: "${baseCustomerText}"` : baseCustomerText;
    const systemInstruction = buildMasterSalesSystemInstruction(conv, customerMessageText);
    const fullHistoryTurns = buildChatHistoryTurns(conv);
    if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === "user") {
      fullHistoryTurns.pop();
    }
    const historyTurns = isSimpleMsg ? fullHistoryTurns.slice(-4) : fullHistoryTurns;
    console.log(
      `\u{1F916} [Sales Bot Generating Reply (${triggerSource})]: Cliente="${conv.customerName}" | Simple="${isSimpleMsg ? "S\xCD (Fast-Path)" : "NO"}" | Citando="${hasQuote ? "S\xCD" : "NO"}" | Motor=${appConfig.aiProvider?.provider} (${appConfig.aiProvider?.model})`
    );
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    const liveTimePromptNotice = `[\u{1F552} HORA OFICIAL EN REP\xDABLICA DOMINICANA (AMERICA/SANTO_DOMINGO UTC-4)]:
- Fecha y hora actual en RD: ${rdNow.fullDateStr} \xB7 ${rdNow.time12} (${rdNow.time24} hrs)
- Estado operativo del negocio: ${rdNow.statusSummary} (${rdNow.statusDetail})
- Pr\xF3xima apertura comercial: ${rdNow.nextOpeningStr}
${rdNow.movedHolidayNotice ? `- Aviso de feriado hoy: ${rdNow.movedHolidayNotice}
` : ""}${rdNow.isOpen ? "\u{1F449} INSTRUCCI\xD3N DE HORARIO: La tienda f\xEDsica (Av. Charles de Gaulle #133) y el servicio de entregas est\xE1n ABIERTOS ahora mismo." : `\u{1F449} INSTRUCCI\xD3N DE HORARIO: Si el cliente SOLO est\xE1 saludando o preguntando por productos/precios, NO menciones que estamos cerrados; responde directo al grano. \xDANICAMENTE menciona que estamos cerrados (y que despachamos ${rdNow.nextOpeningStr}) si el cliente pregunta por el horario, si puede pasar por la tienda ahora mismo, o al momento de confirmar el despacho de un pedido.`}`;
    const hasPriorMessages = (conv.messages || []).filter((m) => m.id !== lastMsg.id).length > 0;
    const conversationStateNotice = hasPriorMessages ? `
\u26A0\uFE0F REGLA ESTRICTA DE CONVERSACI\xD3N EN CURSO: El cliente ya est\xE1 en medio de una conversaci\xF3n previa contigo en este chat. EST\xC1 TERMINANTEMENTE PROHIBIDO volver a saludarlo ("\xA1Hola [Nombre]!", "Bienvenido a Todo Lapto...", "\xBFEn qu\xE9 te podemos ayudar hoy?"). Responde DIRECTO y \xFAnicamente a lo que acaba de consultar en 1 a 2 l\xEDneas concisas, sin mensajes de m\xE1s ni p\xE1rrafos innecesarios.` : "";
    const promptToSend = isSimpleMsg ? `Mensaje actual del cliente (${conv.customerName}): "${baseCustomerText}"

\u26A0\uFE0F El cliente envi\xF3 un mensaje sencillo de saludo o cortes\xEDa. Responde directo al grano en 1 a 2 l\xEDneas cortas m\xE1ximo (sin enviar listas de productos y sin decir que estamos cerrados):` : `${liveTimePromptNotice}${conversationStateNotice}

Mensaje actual del cliente (${conv.customerName}):
${customerMessageText}

Responde ahora como el Agente Oficial de Ventas de Todo Lapto de forma clara, precisa y directa al grano:`;
    const directStoreReply = resolveDirectStoreQuestion(baseCustomerText, conv);
    const directCatalogReply = !directStoreReply ? resolveDirectCatalogReply(baseCustomerText, conv, hasQuote) : null;
    let aiResult;
    if (directStoreReply) {
      aiResult = {
        text: directStoreReply,
        providerUsed: "direct-operational-engine",
        modelUsed: "instant-store-faq"
      };
    } else if (isSimpleMsg) {
      aiResult = {
        text: buildInstantConversationalReply(conv, baseCustomerText),
        providerUsed: appConfig.aiProvider?.provider || "gemini",
        modelUsed: "instant-fast-path"
      };
    } else if (directCatalogReply) {
      aiResult = {
        text: directCatalogReply,
        providerUsed: "odoo-catalog-engine",
        modelUsed: "instant-catalog-match"
      };
    } else {
      try {
        aiResult = await generateTextWithConfiguredAI({
          prompt: promptToSend,
          systemInstruction,
          chatMessages: historyTurns,
          allowFallback: true
        });
      } catch (aiErr) {
        const cleanErr = formatCleanAiError(aiErr);
        console.log(`[Sales Bot]: Utilizando motor de cat\xE1logo en tiempo real (${cleanErr.summary})`);
        aiResult = {
          text: buildSmartCatalogFallbackReply(conv, customerMessageText),
          providerUsed: appConfig.aiProvider?.provider || "gemini",
          modelUsed: "catalog-smart-engine"
        };
      }
    }
    const { cleanText, toolsExecuted } = await processAndExecuteCrmTools(aiResult.text || "", conv);
    const aiReply = cleanText || "\xA1Hola! Bienvenido a *Todo Lapto* \u{1F4BB}. \xBFEn qu\xE9 te podemos ayudar hoy? \xBFBuscas alguna laptop, impresora o accesorio en espec\xEDfico?";
    if (triggerSource !== "manual_crm_trigger" && lastMsg) {
      const finalCheck = await hasEvolutionAlreadyAnsweredSince(conv, lastMsg);
      if (finalCheck.answered) {
        const externalReply = finalCheck.latestOutgoing?.content || aiReply;
        recordBotReplyForConversation(
          conv,
          initialMsgId,
          baseCustomerText,
          externalReply
        );
        recordBotAuditLog({
          customerName: conv.customerName,
          customerPhone: conv.customerPhone,
          sessionId: conv.sessionId,
          triggerSource,
          incomingMessageId: initialMsgId,
          incomingText: baseCustomerText,
          decision: "blocked_already_answered",
          reason: `Bloqueado justo antes de enviar: Otra instancia activa ya entreg\xF3 respuesta en WhatsApp ("${externalReply.slice(0, 45)}...")`,
          replyText: externalReply,
          durationMs: Date.now() - startTime
        });
        return {
          success: false,
          error: "Ya respondido por otra instancia antes del despacho"
        };
      }
    }
    const assistantMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: "assistant",
      type: "text",
      content: aiReply,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      status: "sent"
    };
    recordLocalMessage(conv.sessionId, assistantMessage, conv.customerPhone);
    conv.messages.push(assistantMessage);
    conv.lastTimestamp = assistantMessage.timestamp;
    conv.lastMessagePreview = aiReply;
    conv.lastMessageType = "text";
    broadcastEvent("new_message", { sessionId: conv.sessionId, message: assistantMessage });
    broadcastEvent("conversations_update", { count: conversations.length });
    const sendRes = await sendEvolutionMessageToConversation(conv, aiReply, 150);
    const sentOk = sendRes.ok;
    const durationMs = Date.now() - startTime;
    if (sendRes.messageId) {
      assistantMessage.evolutionMessageId = sendRes.messageId;
      assistantMessage.id = `evo-${sendRes.messageId}`;
      const contactKeys = getConversationContactKeys(conv);
      markMessageIdProcessed(sendRes.messageId, contactKeys);
    }
    setTimeout(() => {
      loadEvolutionMessagesForChat(conv.sessionId).then(() => {
        broadcastEvent("conversations_update", { count: conversations.length });
      }).catch(() => {
      });
    }, 1800);
    recordBotReplyForConversation(
      conv,
      initialLastMsg?.evolutionMessageId || initialLastMsg?.id || "",
      baseCustomerText,
      aiReply
    );
    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: initialLastMsg?.evolutionMessageId || initialLastMsg?.id || "",
      incomingText: baseCustomerText,
      decision: "sent",
      reason: `Respuesta entregada con \xE9xito a WhatsApp en ${durationMs}ms v\xEDa Evolution API (${aiResult.providerUsed} / ${aiResult.modelUsed})`,
      replyText: aiReply,
      durationMs
    });
    return {
      success: true,
      reply: aiReply,
      providerUsed: aiResult.providerUsed,
      modelUsed: aiResult.modelUsed,
      toolsExecuted,
      sentToWhatsApp: sentOk
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    recordBotAuditLog({
      customerName: conv.customerName,
      customerPhone: conv.customerPhone,
      sessionId: conv.sessionId,
      triggerSource,
      incomingMessageId: initialLastMsg?.evolutionMessageId || initialLastMsg?.id || "",
      incomingText: initialLastMsg?.transcription || initialLastMsg?.content || "",
      decision: "error",
      reason: `Error al procesar/enviar respuesta: ${err.message}`,
      durationMs
    });
    console.log(`[Sales Bot Info for ${conv.customerName}]:`, err.message);
    return { success: false, error: err.message };
  } finally {
    releaseBotLock(conv);
  }
}
app.post("/api/ai/generate-reply", async (req, res) => {
  const { sessionId, userMessage } = req.body;
  const conv = conversations.find((c) => c.sessionId === sessionId);
  const lastMsg = conv?.messages[conv.messages.length - 1];
  const baseText = userMessage || lastMsg?.transcription || lastMsg?.content || conv?.lastMessagePreview || "Hola";
  const hasQuote = Boolean(lastMsg?.quotedMessage?.text?.trim());
  const isSimpleMsg = isSimpleConversationalMessage(baseText, hasQuote);
  if (isSimpleMsg) {
    return res.json({
      success: true,
      reply: buildInstantConversationalReply(conv, baseText),
      toolsExecuted: [],
      providerUsed: appConfig.aiProvider?.provider || "gemini",
      modelUsed: "instant-fast-path"
    });
  }
  if (products.length === 0) {
    await syncOdooInventory();
  }
  if (conv && !conv.messagesLoaded) {
    await loadEvolutionMessagesForChat(conv.sessionId);
  }
  const quotedBlock = hasQuote ? `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F4CC} [ATENCI\xD3N M\xC1XIMA \u2014 EL CLIENTE EST\xC1 CITANDO UN MENSAJE ANTERIOR DE LA CONVERSACI\xD3N]
Autor del mensaje citado: ${lastMsg.quotedMessage.author || "Todo Lapto"}
Contenido del mensaje anterior que el cliente est\xE1 citando:
"""
${lastMsg.quotedMessage.text}
"""
Mensaje actual del cliente sobre la cita: "${baseText}"

\u26A0\uFE0F REGLAS OBLIGATORIAS:
1. El cliente pregunta o se refiere a lo conversado anteriormente (la visita acordada a la tienda f\xEDsica de la Charles de Gaulle No. 133 o las opciones de laptops). NO est\xE1 pidiendo un cat\xE1logo nuevo.
2. EST\xC1 ESTRICTAMENTE PROHIBIDO VOLVER A ENVIAR LA LISTA DE LAS 38 LAPTOPS O EL CAT\xC1LOGO COMPLETO AQU\xCD.
3. Responde de forma c\xE1lida, humana y concisa (m\xE1ximo 2 a 4 l\xEDneas) confirmando que s\xED recuerdas lo conversado, confirmando disponibilidad en tienda y preguntando si pasar\xE1 hoy por la tienda o prefiere coordinar env\xEDo.
4. ESTRICTAMENTE PROHIBIDO decir "Dame un momento para confirmar esa informaci\xF3n...", pedir que repitan lo dicho, o enviar mensajes evasivos.
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
` : "";
  const queryText = quotedBlock ? `${quotedBlock}
Consulta del cliente: "${baseText}"` : baseText;
  const systemInstruction = buildMasterSalesSystemInstruction(conv, queryText);
  const fullHistoryTurns = buildChatHistoryTurns(conv);
  if (fullHistoryTurns.length > 0 && fullHistoryTurns[fullHistoryTurns.length - 1].role === "user") {
    fullHistoryTurns.pop();
  }
  const historyTurns = fullHistoryTurns;
  try {
    const rdNow = getDominicanTimeContext(getEffectiveCurrentDate(), appConfig.holidayOverrides || []);
    const liveTimePromptNotice = `[\u{1F552} HORA OFICIAL EN REP\xDABLICA DOMINICANA (AMERICA/SANTO_DOMINGO UTC-4)]:
- Fecha y hora actual en RD: ${rdNow.fullDateStr} \xB7 ${rdNow.time12} (${rdNow.time24} hrs)
- Estado operativo del negocio: ${rdNow.statusSummary} (${rdNow.statusDetail})
- Pr\xF3xima apertura comercial: ${rdNow.nextOpeningStr}
${rdNow.movedHolidayNotice ? `- Aviso de feriado hoy: ${rdNow.movedHolidayNotice}
` : ""}${rdNow.isOpen ? "\u{1F449} INSTRUCCI\xD3N DE HORARIO: La tienda f\xEDsica y el servicio de entregas est\xE1n ABIERTOS ahora mismo." : `\u{1F449} INSTRUCCI\xD3N DE HORARIO: Si el cliente SOLO est\xE1 saludando o preguntando por productos/precios, NO menciones que estamos cerrados; responde directo al grano. \xDANICAMENTE menciona que estamos cerrados (y que despachamos ${rdNow.nextOpeningStr}) si el cliente pregunta por el horario, si puede pasar por la tienda ahora mismo, o al momento de confirmar el despacho de un pedido.`}`;
    const promptToSend = `${liveTimePromptNotice}

Mensaje actual del cliente:
${queryText}

Responde siguiendo las reglas del Agente Oficial de Ventas de Todo Lapto de forma clara, precisa y directa al grano:`;
    const directStoreReply = resolveDirectStoreQuestion(baseText, conv);
    const directCatalogReply = !directStoreReply ? resolveDirectCatalogReply(baseText, conv, hasQuote) : null;
    let result;
    if (directStoreReply) {
      result = {
        text: directStoreReply,
        providerUsed: "direct-operational-engine",
        modelUsed: "instant-store-faq"
      };
    } else if (directCatalogReply) {
      result = {
        text: directCatalogReply,
        providerUsed: "odoo-catalog-engine",
        modelUsed: "instant-catalog-match"
      };
    } else {
      try {
        result = await generateTextWithConfiguredAI({
          prompt: promptToSend,
          systemInstruction,
          chatMessages: historyTurns,
          allowFallback: true
        });
      } catch (aiErr) {
        const cleanErr = formatCleanAiError(aiErr);
        console.log(`[Generate Reply]: Utilizando motor de cat\xE1logo en tiempo real (${cleanErr.summary})`);
        result = {
          text: buildSmartCatalogFallbackReply(conv, queryText),
          providerUsed: appConfig.aiProvider?.provider || "gemini",
          modelUsed: "catalog-smart-engine"
        };
      }
    }
    const { cleanText, toolsExecuted } = await processAndExecuteCrmTools(result.text, conv);
    res.json({
      success: true,
      reply: cleanText,
      toolsExecuted,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed
    });
  } catch (err) {
    const cleanErr = formatCleanAiError(err);
    res.status(500).json({ success: false, message: cleanErr.summary });
  }
});
app.post("/api/conversations/:sessionId/auto-reply", async (req, res) => {
  const { sessionId } = req.params;
  const conv = conversations.find((c) => c.sessionId === sessionId);
  if (!conv) {
    return res.status(404).json({ success: false, message: "Conversaci\xF3n no encontrada" });
  }
  const result = await triggerSalesBotReplyForConversation(conv, "manual_crm_trigger");
  if (!result.success) {
    return res.status(500).json({ success: false, message: result.error || "Error al generar respuesta" });
  }
  res.json(result);
});
app.post("/api/ai/verify-receipt", async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ success: false, message: "Imagen requerida" });
  }
  try {
    const prompt = `Analiza esta imagen y determina si es un comprobante de pago bancario en Rep\xFAblica Dominicana (Banreservas, Banco Popular, BHD, Banco Santa Cruz, Qik, etc.).
Extrae los siguientes datos en formato JSON:
{
  "isPaymentReceipt": true | false,
  "bankName": "nombre del banco detectado",
  "amountRD": n\xFAmero flotante del monto transferido,
  "referenceNumber": "n\xFAmero de confirmaci\xF3n / autorizaci\xF3n / referencia",
  "date": "fecha y hora del comprobante si es visible",
  "destinationAccount": "cuenta o beneficiario destino",
  "senderName": "nombre de quien envi\xF3 la transferencia si aparece",
  "confidenceScore": n\xFAmero del 0 al 100,
  "summary": "resumen en una frase del comprobante"
}
Responde \xDANICAMENTE con el objeto JSON.`;
    const geminiClient = getActiveGeminiClient();
    const response = await geminiClient.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: imageBase64.replace(/^data:image\/[a-z]+;base64,/, "")
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json"
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    res.json({ success: true, verification: parsed });
  } catch (err) {
    const cleanErr = formatCleanAiError(err);
    res.status(500).json({ success: false, message: cleanErr.summary });
  }
});
var handleEvolutionWebhook = async (req, res) => {
  res.status(200).json({ received: true });
  const body = req.body || {};
  const rawEvent = (body?.event || body?.type || "").toString().trim().toLowerCase().replace(/[-_]/g, ".");
  const isMessageUpsert = rawEvent === "messages.upsert" || rawEvent === "messages_upsert" || rawEvent === "message" || rawEvent.endsWith(".upsert") && !rawEvent.includes("update");
  const messageData = Array.isArray(body?.data) ? body.data[0] : Array.isArray(body?.data?.messages) ? body.data.messages[0] : body?.data || body?.message || body;
  const key = messageData?.key;
  if (!isMessageUpsert || !key || key.fromMe) {
    return;
  }
  const messageId = normalizeMsgIdKey(key.id);
  const now = Date.now();
  if (isMessageIdAlreadyProcessed(messageId)) {
    return;
  }
  markMessageIdProcessed(messageId);
  const remoteJid = key.remoteJid || "";
  const rawAlt = key.remoteJidAlt || "";
  const participant = key.participant || "";
  if (isWhatsAppGroup(remoteJid) || isWhatsAppGroup(rawAlt) || isWhatsAppGroup(participant)) {
    return;
  }
  const senderNumber = (rawAlt.endsWith("@s.whatsapp.net") ? rawAlt : remoteJid).replace(/@.*$/, "").replace(/\D/g, "");
  const pushName = messageData.pushName || "Cliente WhatsApp";
  const parsedIncoming = parseSingleEvolutionMessage(messageData, pushName);
  if (!parsedIncoming) return;
  let conv = conversations.find(
    (c) => c.sessionId === remoteJid || senderNumber && c.customerPhone === senderNumber || relatedJidsBySession.get(c.sessionId)?.has(remoteJid)
  );
  if (!conv) {
    conv = {
      sessionId: remoteJid,
      customerPhone: senderNumber,
      customerName: pushName,
      aiEnabled: true,
      unreadCount: 1,
      lastTimestamp: parsedIncoming.timestamp,
      lastMessagePreview: parsedIncoming.content,
      lastMessageType: parsedIncoming.type,
      intentStatus: "explorando",
      detectedProducts: [],
      messages: [parsedIncoming],
      messagesLoaded: true,
      isLiveEvolution: true
    };
    conversations.unshift(conv);
  } else {
    conv.unreadCount += 1;
    conv.lastTimestamp = parsedIncoming.timestamp;
    conv.lastMessagePreview = parsedIncoming.content;
    conv.lastMessageType = parsedIncoming.type;
    if (!conv.messages.some(
      (m) => parsedIncoming.evolutionMessageId && m.evolutionMessageId === parsedIncoming.evolutionMessageId || parsedIncoming.id && m.id === parsedIncoming.id
    )) {
      conv.messages.push(parsedIncoming);
    }
  }
  broadcastEvent("new_message", { sessionId: conv.sessionId, message: parsedIncoming });
  broadcastEvent("conversations_update", { count: conversations.length });
  if (appConfig.supabase?.autoSync !== false) {
    autoSyncMessageToSupabase(conv, parsedIncoming).catch(() => {
    });
  }
  if (appConfig.globalAiActive && conv.aiEnabled) {
    const skipCheck = shouldSkipBotReply(conv, parsedIncoming, "evolution_webhook");
    if (skipCheck.skip) {
      console.log(`\u{1F6E1}\uFE0F [Webhook Skip]: ${skipCheck.reason} (${conv.customerName})`);
      return;
    }
    const contactKeys = getConversationContactKeys(conv);
    if (contactKeys.some((k) => isBotLockActive(k))) {
      console.log(`\u{1F6E1}\uFE0F [Webhook Skip]: Respuesta ya en proceso para ${conv.customerName}`);
      return;
    }
    triggerSalesBotReplyForConversation(conv, "evolution_webhook").catch((err) => {
      console.log(`[Sales Bot Webhook Trigger Info for ${conv.customerName}]:`, err?.message || err);
    });
  }
};
app.post("/api/webhook/evolution", handleEvolutionWebhook);
app.post("/api/webhook", handleEvolutionWebhook);
app.post("/webhook/evolution", handleEvolutionWebhook);
app.post("/webhook", handleEvolutionWebhook);
app.get(["/api/webhook/evolution", "/api/webhook", "/webhook/evolution", "/webhook"], (_req, res) => {
  res.json({
    status: "online",
    service: "Todo Lapto WhatsApp Evolution Webhook",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.post("/api/evolution/register-webhook", async (req, res) => {
  try {
    const rawUrl = (req.body?.webhookUrl || "").trim();
    if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) {
      return res.status(400).json({ success: false, message: "Faltan credenciales de Evolution API" });
    }
    const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, "");
    const instance = appConfig.evolution.instance;
    const hostHeader = req.get("x-forwarded-host") || req.get("host") || "todolapto.com";
    const proto = req.get("x-forwarded-proto") || req.protocol || "https";
    const defaultUrl = `${proto}://${hostHeader}/api/webhook/evolution`;
    const targetWebhookUrl = rawUrl || defaultUrl;
    const setRes = await fetch(`${baseUrl}/webhook/set/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: targetWebhookUrl,
          byEvents: false,
          base64: false,
          events: [
            "MESSAGES_UPSERT"
          ]
        }
      }),
      signal: AbortSignal.timeout(6e3)
    });
    if (!setRes.ok) {
      const errText = await setRes.text().catch(() => "");
      return res.status(setRes.status).json({
        success: false,
        message: `Evolution API devolvi\xF3 estado ${setRes.status}: ${errText.slice(0, 200)}`
      });
    }
    const data = await setRes.json().catch(() => ({}));
    return res.json({
      success: true,
      message: `Webhook registrado exitosamente en Evolution API apuntando a ${targetWebhookUrl}`,
      data
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});
async function ensureEvolutionWebhookRegistered(preferredUrl) {
  try {
    if (!appConfig.evolution.serverUrl || !appConfig.evolution.apiKey) return;
    const baseUrl = appConfig.evolution.serverUrl.replace(/\/$/, "");
    const instance = appConfig.evolution.instance;
    const findRes = await fetch(`${baseUrl}/webhook/find/${instance}`, {
      headers: { apikey: appConfig.evolution.apiKey },
      signal: AbortSignal.timeout(5e3)
    }).catch(() => null);
    let isEnabled = false;
    let registeredUrl = "";
    if (findRes && findRes.ok) {
      const data = await findRes.json().catch(() => null);
      isEnabled = Boolean(data?.enabled);
      registeredUrl = data?.url || "";
    }
    const targetUrl = (preferredUrl || appConfig.evolution.webhookUrl || "https://todolapto.com/api/webhook/evolution").trim();
    if (isEnabled && registeredUrl === targetUrl) {
      console.log(`[Webhook]: Webhook ya registrado y activo en Evolution API (${targetUrl})`);
      return;
    }
    const setRes = await fetch(`${baseUrl}/webhook/set/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: appConfig.evolution.apiKey
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: targetUrl,
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT"]
        }
      }),
      signal: AbortSignal.timeout(6e3)
    });
    if (setRes.ok) {
      console.log(`\u2705 [Webhook]: Webhook registrado exitosamente en Evolution API apuntando a ${targetUrl}`);
    }
  } catch (err) {
    console.log("[Webhook]: Auto-registro de webhook diferido:", err.message);
  }
}
app.get("/api/proxy-image", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith("http")) {
    return res.status(400).send("URL requerida");
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4e3);
    const upstream = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    clearTimeout(timeout);
    if (!upstream.ok) {
      return res.status(upstream.status === 403 || upstream.status === 404 ? 204 : upstream.status).end();
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = await upstream.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(Buffer.from(buffer));
  } catch {
    return res.status(204).end();
  }
});
async function startServer() {
  const isAiStudio = Boolean(process.env.AISTUDIO_APPLET_ID);
  const isProduction = process.env.NODE_ENV === "production";
  const candidateDist = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "dist"),
    path.join(process.cwd(), "public_html"),
    path.join(__dirname, "public_html")
  ].find((dir) => fs.existsSync(path.join(dir, "index.html")));
  const shouldUseVite = isAiStudio && !isProduction;
  let viteMounted = false;
  if (shouldUseVite) {
    try {
      console.log("[Server]: Running Vite development middleware for AI Studio live preview");
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      viteMounted = true;
    } catch (viteErr) {
      console.warn("[Server]: Could not mount Vite middleware, falling back to static:", viteErr.message);
    }
  }
  if (!viteMounted) {
    const distPath = candidateDist || path.join(process.cwd(), "dist");
    const publicPath = path.join(process.cwd(), "public");
    console.log(`[Server]: Production mode - serving static files via direct buffer from ${distPath}`);
    const MIME_TYPES = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".txt": "text/plain; charset=utf-8",
      ".webmanifest": "application/manifest+json"
    };
    const staticMemoryCache = /* @__PURE__ */ new Map();
    const readStaticAsset = (relPath) => {
      const cleanRel = relPath.replace(/^\/+/, "");
      if (!cleanRel || cleanRel.includes("..")) return null;
      if (staticMemoryCache.has(cleanRel)) {
        return staticMemoryCache.get(cleanRel);
      }
      const searchRoots = [distPath, path.join(__dirname, "dist"), publicPath, path.join(__dirname, "public")];
      for (const rootDir of searchRoots) {
        const fullPath = path.join(rootDir, cleanRel);
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase();
            const mime = MIME_TYPES[ext] || "application/octet-stream";
            const buffer = fs.readFileSync(fullPath);
            if (buffer.length < 5 * 1024 * 1024) {
              staticMemoryCache.set(cleanRel, { buffer, mime });
            }
            return { buffer, mime };
          }
        } catch {
        }
      }
      return null;
    };
    app.get(["/favicon.ico", "/favicon.svg"], (_req, res) => {
      const asset = readStaticAsset("favicon.svg") || readStaticAsset("favicon.ico");
      if (asset) {
        res.setHeader("Content-Type", asset.mime);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.status(200).send(asset.buffer);
      }
      return res.status(204).end();
    });
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/webhook/")) {
        return res.status(404).json({ error: "Endpoint no encontrado" });
      }
      const reqPath = decodeURIComponent(req.path || "/");
      if (reqPath !== "/" && reqPath !== "/index.html") {
        const asset = readStaticAsset(reqPath);
        if (asset) {
          res.setHeader("Content-Type", asset.mime);
          if (reqPath.startsWith("/assets/")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "public, max-age=3600");
          }
          return res.status(200).send(asset.buffer);
        }
        const ext = path.extname(reqPath).toLowerCase();
        if (ext && ext !== ".html") {
          return res.status(404).send("Asset not found");
        }
      }
      const indexAsset = readStaticAsset("index.html");
      if (indexAsset) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        return res.status(200).send(indexAsset.buffer);
      }
      return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(
        '<!DOCTYPE html><html><head><title>Vendem\xE1 CRM</title></head><body style="background:#090d12;color:#fff;font-family:sans-serif;padding:40px;text-align:center;"><h2>Vendem\xE1 CRM & Ventas</h2><p>Servidor activo. Por favor ejecuta <code>npm run build</code> para generar los archivos de la interfaz.</p></body></html>'
      );
    });
  }
  const server = http.createServer(app);
  server.keepAliveTimeout = 65e3;
  server.headersTimeout = 66e3;
  let isServerListening = false;
  app.listen = ((...args) => {
    if (isServerListening) {
      const cb = args.find((a) => typeof a === "function");
      if (cb) process.nextTick(cb);
      return server;
    }
    isServerListening = true;
    return server.listen(...args);
  });
  const onListening = () => {
    const addr = server.address();
    const addrStr = typeof addr === "string" ? `socket ${addr}` : addr ? `${addr.address}:${addr.port} (${addr.family})` : `puerto ${PORT}`;
    console.log(
      `\u{1F680} Vendem\xE1 CRM Server listening on ${addrStr} | env.PORT=${process.env.PORT || "default(3000)"} (PID: ${process.pid})`
    );
    setTimeout(() => {
      hydrateAndSyncUsersWithSupabase().then(() => hydrateAndSyncAiConfigWithSupabase()).then(() => hydrateAndSyncHolidaysWithSupabase()).then(() => autoSyncConfigToSupabase(appConfig)).then(() => syncOdooInventory()).then(() => syncOdooCustomers()).then(() => syncEvolutionChats()).then(() => ensureEvolutionWebhookRegistered()).catch((e) => console.log("Initial background sync info:", e?.message || e));
    }, 3500);
    setInterval(() => {
      syncEvolutionChats().catch(() => {
      });
    }, 2e4);
    setInterval(() => {
      syncOdooInventory().catch(() => {
      });
    }, 1e3 * 60 * 30);
    setInterval(() => {
      syncOdooCustomers().catch(() => {
      });
    }, 1e3 * 60 * 30);
  };
  server.on("error", (err) => {
    console.log(`[Server Listen Error on ${PORT}]:`, err.message);
    console.error(`[Server Listen Error on ${PORT}]:`, err.message);
  });
  if (!isServerListening) {
    isServerListening = true;
    server.listen(PORT, onListening);
  }
  const shutdown = (signal) => {
    console.log(`[Server] Received ${signal}. Closing gracefully...`);
    server.close(() => {
      console.log("[Server] HTTP server closed cleanly.");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("[Server] Forcing shutdown after timeout.");
      process.exit(1);
    }, 4e3).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
startServer();
var server_default = app;
export {
  app,
  server_default as default,
  startServer
};
