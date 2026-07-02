const { Pool } = require('pg');

// Conexión segura usando la URL que nos dará Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    // 1. Tabla de Cursos (Guarda el nombre, link de WhatsApp y fechas clave)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cursos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        whatsapp_link TEXT DEFAULT '',
        fechas_importantes TEXT DEFAULT 'No hay fechas importantes agendadas.'
      );
    `);

    // 2. Tabla de Alumnos (Vinculados a un curso y control de clave inicial)
    await client.query(`
      CREATE TABLE IF NOT EXISTS alumnos (
        id SERIAL PRIMARY KEY,
        nombre_completo VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        curso_id INT REFERENCES cursos(id) ON DELETE SET NULL,
        primer_ingreso BOOLEAN DEFAULT TRUE
      );
    `);

    // 3. Banco Global de Tareas (Agrupadas por tema con archivos/links y prerrequisitos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tareas (
        id SERIAL PRIMARY KEY,
        tema VARCHAR(100) NOT NULL,
        actividad VARCHAR(200) NOT NULL,
        tipo VARCHAR(50) NOT NULL, -- 'video', 'test', 'archivo'
        recurso_url TEXT DEFAULT '', -- Enlace de YouTube, Drive, Geogebra, etc.
        requiere_entrega BOOLEAN DEFAULT FALSE,
        fecha_entrega DATE,
        prerrequisito_id INT REFERENCES tareas(id) ON DELETE SET NULL
      );
    `);

    // 4. Adecuación Curricular (Para omitir/excluir tareas a alumnos específicos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS adecuaciones (
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        excluido BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (alumno_id, tarea_id)
      );
    `);

    // 5. Entregas, Vistos y Devoluciones de los Alumnos
    await client.query(`
      CREATE TABLE IF NOT EXISTS entregas (
        id SERIAL PRIMARY KEY,
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        completada BOOLEAN DEFAULT FALSE,
        archivo_url TEXT DEFAULT '', -- Guardado en Cloudinary
        devolucion TEXT DEFAULT '',
        necesita_reiniciar BOOLEAN DEFAULT FALSE,
        respuestas_test TEXT DEFAULT '', -- Para guardar respuestas de cuestionarios
        UNIQUE(alumno_id, tarea_id)
      );
    `);

    console.log("¡Estructura de tablas en Neon lista de forma permanente!");
  } catch (err) {
    console.error("Error al inicializar la base de datos:", err);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };// BLOQUE: CONFIGURACIÓN Y CONEXIÓN A NEON (POSTGRESQL)
const { Pool } = require('pg');

// Se utiliza la variable de entorno que configuraremos en Render para conectar de forma segura
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// BLOQUE: CREACIÓN DE TABLAS DE LA BASE DE DATOS
async function initDatabase() {
  const client = await pool.connect();
  try {
    // 1. Tabla de Cursos (Guarda nombre del curso y link de WhatsApp)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cursos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        whatsapp_link TEXT,
        fechas_importantes TEXT DEFAULT 'No hay fechas importantes agendadas.'
      );
    `);

    // 2. Tabla de Alumnos (Guarda credenciales, curso asignado y control de primer ingreso)
    await client.query(`
      CREATE TABLE IF NOT EXISTS alumnos (
        id SERIAL PRIMARY KEY,
        nombre_completo VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        curso_id INT REFERENCES cursos(id) ON DELETE SET NULL,
        primer_ingreso BOOLEAN DEFAULT TRUE
      );
    `);

    // 3. Tabla de Tareas / Banco Global de Recursos
    await client.query(`
      CREATE TABLE IF NOT EXISTS tareas (
        id SERIAL PRIMARY KEY,
        tema VARCHAR(100) NOT NULL,
        actividad VARCHAR(200) NOT NULL,
        tipo VARCHAR(50) NOT NULL, -- 'video', 'test', 'archivo', etc.
        archivos_urls TEXT[], -- URLs de Cloudinary o Google Drive
        requiere_entrega BOOLEAN DEFAULT FALSE,
        fecha_entrega DATE,
        prerrequisito_id INT REFERENCES tareas(id) ON DELETE SET NULL
      );
    `);

    // 4. Tabla de Asignaciones y Exclusiones Individuales (Adecuación Curricular)
    await client.query(`
      CREATE TABLE IF NOT EXISTS adecuacion_curricular (
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        excluido BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (alumno_id, tarea_id)
      );
    `);

    // 5. Tabla de Entregas y Progreso de los Alumnos
    await client.query(`
      CREATE TABLE IF NOT EXISTS entregas (
        id SERIAL PRIMARY KEY,
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        completada BOOLEAN DEFAULT FALSE,
        archivo_entrega_url TEXT,
        devolucion TEXT,
        necesita_reiniciar BOOLEAN DEFAULT FALSE,
        UNIQUE(alumno_id, tarea_id)
      );
    `);

    console.log("Base de datos e infraestructura de tablas inicializada correctamente en Neon.");
  } catch (err) {
    console.error("Error inicializando la base de datos:", err);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
