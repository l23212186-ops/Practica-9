const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const app = express();
const path = require('path');
const mysql = require('mysql2');
const multer = require('multer'); 
const xlsx = require('xlsx');
require('dotenv').config();

// Configuración de Multer
const upload = multer({ dest: 'uploads/' });

// Configuración de la sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
}));

app.use(express.urlencoded({ extended: true }));

// Configurar conexión a MySQL
const connection = mysql.createConnection({
  host: process.env.DB_HOST,      
  user: process.env.DB_USER,      
  password: process.env.DB_PASSWORD, 
  database: process.env.DB_NAME,
  timezone: 'America/Tijuana'     
});

connection.connect(err => {
  if (err) {
    console.error('Error conectando a MySQL:', err);
    return;
  }
  console.log('Conexión exitosa a MySQL');
});

function renderHTML(title, content) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link rel="stylesheet" href="/styles.css">
        <style>
            /* Estilos extra inyectados para Tablas y Mensajes */
            .status-icon { font-size: 3rem; margin-bottom: 10px; display: block; }
            .success { color: #28a745; }
            .error { color: #dc3545; }
            .warning { color: #ffc107; }
            
            .styled-table { width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 0.9em; box-shadow: 0 0 20px rgba(0, 0, 0, 0.05); }
            .styled-table thead tr { background-color: #10156c; color: #ffffff; text-align: left; }
            .styled-table th, .styled-table td { padding: 12px 15px; }
            .styled-table tbody tr { border-bottom: 1px solid #dddddd; }
            .styled-table tbody tr:nth-of-type(even) { background-color: #f3f3f3; }
            .styled-table tbody tr:last-of-type { border-bottom: 2px solid #0ec2c8; }
            .styled-table tbody tr:hover { background-color: #e9fbfb; cursor: default; }
            
            .btn-xs { padding: 5px 10px; font-size: 0.8rem; margin: 0; width: auto; display: inline-block; }
            .btn-danger { background-color: #dc3545; }
            .btn-danger:hover { background-color: #c82333; }
        </style>
    </head>
    <body>
        <div id="navbar"></div>
        <main class="main-container">
            <section class="card full-width">
                ${content}
            </section>
        </main>
        <script>
            fetch('/navbar.html')
                .then(response => response.text())
                .then(data => { document.getElementById('navbar').innerHTML = data; })
                .catch(err => console.log('Error cargando menú'));
        </script>
    </body>
    </html>`;
}

// Registro
app.post('/registro', (req, res) => {
    const { nombre_usuario, password, codigo_acceso } = req.body;
    const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
    
    connection.query(query, [codigo_acceso], async (err, results) => { 
        if (err || results.length === 0) {
            return res.send(renderHTML('Acceso Denegado', `
                <div style="text-align: center; padding: 20px;">
                    <span class="status-icon error">❌</span>
                    <h2 style="color: #dc3545;">Código Incorrecto</h2>
                    <p>El código de acceso proporcionado no es válido.</p>
                    <button onclick="window.location.href='/registro.html'" style="max-width:200px;">Intentar de nuevo</button>
                </div>
            `));
        }

        const tipo_usuario = results[0].tipo_usuario;
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
        
        connection.query(insertUser, [nombre_usuario, hashedPassword, tipo_usuario], (err) => {
            if (err) {
                return res.send(renderHTML('Error', `
                    <div style="text-align: center; padding: 20px;">
                        <span class="status-icon warning">⚠️</span>
                        <h2>Usuario ya existente</h2>
                        <p>El nombre de usuario ya está registrado.</p>
                        <button onclick="window.location.href='/registro.html'" style="max-width:200px;">Volver</button>
                    </div>
                `));
            }
            res.redirect('/login.html');
        });
    });
});

// Iniciar sesión
app.post('/login', (req, res) => {
    const { nombre_usuario, password } = req.body;
    const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
    
    connection.query(query, [nombre_usuario], async (err, results) => { 
        // Helper para errores de login
        const sendLoginError = (msg) => res.send(renderHTML('Error de Ingreso', `
            <div style="text-align: center; padding: 20px;">
                <span class="status-icon error">🔒</span>
                <h2>No pudimos iniciar sesión</h2>
                <p>${msg}</p>
                <button onclick="window.location.href='/login.html'" style="max-width:200px;">Reintentar</button>
            </div>
        `));

        if (err) return sendLoginError('Error interno del servidor.');
        if (results.length === 0) return sendLoginError('El usuario no existe.');

        const user = results[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) return sendLoginError('La contraseña es incorrecta.');

        req.session.user = {
            id: user.id,
            nombre_usuario: user.nombre_usuario,
            tipo_usuario: user.tipo_usuario 
        };

        res.redirect('/');
    });
});

// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// Middlewares
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html');
  next();
}

function requireRole(role) {
    return (req, res, next) => {
        if (req.session.user && req.session.user.tipo_usuario === role) {
            next();
        } else {
            res.send(renderHTML('Acceso Denegado', `
                <div style="text-align: center;">
                    <span class="status-icon error">🚫</span>
                    <h1>Acceso Restringido</h1>
                    <p>Necesitas ser <strong>${role}</strong> para ver esto.</p>
                    <button onclick="window.location.href='/'" style="max-width:200px;">Ir al Inicio</button>
                </div>
            `));
        }
    };
}

function allowRoles(roles = []) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
      next();
    } else {
        res.status(403).send(renderHTML('Acceso Denegado', `
            <div style="text-align: center;">
                <span class="status-icon error">🚫</span>
                <h1>Permiso Insuficiente</h1>
                <p>Tu rol actual no tiene acceso a esta sección.</p>
                <button onclick="window.location.href='/'" style="max-width:200px;">Ir al Inicio</button>
            </div>
        `));
    }
  };
}

// Descargar Excel
app.get('/download-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const query = 'SELECT nombre, edad, frecuencia_cardiaca FROM pacientes';
    connection.query(query, (err, results) => {
        if (err || results.length === 0) return res.send('No hay datos para exportar.');

        const worksheet = xlsx.utils.json_to_sheet(results);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Pacientes');

        const filePath = path.join(__dirname, 'uploads', 'pacientes_export.xlsx');
        xlsx.writeFile(workbook, filePath);
        res.download(filePath, 'Reporte_Pacientes.xlsx');
    });
});

// Subir Excel
app.post('/upload-pacientes', requireLogin, allowRoles(['admin', 'medico']), upload.single('archivoExcel'), (req, res) => {
    if (!req.file) return res.send(renderHTML('Error', '<h2 style="text-align:center;">Falta archivo</h2><p style="text-align:center;">No seleccionaste ningún Excel.</p><div style="text-align:center;"><button onclick="window.location.href=\'/\'" style="width:auto;">Volver</button></div>'));

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (data.length === 0) return res.send(renderHTML('Vacío', '<h2 style="text-align:center;">Archivo Vacío</h2>'));

        const values = data.map(row => [row.nombre, row.edad, row.frecuencia_cardiaca]);
        const query = 'INSERT INTO pacientes (nombre, edad, frecuencia_cardiaca) VALUES ?';
        
        connection.query(query, [values], (err, result) => {
            if (err) return res.send(renderHTML('Error', `<div style="text-align:center;"><span class="status-icon error">⚠️</span><h2>Error de Formato</h2><p>Verifica las columnas del Excel.</p><button onclick="window.location.href='/'" style="width:auto;">Volver</button></div>`));

            res.send(renderHTML('Importación Exitosa', `
                <div style="text-align: center;">
                    <span class="status-icon success">✅</span>
                    <h2>¡Importación Completada!</h2>
                    <p>Se han añadido <strong>${result.affectedRows}</strong> pacientes a la base de datos.</p>
                    <button onclick="window.location.href='/'" style="max-width:200px;">Continuar</button>
                </div>
            `));
        });
    } catch (error) {
        res.send(renderHTML('Error', 'Error procesando el archivo.'));
    }
});

app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

// Ver Usuarios (Tabla Estilizada)
app.get('/ver-usuarios', requireLogin, allowRoles(['admin']), (req, res) => {
    connection.query('SELECT id, nombre_usuario, tipo_usuario FROM usuarios', (err, results) => {
        if (err) return res.send('Error BD');

        let rows = results.map(u => `<tr><td>${u.id}</td><td><strong>${u.nombre_usuario}</strong></td><td><span style="background:#eee; padding:2px 6px; border-radius:4px;">${u.tipo_usuario}</span></td></tr>`).join('');
        
        res.send(renderHTML('Usuarios', `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h1>Usuarios del Sistema</h1>
                <a href="/" class="login-button" style="padding: 8px 15px; width:auto;">Volver al Panel</a>
            </div>
            <div style="overflow-x:auto;">
                <table class="styled-table">
                    <thead><tr><th>ID</th><th>Usuario</th><th>Rol</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `));
    });
});

// Gestionar Registros (Tabla con Acciones)
app.get('/gestionar-registros', requireLogin, allowRoles(['admin']), (req, res) => {
    connection.query('SELECT * FROM pacientes', (err, results) => {
        if (err) return res.send('Error BD');

        let rows = results.map(p => `
            <tr>
                <td>${p.nombre}</td>
                <td>${p.edad}</td>
                <td>${p.frecuencia_cardiaca} bpm</td>
                <td>
                    <a href="/editar-paciente/${p.id}" class="btn-xs" style="background-color:#0ec2c8; color:white; text-decoration:none; border-radius:4px;">Editar</a>
                    <form action="/eliminar-paciente" method="POST" style="display:inline; margin-left:5px;">
                        <input type="hidden" name="id_paciente" value="${p.id}">
                        <button type="submit" class="btn-xs btn-danger">Borrar</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(renderHTML('Gestión Total', `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h1>Gestión de Registros</h1>
                <a href="/" class="login-button" style="padding: 8px 15px; width:auto;">Volver</a>
            </div>
            <div style="overflow-x:auto;">
                <table class="styled-table">
                    <thead><tr><th>Nombre</th><th>Edad</th><th>Frecuencia C.</th><th>Acciones</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `));
    });
});

// Editar Pacientes (Misma tabla visual)
app.get('/editar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    connection.query('SELECT * FROM pacientes', (err, results) => {
        if (err) return res.send('Error BD');

        let rows = results.map(p => `
            <tr>
                <td>${p.nombre}</td>
                <td>${p.edad}</td>
                <td>${p.frecuencia_cardiaca}</td>
                <td style="text-align:center;">
                    <a href="/editar-paciente/${p.id}" class="btn-xs" style="background-color:#0ec2c8; color:white; text-decoration:none; border-radius:4px;">✏️ Editar</a>
                    <form action="/eliminar-paciente" method="POST" style="display:inline; margin-left:10px;">
                        <input type="hidden" name="id_paciente" value="${p.id}">
                        <button type="submit" class="btn-xs btn-danger">🗑️</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(renderHTML('Editar Pacientes', `
            <h1 style="text-align:center;">Editar Lista de Pacientes</h1>
            <table class="styled-table">
                <thead><tr><th>Nombre</th><th>Edad</th><th>FC</th><th style="text-align:center;">Herramientas</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="text-align:center; margin-top:20px;">
                <button onclick="window.location.href='/'" class="btn-secondary" style="max-width:200px;">Volver al Inicio</button>
            </div>
        `));
    });
});

// Formulario de Edición
app.get('/editar-paciente/:id', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const id = req.params.id;
    connection.query('SELECT * FROM pacientes WHERE id = ?', [id], (err, results) => {
        if (err || results.length === 0) return res.send(renderHTML('No encontrado', '<h1>Paciente no existe</h1>'));

        const p = results[0];
        res.send(renderHTML('Editar Registro', `
            <h1>Editando: <span style="color:#0ec2c8;">${p.nombre}</span></h1>
            <div style="max-width: 500px; margin: 0 auto;">
                <form action="/actualizar-paciente" method="POST" style="text-align:left;">
                    <input type="hidden" name="id_paciente" value="${p.id}">
                    
                    <label>Nombre:</label>
                    <input type="text" name="name" value="${p.nombre}" required>
                    
                    <label>Edad:</label>
                    <input type="number" name="age" value="${p.edad}" required>

                    <label>Frecuencia Cardiaca:</label>
                    <input type="number" name="heart_rate" value="${p.frecuencia_cardiaca}" required>

                    <button type="submit" style="margin-top:20px;">Guardar Cambios</button>
                </form>
                <button onclick="window.location.href='/editar-pacientes'" class="btn-secondary">Cancelar</button>
            </div>
        `));
    });
});

app.post('/actualizar-paciente', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const { id_paciente, name, age, heart_rate } = req.body;
    connection.query('UPDATE pacientes SET nombre = ?, edad = ?, frecuencia_cardiaca = ? WHERE id = ?', [name, age, heart_rate, id_paciente], (err) => {
        if (err) return res.send('Error actualizando');
        res.redirect('/editar-pacientes');
    });
});

app.post('/eliminar-paciente', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    connection.query('DELETE FROM pacientes WHERE id = ?', [req.body.id_paciente], (err) => {
        if (err) return res.send('Error eliminando');
        res.redirect('/editar-pacientes');
    });
});

// Ver Mis Datos
app.get('/ver-mis-datos', requireLogin, (req, res) => {
    connection.query('SELECT * FROM pacientes WHERE nombre = ?', [req.session.user.nombre_usuario], (err, results) => {
        if (err) return res.send('Error BD');

        if (results.length > 0) {
            const p = results[0];
            res.send(renderHTML('Mi Expediente', `
                <div style="text-align:center;">
                    <h1>Hola, ${p.nombre}</h1>
                    <p style="color:#666;">Aquí está tu información actual.</p>
                </div>
                <div style="background:#f9f9f9; padding:20px; border-radius:10px; margin:20px 0; border-left: 5px solid #0ec2c8;">
                    <p><strong>Edad:</strong> ${p.edad} años</p>
                    <p><strong>Frecuencia Cardiaca:</strong> ${p.frecuencia_cardiaca} bpm</p>
                </div>
                <div style="text-align:center;">
                    <button onclick="window.location.href='/'" style="max-width:200px;">Volver</button>
                </div>
            `));
        } else {
            res.send(renderHTML('Sin Datos', `
                <div style="text-align:center;">
                    <span class="status-icon warning">⚠️</span>
                    <h2>Expediente no encontrado</h2>
                    <p>No hay registros médicos asociados al usuario "${req.session.user.nombre_usuario}".</p>
                    <button onclick="window.location.href='/'">Volver</button>
                </div>
            `));
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/submit-data', allowRoles(['admin', 'medico']), (req, res) => {
  const { name, age, heart_rate } = req.body;
  connection.query('INSERT INTO pacientes (nombre, edad, frecuencia_cardiaca) VALUES (?, ?, ?)', [name, age, heart_rate], (err) => {
    if (err) return res.send(renderHTML('Error', '<h2 style="color:red;">Fallo al guardar</h2><button onclick="window.location.href=\'/\'">Volver</button>'));
    
    res.send(renderHTML('Éxito', `
        <div style="text-align:center;">
            <span class="status-icon success">✅</span>
            <h2>Guardado Correctamente</h2>
            <p>El paciente <strong>${name}</strong> ha sido registrado.</p>
            <button onclick="window.location.href='/'" style="max-width:200px;">Continuar</button>
        </div>
    `));
  });
});

// Ordenar (Tabla Visual)
app.get('/ordenar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  connection.query('SELECT * FROM pacientes ORDER BY frecuencia_cardiaca DESC', (err, results) => {
    let rows = results.map(p => `<tr><td>${p.nombre}</td><td>${p.edad}</td><td>${p.frecuencia_cardiaca}</td></tr>`).join('');
    res.send(renderHTML('Ranking Cardíaco', `
        <h1 style="text-align:center;">Pacientes por Frecuencia Cardiaca</h1>
        <table class="styled-table">
            <thead><tr><th>Nombre</th><th>Edad</th><th>BPM (Alta a Baja)</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;"><button onclick="window.location.href='/'" style="width:auto;">Volver</button></div>
    `));
  });
});

// Ver Lista Pacientes (Simple)
app.get('/pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  connection.query('SELECT * FROM pacientes', (err, results) => {
    let rows = results.map(p => `<tr><td>${p.nombre}</td><td>${p.edad}</td><td>${p.frecuencia_cardiaca}</td></tr>`).join('');
    res.send(renderHTML('Lista de Pacientes', `
        <h1 style="text-align:center;">Listado Completo</h1>
        <table class="styled-table">
            <thead><tr><th>Nombre</th><th>Edad</th><th>Frecuencia</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;"><button onclick="window.location.href='/'" style="width:auto;">Volver</button></div>
    `));
  });
});

// Buscar (Resultados)
app.get('/buscar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  const { name_search, age_search } = req.query;
  let query = 'SELECT * FROM pacientes WHERE 1=1';
  if (name_search) query += ` AND nombre LIKE '%${name_search}%'`;
  if (age_search) query += ` AND edad = ${age_search}`;

  connection.query(query, (err, results) => {
    let rows = results.length ? results.map(p => `<tr><td>${p.nombre}</td><td>${p.edad}</td><td>${p.frecuencia_cardiaca}</td></tr>`).join('') 
                              : `<tr><td colspan="3" style="text-align:center; padding:20px;">No se encontraron coincidencias</td></tr>`;

    res.send(renderHTML('Resultados de Búsqueda', `
        <h1 style="text-align:center;">Resultados</h1>
        <table class="styled-table">
            <thead><tr><th>Nombre</th><th>Edad</th><th>Frecuencia</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;"><button onclick="window.location.href='/'" style="width:auto;">Nueva Búsqueda</button></div>
    `));
  });
});

// Búsqueda Live (API - No cambia visual, es JSON)
app.get('/buscar-pacientes-live', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  const searchTerm = req.query.term;
  if (!searchTerm) return res.json([]);
  connection.query("SELECT nombre, edad, frecuencia_cardiaca FROM pacientes WHERE nombre LIKE ? LIMIT 10", [`%${searchTerm}%`], (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});

// Insertar Médico
app.post('/insertar-medico', requireLogin, requireRole('admin'), (req, res) => {
  const { medico_name, especialidad } = req.body;
  if (!medico_name || !especialidad) return res.send(renderHTML('Error', '<h2 style="text-align:center;">Datos Incompletos</h2><button onclick="window.location.href=\'/\'">Volver</button>'));

  connection.query('INSERT INTO medicos (nombre, especialidad) VALUES (?, ?)', [medico_name, especialidad], (err) => {
    res.send(renderHTML('Médico Agregado', `
        <div style="text-align:center;">
            <span class="status-icon success">👨‍⚕️</span>
            <h2>Médico Registrado</h2>
            <p>El Dr./Dra. <strong>${medico_name}</strong> ha sido añadido.</p>
            <button onclick="window.location.href='/'" style="width:auto;">Volver</button>
        </div>
    `));
  });
});

// Ver Médicos
app.get('/medicos', requireLogin, requireRole('admin'), (req, res) => {
  connection.query('SELECT * FROM medicos', (err, results) => {
    let rows = results.map(m => `<tr><td>${m.nombre}</td><td>${m.especialidad}</td></tr>`).join('');
    res.send(renderHTML('Staff Médico', `
        <h1 style="text-align:center;">Directorio de Médicos</h1>
        <table class="styled-table">
            <thead><tr><th>Nombre</th><th>Especialidad</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;"><button onclick="window.location.href='/'" style="width:auto;">Volver</button></div>
    `));
  });
});

app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});