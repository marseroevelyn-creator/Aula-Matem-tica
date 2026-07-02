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

// Inicialización de las tablas persistentes
initDatabase();

// Configuración integrada del almacenamiento en la nube (Cloudinary)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'aula_virtual_entregas',
    resource_type: 'auto'
  }
});
const upload = multer({ storage: storage });

// Instanciación correcta de la API de Google Gemini (Tutor de Matemática)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'aula_secreta_matematica_2026',
  resave: false,
  saveUninitialized: false
}));

// =========================================================================
// 🔐 SECCIÓN: AUTENTICACIÓN Y ACCESOS (LOGINS CON VALIDACIONES)
// =========================================================================

// Autocompletado de alumnos (Búsqueda predictiva del login)
app.get('/api/auth/predictivo', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.nombre_completo, c.nombre AS curso_nombre 
      FROM alumnos a 
      LEFT JOIN cursos c ON a.curso_id = c.id
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Autenticación Docente
app.post('/api/auth/docente', (req, res) => {
  const { password } = req.body;
  if (password === 'admin123') { // Clave base requerida por la docente
    req.session.isDocente = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ message: 'Contraseña docente inválida.' });
});

// Autenticación Alumno
app.post('/api/auth/alumno', async (req, res) => {
  const { nombre_completo, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM alumnos WHERE nombre_completo = $1', [nombre_completo]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Estudiante no registrado.' });

    const alumno = result.rows[0];
    let esValida = false;

    if (alumno.primer_ingreso && password === 'usuario') {
      esValida = true;
    } else {
      esValida = await bcrypt.compare(password, alumno.password_hash);
    }

    if (!esValida) return res.status(401).json({ message: 'Contraseña incorrecta.' });

    req.session.alumnoId = alumno.id;
    req.session.cursoId = alumno.curso_id;
    res.json({ success: true, primerIngreso: alumno.primer_ingreso });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Forzar reconfiguración de contraseña (Mínimo 4 dígitos)
app.post('/api/auth/cambiar-clave-inicial', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado.');
  const { nuevaClave } = req.body;
  if (!nuevaClave || nuevaClave.length < 4) return res.status(400).send('Longitud insuficiente.');

  try {
    const hash = await bcrypt.hash(nuevaClave, 10);
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = FALSE WHERE id = $2', [hash, req.session.alumnoId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================================
// 🤖 SECCIÓN: INTEGRACIÓN CON TUTOR DE INTELIGENCIA ARTIFICIAL GEMINI
// =========================================================================
app.post('/api/ia/consultar', async (req, res) => {
  const { consulta } = req.body;
  try {
    const model = ai.getGenerativeModel({ model: "gemini-pro" });
    const contextoPedagogico = `Actúa como un Tutor Escolar de Matemática de nivel secundario. Responde de manera clara, didáctica, paso a paso y utilizando un lenguaje amigable la siguiente duda planteada por tu alumno: ${consulta}`;
    
    const result = await model.generateContent(contextoPedagogico);
    const response = await result.response;
    res.json({ respuesta: response.text() });
  } catch (err) {
    res.json({ respuesta: "Hola, en este momento el módulo de IA está experimentando alta demanda. Intenta consultarme nuevamente en unos segundos." });
  }
});

// =========================================================================
// 👩‍🏫 SECCIÓN: FUNCIONALIDADES DEL PANEL DOCENTE
// =========================================================================

// Listar datos globales organizados para el Dashboard Docente
app.get('/api/docente/dashboard', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('No autorizado.');
  try {
    const cursos = await pool.query('SELECT * FROM cursos ORDER BY nombre ASC');
    const tareas = await pool.query('SELECT * FROM tareas ORDER BY tema ASC, id ASC');
    const alumnos = await pool.query(`
      SELECT a.*, c.nombre as curso_nombre 
      FROM alumnos a 
      LEFT JOIN cursos c ON a.curso_id = c.id ORDER BY a.nombre_completo ASC
    `);
    const entregas = await pool.query(`
      SELECT e.*, a.nombre_completo, t.actividad 
      FROM entregas e
      JOIN alumnos a ON e.alumno_id = a.id
      JOIN tareas t ON e.tarea_id = t.id
    `);

    res.json({ cursos: cursos.rows, bancoTareas: tareas.rows, alumnos: alumnos.rows, entregas: entregas.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Operaciones de Cursos
app.post('/api/docente/cursos', async (req, res) => {
  const { nombre, whatsapp_link } = req.body;
  try {
    const r = await pool.query('INSERT INTO cursos (nombre, whatsapp_link) VALUES ($1, $2) RETURNING *', [nombre, whatsapp_link || '']);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/docente/cursos/:id', async (req, res) => {
  const { nombre, whatsapp_link, fechas_importantes } = req.body;
  try {
    await pool.query('UPDATE cursos SET nombre = $1, whatsapp_link = $2, fechas_importantes = $3 WHERE id = $4', [nombre, whatsapp_link, fechas_importantes, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/docente/cursos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cursos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Gestión de Alumnos por el Profesor
app.post('/api/docente/alumnos', async (req, res) => {
  const { nombre_completo, curso_id } = req.body;
  try {
    const hashDefecto = await bcrypt.hash('usuario', 10);
    const r = await pool.query('INSERT INTO alumnos (nombre_completo, password_hash, curso_id) VALUES ($1, $2, $3) RETURNING *', [nombre_completo, hashDefecto, curso_id]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docente/alumnos/reiniciar-clave', async (req, res) => {
  const { alumno_id } = req.body;
  try {
    const hashDefecto = await bcrypt.hash('usuario', 10);
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = TRUE WHERE id = $2', [hashDefecto, alumno_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/docente/alumnos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM alumnos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Operaciones del Banco de Tareas
app.post('/api/docente/tareas', async (req, res) => {
  const { tema, actividad, tipo, recurso_url, requiere_entrega, fecha_entrega, prerrequisito_id } = req.body;
  try {
    const r = await pool.query(`
      INSERT INTO tareas (tema, actividad, tipo, recurso_url, requiere_entrega, fecha_entrega, prerrequisito_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
    `, [tema, actividad, tipo, recurso_url || '', requiere_entrega || false, fecha_entrega || null, prerrequisito_id || null]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docente/tareas/asignar-curso', async (req, res) => {
  const { curso_id, tarea_id } = req.body;
  try {
    await pool.query('INSERT INTO curso_tareas (curso_id, tarea_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [curso_id, tarea_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/docente/tareas/desasignar-curso', async (req, res) => {
  const { curso_id, tarea_id } = req.body;
  try {
    await pool.query('DELETE FROM curso_tareas WHERE curso_id = $1 AND tarea_id = $2', [curso_id, tarea_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Guardar Adecuación Curricular Individual (Omitir Actividades)
app.post('/api/docente/adecuacion', async (req, res) => {
  const { alumno_id, tarea_id, excluido } = req.body;
  try {
    await pool.query(`
      INSERT INTO adecuaciones_individuales (alumno_id, tarea_id, excluido) VALUES ($1, $2, $3)
      ON CONFLICT (alumno_id, tarea_id) DO UPDATE SET excluido = EXCLUDED.excluido
    `, [alumno_id, tarea_id, excluido]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Devolución y Reinicio de Entregas
app.post('/api/docente/entregas/corregir', async (req, res) => {
  const { entrega_id, devolucion, necesita_reiniciar } = req.body;
  try {
    if (necesita_reiniciar) {
      await pool.query('UPDATE entregas SET devolucion = $1, necesita_reiniciar = TRUE, completada = FALSE WHERE id = $2', [devolucion, entrega_id]);
    } else {
      await pool.query('UPDATE entregas SET devolucion = $1, necesita_reiniciar = FALSE WHERE id = $2', [devolucion, entrega_id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Copia de seguridad: Exportación total
app.get('/api/docente/respaldo/exportar', async (req, res) => {
  try {
    const cursos = await pool.query('SELECT * FROM cursos');
    const alumnos = await pool.query('SELECT * FROM alumnos');
    const tareas = await pool.query('SELECT * FROM tareas');
    const entregas = await pool.query('SELECT * FROM entregas');
    res.json({
      timestamp: new Date(),
      cursos: cursos.rows,
      alumnos: alumnos.rows,
      tareas: tareas.rows,
      entregas: entregas.rows
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =========================================================================
// 🧑‍🎓 SECCIÓN: ENDPOINTS OPERATIVOS PARA ALUMNOS
// =========================================================================

// Dashboard de Alumnos unificado con lógicas secuenciales y estados de vencimiento
app.get('/api/alumno/dashboard', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado.');
  const alId = req.session.alumnoId;
  const curId = req.session.cursoId;

  try {
    const infoAl = await pool.query(`
      SELECT a.nombre_completo, c.nombre AS curso_nombre, c.whatsapp_link, c.fechas_importantes 
      FROM alumnos a 
      LEFT JOIN cursos c ON a.curso_id = c.id WHERE a.id = $1
    `, [alId]);

    // Consultar tareas asignadas al curso que NO estén marcadas como excluidas por adecuación curricular
    const tareasAl = await pool.query(`
      SELECT t.*, COALESCE(e.completada, false) AS completada, COALESCE(e.subido_pero_no_entregado, false) AS subido_pero_no_entregado,
             e.archivo_url, e.devolucion, e.necesita_reiniciar, e.respuestas_json
      FROM tareas t
      JOIN curso_tareas ct ON t.id = ct.tarea_id
      LEFT JOIN adecuaciones_individuales ad ON ad.tarea_id = t.id AND ad.alumno_id = $1
      LEFT JOIN entregas e ON e.tarea_id = t.id AND e.alumno_id = $1
      WHERE ct.curso_id = $2 AND (ad.excluido IS NULL OR ad.excluido = false)
      ORDER BY t.id ASC
    `, [curId, alId]);

    // Procesamiento de Reglas de Negocio Automatizadas: Prerrequisitos
    const listadoFinal = tareasAl.rows.map(tarea => {
      if (tarea.prerrequisito_id) {
        const preReq = tareasAl.rows.find(t => t.id === tarea.prerrequisito_id);
        tarea.bloqueada = preReq ? !preReq.completada : false;
      } else {
        tarea.bloqueada = false;
      }
      return tarea;
    });

    res.json({ info: infoAl.rows[0], tareas: listadoFinal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Acción de subir archivo (Se guarda en Cloudinary de manera intermedia)
app.post('/api/alumno/subir-archivo', upload.single('adjunto'), async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado.');
  const { tarea_id } = req.body;
  const fileUrl = req.file ? req.file.path : '';

  try {
    await pool.query(`
      INSERT INTO entregas (alumno_id, tarea_id, completada, subido_pero_no_entregado, archivo_url)
      VALUES ($1, $2, false, true, $3)
      ON CONFLICT (alumno_id, tarea_id) DO UPDATE SET archivo_url = EXCLUDED.archivo_url, subido_pero_no_entregado = true
    `, [req.session.alumnoId, tarea_id, fileUrl]);
    res.json({ success: true, url: fileUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Registrar una entrega formal (Para subidas de archivos, tests y videos vistos)
app.post('/api/alumno/registrar-entrega', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado.');
  const { tarea_id, respuestas_json } = req.body;

  try {
    await pool.query(`
      INSERT INTO entregas (alumno_id, tarea_id, completada, subido_pero_no_entregado, respuestas_json, necesita_reiniciar)
      VALUES ($1, $2, true, false, $3, false)
      ON CONFLICT (alumno_id, tarea_id) DO UPDATE SET completada = true, subido_pero_no_entregado = false, respuestas_json = COALESCE(EXCLUDED.respuestas_json, entregas.respuestas_json), necesita_reiniciar = false
    `, [req.session.alumnoId, tarea_id, respuestas_json || '']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`🚀 Servidor en línea en el puerto ${PORT}`));
