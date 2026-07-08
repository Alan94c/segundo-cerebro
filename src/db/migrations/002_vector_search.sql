-- ============================================================
-- MIGRACIÓN 002: Búsqueda Semántica con pgvector
-- Habilita soporte para embeddings en la memoria
-- ============================================================

-- 1. Habilitar la extensión vector si no está activa
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Añadir la columna de embedding a la tabla de memories (768 dimensiones)
-- Usamos 768 dimensiones pasándole el parámetro outputDimensionality al modelo gemini-embedding-2.
-- Esto soluciona el límite de 2000 dimensiones máximas de pgvector para índices HNSW.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 3. Crear índice HNSW para búsqueda rápida por similitud del coseno
-- HNSW es mucho más rápido y escalable que IVFFlat para producción.
-- Usamos vector_cosine_ops ya que la distancia del coseno es la recomendada para embeddings de texto.
CREATE INDEX IF NOT EXISTS idx_memories_embedding 
ON memories USING hnsw (embedding vector_cosine_ops);
