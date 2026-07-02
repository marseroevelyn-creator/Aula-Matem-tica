const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { GoogleGenAI } = require('@google/generative-ai');
const { pool, initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializamos la base de datos relacional
initDatabase();

// Configuración de Cloudinary para almacenar archivos de forma segura
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'aula_virtual_matematica',
    resource_type: 'auto'
  }
});
const upload = multer({ storage: storage });

// Configuración del motor de Inteligencia Artificial Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'clave_secreta_aula_2026',
  resave: false,
  saveUninitialized: false
}));

// ==========================================
// BLOQUE: CONTROL DE ACCESO (LOGINS)
// ==========================================

// Login Docente
app.post('/api/login/docente', (req, res) => {
  const { password } = req.body;
  if (password === 'admin123') { // Clave por defecto estipulada
    req.session.isDocente = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Clave incorrecta' });
});

// Autocompletado / Búsqueda predictiva de alumnos
app.get('/api/alumnos/buscar', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.nombre_completo, c.nombre as curso_nombre 
      FROM alumnos a 
      LEFT JOIN cursos c ON a.curso_id = c.id
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Login Alumnos
app.post('/api/login/alumno', async (req, res) => {
  const { nombre_completo, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM alumnos WHERE nombre_completo = $1', [nombre_completo]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Estudiante no encontrado' });

    const alumno = result.rows[0];
    let esValida = false;

    if (alumno.primer_ingreso && password === 'usuario') { // Clave inicial por defecto
      esValida = true;
    } else {
      esValida = await bcrypt.compare(password, alumno.password_hash);
    }

    if (!esValida) return res.status(401).json({ message: 'Contraseña incorrecta' });

    req.session.alumnoId = alumno.id;
    req.session.cursoId = alumno.curso_id;
    res.json({ success: true, primerIngreso: alumno.primer_ingreso });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cambio obligatorio de contraseña (Mínimo 4 dígitos)
app.post('/api/alumno/cambiar-clave', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  const { nuevaClave } = req.body;
  if (nuevaClave.length < 4) return res.status(400).send('Demasiado corta');

  try {
    const hash = await bcrypt.hash(nuevaClave, 10);
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = FALSE WHERE id = $2', [hash, req.session.alumnoId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// BLOQUE: CONEXIÓN REAL CON GEMINI AI
// ==========================================
app.post('/api/consultar-gemini', async (req, res) => {
  const { duda } = req.body;
  try {
    const model = ai.getGenerativeModel({ model: "gemini-pro" });
    const promptPedagogico = `Actúa como un Tutor de Matemática escolar de secundaria. Explica de forma clara, amigable y paso a paso, usando un lenguaje comprensible, la siguiente consulta: ${duda}`;
    
    const result = await model.generateContent(promptPedagogico);
    const response = await result.response;
    res.json({ respuesta: response.text() });
  } catch (err) {
    res.json({ respuesta: "Ocurrió un inconveniente al conectar con el servicio de IA. Volvé a intentar en unos instantes." });
  }
});

// ==========================================
// BLOQUE: FUNCIONES DEL PANEL DOCENTE
// ==========================================

// Obtener todos los cursos con sus alumnos y tareas
app.get('/api/docente/dashboard', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('No autorizado');
  try {
    const cursos = await pool.query('SELECT * FROM cursos ORDER BY nombre ASC');
    const tareas = await pool.query('SELECT * FROM tareas ORDER BY tema ASC, id ASC');
    res.json({ cursos: cursos.rows, bancoTareas: tareas.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear un curso nuevo
app.post('/api/docente/cursos', async (req, res) => {
  const { nombre, whatsapp_link } = req.body;
  try {
    const r = await pool.query('INSERT INTO cursos (nombre, whatsapp_link) VALUES ($1, $2) RETURNING *', [nombre, whatsapp_link || '']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registrar un alumno nuevo
app.post('/api/docente/alumnos', async (req, res) => {
  const { nombre_completo, curso_id } = req.body;
  try {
    const claveDefectoHash = await bcrypt.hash('usuario', 10); // "usuario" por defecto
    const r = await pool.query(
      'INSERT INTO alumnos (nombre_completo, password_hash, curso_id) VALUES ($1, $2, $3) RETURNING *',
      [nombre_completo, claveDefectoHash, curso_id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reiniciar contraseña de un alumno
app.post('/api/docente/alumnos/reiniciar', async (req, res) => {
  const { alumno_id } = req.body;
  try {
    const claveDefectoHash = await bcrypt.hash('usuario', 10);
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = TRUE WHERE id = $2', [claveDefectoHash, alumno_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Agregar Tarea al Banco Global
app.post('/api/docente/tareas', async (req, res) => {
  const { tema, actividad, tipo, recurso_url, requiere_entrega, fecha_entrega, prerrequisito_id } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO tareas (tema, actividad, tipo, recurso_url, requiere_entrega, fecha_entrega, prerrequisito_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tema, actividad, tipo, recurso_url || '', requiere_entrega || false, fecha_entrega || null, prerrequisito_id || null]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Adecuación Curricular: Guardar configuraciones de omisión
app.post('/api/docente/adecuacion', async (req, res) => {
  const { alumno_id, t_id, excluido } = req.body;
  try {
    await pool.query(`
      INSERT INTO adecuaciones (alumno_id, tarea_id, excluido) VALUES ($1, $2, $3)
      ON CONFLICT (alumno_id, tarea_id) DO UPDATE SET excluido = EXCLUDED.excluido
    `, [alumno_id, t_id, excluido]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Copia de seguridad: Exportar toda la base de datos en JSON
app.get('/api/docente/respaldo/exportar', async (req, res) => {
  try {
    const cursos = await pool.query('SELECT * FROM cursos');
    const alumnos = await pool.query('SELECT * FROM alumnos');
    const tareas = await pool.query('SELECT * FROM tareas');
    const entregas = await pool.query('SELECT * FROM entregas');
    res.json({ cursos: cursos.rows, alumnos: alumnos.rows, tareas: tareas.rows, entregas: entregas.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// BLOQUE: RUTAS PARA EL PANEL DEL ALUMNO
// ==========================================

// Obtener datos del alumno logueado, curso y tareas ordenadas inteligentemente
app.get('/api/alumno/dashboard', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  const alId = req.session.alumnoId;

  try {
    const infoAl = await pool.query(`
      SELECT a.nombre_completo, c.nombre as curso_nombre, c.whatsapp_link, c.fechas_importantes 
      FROM alumnos a 
      LEFT JOIN cursos c ON a.curso_id = c.id WHERE a.id = $1
    `, [alId]);

    // Consultamos las tareas cruzando los filtros de exclusión (adecuación)
    const tareasAl = await pool.query(`
      SELECT t.*, COALESCE(e.completada, false) as completada, e.archivo_url, e.devolucion, e.necesita_reiniciar, e.respuestas_test
      FROM tareas t
      LEFT JOIN adecuaciones ad ON ad.tarea_id = t.id AND ad.alumno_id = $1
      LEFT JOIN entregas e ON e.tarea_id = t.id AND e.alumno_id = $1
      WHERE (ad.excluido IS NULL OR ad.excluido = false)
    `, [alId]);

    // Aplicar lógica de automatización por Prerrequisitos
    const listadoProcesado = tareasAl.rows.map(tarea => {
      if (tarea.prerrequisito_id) {
        const pre = tareasAl.rows.find(t => t.id === tarea.prerrequisito_id);
        tarea.bloqueada = pre ? !pre.completada : false;
      } else {
        tarea.bloqueada = false;
      }
      return tarea;
    });

    res.json({ info: infoAl.rows[0], tareas: listadoProcesado });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Marcar tarea completada o subir archivo a Cloudinary
app.post('/api/alumno/entregar', upload.single('adjunto'), async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  const { tarea_id, respuestas_test } = req.body;
  const fileUrl = req.file ? req.file.path : ''; // Cloudinary nos da la URL directa aquí

  try {
    await pool.query(`
      INSERT INTO entregas (alumno_id, tarea_id, completada, archivo_url, respuestas_test, necesita_reiniciar)
      VALUES ($1, $2, true, $3, $4, false)
      ON CONFLICT (alumno_id, tarea_id) 
      DO UPDATE SET completada = true, archivo_url = COALESCE(EXCLUDED.archivo_url, entregas.archivo_url), respuestas_test = EXCLUDED.respuestas_test, necesita_reiniciar = false
    `, [req.session.alumnoId, tarea_id, fileUrl, respuestas_test || '']);

    res.json({ success: true, url: fileUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
