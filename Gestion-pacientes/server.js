const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const multer = require('multer'); 
const xlsx = require('xlsx');
require('dotenv').config();

// Configuración de Multer para guardar en /uploads
const upload = multer({ dest: 'uploads/' });

// Configuración de la sesión
app.use(session({
  secret: process.env.SESSION_SECRET,
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

// Registro
app.post('/registro', (req, res) => {
    const { nombre_usuario, password, codigo_acceso } = req.body;

    const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
    
    connection.query(query, [codigo_acceso], async (err, results) => { // <-- Se añade 'async' aquí
        if (err || results.length === 0) {
            let html = `
            <html>
            <head>
              <link rel="stylesheet" href="/styles.css">
              <title>Error</title>
            </head>
            <body>
              <h1>Codigo de acceso denegado</h1>
              <button onclick="window.location.href='/registro.html'">Volver</button>
            </body>
            </html>
            `;
            return res.send(html);
        }

        const tipo_usuario = results[0].tipo_usuario;

        const hashedPassword = await bcrypt.hash(password, 10);

        const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
        
        connection.query(insertUser, [nombre_usuario, hashedPassword, tipo_usuario], (err) => {
            if (err) {
                let html = `
                <html>
                <head>
                  <link rel="stylesheet" href="/styles.css">
                  <title>Error</title>
                </head>
                <body>
                  <h1>Error al registrar usuario</h1>
                  <button onclick="window.location.href='/registro.html'">Volver</button>
                </body>
                </html>
                `;
                return res.send(html);
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
        
        if (err) {
            let html = `
            <html>
            <head>
              <link rel="stylesheet" href="/styles.css">
              <title>Error</title>
            </head>
            <body>
              <h1>Error al obtener el usuario</h1>
              <button onclick="window.location.href='/login.html'">Volver</button>
            </body>
            </html>
            `;
            return res.send(html);
        }

        if (results.length === 0) {
            let html = `
            <html>
            <head>
              <link rel="stylesheet" href="/styles.css">
              <title>Error</title>
            </head>
            <body>
              <h1>Usuario no encontrado</h1>
              <button onclick="window.location.href='/login.html'">Volver</button>
            </body>
            </html>
            `;
            return res.send(html);
        }

        const user = results[0];

        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            let html = `
            <html>
            <head>
              <link rel="stylesheet" href="/styles.css">
              <title>Error</title>
            </head>
            <body>
              <h1>Contraseña incorrecta</h1>
              <button onclick="window.location.href='/login.html'">Volver</button>
            </body>
            </html>
            `;
            return res.send(html);
        }

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

// Middleware para verificar si el usuario está autenticado
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(role) {
    return (req, res, next) => {
        if (req.session.user && req.session.user.tipo_usuario === role) {
            next();
        } else {
            let html = `
            <html>
            <head>
              <link rel="stylesheet" href="/styles.css">
              <title>Error</title>
            </head>
            <body>
              <h1>Acceso denegado</h1>
              <button onclick="window.location.href='/'">Volver</button>
            </body>
            </html>
            `;
            return res.send(html);
        }
    };
}

// Middleware para permitir MÚLTIPLES roles
function allowRoles(roles = []) {
  return (req, res, next) => {
    // Verifica si el rol del usuario está INCLUIDO en la lista de roles permitidos
    if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
      next(); // Permitido
    } else {
      // Reutiliza tu HTML de acceso denegado
      let html = `
      <html>
      <head><link rel="stylesheet" href="/styles.css"><title>Error</title></head>
      <body>
        <h1>Acceso denegado</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
      `;
      return res.status(403).send(html);
    }
  };
}

// Ruta para descargar todos los pacientes en Excel
app.get('/download-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    
    // 1. Obtener datos de la BDD
    const query = 'SELECT nombre, edad, frecuencia_cardiaca FROM pacientes';
    connection.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.send('Error al obtener datos para Excel.');
        }

        if (results.length === 0) {
            return res.send('No hay pacientes para exportar.');
        }

        // 2. Convertir JSON a Hoja de Cálculo
        const worksheet = xlsx.utils.json_to_sheet(results);
        
        // 3. Crear un nuevo libro de trabajo
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Pacientes'); // 'Pacientes' es el nombre de la pestaña

        // 4. Escribir el archivo y enviarlo para descarga
        const filePath = path.join(__dirname, 'uploads', 'pacientes_export.xlsx');
        xlsx.writeFile(workbook, filePath);

        // 5. Enviar el archivo al cliente
        res.download(filePath, 'Reporte_Pacientes.xlsx', (err) => {
            if (err) {
                console.error('Error al descargar el archivo:', err);
            }
            // (Opcional) Puedes borrar el archivo del servidor después de descargarlo
            // const fs = require('fs');
            // fs.unlinkSync(filePath);
        });
    });
});

// Ruta para subir un archivo Excel e importar pacientes
app.post('/upload-pacientes', requireLogin, allowRoles(['admin', 'medico']), upload.single('archivoExcel'), (req, res) => {
    
    // 1. Multer ya guardó el archivo, su info está en req.file
    if (!req.file) {
        return res.send('No se seleccionó ningún archivo.');
    }

    const filePath = req.file.path;

    try {
        // 2. Leer el archivo Excel
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        if (data.length === 0) {
            return res.send('El archivo Excel está vacío.');
        }

        // 3. Preparar los datos para la BDD
        // Asumimos que el Excel tiene columnas "nombre", "edad", "frecuencia_cardiaca"
        const query = 'INSERT INTO pacientes (nombre, edad, frecuencia_cardiaca) VALUES ?';
        
        const values = data.map(row => [
            row.nombre, 
            row.edad, 
            row.frecuencia_cardiaca
        ]);

        // 4. Insertar todos los datos en la BDD de una sola vez
        connection.query(query, [values], (err, result) => {
            if (err) {
                console.error(err);
                let htmlError = `
                  <html>
                  <head>
                    <title>Error</title>
                    <link rel="stylesheet" href="/styles.css">
                    <style>
                      body { text-align: center; padding-top: 50px; }
                      .container { max-width: 500px; margin: 0 auto; padding: 30px; background-color: #fff; border-radius: 8px; }
                      p { font-size: 1.2rem; margin-bottom: 30px; }
                    </style>
                  </head>
                  <body>
                    <div class="container">
                      <h1>Error al guardar</h1>
                      <p>No se pudieron importar los datos del Excel. Verifique el formato.</p>
                      <a href="/" class="login-button">Volver al Inicio</a>
                    </div>
                  </body>
                  </html>
                `;
                return res.send(htmlError);
            }

            let htmlExito = `
              <html>
              <head>
                <title>Éxito</title>
                <link rel="stylesheet" href="/styles.css">
                <style>
                  /* Estilos simples para centrar el contenido */
                  body { text-align: center; padding-top: 50px; }
                  .container {
                    max-width: 500px;
                    margin: 0 auto;
                    padding: 30px;
                    background-color: #fff;
                    border-radius: 8px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                  }
                  p {
                    font-size: 1.2rem;
                    margin-bottom: 30px;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>¡Éxito!</h1>
                  <p>Se importaron ${result.affectedRows} pacientes.</p>
                  
                  <a href="/" class="login-button">Volver al Inicio</a>
                </div>
              </body>
              </html>
            `;
            res.send(htmlExito);
        });

    } catch (error) {
        console.error(error);
        res.send('Error al procesar el archivo Excel.');
    }
});

// Ruta para obtener el tipo de usuario actual
app.get('/tipo-usuario', requireLogin, (req, res) => {
  const tipo = req.session.user.tipo_usuario;
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

// Ruta para que solo admin pueda ver todos los usuarios (CON HTML)
app.get('/ver-usuarios', requireLogin, allowRoles(['admin']), (req, res) => {
    
    // 1. Consulta SQL corregida: NUNCA selecciones el password_hash
    const query = 'SELECT id, nombre_usuario, tipo_usuario FROM usuarios';
    
    connection.query(query, (err, results) => {
        if (err) return res.send('Error al obtener usuarios');

        // 2. Construye la tabla HTML (similar a tu ruta /medicos)
        let html = `
          <html>
          <head>
            <link rel="stylesheet" href="/styles.css">
            <title>Usuarios</title>
          </head>
          <body>
            <h1>Usuarios Registrados</h1>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre de Usuario</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
        `;

        results.forEach(usuario => {
          html += `
            <tr>
              <td>${usuario.id}</td>
              <td>${usuario.nombre_usuario}</td>
              <td>${usuario.tipo_usuario}</td>
            </tr>
          `;
        });

        html += `
              </tbody>
            </table>
            <button onclick="window.location.href='/'">Volver</button>
          </body>
          </html>
        `;
        
        // 3. Envía el HTML
        res.send(html);
    });
});

// Muestra la lista de pacientes con botones de Editar/Eliminar
app.get('/gestionar-registros', requireLogin, allowRoles(['admin']), (req, res) => {
    const query = 'SELECT * FROM pacientes';
    connection.query(query, (err, results) => {
        if (err) return res.send('Error al obtener pacientes');

        let html = `
        <html>
        <head>
            <link rel="stylesheet" href="/styles.css"><title>Gestionar Registros</title>
        </head>
        <body>
            <h1>Gestionar Registros de Pacientes (Admin)</h1>
            <table>
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Edad</th>
                        <th>Frec. Cardiaca</th>
                        <th>Editar</th>
                        <th>Eliminar</th>
                    </tr>
                </thead>
                <tbody>
        `;
        results.forEach(paciente => {
            html += `
                <tr>
                    <td>${paciente.nombre}</td>
                    <td>${paciente.edad}</td>
                    <td>${paciente.frecuencia_cardiaca}</td>
                    <td>
                        <!-- Botón que lleva a la página de edición -->
                        <a href="/editar-paciente/${paciente.id}">Editar</a>
                    </td>
                    <td>
                        <!-- Formulario para eliminar (usa POST) -->
                        <form action="/eliminar-paciente" method="POST" style="margin:0;">
                            <input type="hidden" name="id_paciente" value="${paciente.id}">
                            <button type="submit">Eliminar</button>
                        </form>
                    </td>
                </tr>
            `;
        });
        html += `
                </tbody>
            </table>
            <button onclick="window.location.href='/'">Volver</button>
        </body>
        </html>
        `;
        res.send(html);
    });
});

// Muestra la MISMA tabla que la ruta anterior.
app.get('/editar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const query = 'SELECT * FROM pacientes';
    connection.query(query, (err, results) => {
        if (err) return res.send('Error al obtener pacientes');

        let html = `
        <html>
        <head>
            <link rel="stylesheet" href="/styles.css"><title>Editar Pacientes</title>
        </head>
        <body>
            <h1>Editar Pacientes</h1>
            <table>
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Edad</th>
                        <th>Frec. Cardiaca</th>
                        <th>Editar</th>
                        <th>Eliminar</th>
                    </tr>
                </thead>
                <tbody>
        `;
        results.forEach(paciente => {
            html += `
                <tr>
                    <td>${paciente.nombre}</td>
                    <td>${paciente.edad}</td>
                    <td>${paciente.frecuencia_cardiaca}</td>
                    <td>
                        <a href="/editar-paciente/${paciente.id}">Editar</a>
                    </td>
                    <td>
                        <form action="/eliminar-paciente" method="POST" style="margin:0;">
                            <input type="hidden" name="id_paciente" value="${paciente.id}">
                            <button type="submit">Eliminar</button>
                        </form>
                    </td>
                </tr>
            `;
        });
        html += `
                </tbody>
            </table>
            <button onclick="window.location.href='/'">Volver</button>
        </body>
        </html>
        `;
        res.send(html);
    });
});

// Se activa cuando haces clic en el botón "Editar" de un paciente
app.get('/editar-paciente/:id', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    const id = req.params.id;
    const query = 'SELECT * FROM pacientes WHERE id = ?';
    
    connection.query(query, [id], (err, results) => {
        if (err || results.length === 0) {
            return res.send('Error: Paciente no encontrado.');
        }

        const paciente = results[0];

        let html = `
        <html>
        <head>
            <link rel="stylesheet" href="/styles.css"><title>Editando Paciente</title>
        </head>
        <body>
            <h1>Editando a ${paciente.nombre}</h1>
            
            <!-- Este formulario envía los datos a /actualizar-paciente -->
            <form action="/actualizar-paciente" method="POST">
                
                <!-- Input oculto para enviar la ID -->
                <input type="hidden" name="id_paciente" value="${paciente.id}">

                <label for="name">Nombre del paciente:</label>
                <input type="text" id="name" name="name" value="${paciente.nombre}">
                
                <label for="age">Edad:</label>
                <input type="number" id="age" name="age" value="${paciente.edad}">

                <label for="heart-rate">Frecuencia Cardiaca (bpm):</label>
                <input type="number" id="heart-rate" name="heart_rate" value="${paciente.frecuencia_cardiaca}">

                <button type="submit">Actualizar</button>
            </form>
            <button onclick="window.location.href='/editar-pacientes'">Cancelar</button>
        </body>
        </html>
        `;
        res.send(html);
    });
});

// Se activa cuando envías el formulario de edición
app.post('/actualizar-paciente', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    // Obtenemos los datos del formulario (req.body)
    const { id_paciente, name, age, heart_rate } = req.body;

    const query = 'UPDATE pacientes SET nombre = ?, edad = ?, frecuencia_cardiaca = ? WHERE id = ?';
    
    connection.query(query, [name, age, heart_rate, id_paciente], (err, result) => {
        if (err) {
            return res.send('Error al actualizar el paciente.');
        }
        // Redirigimos al usuario de vuelta a la lista
        res.redirect('/editar-pacientes');
    });
});

// Se activa cuando haces clic en el botón "Eliminar"
app.post('/eliminar-paciente', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
    // Obtenemos la ID del formulario oculto
    const { id_paciente } = req.body;

    const query = 'DELETE FROM pacientes WHERE id = ?';
    
    connection.query(query, [id_paciente], (err, result) => {
        if (err) {
            return res.send('Error al eliminar el paciente.');
        }
        // Redirigimos al usuario de vuelta a la lista
        res.redirect('/editar-pacientes');
    });
});

// Ruta para que un paciente vea sus propios datos
app.get('/ver-mis-datos', requireLogin, (req, res) => {
    const nombreUsuario = req.session.user.nombre_usuario;

    const query = 'SELECT * FROM pacientes WHERE nombre = ?';

    connection.query(query, [nombreUsuario], (err, results) => {
        if (err) {
            return res.send('Error al obtener los datos.');
        }

        // 3. Construimos la página HTML
        let html = `
          <html>
          <head>
            <link rel="stylesheet" href="/styles.css">
            <title>Mis Datos</title>
          </head>
          <body>
            <h1>Mis Datos de Paciente</h1>
        `;

        // 4. Verificamos si encontramos un registro de paciente
        if (results.length > 0) {
            const paciente = results[0]; // Solo mostramos el primer resultado
            html += `
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Edad</th>
                    <th>Frecuencia Cardiaca (bpm)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>${paciente.nombre}</td>
                    <td>${paciente.edad}</td>
                    <td>${paciente.frecuencia_cardiaca}</td>
                  </tr>
                </tbody>
              </table>
            `;
        } else {
            // Si no hay paciente con ese nombre de usuario
            html += `<p>No se encontraron datos de paciente asociados a tu usuario (${nombreUsuario}).</p>`;
        }

        html += `
            <br>
            <button onclick="window.location.href='/'">Volver</button>
          </body>
          </html>
        `;

        res.send(html);
    });
});

// Servir archivos estáticos (HTML)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para guardar datos en la base de datos
app.post('/submit-data', allowRoles(['admin', 'medico']), (req, res) => {
  const { name, age, heart_rate } = req.body;

  const query = 'INSERT INTO pacientes (nombre, edad, frecuencia_cardiaca) VALUES (?, ?, ?)';
  connection.query(query, [name, age, heart_rate], (err, result) => {
    if (err) {
      let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Error</title>
      </head>
      <body>
        <h1>Error al guardar paciente</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    
      return res.send(html);
    }
    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Correctamente</title>
      </head>
      <body>
        <h1>Guardado Exitosamente</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});

// Ruta para ordenar pacientes por frecuencia cardiaca
app.get('/ordenar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  const query = 'SELECT * FROM pacientes ORDER BY frecuencia_cardiaca DESC';

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes Ordenados</title>
      </head>
      <body>
        <h1>Pacientes Ordenados por Frecuencia Cardiaca</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Frecuencia Cardiaca (bpm)</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.frecuencia_cardiaca}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ruta para mostrar los datos de la base de datos en formato HTML
app.get('/pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  connection.query('SELECT * FROM pacientes', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes</title>
      </head>
      <body>
        <h1>Pacientes Registrados</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Frecuencia Cardiaca (bpm)</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.frecuencia_cardiaca}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ruta para buscar pacientes según filtros
app.get('/buscar-pacientes', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  const { name_search, age_search } = req.query;
  let query = 'SELECT * FROM pacientes WHERE 1=1';

  if (name_search) {
    query += ` AND nombre LIKE '%${name_search}%'`;
  }
  if (age_search) {
    query += ` AND edad = ${age_search}`;
  }

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Resultados de Búsqueda</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Frecuencia Cardiaca (bpm)</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.frecuencia_cardiaca}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ruta para búsqueda de pacientes en tiempo real (AJAX)
app.get('/buscar-pacientes-live', requireLogin, allowRoles(['admin', 'medico']), (req, res) => {
  const searchTerm = req.query.term;

  // Si no hay término de búsqueda, devolvemos un array vacío
  if (!searchTerm) {
    return res.json([]);
  }

  // Usamos LIKE para buscar coincidencias. LIMIT 10 es una buena práctica.
  const query = "SELECT nombre, edad, frecuencia_cardiaca FROM pacientes WHERE nombre LIKE ? LIMIT 10";
  
  connection.query(query, [`%${searchTerm}%`], (err, results) => {
    if (err) {
      console.error('Error en búsqueda live:', err);
      return res.status(500).json({ error: 'Error de base de datos' });
    }
    // Devolvemos los resultados como JSON
    res.json(results);
  });
});

// Ruta para insertar un nuevo médico
app.post('/insertar-medico', requireLogin, requireRole('admin'), (req, res) => {
  const { medico_name, especialidad } = req.body;

  // 🔹 Validar campos vacíos
  if (!medico_name || !especialidad) {
    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Error</title>
      </head>
      <body>
        <h1>Error: Debes llenar todos los campos.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    return res.send(html);
  }

  const query = 'INSERT INTO medicos (nombre, especialidad) VALUES (?, ?)';

  connection.query(query, [medico_name, especialidad], (err, result) => {

    // 🔹 Inserción exitosa
    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Éxito</title>
      </head>
      <body>
        <h1>Médico ${medico_name} guardado exitosamente.</h1>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});

// Ruta para mostrar los datos de medicos de la base de datos en formato HTML
app.get('/medicos', requireLogin, requireRole('admin'), (req, res) => {
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Medicos</title>
      </head>
      <body>
        <h1>Medicos Registrados</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Especialidad</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(medico => {
      html += `
        <tr>
          <td>${medico.nombre}</td>
          <td>${medico.especialidad}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});


// Iniciar el servidor
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});

