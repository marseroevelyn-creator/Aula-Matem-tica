// ============================================================================
// BLOQUE 1: IMPORTACIÓN DE LIBRERÍAS Y CONFIGURACIÓN INICIAL
// Explicación: Cargamos las librerías necesarias para el servidor web (Express),
// la base de datos (pg), el almacenamiento de archivos (Cloudinary) y la IA (Gemini).
// ============================================================================
require('dotenv').config(); // Carga las variables de entorno desde el archivo .env
const express = require('express');
const { Pool } = require('pg'); // Cliente de PostgreSQL para conectar con Neon DB
const cloudinary = require('cloudinary').v2;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { GoogleGenerativeAI } = require('@google/generative-ai'); // <-- LÍNEA IMPORTANTE (Reemplaza la importación vieja)
require('dotenv').config();

const app = express();

// Middlewares para procesar JSON en las peticiones y servir archivos estáticos (HTML/CSS/JS)
app.use(express.json());
app.use(express.static('public'));

// ============================================================================
// BLOQUE 2: CONEXIÓN A BASE DE DATOS NEON (POSTGRESQL)
// Explicación: Conecta la aplicación con Neon para asegurar que los datos
// no se borren cuando Render reinicie el servidor.
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // URI de conexión que te da Neon
  ssl: { rejectUnauthorized: false } // Requerido para conexiones seguras SSL en Neon
});

// ============================================================================
// BLOQUE 3: CONFIGURACIÓN DE CLOUDINARY
// Explicación: Configura las credenciales para subir PDFs, imágenes y entregas.
// ============================================================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================================================================
// BLOQUE 4: INICIALIZACIÓN DE GEMINI AI
// Explicación: Instancia el cliente oficial de Google GenAI para el tutor de matemática.
// ============================================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// FUNCIÓN 1: Autenticación de Usuarios (Docente y Alumno)
// Ruta: POST /api/login
// Explicación: Verifica si la persona que intenta ingresar es la docente o un alumno.
// - Si es docente: Compara contra la clave genérica "admin123".
// - Si es alumno: Busca al usuario en Neon DB y verifica la contraseña[cite: 1].
// ============================================================================
app.post('/api/login', async (req, res) => {
  const { nombre, password, esDocente } = req.body;

  // --- Caso 1: Acceso Docente ---
  if (esDocente) {
    if (password === 'admin123') { // Clave definida en requerimientos[cite: 1]
      return res.json({ 
        exito: true, 
        role: 'docente',
        mensaje: 'Bienvenida Profesora' 
      });
    }
    return res.status(401).json({ exito: false, error: 'Contraseña docente incorrecta' });
  }

  // --- Caso 2: Acceso Alumno ---
  try {
    // Consulta a Neon buscando el alumno por su nombre completo[cite: 1]
    const resultado = await pool.query(
      'SELECT id, nombre, password, primer_ingreso, curso_id FROM alumnos WHERE nombre = $1', 
      [nombre]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ exito: false, error: 'Alumno/a no encontrado en la lista' });
    }

    const alumno = resultado.rows[0];

    // Verificación de la contraseña ingresada
    if (alumno.password === password) {
      return res.json({
        exito: true,
        role: 'alumno',
        alumnoId: alumno.id,
        nombre: alumno.nombre,
        primerIngreso: alumno.primer_ingreso // Booleano: indica si debe cambiar su clave[cite: 1]
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
// Ruta: POST /api/alumno/cambiar-clave
// Explicación: Permite al alumno actualizar su clave genérica "usuario" por una 
// propia de al menos 4 dígitos durante su primer inicio de sesión[cite: 1].
// ============================================================================
app.post('/api/alumno/cambiar-clave', async (req, res) => {
  const { alumnoId, nuevaPassword } = req.body;

  // Validación: La clave debe tener al menos 4 dígitos[cite: 1]
  if (!nuevaPassword || nuevaPassword.length < 4) {
    return res.status(400).json({ 
      exito: false, 
      error: 'La nueva contraseña debe tener al menos 4 dígitos' 
    });
  }

  try {
    // Actualiza la contraseña en Neon DB y marca primer_ingreso como FALSE[cite: 1]
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
// Ruta: POST /api/gemini-consulta
// Explicación: Recibe una consulta matemática del alumno y la procesa mediante
// la API de Gemini 2.5 Flash configurada como tutor pedagógico[cite: 1].
// ============================================================================
app.post('/api/gemini-consulta', async (req, res) => {
  const { duda } = req.body;

  if (!duda || duda.trim() === '') {
    return res.status(400).json({ exito: false, error: 'Debés escribir una consulta' });
  }

try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      systemInstruction: "Sos un tutor asistente pedagógico de matemática para nivel secundario. Explicá de forma clara, directa, amable y didáctica."
    });

    const result = await model.generateContent(duda);
    const response = await result.response;
    const text = response.text();

    res.json({ exito: true, respuesta: text });
  } catch (error) {
    console.error("Error en Gemini:", error);
    res.status(500).json({ exito: false, error: "Error al comunicarse con el tutor AI." });
  }

    res.json({ exito: true, respuesta: response.text });

  } catch (error) {
    console.error('Error en /api/gemini-consulta:', error);
    res.status(500).json({ exito: false, error: 'Hubo un inconveniente al consultar a la IA' });
  }
});


// ============================================================================
// BLOQUE 5: ARRANQUE DEL SERVIDOR
// Explicación: Inicia el servidor en el puerto proporcionado por Render o el 3000 local.
// ============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`);
});

// ============================================================================
// FUNCIÓN 4: Cargar Archivo a Cloudinary y Guardar Tarea
// Ruta: POST /api/docente/crear-tarea
// Explicación: Recibe el título, tema, links o archivos adjuntos. Si hay un
// archivo base64/buffer, lo envía a Cloudinary y guarda el enlace en Neon.
// ============================================================================
app.post('/api/docente/crear-tarea', async (req, res) => {
  const { tema, titulo, tipoRecurso, urlEnlace, archivoBase64, requiereEntrega, preRequisitoId } = req.body;

  try {
    let urlFinal = urlEnlace;

    // Si la profesora subió un archivo local (PDF, imagen, etc.), lo mandamos a Cloudinary
    if (archivoBase64) {
      const resultadoUpload = await cloudinary.uploader.upload(archivoBase64, {
        folder: 'aula_virtual_matematica',
        resource_type: 'auto' // Detecta automáticamente si es PDF, imagen, etc.
      });
      urlFinal = resultadoUpload.secure_url;
    }

    // Insertamos la nueva tarea en Neon DB
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
