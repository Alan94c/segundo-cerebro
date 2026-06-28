# 🧠 Arquitectura de Segundo Cerebro

El bot funciona como una API construida sobre **Node.js** y **Express**, usando una base de datos **PostgreSQL** para la persistencia.

```
                  [ WhatsApp de Alan ]
                           ↕
                  [ Webhook en Render ]
                           ↕
           [ Enrutador de Intenciones (Gemini) ]
              ↙            ↓            ↘
     [ Recordatorios ]  [ Tareas ]  [ Google Calendar ]
              ↘            ↓            ↙
                 [ Base de Datos (PG) ]
```

---

## 📁 Estructura del Código

La lógica está organizada dentro de la carpeta `src/modules/`:

### 1. 📥 Recibir Mensajes (`src/modules/webhook/`)
Aquí se encuentra el archivo [webhook.controller.js](file:///C:/Users/MSI/.gemini/antigravity/scratch/segundo-cerebro/src/modules/webhook/webhook.controller.js). Su única tarea es recibir el mensaje que le envías por WhatsApp, verificar de qué tipo es (texto, imagen, audio) e iniciar el proceso correspondiente.

### 2. 🧠 El Enrutador NLP (`src/modules/nlp/`)
Este es el "cerebro" del asistente:
* **[intent.router.js](file:///C:/Users/MSI/.gemini/antigravity/scratch/segundo-cerebro/src/modules/nlp/intent.router.js)**: Toma tu texto, le añade el contexto actual (la fecha y hora actual en México) y se lo envía a **Gemini 2.5 Flash** para clasificar qué quieres hacer (`RECORDATORIO`, `TAREA_LISTA`, `EVENTO_CALENDARIO`, etc.) y extraer los datos importantes (fechas, nombres de objetos).
* **[gemini.client.js](file:///C:/Users/MSI/.gemini/antigravity/scratch/segundo-cerebro/src/modules/nlp/gemini.client.js)**: Contiene el cliente de Gemini y el **sistema de respaldo (fallback)** que implementamos, el cual intercambia las claves de API automáticamente si detecta un error de cuota `429`.

### 3. ⚙️ El Despachador de Acciones (`src/modules/nlp/action.dispatcher.js`)
El [action.dispatcher.js](file:///C:/Users/MSI/.gemini/antigravity/scratch/segundo-cerebro/src/modules/nlp/action.dispatcher.js) toma el resultado estructurado de Gemini y ejecuta la acción correcta en la base de datos o en los servicios correspondientes:
* Si es un **Recordatorio**: Llama a `reminder.service.js` para programarlo.
* Si es una **Tarea**: La añade a la tabla de pendientes.
* Si es un **Evento**: Llama a `calendar.service.js` para agendarlo en tu cuenta vinculada de Google Calendar.
* Si es un comando de **Borrado**: Ejecuta la query de limpieza masiva (`DELETE`).

### 4. ⏰ El Planificador de Recordatorios (`src/modules/scheduler/`)
El archivo [scheduler.js](file:///C:/Users/MSI/.gemini/antigravity/scratch/segundo-cerebro/src/modules/scheduler/scheduler.js) corre en segundo plano cada minuto gracias a un programador de tareas en Node (cron). 
* Verifica si hay recordatorios programados en la base de datos cuya fecha ya haya pasado (`scheduled_at <= NOW()`).
* Si encuentra alguno pendiente, envía el mensaje por WhatsApp a tu número y marca el recordatorio como enviado (`is_sent = true`).

---

## 🛠️ ¿Dónde está la Base de Datos?

La base de datos es un servicio de PostgreSQL hospedado también en Render. Las tablas principales son:
* **`users`**: Registra tu número de teléfono y tu zona horaria.
* **`reminders`**: Guarda los mensajes de tus recordatorios y la fecha/hora exacta en la que se deben enviar.
* **`tasks`**: Tu lista de tareas pendientes.
* **`media_extractions`**: Almacena los resultados del análisis de tickets y fotos procesadas por Gemini Vision.

---

## 🌐 Configuración en la Nube
* **Servidor**: Corre gratis en Render y se mantiene activo 24/7 gracias al ping de **UptimeRobot** que configuramos en `/api/v1/health`.
* **Variables**: Todo el comportamiento se gobierna desde las variables de entorno de Render (claves API, tokens de WhatsApp y URLs de acceso a la base de datos).
