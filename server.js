// ============================================================================
// BLOQUE 1: IMPORTACIÓN DE LIBRERÍAS Y CONFIGURACIÓN INICIAL
// ============================================================================
require('dotenv').config(); // Carga las variables de entorno desde el archivo .env
const express = require('express');
const { Pool } = require('pg'); // Cliente de PostgreSQL para conectar con Neon DB
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Middlewares para procesar JSON en las peticiones y servir archivos estáticos
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ============================================================================
// BLOQUE 2: CONEXIÓN A BASE DE DATOS NEON (POSTGRESQL)
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================================================
// BLOQUE 3: CONFIGURACIÓN DE CLOUDINARY
// ============================================================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================================================================
// BLOQUE 4: INICIALIZACIÓN DE GEMINI AI
// ============================================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// FUNCIÓN 1: Autenticación de Usuarios (Docente y Alumno)
// ============================================================================
app.post('/api/login', async (req, res) => {
  const { nombre, password, esDocente } = req.body;

  if (esDocente) {
    if (password === 'admin123') {
      return res.json({ 
        exito: true, 
        role: 'docente',
        mensaje: 'Bienvenida Profesora' 
      });
    }
    return res.status(401).json({ exito: false, error: 'Contraseña docente incorrecta' });
  }

  try {
    const resultado = await pool.query(
      'SELECT id, nombre, password, primer_ingreso, curso_id FROM alumnos WHERE nombre = $1', 
      [nombre]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ exito: false, error: 'Alumno/a no encontrado en la lista' });
    }

    const alumno = resultado.rows[0];

    if (alumno.password === password) {
      return res.json({
        exito: true,
        role: 'alumno',
        alumnoId: alumno.id,
        nombre: alumno.nombre,
        primerIngreso: alumno.primer_ingreso
      });
    }

    return res.status(401).json({ exito: false, error: 'Contraseña incorrecta' });

  } catch (error) {
    console.error('Error en /api/login:', error);
    res.status(500).json({ exito: false, error: 'Error interno en la base de datos' });
  }
});

// ============================================================================
// FUNCIÓN 2: Cambiar Contraseña en Primer Ingreso (Alumno)
// ============================================================================
app.post('/api/alumno/cambiar-clave', async (req, res) => {
  const { alumnoId, nuevaPassword } = req.body;

  if (!nuevaPassword || nuevaPassword.length < 4) {
    return res.status(400).json({ 
      exito: false, 
      error: 'La nueva contraseña debe tener al menos 4 dígitos' 
    });
  }

  try {
    await pool.query(
      'UPDATE alumnos SET password = $1, primer_ingreso = false WHERE id = $2',
      [nuevaPassword, alumnoId]
    );

    res.json({ 
      exito: true, 
      mensaje: 'Contraseña actualizada correctamente. ¡Ya podés ingresar!' 
    });

  } catch (error) {
    console.error('Error en /api/alumno/cambiar-clave:', error);
    res.status(500).json({ exito: false, error: 'No se pudo guardar la contraseña' });
  }
});

// ============================================================================
// FUNCIÓN 3: Consulta al Asistente Didáctico Gemini AI
// ============================================================================
app.post('/api/gemini-consulta', async (req, res) => {
  const { duda } = req.body;

  if (!duda || duda.trim() === '') {
    return res.status(400).json({ exito: false, error: 'Debés escribir una consulta' });
  }

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash"
    });

    const promptConRol = `Sos un tutor asistente pedagógico de matemática para nivel secundario. Explicá de forma clara, directa, amable y didáctica. Responde a la siguiente duda: ${duda}`;

    const result = await model.generateContent(promptConRol);
    const response = await result.response;
    const text = response.text();

    res.json({ exito: true, respuesta: text });
  } catch (error) {
    console.error("Error en Gemini:", error);
    res.status(500).json({ exito: false, error: "Error al comunicarse con el tutor AI." });
  }
});
// ============================================================================
// FUNCIÓN 4: Cargar Archivo a Cloudinary y Guardar Tarea
// ============================================================================
app.post('/api/docente/crear-tarea', async (req, res) => {
  const { tema, titulo, tipoRecurso, urlEnlace, archivoBase64, requiereEntrega, preRequisitoId } = req.body;

  try {
    let urlFinal = urlEnlace;

    if (archivoBase64) {
      const resultadoUpload = await cloudinary.uploader.upload(archivoBase64, {
        folder: 'aula_virtual_matematica',
        resource_type: 'auto'
      });
      urlFinal = resultadoUpload.secure_url;
    }

    const nuevaTarea = await pool.query(
      `INSERT INTO tareas (tema, titulo, archivo_url, requiere_entrega, prerequisito_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tema, titulo, urlFinal, requiereEntrega || false, preRequisitoId || null]
    );

    res.json({ exito: true, tarea: nuevaTarea.rows[0] });

  } catch (error) {
    console.error('Error al crear tarea:', error);
    res.status(500).json({ exito: false, error: 'No se pudo guardar la tarea' });
  }
});

// ============================================================================
// BLOQUE 5: ARRANQUE DEL SERVIDOR
// ============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});
// ============================================================================
// NUEVA FUNCIÓN: Obtener nombres de alumnos para el selector
// ============================================================================
app.get('/api/alumnos-lista', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT nombre FROM alumnos ORDER BY nombre ASC');
    res.json({ exito: true, alumnos: resultado.rows.map(a => a.nombre) });
  } catch (error) {
    console.error('Error al obtener lista de alumnos:', error);
    res.status(500).json({ exito: false, alumnos: [] });
  }
});
