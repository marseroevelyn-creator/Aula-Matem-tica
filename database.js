const { Pool } = require('pg');

// Configuración del Pool de conexiones usando la variable provista por Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Requisito obligatorio para conexiones seguras en Neon
});

// Este bloque se encarga de crear las tablas de forma permanente si no existen
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Tabla para almacenar los Cursos de matemática
    await client.query(`
      CREATE TABLE IF NOT EXISTS cursos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        whatsapp_link TEXT DEFAULT '',
        fechas_importantes TEXT DEFAULT 'No hay fechas importantes agendadas.'
      );
    `);

    // Tabla para almacenar a los Alumnos adscritos a un curso
    await client.query(`
      CREATE TABLE IF NOT EXISTS alumnos (
        id SERIAL PRIMARY KEY,
        nombre_completo VARCHAR(150) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        curso_id INT REFERENCES cursos(id) ON DELETE CASCADE,
        primer_ingreso BOOLEAN DEFAULT TRUE
      );
    `);

    // Tabla del Banco Global de Tareas estructurado por temas (carpetas lógicas)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tareas (
        id SERIAL PRIMARY KEY,
        tema VARCHAR(150) NOT NULL,
        actividad VARCHAR(200) NOT NULL,
        tipo VARCHAR(50) NOT NULL, -- Puede ser: 'archivo', 'video', o 'test'
        recurso_url TEXT DEFAULT '', -- URLs asociadas a Drive, YouTube, GeoGebra, etc.
        requiere_entrega BOOLEAN DEFAULT FALSE,
        fecha_entrega DATE,
        prerrequisito_id INT REFERENCES tareas(id) ON DELETE SET NULL
      );
    `);

    // Tabla intermedia para gestionar las Tareas que se le asignan a cada curso de manera masiva
    await client.query(`
      CREATE TABLE IF NOT EXISTS curso_tareas (
        curso_id INT REFERENCES cursos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        PRIMARY KEY (curso_id, tarea_id)
      );
    `);

    // Tabla de Adecuación Curricular Individual: controla si una tarea se omite para un alumno específico
    await client.query(`
      CREATE TABLE IF NOT EXISTS adecuaciones_individuales (
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        excluido BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (alumno_id, tarea_id)
      );
    `);

    // Tabla de Entregas, estados de visionado de videos y respuestas a tests pedagógicos
    await client.query(`
      CREATE TABLE IF NOT EXISTS entregas (
        id SERIAL PRIMARY KEY,
        alumno_id INT REFERENCES alumnos(id) ON DELETE CASCADE,
        tarea_id INT REFERENCES tareas(id) ON DELETE CASCADE,
        completada BOOLEAN DEFAULT FALSE,
        subido_pero_no_entregado BOOLEAN DEFAULT FALSE,
        archivo_url TEXT DEFAULT '', -- Enlace persistente respaldado en Cloudinary
        respuestas_json TEXT DEFAULT '', -- Registro de respuestas a los cuestionarios
        devolucion TEXT DEFAULT '',
        necesita_reiniciar BOOLEAN DEFAULT FALSE,
        UNIQUE(alumno_id, tarea_id)
      );
    `);

    console.log("⚡ Estructura relacional de tablas sincronizada correctamente en Neon.");
  } catch (err) {
    console.error("❌ Error estructurando la base de datos:", err);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDatabase };
