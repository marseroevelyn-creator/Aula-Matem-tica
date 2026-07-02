// BLOQUE: IMPORTACIÓN DE LIBRERÍAS Y CONFIGURACIÓN INICIAL
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

// Inicializar la base de datos
initDatabase();

// Configurar Cloudinary para el almacenamiento persistente de archivos
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
  },
});
const upload = multer({ storage: storage });

// Inicializar Inteligencia Artificial de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Middlewares estándar
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'secreto_aula_matematica_2026',
  resave: false,
  saveUninitialized: false
}));

// BLOQUE: SISTEMA DE AUTENTICACIÓN Y AUTORIZACIÓN (LOGIN)
// Login del Docente
app.post('/api/login/docente', (req, res) => {
  const { password } = req.body;
  if (password === 'admin123') { // Clave por defecto solicitada
    req.session.isDocente = true;
    return res.json({ success: true, redirect: '/docente.html' });
  }
  return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
});

// Login del Alumno (con texto predictivo/búsqueda por nombre en el frontend)
app.post('/api/login/alumno', async (req, res) => {
  const { nombre_completo, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM alumnos WHERE nombre_completo = $1', [nombre_completo]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Alumno no encontrado' });
    
    const alumno = result.rows[0];
    let passValido = false;

    if (alumno.primer_ingreso && password === 'usuario') {
      passValido = true;
    } else {
      passValido = await bcrypt.compare(password, alumno.password_hash);
    }

    if (!passValido) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    req.session.alumnoId = alumno.id;
    return res.json({ success: true, primerIngreso: alumno.primer_ingreso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cambio de contraseña obligatorio en el primer ingreso
app.post('/api/alumno/cambiar-password', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  const { nuevaPassword } = req.body;
  if (nuevaPassword.length < 4) return res.status(400).send('La clave debe tener al menos 4 dígitos');

  try {
    const hash = await bcrypt.hash(nuevaPassword, 10);
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = FALSE WHERE id = $2', [hash, req.session.alumnoId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BLOQUE: TUTORÍA INTEGRADA CON IA (GEMINI REAL)
app.post('/api/consultar-gemini', async (req, res) => {
  const { duda } = req.body;
  try {
    const model = ai.getGenerativeModel({ model: "gemini-pro" });
    const promptContexto = `Eres un tutor de matemáticas empático y divertido para un aula virtual escolar. Responde de forma clara, concisa y pedagógica a la siguiente duda: ${duda}`;
    
    const result = await model.generateContent(promptContexto);
    const response = await result.response;
    res.json({ respuesta: response.text() });
  } catch (err) {
    res.status(500).json({ respuesta: "Lo siento, tuve un problema al conectarme con mi cerebro de IA. Intenta de nuevo." });
  }
});

// BLOQUE: FUNCIONALIDADES DEL PANEL DOCENTE (GESTIÓN)
// Crear Curso
app.post('/api/cursos', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  const { nombre, whatsapp_link } = req.body;
  try {
    const result = await pool.query('INSERT INTO cursos (nombre, whatsapp_link) VALUES ($1, $2) RETURNING *', [nombre, whatsapp_link]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Agregar Alumno
app.post('/api/alumnos', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  const { nombre_completo, curso_id } = req.body;
  try {
    // Registra al alumno con el hash de la palabra base "usuario" por seguridad inicial
    const defaultHash = await bcrypt.hash('usuario', 10);
    const result = await pool.query(
      'INSERT INTO alumnos (nombre_completo, password_hash, curso_id) VALUES ($1, $2, $3) RETURNING *',
      [nombre_completo, defaultHash, curso_id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear Tarea en el Banco Global
app.post('/api/tareas', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  const { tema, actividad, tipo, archivos_urls, requiere_entrega, fecha_entrega, prerrequisito_id } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO tareas (tema, actividad, tipo, archivos_urls, requiere_entrega, fecha_entrega, prerrequisito_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tema, actividad, tipo, archivos_urls, requiere_entrega, fecha_entrega, prerrequisito_id || null]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Adecuación curricular (Excluir tareas de forma individual)
app.post('/api/adecuacion', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  const { alumno_id, tarea_id, excluido } = req.body;
  try {
    await pool.query(
      `INSERT INTO adecuacion_curricular (alumno_id, tarea_id, excluido) 
       VALUES ($1, $2, $3) ON CONFLICT (alumno_id, tarea_id) 
       DO UPDATE SET excluido = EXCLUDED.excluido`,
      [alumno_id, tarea_id, excluido]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reiniciar clave de un alumno (Vuelve a colocar "usuario" como contraseña por defecto)
app.post('/api/alumnos/reiniciar-clave', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  const { alumno_id } = req.body;
  try {
    await pool.query('UPDATE alumnos SET password_hash = $1, primer_ingreso = TRUE WHERE id = $2', [await bcrypt.hash('usuario', 10), alumno_id]);
    res.json({ success: true, message: 'Clave restablecida a "usuario"' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Copia de seguridad completa: Descargar datos en JSON
app.get('/api/respaldo/exportar', async (req, res) => {
  if (!req.session.isDocente) return res.status(403).send('Acceso denegado');
  try {
    const cursos = await pool.query('SELECT * FROM cursos');
    const alumnos = await pool.query('SELECT * FROM alumnos');
    const tareas = await pool.query('SELECT * FROM tareas');
    res.json({ cursos: cursos.rows, alumnos: alumnos.rows, tareas: tareas.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// BLOQUE: RUTAS PARA EL PANEL DEL ALUMNO (ENTREGAS Y AUTOMATIZACIÓN)
// Obtener las tareas del alumno ordenadas cronológicamente y filtrando exclusiones y prerrequisitos
app.get('/api/alumno/mis-tareas', async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  try {
    const alumnoId = req.session.alumnoId;
    
    // Traer información del alumno y su curso
    const alInfo = await pool.query('SELECT curso_id FROM alumnos WHERE id = $1', [alumnoId]);
    const cursoId = alInfo.rows[0].curso_id;

    // Buscar tareas no excluidas para este alumno
    const tareasQuery = await pool.query(`
      SELECT t.*, COALESCE(e.completada, FALSE) as completada, e.devolucion, e.necesita_reiniciar
      FROM tareas t
      LEFT JOIN adecuacion_curricular ac ON ac.tarea_id = t.id AND ac.alumno_id = $1
      LEFT JOIN entregas e ON e.tarea_id = t.id AND e.alumno_id = $1
      WHERE (ac.excluido IS NULL OR ac.excluido = FALSE)
      ORDER BY t.fecha_entrega ASC, t.id ASC
    `, [alumnoId]);

    // Comprobación de estado automatizado por prerrequisito
    const listadoFinal = tareasQuery.rows.map(tarea => {
      if (tarea.prerrequisito_id) {
        const preReq = tareasQuery.rows.find(t => t.id === tarea.prerrequisito_id);
        tarea.bloqueada = preReq ? !preReq.completada : false;
      } else {
        tarea.bloqueada = false;
      }
      return tarea;
    });

    res.json(listadoFinal);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Alumno marca como completada una actividad o sube su archivo a Cloudinary
app.post('/api/alumno/entregar-tarea', upload.single('archivo_entrega'), async (req, res) => {
  if (!req.session.alumnoId) return res.status(401).send('No autorizado');
  const { tarea_id } = req.body;
  const alumnoId = req.session.alumnoId;
  const fileUrl = req.file ? req.file.path : null;

  try {
    await pool.query(`
      INSERT INTO entregas (alumno_id, tarea_id, completada, archivo_entrega_url)
      VALUES ($1, $2, TRUE, $3)
      ON CONFLICT (alumno_id, tarea_id)
      DO UPDATE SET completada = TRUE, archivo_entrega_url = COALESCE(EXCLUDED.archivo_entrega_url, entregas.archivo_entrega_url), necesita_reiniciar = FALSE
    `, [alumnoId, tarea_id, fileUrl]);

    res.json({ success: true, url: fileUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Encender el servidor local / productivo
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose con éxito en el puerto ${PORT}`);
});
