# 🧠 Segundo Cerebro — WhatsApp Backend

Backend completo de un asistente personal inteligente operado vía WhatsApp. Usa Gemini AI para clasificar mensajes en lenguaje natural y ejecutar acciones en PostgreSQL y Google Calendar.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Base de datos | PostgreSQL 14+ |
| IA | Google Gemini 1.5 Flash |
| Canal | WhatsApp Cloud API (Meta) |
| Integraciones | Google Calendar OAuth2 |
| Scheduler | node-cron |
| Auth API | JWT + bcrypt |

---

## Inicio Rápido

### 1. Clonar / descargar y configurar entorno

```bash
# Copiar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales reales
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Crear la base de datos PostgreSQL

```bash
# Crear la base de datos
createdb segundo_cerebro

# Ejecutar las migraciones
psql $DATABASE_URL -f src/db/migrations/001_initial_schema.sql

# En Windows PowerShell:
# psql %DATABASE_URL% -f src/db/migrations/001_initial_schema.sql
```

### 4. Iniciar el servidor

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

Verás este output:
```
╔══════════════════════════════════════╗
║       🧠 SEGUNDO CEREBRO v1.0        ║
╚══════════════════════════════════════╝

✅  Variables de entorno: OK
✅  PostgreSQL conectado correctamente.
✅  Scheduler iniciado:
   • Recordatorios: cada minuto
   • Resumen diario: cron="0 7 * * *" (America/Mexico_City)

🚀  Servidor corriendo en http://localhost:3000
📡  Webhook:     POST http://localhost:3000/webhook
🔐  API REST:    http://localhost:3000/api/v1
📅  Google Auth: http://localhost:3000/auth/google
❤️   Health:      http://localhost:3000/api/v1/health
```

---

## Configuración de WhatsApp Cloud API

### Requisitos
1. Cuenta en [Meta for Developers](https://developers.facebook.com/)
2. App de tipo "Business" con WhatsApp habilitado
3. Número de teléfono registrado en Meta

### Pasos
1. En Meta for Developers → tu App → WhatsApp → Configuración
2. Configura el webhook:
   - **URL**: `https://TU_DOMINIO/webhook`
   - **Token de verificación**: El valor de `WEBHOOK_VERIFY_TOKEN` en tu `.env`
   - **Campos suscritos**: `messages`
3. Copia el **Token de acceso** → `WHATSAPP_TOKEN` en `.env`
4. Copia el **ID del número** → `WHATSAPP_PHONE_NUMBER_ID` en `.env`
5. Copia el **App Secret** (Configuración básica) → `WHATSAPP_APP_SECRET` en `.env`

