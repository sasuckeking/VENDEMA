import fs from 'fs';

const BASE = 'http://localhost:3000';

async function run() {
  console.log('====================================================');
  console.log('    AUDITORÍA COMPLETA Y EVALUACIÓN VENDEMÁ CRM     ');
  console.log('====================================================\n');

  let token = null;

  // 1. Auth Test
  console.log('1. Probando Autenticación Segura (/api/auth/login)...');
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nelson', password: 'elmejor19' })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token) {
      token = data.token;
      console.log(`   ✅ Login Exitoso: Usuario "${data.user.nombre}" (${data.user.role}). Token generado.`);
    } else {
      console.log(`   ❌ Falló Login:`, data);
    }
  } catch (e) {
    console.log(`   ❌ Error en Login:`, e.message);
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  // 2. Auth Me
  console.log('\n2. Probando Sesión (/api/auth/me)...');
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && (data.authenticated || data.success) ? `   ✅ Sesión Válida: ${data.user.username} (${data.user.role})` : `   ❌ Falló /api/auth/me:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/auth/me:`, e.message);
  }

  // 3. Config
  console.log('\n3. Probando Configuración del CRM (/api/config)...');
  try {
    const res = await fetch(`${BASE}/api/config`, { headers: authHeaders });
    const data = await res.json();
    if (res.ok && data.success) {
      console.log(`   ✅ Config OK: IA Activa=${data.config.globalAiActive}, Proveedor=${data.config.aiProvider?.provider} (${data.config.aiProvider?.model})`);
      console.log(`      Horario RD: ${data.businessSchedule?.formattedLocalTime} (Abierto: ${data.businessSchedule?.isOpen})`);
    } else {
      console.log(`   ❌ Falló /api/config:`, data);
    }
  } catch (e) {
    console.log(`   ❌ Error en /api/config:`, e.message);
  }

  // 4. Evolution API Connection Test
  console.log('\n4. Probando Conexión con Evolution API v2 (/api/evolution/test-connection)...');
  try {
    const res = await fetch(`${BASE}/api/evolution/test-connection`, { method: 'POST', headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Evolution API: Estado=${data.status?.state || 'OK'}, Instancia=${data.status?.instanceName || 'todolapto'}` : `   ⚠️ Evolution API Aviso:`, data);
  } catch (e) {
    console.log(`   ❌ Error en Evolution API test:`, e.message);
  }

  // 5. Evolution QR State
  console.log('\n5. Verificando Estado del QR y WhatsApp (/api/evolution/qrcode)...');
  try {
    const res = await fetch(`${BASE}/api/evolution/qrcode`, { headers: authHeaders });
    const data = await res.json();
    console.log(`   ℹ️ QR State: State=${data.state}, Connected=${data.connected}, OwnerJid=${data.ownerJid || 'none'}`);
  } catch (e) {
    console.log(`   ❌ Error en QR code:`, e.message);
  }

  // 6. Odoo Connection Test
  console.log('\n6. Probando Conexión con Odoo ERP (/api/odoo/test-connection)...');
  try {
    const res = await fetch(`${BASE}/api/odoo/test-connection`, { method: 'POST', headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Odoo Conectado: ${data.message} (UID: ${data.uid})` : `   ❌ Falló Odoo test:`, data);
  } catch (e) {
    console.log(`   ❌ Error en Odoo test:`, e.message);
  }

  // 7. Odoo Products
  console.log('\n7. Verificando Inventario de Odoo (/api/odoo/products)...');
  try {
    const res = await fetch(`${BASE}/api/odoo/products`, { headers: authHeaders });
    const data = await res.json();
    if (res.ok && data.success) {
      console.log(`   ✅ Productos Totales: ${data.totalCount} (Vitrina: ${data.vitrinaCount}, Almacén: ${data.almacenCount})`);
      const laptops = data.products.filter(p => p.category === 'laptop');
      console.log(`      Laptops disponibles en stock: ${laptops.length} modelos.`);
      if (laptops.length > 0) {
        console.log(`      Ejemplo: "${laptops[0].name}" - RD$${laptops[0].list_price} (Stock: ${laptops[0].qty_available})`);
      }
    } else {
      console.log(`   ❌ Falló Odoo products:`, data);
    }
  } catch (e) {
    console.log(`   ❌ Error en Odoo products:`, e.message);
  }

  // 8. Supabase Connection Test
  console.log('\n8. Probando Conexión con Supabase (/api/supabase/test-connection)...');
  try {
    const res = await fetch(`${BASE}/api/supabase/test-connection`, { method: 'POST', headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Supabase Conectado: ${data.message}` : `   ⚠️ Supabase Aviso:`, data);
  } catch (e) {
    console.log(`   ❌ Error en Supabase test:`, e.message);
  }

  // 9. Orders Pipeline
  console.log('\n9. Verificando Pipeline de Ventas y Pedidos (/api/orders)...');
  try {
    const res = await fetch(`${BASE}/api/orders`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Pedidos en Sistema: ${data.orders?.length || 0} pedidos cargados.` : `   ❌ Falló /api/orders:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/orders:`, e.message);
  }

  // 10. Customers Lead
  console.log('\n10. Verificando Clientes y Leads (/api/customers)...');
  try {
    const res = await fetch(`${BASE}/api/customers`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Clientes en Sistema: ${data.total || 0} clientes (Sincronizados desde Odoo: ${data.odooCount || 0}).` : `   ❌ Falló /api/customers:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/customers:`, e.message);
  }

  // 11. WhatsApp Statuses
  console.log('\n11. Verificando Estados de WhatsApp (/api/whatsapp-statuses)...');
  try {
    const res = await fetch(`${BASE}/api/whatsapp-statuses`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Estados Activos: ${data.statuses?.length || 0} promociones registradas.` : `   ❌ Falló /api/whatsapp-statuses:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/whatsapp-statuses:`, e.message);
  }

  // 12. AI Brain & Insights
  console.log('\n12. Verificando Cerebro IA y Aprendizaje (/api/ai/insights)...');
  try {
    const res = await fetch(`${BASE}/api/ai/insights`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Aprendizajes Registrados: ${data.insights?.length || 0} patrones en memoria.` : `   ❌ Falló /api/ai/insights:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/ai/insights:`, e.message);
  }

  // 13. System Diagnostics & Logs
  console.log('\n13. Verificando Diagnósticos y Registros (/api/system/logs y /api/system/diagnostics)...');
  try {
    const res = await fetch(`${BASE}/api/system/logs`, { headers: authHeaders });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ Logs del Sistema: ${data.entries?.length || 0} logs registrados.` : `   ❌ Falló /api/system/logs:`, data);
  } catch (e) {
    console.log(`   ❌ Error en /api/system/logs:`, e.message);
  }

  // 14. AI Provider Test (OpenAI)
  console.log('\n14. Probando Conexión en Vivo con Proveedor IA (/api/ai/test-provider)...');
  try {
    const res = await fetch(`${BASE}/api/ai/test-provider`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' })
    });
    const data = await res.json();
    console.log(res.ok && data.success ? `   ✅ OpenAI Conectado: ${data.message} (Respuesta: "${data.reply?.slice(0, 60)}...")` : `   ❌ Falló OpenAI test:`, data);
  } catch (e) {
    console.log(`   ❌ Error en OpenAI test:`, e.message);
  }

  // 15. Live Inbound Webhook Test
  console.log('\n15. Probando Ingesta de Mensajes de WhatsApp y Generación de Respuesta IA...');
  try {
    const testSessionId = '18099998877@s.whatsapp.net';
    const testMsgId = 'TEST_AUDIT_' + Date.now();
    const webhookPayload = {
      event: 'messages.upsert',
      instance: 'todolapto',
      data: {
        key: {
          remoteJid: testSessionId,
          fromMe: false,
          id: testMsgId
        },
        pushName: 'Cliente Auditoria',
        message: {
          conversation: 'Hola buenas tardes, ¿qué laptops tienen disponibles para oficina?'
        },
        messageTimestamp: Math.floor(Date.now() / 1000)
      }
    };

    const whRes = await fetch(`${BASE}/api/webhook/evolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    const whData = await whRes.json();
    console.log(`   ✅ Webhook HTTP Response:`, whData);

    // Wait 3 seconds for async AI processing & Queue
    console.log('   ⏳ Esperando procesamiento del Asistente de IA (3 segundos)...');
    await new Promise(r => setTimeout(r, 3500));

    // Check conversation history
    const convRes = await fetch(`${BASE}/api/conversations`, { headers: authHeaders });
    const convData = await convRes.json();
    const auditConv = convData.conversations?.find(c => c.sessionId === testSessionId);
    if (auditConv) {
      console.log(`   ✅ Conversación creada en CRM: ${auditConv.clientName || auditConv.customerName} (${auditConv.messages.length} mensajes)`);
      const lastMsg = auditConv.messages[auditConv.messages.length - 1];
      const msgText = lastMsg.content || lastMsg.text || '';
      console.log(`      Último mensaje (${lastMsg.sender}): "${msgText.slice(0, 100)}..."`);
    } else {
      console.log(`   ⚠️ La conversación no se encontró en la lista de conversaciones.`);
    }

  } catch (e) {
    console.log(`   ❌ Error en Webhook test:`, e.message);
  }

  console.log('\n====================================================');
  console.log('             FIN DE LA AUDITORÍA                    ');
  console.log('====================================================');
}

run();
