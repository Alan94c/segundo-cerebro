-- ============================================================
--  SEGUNDO CEREBRO — Schema Inicial PostgreSQL
--  Ejecutar: psql $DATABASE_URL -f este_archivo.sql
-- ============================================================

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para búsqueda por similitud

-- ============================================================
-- TABLA: users
-- Cada número de WhatsApp es un usuario único
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number  VARCHAR(20) UNIQUE NOT NULL,   -- Formato internacional: 521234567890
    name          VARCHAR(100),
    pin_hash      VARCHAR(255),                   -- PIN para login en frontend (bcrypt)
    timezone      VARCHAR(50) DEFAULT 'America/Mexico_City',
    is_active     BOOLEAN DEFAULT TRUE,
    google_linked BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);

-- ============================================================
-- TABLA: google_tokens
-- Tokens OAuth2 de Google Calendar por usuario
-- ============================================================
CREATE TABLE IF NOT EXISTS google_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    token_type      VARCHAR(50),
    expiry_date     BIGINT,                        -- Timestamp en ms (formato de googleapis)
    scope           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- ============================================================
-- TABLA: memories
-- Memoria a largo plazo: hechos, datos, fragmentos de información
-- ============================================================
CREATE TABLE IF NOT EXISTS memories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,                     -- El hecho en lenguaje natural
    tags        TEXT[],                            -- Etiquetas para filtro rápido
    source      VARCHAR(50) DEFAULT 'whatsapp',   -- 'whatsapp' | 'api' | 'image'
    search_vec  TSVECTOR,                          -- Vector para búsqueda full-text
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Índice GIN para búsqueda full-text en español
CREATE INDEX IF NOT EXISTS idx_memories_search ON memories USING GIN(search_vec);
CREATE INDEX IF NOT EXISTS idx_memories_user   ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_tags   ON memories USING GIN(tags);

-- Trigger para mantener search_vec actualizado automáticamente
CREATE OR REPLACE FUNCTION memories_search_vec_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vec := to_tsvector('spanish', COALESCE(NEW.content, '') || ' ' || COALESCE(array_to_string(NEW.tags, ' '), ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_search ON memories;
CREATE TRIGGER trg_memories_search
    BEFORE INSERT OR UPDATE ON memories
    FOR EACH ROW EXECUTE FUNCTION memories_search_vec_update();

-- ============================================================
-- TABLA: inventory_items
-- Objetos físicos con su ubicación actual (Metodología 5S)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_name       VARCHAR(200) NOT NULL,
    item_name_lower VARCHAR(200) GENERATED ALWAYS AS (LOWER(item_name)) STORED,
    current_location TEXT NOT NULL,
    description     TEXT,
    category        VARCHAR(100),
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_user  ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_name  ON inventory_items USING GIN(to_tsvector('spanish', item_name));
-- Índice único para el UPSERT en inventory.service.js (ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique ON inventory_items(user_id, item_name_lower);

-- ============================================================
-- TABLA: lists
-- Agrupadores de tareas (Lista de compras, Proyecto MEX 3, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS lists (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    color       VARCHAR(7) DEFAULT '#3B82F6',      -- Hex color para el frontend
    is_shared   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla puente para usuarios compartidos en una lista
CREATE TABLE IF NOT EXISTS list_members (
    list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(20) DEFAULT 'viewer',       -- 'viewer' | 'editor'
    PRIMARY KEY (list_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lists_owner ON lists(owner_id);

-- ============================================================
-- TABLA: tasks
-- Tareas individuales, vinculadas a una lista
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_id         UUID REFERENCES lists(id) ON DELETE SET NULL,
    assigned_to     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES users(id),
    title           TEXT NOT NULL,
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'in_progress' | 'completed' | 'cancelled'
    priority        VARCHAR(10) DEFAULT 'normal',   -- 'low' | 'normal' | 'high' | 'urgent'
    due_date        TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    source          VARCHAR(50) DEFAULT 'whatsapp',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_list     ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;

-- ============================================================
-- TABLA: reminders
-- Recordatorios con fecha/hora exacta para el scheduler
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks(id) ON DELETE CASCADE,   -- Opcional: vinculado a tarea
    message         TEXT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    is_sent         BOOLEAN DEFAULT FALSE,
    sent_at         TIMESTAMPTZ,
    is_recurring    BOOLEAN DEFAULT FALSE,
    recurrence_rule VARCHAR(100),                  -- Ej: 'daily', 'weekly', cron expr
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índice crítico: el scheduler escanea este índice cada minuto
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders(scheduled_at, is_sent)
    WHERE is_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);

-- ============================================================
-- TABLA: media_extractions
-- Registra lo que Gemini Vision extrajo de imágenes
-- ============================================================
CREATE TABLE IF NOT EXISTS media_extractions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type      VARCHAR(50),                   -- 'image' | 'document'
    original_url    TEXT,                          -- URL temporal de WA
    extracted_data  JSONB NOT NULL,                -- Entidades extraídas por Gemini
    raw_text        TEXT,                          -- Texto OCR completo
    linked_memory   UUID REFERENCES memories(id),
    linked_task     UUID REFERENCES tasks(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_user ON media_extractions(user_id);
CREATE INDEX IF NOT EXISTS idx_media_extracted ON media_extractions USING GIN(extracted_data);

-- ============================================================
-- FUNCIÓN: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger de updated_at a todas las tablas relevantes
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['users','google_tokens','memories','inventory_items','lists','tasks']
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_updated_at ON %I;
            CREATE TRIGGER trg_updated_at
                BEFORE UPDATE ON %I
                FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        ', t, t);
    END LOOP;
END;
$$;

-- ============================================================
-- DATOS INICIALES (opcional: usuario de prueba)
-- ============================================================
-- INSERT INTO users (phone_number, name) VALUES ('521234567890', 'Admin') ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLA: messages (Historial de Conversación)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    sender        VARCHAR(10) NOT NULL, -- 'user' o 'bot'
    message_type  VARCHAR(20) DEFAULT 'text',
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at DESC);
