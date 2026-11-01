# Conexión y Subida Total a Supabase & Jerarquía de Usuarios (RBAC)

## 1. Jerarquía de Usuarios y Autenticación (Sin Correos)
Se implementó un sistema de acceso y control de permisos jerárquico estricto donde **no se utiliza ningún correo electrónico**, únicamente:
- **Nombre Completo**
- **Nombre de Usuario** (`username`)
- **Contraseña**
- **Número de WhatsApp** (con botón de apertura directa a chat)
- **Rol y Nivel de Jerarquía**:
  1. 👑 **Super Admin (`super_admin`)**:
     - Usuario principal: `nelson` / Contraseña: `elmejor19`.
     - Control total e irrestricto de la plataforma.
     - Es el único con potestad para crear, editar, reactivar y eliminar cualquier usuario del sistema (Nelson está blindado contra eliminación o degradación).
     - Acceso completo a la configuración de conexiones (Odoo, Evolution API, Supabase, OpenAI, DeepSeek, Gemini).
  2. 👔 **Dueño del Negocio (`dueno`)**:
     - Acceso completo a métricas, pedidos, finanzas, inventario, clientes y chats de WhatsApp.
     - Capacidad para crear y supervisar las cuentas de sus empleados.
  3. 🎧 **Empleado / Vendedor (`empleado`)**:
     - Interfaz comercial enfocada: WhatsApp Inbox (atención en vivo), Inventario (stock vitrina/almacén), Pedidos & Cobros y Clientes.
     - **Restricción de seguridad**: Las credenciales de API, tokens de Odoo/WhatsApp/Supabase y la pestaña de configuración están ocultas para proteger los secretos comerciales.

## 2. Componentes Frontend Desarrollados
- **`src/components/LoginView.tsx`**: Pantalla de login elegante con campos de usuario y contraseña, selector de visibilidad de clave y accesos directos rápidos para Nelson (Super Admin), Dueño y Empleado.
- **`src/components/UsersView.tsx`**: Panel completo de gestión de usuarios con tarjetas de métricas, tabla detallada, modal de creación/edición, control de activación y accesos directos a WhatsApp.
- **`src/components/Navbar.tsx`**: Integración de perfil de usuario activo con insignia de rol, botón de cierre de sesión y filtrado de pestañas según el rol.
- **`src/App.tsx`**: Gestión de sesión activa con persistencia en `localStorage`.

## 3. Endpoints Backend (`server.ts`) y Persistencia (`.vendema-users.json`)
- `POST /api/auth/login`: Autentica por usuario y contraseña, actualiza último acceso y genera token.
- `GET /api/auth/me`: Verifica la sesión actual.
- `POST /api/auth/logout`: Cierra sesión.
- `GET /api/users`: Lista todos los usuarios registrados (con passwords sanitizados).
- `POST /api/users`: Crea un nuevo usuario validando username único.
- `PUT /api/users/:id`: Edita datos, rol, estado o actualiza contraseña.
- `DELETE /api/users/:id`: Elimina usuarios (con protección estricta para no eliminar a `nelson`).