> **Nota**: Para desarrollo local, usa [ngrok](https://ngrok.com/) para exponer tu puerto:
> ```bash
> ngrok http 3000
> # Usa la URL https://xxxx.ngrok.io/webhook en la configuración de Meta
> ```

---

## Configuración de Google Calendar OAuth2

### Requisitos
1. Proyecto en [Google Cloud Console](https://console.cloud.google.com/)
2. API de Google Calendar habilitada

### Pasos
1. Google Cloud Console → APIs y Servicios → Credenciales → Crear credenciales → ID de cliente OAuth
2. Tipo: **Aplicación web**
3. URI de redireccionamiento autorizado: `http://localhost:3000/auth/google/callback`
4. Copia **Client ID** y **Client Secret** al `.env`
5. Para vincular un usuario, abre en el navegador:
   ```
   http://localhost:3000/auth/google?userId=UUID_DEL_USUARIO
   ```

> Obtén el UUID del usuario consultando la BD: `SELECT id, phone_number FROM users;`

---

## Arquitectura de Módulos

```
src/
├── config/
│   ├── env.js          # Validación y exportación de env vars
│   └── db.js           # Pool de conexiones PostgreSQL
│
├── db/
│   └── migrations/
│       └── 001_initial_schema.sql   # 8 tablas + índices full-text
│
├── modules/
│   ├── webhook/
│   │   ├── webhook.routes.js       # GET (handshake) + POST (mensajes)
│   │   └── webhook.controller.js   # Orquestador principal
│   │
│   ├── nlp/
│   │   ├── gemini.client.js        # SDK Gemini (texto + visión)
│   │   ├── intent.router.js        # Clasificador de intenciones
│   │   ├── vision.extractor.js     # Extracción desde imágenes
│   │   └── action.dispatcher.js    # Enrutador de acciones
│   │
│   ├── memory/
│   │   ├── memory.service.js       # Memoria largo plazo (full-text)
│   │   └── inventory.service.js    # Inventario 5S (ubicaciones)
│   │
│   ├── tasks/
│   │   ├── list.service.js         # Listas y tareas
│   │   └── reminder.service.js     # Recordatorios programados
│   │
│   ├── whatsapp/
│   │   └── whatsapp.service.js     # Envío de mensajes WA
│   │
│   ├── calendar/
│   │   ├── google.auth.js          # OAuth2 + persistencia de tokens
│   │   ├── calendar.service.js     # CRUD de eventos en GCal
│   │   └── calendar.routes.js      # /auth/google + callback
│   │
│   ├── scheduler/
│   │   └── scheduler.js            # Cron jobs (recordatorios + digest)
│   │
│   └── api/
│       ├── auth.middleware.js      # Verificación JWT
│       ├── auth.routes.js          # Login, perfil, google-link
│       ├── tasks.routes.js         # CRUD tareas y listas
│       ├── memory.routes.js        # CRUD memorias
│       ├── inventory.routes.js     # CRUD inventario
│       ├── reminders.routes.js     # CRUD recordatorios
│       └── api.routes.js           # Router raíz /api/v1
│
├── app.js              # Express bootstrap (middlewares + rutas)
└── server.js           # Entry point (DB + scheduler + listen)
```

---

## API REST — Referencia

### Autenticación
Todos los endpoints `/api/v1/*` (excepto `/health`) requieren header:
```
Authorization: Bearer <JWT_TOKEN>
```

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Login con teléfono + PIN |
| `GET` | `/api/v1/auth/me` | Perfil del usuario |
| `PATCH` | `/api/v1/auth/profile` | Actualizar nombre/timezone |
| `GET` | `/api/v1/auth/google-link` | URL para vincular Google |
| `GET` | `/api/v1/tasks` | Listar tareas (`?listId=&status=`) |
| `GET` | `/api/v1/tasks/today` | Tareas de hoy |
| `POST` | `/api/v1/tasks` | Crear tarea |
| `PATCH` | `/api/v1/tasks/:id` | Actualizar tarea |
| `POST` | `/api/v1/tasks/:id/complete` | Completar tarea |
| `GET` | `/api/v1/tasks/lists` | Listar listas |
| `POST` | `/api/v1/tasks/lists` | Crear lista |
| `GET` | `/api/v1/memory` | Buscar memorias (`?q=texto`) |
| `POST` | `/api/v1/memory` | Guardar memoria |
| `DELETE` | `/api/v1/memory/:id` | Eliminar memoria |
| `GET` | `/api/v1/inventory` | Listar inventario (`?q=&category=`) |
| `POST` | `/api/v1/inventory` | Registrar ítem |
| `DELETE` | `/api/v1/inventory/:id` | Eliminar ítem |
| `GET` | `/api/v1/reminders` | Listar recordatorios futuros |
| `POST` | `/api/v1/reminders` | Crear recordatorio |
| `DELETE` | `/api/v1/reminders/:id` | Cancelar recordatorio |
| `GET` | `/api/v1/health` | Health check |

---

## Intenciones de Gemini

El sistema clasifica cada mensaje en una de estas 7 intenciones:

| Intent | Ejemplo de mensaje |
|---|---|
| `RECORDATORIO` | "Recuérdame comprar cable a las 3pm" |
| `MEMORIA_LARGO_PLAZO` | "El margen de las regletas debe ser $220" |
| `TAREA_LISTA` | "Agregar cinta aislante a la lista del súper" |
| `EVENTO_CALENDARIO` | "Mantenimiento CCTV mañana a las 4pm" |
| `INVENTARIO_5S` | "Guardé los módulos SABRE en la caja roja" |
| `CONSULTA` | "¿Dónde están los módulos SABRE?" |
| `CONVERSACION` | "Hola", "Gracias" |

---

## Variables de Entorno Requeridas

Ver [`.env.example`](./.env.example) para la documentación completa.

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL |
| `WHATSAPP_TOKEN` | Token de acceso de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número de WA |
| `WHATSAPP_APP_SECRET` | App Secret de Meta (para HMAC) |
| `WEBHOOK_VERIFY_TOKEN` | Token personalizado de verificación |
| `GEMINI_API_KEY` | API Key de Google AI Studio |
| `JWT_SECRET` | Secreto para firmar tokens JWT |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID de Google |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret de Google |

---

## Próximos Pasos (Fase 2)

- [ ] Frontend React con panel de control visual
- [ ] Transcripción de notas de voz (Whisper API o similar)
- [ ] Soporte para grupos de WhatsApp
- [ ] Búsqueda vectorial con pgvector para memoria semántica
- [ ] Notificaciones push en el frontend (WebSockets)
