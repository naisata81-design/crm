require('dotenv').config();

// Registro de diagnóstico en memoria
const waLog = {
    ultimoError: null,
    ultimaActividad: null,
    ultimoMensaje: null,
    historial: [],
    errores: [],   // Log de errores reales con stack
    add(msg) {
        const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        this.historial.unshift(`[${ts}] ${msg}`);
        if (this.historial.length > 30) this.historial.pop();
    },
    addError(label, err) {
        const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        const entry = `[${ts}] ❌ ${label}: ${err && err.message ? err.message : String(err)}${err && err.stack ? '\n' + err.stack.split('\n').slice(1,4).join('\n') : ''}`;
        this.errores.unshift(entry);
        if (this.errores.length > 50) this.errores.pop();
        this.ultimoError = entry;
        this.historial.unshift(`[${ts}] ❌ ERROR: ${label}: ${err && err.message ? err.message.substring(0,80) : String(err).substring(0,80)}`);
        if (this.historial.length > 30) this.historial.pop();
    }
};

// Redirigir console.error y console.warn al waLog (no silenciarlos)
console.log = function() {};
console.info = function() {};
console.warn = function(...args) {
    waLog.add(`⚠️ [warn] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ').substring(0,120)}`);
};
console.error = function(...args) {
    const msg = args.map(a => {
        if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack.split('\n').slice(1,4).join('\n') : '');
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const entry = `[${ts}] ❌ ${msg}`;
    waLog.errores.unshift(entry);
    if (waLog.errores.length > 50) waLog.errores.pop();
    waLog.ultimoError = entry;
    waLog.historial.unshift(`[${ts}] ❌ ${msg.substring(0,100)}`);
    if (waLog.historial.length > 30) waLog.historial.pop();
};

// Errores conocidos y transitorios de Puppeteer/WhatsApp Web que se pueden ignorar
const PUPPETEER_IGNORABLE_ERRORS = [
    'Execution context was destroyed',
    'Session closed',
    'Target closed',
    'Protocol error',
    'Cannot find context with specified id',
    'Navigating frame was detached',
    // Errores transitorios de MongoDB Atlas (elección de primary / failover)
    'primary marked stale',
    'No primary found',
    'Server selection timed out',
    'connection timed out',
    'ECONNRESET',
    'ECONNREFUSED',
];
const isPuppeteerNoise = (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    return PUPPETEER_IGNORABLE_ERRORS.some(e => msg.includes(e));
};

// Capturar errores no manejados globalmente
process.on('uncaughtException', async (err) => {
    if (isPuppeteerNoise(err)) return; // ignorar ruido de Puppeteer
    
    // ENOENT del ZIP = /app era read-only. Ahora usamos /tmp, no debe ocurrir.
    // NO borrar la sesión de MongoDB — puede ser válida y recuperable.
    if (err.code === 'ENOENT' && err.message && err.message.includes('RemoteAuth')) {
        waLog.add('⚠️ ZIP de sesión no encontrado en disco (ENOENT). Reiniciando bot para reintentar...');
        waStatus = 'DESCONECTADO';
        waReady = false;
        waInitializing = false;
        try {
            if (waClient) { try { await waClient.destroy(); } catch(_) {} waClient = null; }
        } catch(_) {}
        setTimeout(() => initWhatsApp(), 5000);
        return; // NO borrar MongoDB — la sesión puede seguir siendo válida
    }
    
    waLog.addError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
    if (isPuppeteerNoise(reason)) return; // ignorar ruido de Puppeteer
    waLog.addError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

// Variable global para el cliente
let waClient = null;
let waReady = false;

// Función global para enviar mensajes

// ─── INFERIDOR DE GÉNERO POR NOMBRE ─────────────────────────────────────────
const NOMBRES_FEMENINOS = new Set([
    'sofia','sofía','maria','maría','ana','laura','gabriela','isabel','patricia',
    'alejandra','andrea','monica','mónica','rosa','carmen','lucía','lucia',
    'fernanda','daniela','valeria','victoria','cristina','elena','beatriz',
    'claudia','mariana','veronica','verónica','irene','silvia','esperanza',
    'yolanda','alicia','martha','marta','susana','adriana','rebeca','jaqueline',
    'jacqueline','lorena','diana','paula','sara','blanca','leticia','eva',
    'gloria','lourdes','pilar','concepcion','concepción','dolores','amparo',
    'antonia','francisca','josefa','natalia','esther','julia','teresa','raquel',
    'celia','consuelo','marisol','maribel','griselda','lidia','norma','karla',
    'karina','nadia','wendy','brenda','paola','alejandrina','guadalupe','lupe',
    'rocio','rocío','miriam','mirna','elsa','araceli','fabiola','vanessa'
]);
const NOMBRES_MASCULINOS = new Set([
    'daniel','carlos','juan','jose','josé','miguel','luis','antonio','francisco',
    'pedro','jesus','jesús','manuel','jorge','alejandro','roberto','david',
    'eduardo','ricardo','fernando','sergio','mario','rafael','victor','víctor',
    'alberto','oscar','óscar','hector','héctor','raul','raúl','arturo','pablo',
    'felipe','andres','andrés','enrique','guillermo','javier','gerardo','ernesto',
    'gabriel','rodrigo','alejandro','ivan','iván','martin','martín','omar','hugo',
    'armando','alfredo','diego','ignacio','antonio','edgar','cesar','césar',
    'benjamin','benjamín','samuel','santiago','adam','adan','adrián','adrian',
    'alan','alexis','angel','ángel','benito','beto','chuy','dario','darío',
    'efrain','efraín','emilio','erick','erik','ezequiel','fabian','fabián',
    'fidel','frank','freddy','gilberto','gonzalo','gustavo','heberto','hilario',
    'jaime','jonatan','jonathan','kevin','leo','leonel','lino','lucas','marco',
    'marcos','maximiliano','memo','nahum','noe','noé','octavio','oswaldo',
    'ramiro','rene','rené','reynaldo','roberto','rogelio','roque','ruben','rubén',
    'salvador','simon','simón','tomas','tomás','ulises','uriel','willian','william'
]);

function inferirGenero(nombre) {
    if (!nombre) return 'masculino'; // fallback
    // Tomar el primer nombre si hay varios
    const primerNombre = nombre.trim().split(/[\s,]+/)[0].toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quitar acentos para comparar
    if (NOMBRES_FEMENINOS.has(primerNombre)) return 'femenino';
    if (NOMBRES_MASCULINOS.has(primerNombre)) return 'masculino';
    // Heurística de terminación: nombres en -a tienden a ser femeninos
    if (primerNombre.endsWith('a') && !['mia','luca'].includes(primerNombre)) return 'femenino';
    return 'masculino'; // fallback
}
// ────────────────────────────────────────────────────────────────────────────

async function sendWhatsAppMessage(to, body, opciones = {}) {
    if (!waReady || !waClient) {
        waLog.add('⚠️ Intentó enviar mensaje pero WhatsApp no está listo');
        throw new Error('WhatsApp no está listo');
    }

    // =========================================================
    // HUMANIZADOR: Pasar el mensaje por el Cerebro para darle
    // lenguaje fluido y natural antes de enviarlo al cliente
    // =========================================================
    let bodyFinal = body;
    if (opciones.tipo) { // solo humanizar si se indica el tipo de mensaje
        try {
            const BOT_URL = process.env.BOT_ADVANCED_URL || 'https://boot-production-5efa.up.railway.app';
            const SECRET = process.env.API_SECRET_TOKEN || 'tu_token_secreto_muy_seguro_123';
            const hRes = await fetch(`${BOT_URL}/api/bot/humanize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-token': SECRET, 'Bypass-Tunnel-Reminder': 'true' },
                body: JSON.stringify({ texto: body, tipo: opciones.tipo, genero: opciones.genero || 'masculino' })
            });
            if (hRes.ok) {
                const hData = await hRes.json();
                if (hData.humanizado) {
                    bodyFinal = hData.humanizado;
                    waLog.add(`✨ Mensaje humanizado (tipo: ${opciones.tipo})`);
                }
            }
        } catch (hErr) {
            // Falla silenciosa: si el bot nuevo está caído, usamos el texto original
            waLog.add(`⚠️ Humanizador no disponible, enviando texto original.`);
        }
    }
    // =========================================================

    try {
        // Limpiar el número (quitar espacios, guiones, etc)
        let cleanPhone = to.replace(/\D/g, '');
        // Si el número tiene 10 dígitos (formato México local), agregar 521
        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
        // Si tiene 12 dígitos y empieza con 52 pero sin el 1 de celular, agregarlo (opcional, WhatsApp a veces acepta 52)
        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
        
        let chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
        if (waClient) {
            // Validar y obtener el ID real desde los servidores de WhatsApp para evitar bloqueos
            try {
                const registeredUser = await waClient.getNumberId(cleanPhone);
                if (registeredUser && registeredUser._serialized) {
                    chatId = registeredUser._serialized;
                } else {
                    waLog.add(`⚠️ Número no válido o no registrado en WA: ${cleanPhone}`);
                    return; // Abortar envío pacíficamente
                }
            } catch (err) {
                const errMsg = err && err.message ? err.message : String(err);
                const errCode = err && err.code ? ` [code: ${err.code}]` : '';
                const errStack = err && err.stack ? '\n' + err.stack.split('\n').slice(1, 4).join(' | ') : '';
                waLog.add(`⚠️ Error resolviendo ID de WA para ${cleanPhone}${errCode}: ${errMsg}${errStack}`);
                waLog.addError(`getNumberId(${cleanPhone})`, err);
                // Continúa con el chatId construido manualmente como fallback
            }

            // Promise.race para evitar que await waClient.sendMessage cuelgue el hilo permanentemente si Chrome está bloqueado
            await Promise.race([
                waClient.sendMessage(chatId, bodyFinal),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de WhatsApp Web (15s)')), 15000))
            ]);
            waLog.add(`✅ Notificación enviada a ${chatId}`);
        } else {
            waLog.add(`❌ waClient no está definido. No se pudo enviar a ${chatId}`);
        }
    } catch (e) {
        const eMsg = e && e.message ? e.message : String(e);
        const eCode = e && e.code ? ` [code: ${e.code}]` : '';
        const eStack = e && e.stack ? '\n' + e.stack.split('\n').slice(1, 4).join(' | ') : '';
        waLog.ultimoError = `[Enviando a ${to}]${eCode}: ${eMsg}`;
        waLog.add(`❌ Error notificando a ${to}${eCode}: ${eMsg}${eStack}`);
        waLog.addError(`sendWhatsAppMessage(${to})`, e);

        // Si el error es el 'getChat' undefined, el cliente está en estado zombie.
        // Marcarlo como no listo para forzar reconexion en el próximo intento.
        if (eMsg.includes('getChat') || eMsg.includes('Execution context was destroyed') || eMsg.includes('Session closed')) {
            waLog.add('⚠️ Cliente WhatsApp en estado zombie detectado. Reiniciando bot automáticamente...');
            waReady = false;
            waStatus = 'DESCONECTADO';
            
            // Forzar reinicio del cliente
            setTimeout(async () => {
                try {
                    if (waClient) {
                        await waClient.destroy();
                        waClient = null;
                    }
                } catch (_) {}
                // initWhatsApp() se encarga de re-crear la sesión
                initWhatsApp();
            }, 3000);
        }
    }
}

// Función global para enviar multimedia (imágenes, pdfs)
async function sendWhatsAppMedia(to, mediaObj, caption = '') {
    if (!waReady || !waClient) {
        waLog.add('⚠️ Intentó enviar multimedia pero WhatsApp no está listo');
        throw new Error('WhatsApp no está listo');
    }

    try {
        let cleanPhone = to.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
        
        let chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
        if (waClient) {
            try {
                const registeredUser = await waClient.getNumberId(cleanPhone);
                if (registeredUser && registeredUser._serialized) chatId = registeredUser._serialized;
            } catch (err) {}

            await Promise.race([
                waClient.sendMessage(chatId, mediaObj, { caption }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de WhatsApp Web (15s)')), 15000))
            ]);
            waLog.add(`✅ Multimedia enviada a ${chatId}`);
        }
    } catch (e) {
        waLog.add(`❌ Error enviando multimedia a ${to}: ${e.message}`);
    }
}
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Asegurar que el directorio de archivos exista (necesario en Render y otros servidores)
const ARCHIVOS_DIR = path.join(__dirname, 'public', 'archivos');
if (!fs.existsSync(ARCHIVOS_DIR)) {
    fs.mkdirSync(ARCHIVOS_DIR, { recursive: true });
    // console.log('📁 Directorio /public/archivos creado automáticamente');
}

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB max por archivo
});

const app = express();
const PORT = process.env.PORT || 3001; // Diferente puerto al principal

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://mongo:mJiHJrpYpovNfMvBBzfwiKpoBjYcPZLg@acela.proxy.rlwy.net:27029/naisata_db?authSource=admin';

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    heartbeatFrequencyMS: 10000,
    socketTimeoutMS: 45000,
})
    .then(() => console.log('✅ CRM Conectado a MongoDB exitosamente'))
    .catch(err => console.error('❌ Error conectando a MongoDB desde CRM:', err.message));


// --- Schemas (Específicos para CRM/ERP) ---

// Schemas para lectura cruzada desde la DB principal (Tracking App)
const VehicleTransactionRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    vehicleId: { type: String, ref: 'VehicleRef' },
    userId: String,
    userName: String,
    tipoMovimiento: String,
    proyectoId: String,
    notas: String,
    checklist: Object,
    checklistNotas: String,
    imgReporteDanos: String,
    estadoConfirmacion: String,
    fecha: Date,
    fechaFirma: Date,
    nivelesReportados: String
}, { collection: 'vehicletransactions' });
const VehicleRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    placas: String, modelo: String, marca: String, estado: String, destinoSugeridoCRM: String, crmActividadId: String, crmProyectoId: String
}, { collection: 'vehicles' });
const InvTransactionRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    itemId: { type: String, ref: 'InvItemRef' }, // String en lugar de ObjectId (migración BD)
    tipoMovimiento: String, cantidad: Number, responsable: String, proyectoId: String, fecha: Date
}, { collection: 'inventorytransactions' });
const InvItemRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String, tipo: String
}, { collection: 'inventoryitems' });
const UserRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String, apellido: String, telefono: String
}, { collection: 'users' });

// Schema de lectura cruzada: Tickets/Entregables de la app principal
const TicketRefSchema = new mongoose.Schema({
    _id: { type: String },
    siteId: String,
    proyectoId: String, // Algunos tickets tienen referencia directa al proyecto
    firmaTecnico: String,
    firmaCliente: String, // Si tiene valor = entregable firmado
    nombreCliente: String,
    folio: String,
    estado: String
}, { collection: 'tickets' });

const VehicleTransactionRef = mongoose.model('VehicleTransactionRef', VehicleTransactionRefSchema);
const VehicleRef = mongoose.model('VehicleRef', VehicleRefSchema);
const InvTransactionRef = mongoose.model('InvTransactionRef', InvTransactionRefSchema);
const InvItemRef = mongoose.model('InvItemRef', InvItemRefSchema);
const UserRef = mongoose.model('UserRef', UserRefSchema);
const TicketRef = mongoose.model('TicketRef', TicketRefSchema);

const CRMCotizacionSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    folio: { type: String, unique: true, sparse: true },
    clienteId: String,
    clienteNombre: String,
    vendedorId: String,
    descripcion: String,
    lugarEjecucion: String,
    contacto: String,
    categoria: { type: String, enum: ['Electricidad', 'Voz y Datos', 'Aires Acondicionados', 'Aislamiento', 'Tablaroca'] },
    condiciones: String,
    notas: String,
    creadorNombre: String,
    creadorCorreo: String,
    creadorTelefono: String,
    estado: { 
        type: String, 
        enum: ['Neutral', 'Levantamiento', 'Cotizando', 'En Seguimiento', 'Aprobado', 'Perdido', 'Perdida', 'Terminada', 'Cerrada', 'En Proceso', 'Ganada'], 
        default: 'Neutral' 
    },
    partidas: [{
        descripcion: String,
        cantidad: Number,
        um: String,
        precioUnitario: Number,
        total: Number
    }],
    subtotal: Number,
    iva: Number,
    total: Number,
    productosSugeridos: [{
        cantidad: Number,
        numeroParte: String,
        marca: String,
        descripcion: String,
        costo: Number
    }],
    fechaCreacion: { type: Date, default: Date.now },
    fechaSeguimiento: Date,
    requiereRevision: { type: Boolean, default: false },
    proyectoActivoId: String, // Se llena cuando se aprueba y pasa a ERP
    archivos: [String] // URLs de documentos adjuntos (planos, fotos, PDFs del cliente)
});
const CRMCotizacion = mongoose.model('CRMCotizacion', CRMCotizacionSchema);

const CRMProyectoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    cotizacionId: String, // Referencia a la cotización original
    folio: String, // Identificador de proyecto heredado o nuevo
    nombre: String,
    clienteId: String,
    clienteNombre: String,
    residenteId: String, // Encargado
    trabajadoresAsignados: [String],
    vehiculosAsignados: [String],
    estado: { type: String, enum: ['Activo', 'Pausado', 'Terminado', 'Cancelado', 'Terminada', 'Cerrada'], default: 'Activo' },
    fechaInicio: { type: Date, default: Date.now },
    fechaFin: Date,
    // Finanzas
    facturas: [{
        folio: String,
        descripcion: String,
        monto: Number,
        tipo: { type: String, enum: ['Ingreso', 'Egreso'] },
        archivoUrl: String, // PDF o Imagen
        fecha: { type: Date, default: Date.now }
    }],
    porcentajeAvance: { type: Number, default: 0 },
    avances: [{
        fecha: { type: Date, default: Date.now },
        empleado: String,
        porcentaje: Number,
        porcentajeProyecto: Number,
        comentario: String,
        fotos: [String]
    }],
    // Historial Diario / Bitácora
    bitacoraDiaria: [{
        fecha: Date,
        descripcion: String,
        personalAsistente: [String], // Quiénes fueron ese día
        vehiculosUtilizados: [String], // Qué carros se llevaron
        fotos: [String]
    }],
    archivos: [String] // IDs de documentos CRMArchivo en MongoDB
});
const CRMProyecto = mongoose.model('CRMProyecto', CRMProyectoSchema);

// Schema para almacenar archivos/imágenes en MongoDB (Base64)
const CRMArchivoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    nombre: String,
    contentType: String,
    datos: String, // Base64
    tamanio: Number,
    fechaSubida: { type: Date, default: Date.now }
});
const CRMArchivo = mongoose.model('CRMArchivo', CRMArchivoSchema);

const CRMActividadSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    descripcion: String,
    asignadoAId: String, 
    asignadoANombre: String,
    cuadrillaNombres: [String],
    vehiculosAsignados: [String],
    tipoDestino: String,
    proyectoId: String,
    estado: { type: String, enum: ['Pendiente', 'En Camino', 'En Sitio', 'En Progreso', 'Completada'], default: 'Pendiente' },
    fechaVencimiento: Date,
    horaInicio: String,  // "09:00" formato HH:MM
    horaFin: String,     // "13:00" formato HH:MM (opcional)
    avanceReportado: { type: Boolean, default: false },
    comentarioCierre: String,
    porcentajeAvance: { type: Number, default: 0 },
    avances: [{
        fecha: { type: Date, default: Date.now },
        empleado: String,
        porcentaje: Number,
        comentario: String,
        fotos: [String]
    }],
    fechaCreacion: { type: Date, default: Date.now }
});
const CRMActividad = mongoose.model('CRMActividad', CRMActividadSchema);

const CRMEventoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    tipo: { type: String, enum: ['Junta', 'Levantamiento', 'Llamada', 'Otro'], default: 'Junta' },
    titulo: String,
    descripcion: String,
    fechaInicio: Date,
    fechaFin: Date,
    participantes: [String],
    vehiculosAsignados: [String],
    recordatorioEnviado: { type: Boolean, default: false },
    fechaCreacion: { type: Date, default: Date.now }
});
const CRMEvento = mongoose.model('CRMEvento', CRMEventoSchema);

const CRMAjustesSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    tipo: { type: String, default: 'general' },
    logoBase64: String,
    folioInicio: { type: Number, default: 1 }
});
const CRMAjustes = mongoose.model('CRMAjustes', CRMAjustesSchema);

// Helper: obtener el siguiente número de folio disponible
async function getNextFolioNumber() {
    const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
    const folioInicio = ajustes?.folioInicio || 1;
    // Buscar el mayor número de folio existente con formato C1, C2... o legacy C-NNN
    const cots = await CRMCotizacion.find({ folio: { $regex: /^C\d+$|^C-\d+$/ } }).select('folio');
    let maxNum = folioInicio - 1;
    cots.forEach(c => {
        const num = parseInt(c.folio.replace('C-', '').replace('C', ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return Math.max(maxNum + 1, folioInicio);
}

// --- API Routes ---

// ==========================================
// PUENTE DE COMUNICACIÓN CON SERVER_BOT.JS
// ==========================================
app.post('/api/bridge/receive', (req, res) => {
    const token = req.headers['x-api-token'];
    // Validar token de seguridad (debe coincidir con el del bot)
    const SECRET = process.env.API_SECRET_TOKEN || 'tu_token_secreto_muy_seguro_123';
    
    if (token !== SECRET) {
        return res.status(401).json({ error: 'Acceso denegado al CRM: Token inválido' });
    }
    
    const data = req.body;
    console.log(`\n[CRM] 🤖 Notificación entrante del Bot Avanzado:`, data);
    
    // Aquí el CRM procesará la información que manda el bot (guardar historial, actualizar base de datos, etc)
    // ...

    res.json({ status: 'success', message: 'CRM recibió los datos del bot correctamente' });
});
// ==========================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'CRM Server is running' });
});

// Endpoint de diagnóstico — verifica estado de la conexión a MongoDB
app.get('/api/debug/status', (req, res) => {
    const estados = { 0: 'desconectado', 1: 'conectado', 2: 'conectando', 3: 'desconectando' };
    const dbState = mongoose.connection.readyState;
    res.json({
        server: 'OK',
        mongodb: estados[dbState] || `estado-${dbState}`,
        mongodbReadyState: dbState,
        uri_source: process.env.MONGODB_URI ? 'variable de entorno' : 'hardcoded',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/usuarios', async (req, res) => {
    try {
        const users = await UserRef.find().select('nombre apellido telefono').sort('nombre');
        res.json(users);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/test-phones', async (req, res) => {
    try {
        const users = await mongoose.connection.db.collection('users').find({}).toArray();
        res.json(users);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vehiculos/disponibles', async (req, res) => {
    try {
        // Obtenemos todos los vehiculos. El admin elegirá
        const vehs = await VehicleRef.find().select('placas modelo marca destinoSugeridoCRM').sort('modelo');
        res.json(vehs);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Rutas de Ajustes (Logo)
app.get('/api/ajustes/logo', async (req, res) => {
    try {
        const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        res.json({ logo: ajustes ? ajustes.logoBase64 : null });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/ajustes/logo', async (req, res) => {
    try {
        const { logoBase64 } = req.body;
        let ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        if (!ajustes) {
            ajustes = new CRMAjustes({ tipo: 'general', logoBase64 });
        } else {
            ajustes.logoBase64 = logoBase64;
        }
        await ajustes.save();
        res.json({ message: 'Logo guardado con éxito' });
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Rutas de Ajustes (Folio)
app.get('/api/ajustes/folio', async (req, res) => {
    try {
        const ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        res.json({ folioInicio: ajustes?.folioInicio || 1 });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/ajustes/folio', async (req, res) => {
    try {
        const { folioInicio } = req.body;
        const num = parseInt(folioInicio, 10);
        if (isNaN(num) || num < 1) return res.status(400).json({ error: 'Número inválido' });
        let ajustes = await CRMAjustes.findOne({ tipo: 'general' });
        if (!ajustes) {
            ajustes = new CRMAjustes({ tipo: 'general', folioInicio: num });
        } else {
            ajustes.folioInicio = num;
        }
        await ajustes.save();
        res.json({ message: `Folio inicial configurado a ${num}` });
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Rutas de Cotizaciones
app.get('/api/cotizaciones', async (req, res) => {
    try {
        const cots = await CRMCotizacion.find().sort({ fechaCreacion: -1 });
        res.json(cots);
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Asignar folios a TODAS las cotizaciones que no lo tengan (debe ir ANTES de /:id)
app.post('/api/cotizaciones/asignar-folios-todos', async (req, res) => {
    try {
        const sinFolio = await CRMCotizacion.find({
            $or: [
                { folio: { $exists: false } },
                { folio: null },
                { folio: '' },
                { folio: 'Sin folio' }
            ]
        }).sort({ fechaCreacion: 1 });

        let count = 0;
        for (const cot of sinFolio) {
            const num = await getNextFolioNumber();
            cot.folio = `C${num}`;
            await cot.save();
            count++;
        }
        res.json({ message: `${count} cotizaciones actualizadas con folio.`, total: count });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cotizaciones/:id', async (req, res) => {
    try {
        const cot = await CRMCotizacion.findById(req.params.id);
        if (!cot) return res.status(404).json({ error: 'No encontrado' });
        res.json(cot);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/cotizaciones', async (req, res) => {
    try {
        const data = req.body;

        // Generar folio único — si hay colisión por concurrencia, reintentamos
        const folioManual = data.folio && data.folio.trim() !== '' && data.folio !== 'Sin folio' && data.folio !== 'Asignación Automática';

        if (folioManual) {
            // Folio proporcionado manualmente: verificar que no esté en uso
            const existe = await CRMCotizacion.findOne({ folio: data.folio.trim() });
            if (existe) {
                return res.status(409).json({ error: `El folio "${data.folio.trim()}" ya está en uso. Se asignará uno automáticamente.` });
            }
            data.folio = data.folio.trim();
        } else {
            // Folio automático con protección ante colisión por concurrencia
            let intentos = 0;
            let folioGenerado;
            while (intentos < 5) {
                const num = await getNextFolioNumber();
                folioGenerado = `C${num}`;
                const existe = await CRMCotizacion.findOne({ folio: folioGenerado });
                if (!existe) break; // folio disponible
                intentos++;
            }
            data.folio = folioGenerado;
        }

        const newCotizacion = new CRMCotizacion(data);
        await newCotizacion.save();
        res.json({ message: 'Cotización creada con éxito', data: newCotizacion });
    } catch(err) {
        if (err.code === 11000) {
            // Error de índice único en MongoDB (race condition extrema)
            return res.status(409).json({ error: 'El folio generado ya existe. Por favor intenta de nuevo.' });
        }
        res.status(500).json({error: err.message});
    }
});

app.put('/api/cotizaciones/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        // Prevent overwriting the folio with an empty string or default labels which trigger duplicate key E11000
        if (data.folio === '' || data.folio === 'Asignación Automática' || data.folio === 'Sin folio') {
            delete data.folio;
        }

        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, data, { returnDocument: 'after' });
        if (!updatedCot) return res.status(404).json({ error: 'Cotización no encontrada' });
        res.json({ message: 'Cotización actualizada con éxito', data: updatedCot });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Subir archivos adjuntos a una cotización (planos, fotos, PDFs del cliente)
app.post('/api/cotizaciones/:id/archivos', upload.array('archivos', 10), async (req, res) => {
    try {
        const { id } = req.params;
        const cot = await CRMCotizacion.findById(id);
        if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
        if (!cot.archivos) cot.archivos = [];
        for (const file of req.files) {
            const archivo = new CRMArchivo({
                nombre: file.originalname,
                contentType: file.mimetype,
                datos: file.buffer.toString('base64'),
                tamanio: file.size
            });
            const saved = await archivo.save();
            cot.archivos.push(`/api/archivos/${saved._id}`);
        }
        await cot.save();
        res.json({ archivos: cot.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar un archivo adjunto de una cotización
app.delete('/api/cotizaciones/:id/archivos/:archivoId', async (req, res) => {
    try {
        const { id, archivoId } = req.params;
        const cot = await CRMCotizacion.findById(id);
        if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
        cot.archivos = (cot.archivos || []).filter(u => !u.includes(archivoId));
        await cot.save();
        await CRMArchivo.findByIdAndDelete(archivoId);
        res.json({ archivos: cot.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/cotizaciones/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        
        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, { estado: estado }, { returnDocument: 'after' });
        if (!updatedCot) return res.status(404).json({ error: 'Cotización no encontrada' });
        
        res.json({ message: 'Estado actualizado', data: updatedCot });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Rutas de Proyectos
app.get('/api/proyectos', async (req, res) => {
    try {
        const proys = await CRMProyecto.find().sort({ fechaInicio: -1 });
        res.json(proys);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.post('/api/proyectos', async (req, res) => {
    try {
        const data = req.body;
        const count = await CRMProyecto.countDocuments();
        
        let folioFinal = `P${count + 1}`;
        
        // Asignar Folio heredado si existe
        if (data.cotizacionId) {
            const cot = await CRMCotizacion.findById(data.cotizacionId);
            if (cot && cot.folio) folioFinal = cot.folio;
            
            // Marcar cotizacion a "Ganada" si se pasa a proyectos operativos
            if (cot) {
                 cot.proyectoActivoId = folioFinal; 
                 cot.estado = 'Ganada';
                 await cot.save();
                 // Heredar documentos adjuntos de la cotización al proyecto
                 if (cot.archivos && cot.archivos.length > 0) {
                     data.archivos = cot.archivos;
                 }
            }
        }
        
        const newProy = new CRMProyecto({ ...data, folio: folioFinal });
        await newProy.save();
        res.json({ message: 'Proyecto creado con éxito', data: newProy });
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.put('/api/proyectos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        // Validación: Si se intenta cerrar/terminar, debe existir al menos un entregable firmado
        const ESTADOS_CIERRE = ['Terminada', 'Terminado', 'Cerrada', 'Cerrado', 'Cancelado'];
        if (data.estado && ESTADOS_CIERRE.includes(data.estado)) {
            const proyecto = await CRMProyecto.findById(id);
            if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

            // Se busca por: proyectoId directo, folio del proyecto, _id del proyecto o el campo folio del ticket
            const folioProyecto = proyecto.folio || '';
            const ticketQuery = {
                firmaCliente: { $exists: true, $ne: null, $ne: '' },
                $or: [
                    { proyectoId: id },
                    { proyectoId: folioProyecto },
                    { proyectoId: { $regex: folioProyecto, $options: 'i' } },
                    { folio: folioProyecto },
                    { folio: { $regex: folioProyecto, $options: 'i' } }
                ]
            };

            const ticketFirmado = await TicketRef.findOne(ticketQuery).select('_id folio firmaCliente');

            if (!ticketFirmado) {
                return res.status(422).json({
                    error: `No se puede cerrar el proyecto "${folioProyecto}" porque no tiene ningún entregable firmado por el cliente. Genera y solicita la firma del entregable en la sección de Tickets antes de cerrar.`
                });
            }

            // Segunda Validación: La suma de facturas debe igualar al total de la cotización (si existe cotización asociada)
            if (proyecto.cotizacionId) {
                const cotizacion = await CRMCotizacion.findById(proyecto.cotizacionId);
                if (cotizacion && (cotizacion.total || cotizacion.total === 0)) {
                    const sumaFacturas = (proyecto.facturas || []).reduce((acc, f) => acc + (f.monto || 0), 0);
                    
                    // Permitir margen de $1 por posibles diferencias de redondeo en decimales
                    if (Math.abs(sumaFacturas - cotizacion.total) > 1) {
                        return res.status(422).json({
                            error: `No se puede cerrar el proyecto. La suma de facturas ($${sumaFacturas.toLocaleString('es-MX', {minimumFractionDigits:2})}) no coincide con el monto total de la cotización ($${cotizacion.total.toLocaleString('es-MX', {minimumFractionDigits:2})}).`
                        });
                    }
                }
            }

            // Tercera Validación: El porcentaje de avance del proyecto debe ser 100%
            if (proyecto.porcentajeAvance !== 100) {
                return res.status(422).json({
                    error: `No se puede cerrar el proyecto. El porcentaje de avance actual es del ${proyecto.porcentajeAvance || 0}%. Debe estar al 100% para poder finalizarlo.`
                });
            }
        }

        const updatedProy = await CRMProyecto.findByIdAndUpdate(id, data, { returnDocument: 'after' });
        if (!updatedProy) return res.status(404).json({ error: 'Proyecto no encontrado' });
        res.json({ message: 'Proyecto actualizado con éxito', data: updatedProy });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/proyectos/:id/recursos', async (req, res) => {
    try {
        const proj = await CRMProyecto.findById(req.params.id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        
        let orConditions = [{ proyectoId: proj._id.toString() }];
        
        if (proj.folio && proj.folio.trim() !== '') {
            orConditions.push({ proyectoId: proj.folio.trim() });
            orConditions.push({ proyectoId: { $regex: proj.folio.trim(), $options: 'i' } });
            orConditions.push({ notas: { $regex: proj.folio.trim(), $options: 'i' } }); // Búsqueda en notas por [Destino CRM]
        }
        
        if (proj.nombre && proj.nombre.trim() !== '') {
            const safeSearch = proj.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
            orConditions.push({ notas: { $regex: safeSearch, $options: 'i' } });
        } else if (proj.clienteNombre && proj.clienteNombre.trim() !== '') {
            const safeSearch = proj.clienteNombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
            orConditions.push({ notas: { $regex: safeSearch, $options: 'i' } });
        }

        let q = { $or: orConditions };
        
        const vehTransactions = await VehicleTransactionRef.find(q)
                                        .populate('vehicleId')
                                        .sort({ fecha: -1 })
                                        .limit(50);
        
        const invTransactions = await InvTransactionRef.find(q)
                                        .populate('itemId')
                                        .sort({ fecha: -1 })
                                        .limit(50);
                                        
        // También incluir actividades CRM vinculadas para enriquecer historial
        const actividadesConditions = [
            { proyectoId: proj._id.toString() },
            { proyectoId: proj.folio }
        ];
        // Manejar formato legado "[Activo] P-003 - Nombre" que puede estar en la BD
        if (proj.folio) {
            actividadesConditions.push({ proyectoId: { $regex: proj.folio, $options: 'i' } });
        }
        if (proj.nombre) {
            const safeNombre = proj.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            actividadesConditions.push({ proyectoId: { $regex: safeNombre, $options: 'i' } });
        }
        if (proj.clienteNombre) {
            const safeCliente = proj.clienteNombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            actividadesConditions.push({ proyectoId: { $regex: safeCliente, $options: 'i' } });
        }
        const actividadesProy = await CRMActividad.find({ $or: actividadesConditions });

        // Personal de actividades CRM
        const personalCRM = new Set();
        actividadesProy.forEach(a => {
            if (a.asignadoANombre) personalCRM.add(a.asignadoANombre);
            (a.cuadrillaNombres || []).forEach(n => n && personalCRM.add(n));
        });

        // Vehículos de actividades CRM
        const vehiculosCRM = [];
        const allVehIds = new Set();
        actividadesProy.forEach(a => (a.vehiculosAsignados||[]).forEach(vid => allVehIds.add(vid)));
        if (allVehIds.size > 0) {
            const vehs = await VehicleRef.find({ _id: { $in: Array.from(allVehIds) } }).select('marca modelo placas');
            vehs.forEach(v => vehiculosCRM.push(v));
        }

        res.json({
            vehiculos: vehTransactions,
            herramientas: invTransactions,
            personalCRM: Array.from(personalCRM),
            vehiculosCRM,
            actividades: actividadesProy
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/archivos', upload.array('archivos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        if (!proj.archivos) proj.archivos = [];

        for (const file of req.files) {
            const archivo = new CRMArchivo({
                nombre: file.originalname,
                contentType: file.mimetype,
                datos: file.buffer.toString('base64'),
                tamanio: file.size
            });
            const saved = await archivo.save();
            proj.archivos.push(`/api/archivos/${saved._id}`);
        }
        await proj.save();
        res.json({ files: proj.archivos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Servir archivos guardados en MongoDB
app.get('/api/archivos/:id', async (req, res) => {
    try {
        const archivo = await CRMArchivo.findById(req.params.id);
        if (!archivo) return res.status(404).send('Archivo no encontrado');
        const buffer = Buffer.from(archivo.datos, 'base64');
        res.set('Content-Type', archivo.contentType);
        res.set('Content-Disposition', `inline; filename="${archivo.nombre}"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/facturas', upload.single('archivo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { folio, monto } = req.body;
        if (!req.file) {
            return res.status(400).json({ error: 'Es obligatorio subir un archivo (foto o PDF) para la factura.' });
        }
        
        const archivo = new CRMArchivo({
            nombre: req.file.originalname,
            contentType: req.file.mimetype,
            datos: req.file.buffer.toString('base64'),
            tamanio: req.file.size
        });
        const saved = await archivo.save();
        const archivoUrl = `/api/archivos/${saved._id}`;
        
        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");
        
        if (!proj.facturas) proj.facturas = [];
        proj.facturas.push({ folio, monto: parseFloat(monto) || 0, archivoUrl, tipo: 'Ingreso', fecha: new Date() });
        await proj.save();
        res.json({ success: true, facturas: proj.facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar una factura de un proyecto
app.delete('/api/proyectos/:id/facturas/:facturaId', async (req, res) => {
    try {
        const { id, facturaId } = req.params;
        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).json({ error: "Proyecto no encontrado" });
        
        const factura = proj.facturas.id(facturaId);
        if (!factura) return res.status(404).json({ error: "Factura no encontrada" });
        
        // Eliminar el archivo asociado si existe
        if (factura.archivoUrl) {
            const archivoId = factura.archivoUrl.split('/').pop();
            try {
                await CRMArchivo.findByIdAndDelete(archivoId);
            } catch(e) { console.error("Error eliminando archivo de factura:", e); }
        }
        
        // Remover factura del arreglo
        proj.facturas.pull(facturaId);
        await proj.save();
        
        res.json({ success: true, message: 'Factura eliminada', facturas: proj.facturas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/proyectos/:id/avance', upload.array('fotos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { empleado, porcentajeTarea, porcentajeProyecto, comentario, actividadId } = req.body;
        
        let fotosUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const archivo = new CRMArchivo({
                    nombre: file.originalname,
                    contentType: file.mimetype,
                    datos: file.buffer.toString('base64'),
                    tamanio: file.size
                });
                const saved = await archivo.save();
                fotosUrls.push(`/api/archivos/${saved._id}`);
            }
        }

        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).json({ error: "Proyecto no encontrado" });

        // Si se envió el ID de la actividad, verificar que no se haya reportado ya
        if (actividadId) {
            const act = await CRMActividad.findById(actividadId);
            if (act) {
                if (act.avanceReportado) {
                    return res.status(400).json({ error: "Ya se reportó un avance para esta tarea." });
                }
                act.avanceReportado = true;
                await act.save();
            }
        }

        const pctTarea = parseInt(porcentajeTarea, 10) || 0;
        const pctProyecto = parseInt(porcentajeProyecto, 10) || 0;
        
        proj.avances.push({
            empleado,
            porcentaje: pctTarea,
            porcentajeProyecto: pctProyecto,
            comentario,
            fotos: fotosUrls
        });
        
        // Actualizar porcentaje del proyecto si se proporcionó
        if (pctProyecto > 0) {
            proj.porcentajeAvance = pctProyecto;
        }
        
        await proj.save();
        
        res.json({ success: true, avance: proj.avances[proj.avances.length - 1] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/proyectos/:id/porcentaje-global', async (req, res) => {
    try {
        const { id } = req.params;
        const { porcentaje } = req.body;
        
        const pct = parseInt(porcentaje, 10);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            return res.status(400).json({ error: "Porcentaje inválido. Debe ser entre 0 y 100." });
        }

        const proj = await CRMProyecto.findById(id);
        if (!proj) return res.status(404).send("Proyecto no encontrado");

        proj.porcentajeAvance = pct;
        await proj.save();

        res.json({ success: true, porcentajeAvance: proj.porcentajeAvance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// Rutas de Actividades
app.get('/api/actividades', async (req, res) => {
    try {
        const acts = await CRMActividad.find().sort({ fechaCreacion: -1 });
        res.json(acts);
    } catch(err) { res.status(500).json({error: err.message}); }
});

app.get('/api/actividades/:id', async (req, res, next) => {
    if (req.params.id === 'conflictos') return next();
    try {
        const act = await CRMActividad.findById(req.params.id);
        if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });
        res.json(act);
    } catch(err) { res.status(500).json({error: err.message}); }
});

// Detección de conflictos de recursos
// Helper compartido de solapamiento de horarios
const toMins = h => {
    if (!h || h === '') return null;
    const [hh, mm] = h.split(':').map(Number);
    return hh * 60 + mm;
};
const solapan = (aIni, aFin, bIni, bFin) => {
    // Tratar null/vacío como rango completo del día (00:00 - 23:59)
    const aStart = toMins(aIni) ?? 0;
    const aEnd   = toMins(aFin) ?? 23 * 60 + 59;
    const bStart = toMins(bIni) ?? 0;
    const bEnd   = toMins(bFin) ?? 23 * 60 + 59;
    return aStart < bEnd && aEnd > bStart;
};

app.get('/api/actividades/conflictos', async (req, res) => {
    try {
        const { fecha, horaInicio, horaFin } = req.query;
        let empleados = req.query['empleados[]'] || req.query.empleados || [];
        let vehiculos = req.query['vehiculos[]'] || req.query.vehiculos || [];
        if (!Array.isArray(empleados)) empleados = [empleados];
        if (!Array.isArray(vehiculos)) vehiculos = [vehiculos];

        if (!fecha) return res.json({ vehiculosOcupados: [], empleadosOcupados: [], vehiculosBloqueados: [] });

        // Rango del día seleccionado (medianoche a medianoche UTC)
        const diaInicio = new Date(fecha + 'T00:00:00.000Z');
        const diaFin   = new Date(fecha + 'T23:59:59.999Z');

        // Todas las tareas y eventos de ese día
        const tareasDelDia = await CRMActividad.find({ 
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
            estado: { $ne: 'Completada' }
        });
        const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

        const vehiculosOcupados = [];
        const empleadosOcupados = [];

        // Normalizamos la lista de empleados buscados
        const empBuscados = empleados.map(e => e.trim().toLowerCase());

        tareasDelDia.forEach(t => {
            const hayConflicto = solapan(horaInicio || null, horaFin || null, t.horaInicio || null, t.horaFin || null);
            if (!hayConflicto) return;

            // Revisar vehículos
            (t.vehiculosAsignados || []).forEach(vId => {
                if (vehiculos.includes(vId) && !vehiculosOcupados.find(x => x.id === vId)) {
                    vehiculosOcupados.push({ id: vId, tarea: t.descripcion, horaInicio: t.horaInicio, horaFin: t.horaFin });
                }
            });

            // Revisar encargado principal y cuadrilla
            let empExistArr = [t.asignadoANombre, ...(t.cuadrillaNombres || [])]
                .filter(Boolean).join(',').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            empBuscados.forEach(b => {
                if (empExistArr.some(e => e === b || e.includes(b) || b.includes(e))) {
                    // Original name from query to let frontend match it
                    const origName = empleados.find(orig => orig.trim().toLowerCase() === b) || b;
                    if (!empleadosOcupados.find(x => x.nombre === origName)) {
                        empleadosOcupados.push({ nombre: origName, tarea: t.descripcion, horaInicio: t.horaInicio, horaFin: t.horaFin });
                    }
                }
            });
        });

        eventosDelDia.forEach(ev => {
            const hIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
            const hFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
            const hayConflicto = solapan(horaInicio || null, horaFin || null, hIni, hFin);
            if (!hayConflicto) return;

            (ev.vehiculosAsignados || []).forEach(vId => {
                if (vehiculos.includes(vId) && !vehiculosOcupados.find(x => x.id === vId)) {
                    vehiculosOcupados.push({ id: vId, tarea: ev.titulo, horaInicio: hIni, horaFin: hFin });
                }
            });

            let empExistArr = (ev.participantes || [])
                .filter(Boolean).join(',').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

            empBuscados.forEach(b => {
                if (empExistArr.some(e => e === b || e.includes(b) || b.includes(e))) {
                    const origName = empleados.find(orig => orig.trim().toLowerCase() === b) || b;
                    if (!empleadosOcupados.find(x => x.nombre === origName)) {
                        empleadosOcupados.push({ nombre: origName, tarea: ev.titulo, horaInicio: hIni, horaFin: hFin });
                    }
                }
            });
        });

        // Vehículos bloqueados de Tracking
        const bloqueadosTracking = await VehicleRef.find({
            estado: { $in: ['Prestado', 'Pendiente de Confirmación'] }
        }).select('_id estado');

        const vehiculosBloqueados = bloqueadosTracking
            .filter(v => vehiculos.includes(v._id.toString()))
            .map(v => ({ id: v._id.toString(), estado: v.estado }));

        res.json({ vehiculosOcupados, empleadosOcupados, vehiculosBloqueados });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Obtener alcance de proyecto sin precios (para encargados)
app.get('/api/alcance-proyecto/:proyectoId', async (req, res) => {
    try {
        const { proyectoId } = req.params;
        
        let orConditions = [];
        const mongooseQuery = require('mongoose');
        if (mongooseQuery.isValidObjectId(proyectoId)) {
            orConditions.push({ _id: proyectoId });
        }
        orConditions.push({ folio: proyectoId });
        
        const proj = await CRMProyecto.findOne({ $or: orConditions });
        if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });
        
        if (!proj.cotizacionId) {
            return res.status(404).json({ error: 'El proyecto no tiene cotización asociada' });
        }
        
        const cot = await CRMCotizacion.findById(proj.cotizacionId);
        if (!cot) return res.status(404).json({ error: 'Cotización original no encontrada' });
        
        // Redactar datos (quitar todo lo relacionado a precios)
        const alcance = {
            clienteNombre: cot.clienteNombre,
            folio: cot.folio,
            lugarEjecucion: cot.lugarEjecucion,
            contacto: cot.contacto,
            descripcion: cot.descripcion,
            notas: cot.notas,
            fechaCreacion: cot.fechaCreacion,
            creadorNombre: cot.creadorNombre,
            creadorTelefono: cot.creadorTelefono,
            creadorCorreo: cot.creadorCorreo,
            productosSugeridos: (cot.productosSugeridos || []).map(ps => ({
                cantidad: ps.cantidad,
                descripcion: ps.descripcion,
                numeroParte: ps.numeroParte,
                marca: ps.marca,
                // Redactar costo
            })),
            partidas: (cot.partidas || []).map(p => ({
                descripcion: p.descripcion,
                cantidad: p.cantidad,
                unidad: p.unidad,
                // Redactar precioUnitario y total
            }))
        };
        
        res.json(alcance);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener tareas de hoy para un empleado (para portal de empleados)
app.get('/api/empleados/mis-tareas-hoy', async (req, res) => {
    try {
        const { nombre } = req.query;
        if (!nombre) return res.status(400).json({error: 'Falta nombre'});

        // Rango de hoy en zona horaria de México
        const fechaIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
        const diaInicio = new Date(fechaIso + 'T00:00:00.000Z');
        const diaFin   = new Date(fechaIso + 'T23:59:59.999Z');

        // Búsqueda insensible a mayúsculas
        const nombreRegex = new RegExp(`^\\s*${nombre.trim()}\\s*$`, 'i');

        // Buscar actividades donde sea asignado (encargado) o esté en cuadrilla
        const tareas = await CRMActividad.find({
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
            estado: { $ne: 'Completada' },
            $or: [
                { asignadoANombre: nombreRegex },
                { cuadrillaNombres: nombreRegex }
            ]
        });

        // Enriquecer con info de vehículos y proyectos (archivos)
        const tareasEnriquecidas = await Promise.all(tareas.map(async (t) => {
            const tObj = t.toObject();
            
            // Separar posibles múltiples encargados y buscar coincidencia exacta para evitar falsos positivos
            const encargadosArr = (t.asignadoANombre || '').toLowerCase().split(',').map(s => s.trim());
            tObj.isEncargado = encargadosArr.includes((nombre || '').trim().toLowerCase());

            // Vehiculos
            if (t.vehiculosAsignados && t.vehiculosAsignados.length > 0) {
                tObj.vehiculosInfo = await VehicleRef.find({ _id: { $in: t.vehiculosAsignados } }).select('marca modelo placas');
            } else {
                tObj.vehiculosInfo = [];
            }

            // Proyecto / Archivos
            if (t.proyectoId) {
                const mongooseQuery = require('mongoose');
                let orConditions = [];
                if (mongooseQuery.isValidObjectId(t.proyectoId)) {
                    orConditions.push({ _id: t.proyectoId });
                }
                orConditions.push({ folio: t.proyectoId });
                // También buscar por nombre parcial (para cuando proyectoId es texto)
                orConditions.push({ nombre: { $regex: t.proyectoId.split(']').pop().split('-').pop().trim(), $options: 'i' } });

                const proj = await CRMProyecto.findOne({ $or: orConditions });
                if (proj) {
                    tObj.proyectoNombreReal = proj.nombre;
                    tObj.proyectoObjectId = proj._id.toString(); // ID real para avances
                    tObj.archivos = proj.archivos || [];
                } else {
                    tObj.archivos = [];
                    tObj.proyectoObjectId = null;
                }
            } else {
                tObj.archivos = [];
                tObj.proyectoObjectId = null;
            }
            return tObj;
        }));

        res.json(tareasEnriquecidas);
    } catch(err) {
        res.status(500).json({error: err.message});
    }
});

async function notificarFlotilla(actividad, nuevosVehiculosIds) {
    try {
        if (!nuevosVehiculosIds || nuevosVehiculosIds.length === 0) return;
        
        const allUsers = await UserRef.find();
        const allVehs = await VehicleRef.find();
        
        const vehiculosNombres = nuevosVehiculosIds.map(vId => {
            const v = allVehs.find(x => x._id.toString() === vId);
            return v ? `${v.marca} ${v.modelo} (${v.placas || 'S/P'})` : 'Desconocido';
        }).join(', ') || 'Ninguno';

        let encargado = '';
        if (Array.isArray(actividad.asignadoANombre)) {
            encargado = actividad.asignadoANombre.join(', ');
        } else if (typeof actividad.asignadoANombre === 'string') {
            encargado = actividad.asignadoANombre;
        } else {
            encargado = 'Alguien del equipo';
        }

        const msgFlotilla = `🚗 *SOLICITUD DE VEHÍCULO (CRM)* 🚗\nHola, se acaba de asignar un vehículo para una tarea operativa.\n\n👤 **Asignado a:** ${encargado}\n🚙 **Vehículo(s):** ${vehiculosNombres}\n📝 **Tarea:** ${actividad.descripcion || 'Tarea Interna'}\n\n🔧 _Favor de realizar el préstamo formal (entrega de llaves) en el módulo de Tracking._`;

        const administradoras = allUsers.filter(u => {
            const name = (u.nombre + ' ' + (u.apellido || '')).toLowerCase();
            return name.includes('jaqueline') || name.includes('isabel');
        });

        for (const admin of administradoras) {
            if (admin.telefono) {
                if (typeof waLog !== 'undefined' && waLog.add) {
                    waLog.add(`Enviando notificación de flotilla a: ${admin.nombre}`);
                }
                try {
                    await sendWhatsAppMessage(admin.telefono, msgFlotilla, { tipo: 'flotilla' });
                } catch(e) {
                    console.error('Error enviando WA a flotilla:', e);
                }
            }
        }
    } catch(e) {
        console.error('Error en notificarFlotilla:', e);
    }
}

app.post('/api/actividades', async (req, res) => {
    try {
        const data = req.body;

        // Ajuste de zona horaria para evitar desfase de 1 día (forzar mediodía UTC)
        if (data.fechaVencimiento && typeof data.fechaVencimiento === 'string' && data.fechaVencimiento.length === 10) {
            data.fechaVencimiento = data.fechaVencimiento + 'T12:00:00.000Z';
        }

        // --- Guard: verificar conflictos antes de guardar ---
        if (data.fechaVencimiento) {
            const fecha = new Date(data.fechaVencimiento).toISOString().split('T')[0];
            const diaInicio = new Date(fecha + 'T00:00:00.000Z');
            const diaFin   = new Date(fecha + 'T23:59:59.999Z');

            // Helper para convertir "HH:MM" a minutos totales
            const toMinsLocal = h => {
                if (!h || h === '') return null;
                const [hh, mm] = h.split(':').map(Number);
                return hh * 60 + mm;
            };

            // Hora actual en México (formato HH:MM)
            const ahoraEnMexico = new Date().toLocaleTimeString('en-US', {
                timeZone: 'America/Mexico_City',
                hour12: false, hour: '2-digit', minute: '2-digit'
            });
            const fechaHoyMexico = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            const esFechaHoy = fecha === fechaHoyMexico;

            // Corrección 2: Si es HOY y no hay hora de inicio, usar la hora actual como referencia
            if (esFechaHoy && !data.horaInicio) {
                data.horaInicio = ahoraEnMexico;
            }

            // Corrección 3: Si es HOY y la hora de fin ya pasó, rechazar de inmediato
            if (esFechaHoy && data.horaFin) {
                const minutosFin = toMinsLocal(data.horaFin);
                const minutosAhora = toMinsLocal(ahoraEnMexico);
                if (minutosFin !== null && minutosAhora !== null && minutosFin <= minutosAhora) {
                    return res.status(409).json({
                        error: 'Conflicto de horario',
                        conflictos: [`La hora de fin (${data.horaFin}) ya pasó. Son las ${ahoraEnMexico} en México. Por favor elige un horario futuro.`]
                    });
                }
            }

            // Corrección 1: Excluir tareas Completadas o Canceladas del chequeo de conflictos
            const tareasDelDia = await CRMActividad.find({
                fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
                estado: { $nin: ['Completada', 'Cancelada'] }
            });
            const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

            const conflictos = [];
            
            let empNuevosArr = [data.asignadoANombre, ...(data.cuadrillaNombres || [])]
                .filter(Boolean).join(',').split(',')
                .map(s => s.trim().toLowerCase()).filter(Boolean);

            tareasDelDia.forEach(t => {
                if (!solapan(data.horaInicio || null, data.horaFin || null, t.horaInicio || null, t.horaFin || null)) return;
                
                (t.vehiculosAsignados || []).forEach(vId => {
                    if ((data.vehiculosAsignados || []).includes(vId))
                        conflictos.push(`Vehículo ocupado en tarea: "${t.descripcion}"`);
                });
                
                let empExistArr = [t.asignadoANombre, ...(t.cuadrillaNombres || [])]
                    .filter(Boolean).join(',').split(',')
                    .map(s => s.trim().toLowerCase()).filter(Boolean);
                
                empNuevosArr.forEach(n => {
                    // Verificación parcial e insensible a mayúsculas
                    if (empExistArr.some(e => e === n || e.includes(n) || n.includes(e))) {
                        conflictos.push(`Empleado ocupado en otra tarea: "${t.descripcion}"`);
                    }
                });
            });

            eventosDelDia.forEach(ev => {
                const horaIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                const horaFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                if (!solapan(data.horaInicio || null, data.horaFin || null, horaIni, horaFin)) return;
                
                (ev.vehiculosAsignados || []).forEach(vId => {
                    if ((data.vehiculosAsignados || []).includes(vId))
                        conflictos.push(`Vehículo ocupado en evento: "${ev.titulo}"`);
                });
                
                let empExistArr = (ev.participantes || [])
                    .filter(Boolean).join(',').split(',')
                    .map(s => s.trim().toLowerCase()).filter(Boolean);
                
                empNuevosArr.forEach(n => {
                    if (empExistArr.some(e => e === n || e.includes(n) || n.includes(e))) {
                        conflictos.push(`Empleado ocupado en junta/levantamiento: "${ev.titulo}"`);
                    }
                });
            });

            // También verificar vehículos bloqueados en Tracking
            if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
                const bloqueados = await VehicleRef.find({
                    _id: { $in: data.vehiculosAsignados },
                    estado: { $in: ['Prestado', 'Pendiente de Confirmación'] }
                }).select('modelo estado');
                bloqueados.forEach(v => {
                    conflictos.push(`Vehículo "${v.modelo}" está ${v.estado} en Tracking`);
                });
            }

            if (conflictos.length > 0) {
                return res.status(409).json({ error: 'Conflicto de recursos', conflictos });
            }
        }
        // --- Fin Guard ---

        const newAct = new CRMActividad(data);
        await newAct.save();

        // Inyectar etiqueta sugerida a vehículos seleccionados
        if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
            let label = data.destinoSugeridoCRMText;
            if (!label || label === '') label = data.descripcion || 'Tarea de CRM';
            for (const vId of data.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { 
                    destinoSugeridoCRM: label,
                    crmActividadId: newAct._id.toString(),
                    crmProyectoId: newAct.proyectoId || null
                });
            }
        }

        // ✅ Responder al cliente INMEDIATAMENTE (sin esperar WhatsApp)
        res.json({ message: 'Actividad creada con éxito', data: newAct });

        // --- NOTIFICACIONES WHATSAPP (en segundo plano, NO bloquea la respuesta) ---
        setImmediate(async () => {
        try {
            const allUsers = await UserRef.find();
            const allVehs = await VehicleRef.find();
            
            const findPhone = (name) => {
                // Quitamos espacios dobles y lo pasamos a minúsculas
                const queryName = name.trim().toLowerCase().replace(/\s+/g, ' ');
                const u = allUsers.find(x => {
                    const soloNombre = (x.nombre || '').trim().toLowerCase();
                    const soloApellido = (x.apellido || '').trim().toLowerCase();
                    const fullName = `${soloNombre} ${soloApellido}`.trim().replace(/\s+/g, ' ');
                    
                    if (!fullName) return false;
                    
                    // Match exacto, o si uno contiene al otro (Ej. "Daniel" dentro de "Daniel Arevalos")
                    return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
                });
                return u && u.telefono ? u.telefono : null;
            };

            const vehiculosNombres = (data.vehiculosAsignados || []).map(vId => {
                const v = allVehs.find(x => x._id.toString() === vId);
                return v ? v.modelo : 'Desconocido';
            }).join(', ') || 'Ninguno';
            
            // Si el frontend envía los acompañantes como un solo string separado por comas, lo separamos
            let acompanantesArr = [];
            if (Array.isArray(data.cuadrillaNombres)) {
                acompanantesArr = data.cuadrillaNombres.filter(Boolean);
            } else if (typeof data.cuadrillaNombres === 'string') {
                acompanantesArr = data.cuadrillaNombres.split(',').map(s => s.trim()).filter(Boolean);
            }
            
            let encargadosArr = [];
            if (Array.isArray(data.asignadoANombre)) {
                encargadosArr = data.asignadoANombre.filter(Boolean);
            } else if (typeof data.asignadoANombre === 'string') {
                encargadosArr = data.asignadoANombre.split(',').map(s => s.trim()).filter(Boolean);
            }

            const acompanantesTxt = acompanantesArr.join(', ') || 'Nadie';
            const encargadosTxt = encargadosArr.join(', ') || 'Ninguno';

            let proyectoNombre = 'Ninguno';
            if (data.proyectoId) {
                // FIX: el frontend guarda el FOLIO ("C523") en proyectoId, no el _id de MongoDB.
                // findById("C523") siempre devuelve null → búsqueda dual: primero por _id, luego por folio.
                const mongoose = require('mongoose');
                let proj = null;
                if (mongoose.isValidObjectId(data.proyectoId)) {
                    proj = await CRMProyecto.findById(data.proyectoId);
                }
                if (!proj) {
                    proj = await CRMProyecto.findOne({
                        $or: [
                            { folio: data.proyectoId },
                            { folio: { $regex: `^${data.proyectoId.trim()}$`, $options: 'i' } }
                        ]
                    });
                }
                if (proj) {
                    proyectoNombre = `${proj.folio || 'S/F'} - ${proj.nombre}`;
                    if (typeof waLog !== 'undefined' && waLog.add) {
                        waLog.add(`📂 Proyecto encontrado: ${proyectoNombre}`);
                    }
                } else {
                    if (typeof waLog !== 'undefined' && waLog.add) {
                        waLog.add(`⚠️ Proyecto NO encontrado para proyectoId: "${data.proyectoId}".`);
                    }
                }
            }

            const _dFecha = data.fechaVencimiento ? new Date(data.fechaVencimiento) : null;
            const fechaTxt = _dFecha
                ? `${_dFecha.toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'America/Mexico_City' })} - ${_dFecha.toLocaleDateString('es-MX', { day: '2-digit', timeZone: 'America/Mexico_City' })}`
                : 'No definida';

            // ── Determinar si la tarea es FUTURA (más de 1 día) o INMEDIATA (hoy/mañana) ──
            const hoyMx = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
            const hoyMxMs = new Date(hoyMx + 'T12:00:00.000Z').getTime();
            const tareaMs = _dFecha ? _dFecha.getTime() : hoyMxMs;
            const diasDiferencia = Math.round((tareaMs - hoyMxMs) / (1000 * 60 * 60 * 24));
            const esTareaFutura = diasDiferencia > 1; // más de 1 día de distancia

            const mensajeBase = `📝 Tarea: ${data.descripcion}\n📅 Fecha: ${fechaTxt}\n🕒 Horario: ${data.horaInicio || 'No definido'} a ${data.horaFin || 'No definido'}\n🏗️ Proyecto: ${proyectoNombre}\n🚗 Vehículo(s): ${vehiculosNombres}\n\nResponde con:\n✅ *ACEPTAR* — para confirmar tu participación\n❌ *RECHAZAR* — si no puedes realizarla`;

            for (const enc of encargadosArr) {
                const telEncargado = findPhone(enc);
                if (typeof waLog !== 'undefined' && waLog.add) {
                    waLog.add(`🔍 Buscando tel para encargado: ${enc} -> Resultado: ${telEncargado || 'NO ENCONTRADO'}`);
                }
                if (telEncargado) {
                    if (esTareaFutura) {
                        // ✉️ AVISO CORTO: solo notificar que fue agendado, sin detalles
                        const msgAviso = `📌 *AVISO DE TAREA AGENDADA*\n\nHola *${enc}*, quedaste agendado para una tarea el *${fechaTxt}*.\n📝 ${data.descripcion || 'Tarea operativa'}\n\n_Te mando todos los detalles un día antes._ 👌`;
                        try { await sendWhatsAppMessage(telEncargado, msgAviso, { tipo: 'aviso_tarea', genero: inferirGenero(enc) }); } catch(e) { console.error('Error WA aviso encargado:', e); }
                    } else {
                        // 🚨 MENSAJE COMPLETO: tarea para hoy o mañana
                        const msgEncargado = `🚨 *NUEVA TAREA ASIGNADA (Tú eres el Encargado)* 🚨\n\n${mensajeBase}\n\n👥 Te acompañan: ${acompanantesTxt}`;
                        try { await sendWhatsAppMessage(telEncargado, msgEncargado, { tipo: 'tarea_encargado', genero: inferirGenero(enc) }); } catch(e) { console.error('Error WA encargado:', e); }
                        // Encolar sesión WAITING_TASK_CONFIRM solo para tareas inmediatas
                        try {
                            const chatIdEnc = phoneToWaChatId(telEncargado);
                            const altChatIdEnc = chatIdEnc.startsWith('521') ? chatIdEnc.replace('521','52') : chatIdEnc.replace(/^52/, '521');
                            const encSessionData = { state: 'WAITING_TASK_CONFIRM', ctx: { tareaDesc: data.descripcion, nombreTrabajador: enc, tareaId: newAct._id ? newAct._id.toString() : null, proyectoId: data.proyectoId || 'IND' } };
                            await enqueueSession(chatIdEnc, encSessionData);
                            await enqueueSession(altChatIdEnc, encSessionData);
                            waLog.add(`📋 [COLA-CRM] WAITING_TASK_CONFIRM encolado para encargado: ${chatIdEnc}`);
                        } catch(eQ) { console.error('Error encolando tarea encargado:', eQ); }
                    }
                }
            }

            for (const ac of acompanantesArr) {
                const telAc = findPhone(ac);
                if (typeof waLog !== 'undefined' && waLog.add) {
                    waLog.add(`🔍 Buscando tel para acompañante: ${ac} -> Resultado: ${telAc || 'NO ENCONTRADO'}`);
                }
                if (telAc) {
                    if (esTareaFutura) {
                        // ✉️ AVISO CORTO
                        const msgAvisoAc = `📌 *AVISO DE TAREA AGENDADA*\n\nHola *${ac}*, vas a participar en una tarea el *${fechaTxt}*.\n📝 ${data.descripcion || 'Tarea operativa'}\n👤 Encargado: ${encargadosTxt}\n\n_Te mando todos los detalles un día antes._ 👌`;
                        try { await sendWhatsAppMessage(telAc, msgAvisoAc, { tipo: 'aviso_tarea', genero: inferirGenero(ac) }); } catch(e) { console.error('Error WA aviso acompañante:', e); }
                    } else {
                        // 🚨 MENSAJE COMPLETO
                        const msgAc = `🔔 *NUEVA TAREA ASIGNADA (Vas como Acompañante)* 🔔\n\n👤 Encargado principal: ${encargadosTxt || 'Ninguno'}\n\n${mensajeBase}`;
                        try { await sendWhatsAppMessage(telAc, msgAc, { tipo: 'tarea_acompanante', genero: inferirGenero(ac) }); } catch(e) { console.error('Error WA acompañante:', e); }
                        try {
                            const chatIdAc = phoneToWaChatId(telAc);
                            const altChatIdAc = chatIdAc.startsWith('521') ? chatIdAc.replace('521','52') : chatIdAc.replace(/^52/, '521');
                            const acSessionData = { state: 'WAITING_TASK_CONFIRM', ctx: { tareaDesc: data.descripcion, nombreTrabajador: ac, tareaId: newAct._id ? newAct._id.toString() : null, proyectoId: data.proyectoId || 'IND' } };
                            await enqueueSession(chatIdAc, acSessionData);
                            await enqueueSession(altChatIdAc, acSessionData);
                            waLog.add(`📋 [COLA-CRM] WAITING_TASK_CONFIRM encolado para acompañante: ${chatIdAc}`);
                        } catch(eQ) { console.error('Error encolando tarea acompañante:', eQ); }
                    }
                }
            }

        } catch (e) {
            console.error("Error generando notificaciones WA desde CRM:", e);
            if (typeof waLog !== 'undefined' && waLog.add) {
                waLog.add(`❌ CRITICAL ERROR notificaciones: ${e.message}`);
            }
        }
        
        // Notificar a flotilla si se asignaron vehículos
        if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
            await notificarFlotilla(data, data.vehiculosAsignados);
        }

        }); // fin setImmediate
        // --- FIN NOTIFICACIONES ---
    } catch(err) { res.status(500).json({error: err.message}); }
});
app.put('/api/actividades/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        // Ajuste de zona horaria para evitar desfase de 1 día (forzar mediodía UTC)
        if (data.fechaVencimiento && typeof data.fechaVencimiento === 'string' && data.fechaVencimiento.length === 10) {
            data.fechaVencimiento = data.fechaVencimiento + 'T12:00:00.000Z';
        }
        
        // Respaldar la actividad original para ver qué cambió
        const oldAct = await CRMActividad.findById(id);
        const oldVehiculos = oldAct ? (oldAct.vehiculosAsignados || []) : [];

        const updatedAct = await CRMActividad.findByIdAndUpdate(id, data, { returnDocument: 'after' });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        
        const newVehiculos = updatedAct.vehiculosAsignados || [];

        // Soltar vehículos que ya no están asignados
        const vehiculosSoltados = oldVehiculos.filter(v => !newVehiculos.includes(v));
        for (const vId of vehiculosSoltados) {
            await VehicleRef.findByIdAndUpdate(vId, { 
                $unset: { destinoSugeridoCRM: 1, crmActividadId: 1, crmProyectoId: 1 } 
            });
            // Si tiene proyecto, quitar del proyecto
            if (updatedAct.proyectoId) {
                await CRMProyecto.findByIdAndUpdate(updatedAct.proyectoId, {
                    $pull: { vehiculosAsignados: vId }
                });
            }
        }

        // Asignar los nuevos vehículos
        if (newVehiculos.length > 0) {
            let label = data.destinoSugeridoCRMText || updatedAct.descripcion || 'Tarea de CRM';
            for (const vId of newVehiculos) {
                await VehicleRef.findByIdAndUpdate(vId, { 
                    destinoSugeridoCRM: label,
                    crmActividadId: updatedAct._id.toString(),
                    crmProyectoId: updatedAct.proyectoId || null
                });
                // Si tiene proyecto, agregar al proyecto
                if (updatedAct.proyectoId) {
                    await CRMProyecto.findByIdAndUpdate(updatedAct.proyectoId, {
                        $addToSet: { vehiculosAsignados: vId }
                    });
                }
            }
        }
        
        const nuevosAgregados = newVehiculos.filter(v => !oldVehiculos.includes(v));
        if (nuevosAgregados.length > 0) {
            setImmediate(() => {
                notificarFlotilla(data, nuevosAgregados);
            });
        }

        res.json({ message: 'Actividad actualizada con éxito', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/actividades/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, comentarioCierre } = req.body;
        let updateData = { estado };
        if (comentarioCierre) updateData.comentarioCierre = comentarioCierre;
        const updatedAct = await CRMActividad.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });

        // Si se completó o canceló, liberar los vehículos en Tracking
        if (['Completada', 'Cancelada'].includes(estado)) {
            if (updatedAct.vehiculosAsignados && updatedAct.vehiculosAsignados.length > 0) {
                for (const vId of updatedAct.vehiculosAsignados) {
                    await VehicleRef.findByIdAndUpdate(vId, { 
                        $unset: { destinoSugeridoCRM: 1, crmActividadId: 1, crmProyectoId: 1 } 
                    });
                }
            }
        }
        res.json({ message: 'Estado actualizado', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/actividades/:id/avance', upload.array('fotos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { empleado, porcentajeTarea, comentario } = req.body;
        
        const act = await CRMActividad.findById(id);
        if (!act) return res.status(404).json({ error: 'Actividad no encontrada' });
        if (act.avanceReportado) {
            return res.status(400).json({ error: "Ya se reportó un avance para esta tarea." });
        }

        const pctTarea = parseFloat(porcentajeTarea) || 0;

        let fotosUrls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const archivo = new CRMArchivo({
                    nombre: file.originalname,
                    contentType: file.mimetype,
                    datos: file.buffer.toString('base64'),
                    tamanio: file.size
                });
                const saved = await archivo.save();
                fotosUrls.push(`/api/archivos/${saved._id}`);
            }
        }

        act.avances = act.avances || [];
        act.avances.push({
            empleado,
            porcentaje: pctTarea,
            comentario,
            fotos: fotosUrls
        });

        if (pctTarea > act.porcentajeAvance) {
            act.porcentajeAvance = pctTarea;
        }

        if (pctTarea >= 100) {
            act.estado = 'Completada';
        }
        act.avanceReportado = true;

        await act.save();

        // Si la actividad pertenece a un proyecto, sincronizar avance hacia el proyecto
        if (act.proyectoId && act.proyectoId !== 'IND' && act.proyectoId !== 'General') {
            const mongooseQuery = require('mongoose');
            let proj = null;
            if (mongooseQuery.isValidObjectId(act.proyectoId)) {
                proj = await CRMProyecto.findById(act.proyectoId);
            } else {
                const folioPuro = act.proyectoId.replace('Proyecto Activo -', '').split('-').pop().trim();
                proj = await CRMProyecto.findOne({ 
                    $or: [{ folio: folioPuro }, { nombre: { $regex: folioPuro, $options: 'i' } }] 
                });
            }
            if (proj) {
                const pctProyecto = req.body.porcentajeProyecto ? parseInt(req.body.porcentajeProyecto, 10) : 0;
                proj.avances.push({
                    empleado,
                    porcentaje: pctTarea,
                    porcentajeProyecto: pctProyecto,
                    comentario,
                    fotos: fotosUrls
                });
                if (pctProyecto > 0) proj.porcentajeAvance = pctProyecto;
                await proj.save();
            }
        }

        res.json({ success: true, avance: act.avances[act.avances.length - 1] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/actividades/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedAct = await CRMActividad.findByIdAndDelete(id);
        if (!deletedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        
        if (deletedAct.vehiculosAsignados && deletedAct.vehiculosAsignados.length > 0) {
            for (const vId of deletedAct.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { $unset: { destinoSugeridoCRM: 1 } });
            }
        }

        res.json({ message: 'Actividad eliminada' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Rutas de Eventos (Agenda)
app.get('/api/eventos', async (req, res) => {
    try {
        const evs = await CRMEvento.find().sort({ fechaInicio: 1 });
        res.json(evs);
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/eventos', async (req, res) => {
    try {
        const data = req.body;
        const ev = new CRMEvento(data);
        await ev.save();
        res.json({ message: 'Evento creado', data: ev });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/eventos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await CRMEvento.findByIdAndDelete(id);
        res.json({ message: 'Evento eliminado' });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// INTEGRACION WHATSAPP-WEB.JS - NAIS BOT
// ==========================================
const { Client, RemoteAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

// CustomMongoStore para arreglar el bug de rutas de wwebjs-mongo en Railway
class CustomMongoStore {
    constructor({ mongoose } = {}) {
        if(!mongoose) throw new Error('A valid Mongoose instance is required for MongoStore.');
        this.mongoose = mongoose;
    }

    async sessionExists(options) {
        let multiDeviceCollection = this.mongoose.connection.db.collection(`whatsapp-${options.session}.files`);
        let hasExistingSession = await multiDeviceCollection.countDocuments();
        return !!hasExistingSession;   
    }
    
    async save(options) {
        var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
            bucketName: `whatsapp-${options.session}`
        });
        await new Promise((resolve, reject) => {
            // FIX: Usar WA_DATA_PATH (directorio temporal) en lugar de ./
            const zipPath = require('path').join(WA_DATA_PATH, `${options.session}.zip`);
            require('fs').createReadStream(zipPath)
                .pipe(bucket.openUploadStream(`${options.session}.zip`))
                .on('error', err => reject(err))
                .on('close', () => resolve());
        });
        options.bucket = bucket;
        await this.#deletePrevious(options);
    }

    async extract(options) {
        var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
            bucketName: `whatsapp-${options.session}`
        });
        return new Promise((resolve, reject) => {
            bucket.openDownloadStreamByName(`${options.session}.zip`)
                .pipe(require('fs').createWriteStream(options.path))
                .on('error', err => reject(err))
                .on('close', () => resolve());
        });
    }

    async delete(options) {
        var bucket = new this.mongoose.mongo.GridFSBucket(this.mongoose.connection.db, {
            bucketName: `whatsapp-${options.session}`
        });
        const documents = await bucket.find({
            filename: `${options.session}.zip`
        }).toArray();

        documents.map(async doc => {
            return bucket.delete(doc._id);
        });   
    }

    async #deletePrevious(options) {
        const documents = await options.bucket.find({
            filename: `${options.session}.zip`
        }).toArray();
        if (documents.length > 1) {
            const oldSession = documents.reduce((a, b) => a.uploadDate < b.uploadDate ? a : b);
            return options.bucket.delete(oldSession._id);   
        }
    }
}

// Schema para persistir sesiones del bot WA en MongoDB (sobrevive reinicios)
const WaSessionSchema = new mongoose.Schema({
    chatId: { type: String, unique: true },
    state: { type: String, default: 'IDLE' },
    ctx: { type: Object, default: {} },
    pendingQueue: { type: Array, default: [] }, // Cola de pendientes del sistema
    expiresAt: { type: Date, default: null },   // Expiración instantánea (sin depender del TTL de Mongo)
    updatedAt: { type: Date, default: Date.now, expires: 86400 } // TTL 24h físico
}, { collection: 'wa_bot_sessions' });
const WaSession = mongoose.model('WaSession', WaSessionSchema);

// Helpers async para sesiones persistentes
async function getSession(chatId) {
    try {
        const s = await WaSession.findOne({ chatId }).lean();
        if (!s) return { state: 'IDLE', ctx: {}, pendingQueue: [] };
        // Validación instantánea de expiración (no dependemos del TTL lento de Mongo)
        if (s.expiresAt && new Date() > new Date(s.expiresAt)) {
            await WaSession.findOneAndUpdate({ chatId }, { state: 'IDLE', ctx: {}, pendingQueue: [], expiresAt: null });
            return { state: 'IDLE', ctx: {}, pendingQueue: [] };
        }
        return { state: s.state || 'IDLE', ctx: s.ctx || {}, pendingQueue: s.pendingQueue || [] };
    } catch(e) { return { state: 'IDLE', ctx: {}, pendingQueue: [] }; }
}

async function setSession(chatId, data) {
    try {
        // Si no se pasa pendingQueue explícitamente, preservar la que ya existe en DB
        // Esto evita que los flujos (avance, tarea, etc.) borren la cola al hacer setSession({ state:'IDLE', ctx:{} })
        let queueToSave;
        if (data.pendingQueue !== undefined) {
            // Se pasó explícitamente (incluyendo [] vacío): respetar ese valor
            queueToSave = data.pendingQueue;
        } else {
            // No se pasó: leer la cola actual de la DB para preservarla
            const existing = await WaSession.findOne({ chatId }).select('pendingQueue').lean();
            queueToSave = existing?.pendingQueue || [];
        }

        await WaSession.findOneAndUpdate(
            { chatId },
            { state: data.state, ctx: data.ctx || {}, pendingQueue: queueToSave, expiresAt: data.expiresAt || null, updatedAt: new Date() },
            { upsert: true, returnDocument: 'after' }
        );
    } catch(e) { waLog.add(`⚠️ Error guardando sesión: ${e.message?.substring(0,60)}`); }
}

// Encola un pendiente del SISTEMA sin sobreescribir la sesión activa del usuario.
// Solo debe usarse para estados iniciados por el sistema (WAITING_VEHICLE_CONFIRM, WAITING_TASK_CONFIRM).
async function enqueueSession(chatId, newItem) {
    try {
        const current = await getSession(chatId);
        const SYSTEM_STATES = ['WAITING_VEHICLE_CONFIRM', 'WAITING_TASK_CONFIRM'];
        if (current.state === 'IDLE') {
            // No hay nada activo: activar directamente
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
            await setSession(chatId, { state: newItem.state, ctx: newItem.ctx, pendingQueue: [], expiresAt });
        } else if (SYSTEM_STATES.includes(current.state)) {
            // Hay un pendiente del sistema activo: agregar a la cola
            const queue = current.pendingQueue || [];
            const alreadyQueued = queue.some(q => q.state === newItem.state && JSON.stringify(q.ctx) === JSON.stringify(newItem.ctx));
            if (!alreadyQueued) {
                queue.push(newItem);
                await WaSession.findOneAndUpdate({ chatId }, { pendingQueue: queue, updatedAt: new Date() });
                waLog.add(`📥 [COLA] Encolado ${newItem.state} para ${chatId} (cola: ${queue.length})`);
            }
        } else {
            // El usuario está en un flujo propio (avance, cita, etc.): agregar a la cola igualmente
            const queue = current.pendingQueue || [];
            queue.push(newItem);
            await WaSession.findOneAndUpdate({ chatId }, { pendingQueue: queue, updatedAt: new Date() });
            waLog.add(`📥 [COLA] Encolado ${newItem.state} para ${chatId} (usuario en flujo activo, queue: ${queue.length})`);
        }
    } catch(e) { waLog.add(`⚠️ Error encolando sesión: ${e.message?.substring(0,60)}`); }
}

// Resuelve la sesión actual y activa el siguiente pendiente de la cola (si existe).
// Reemplaza el patrón: setSession(id, { state: 'IDLE', ctx: {} }) al finalizar un flujo del SISTEMA.
async function resolveSession(chatId, altChatId, reply) {
    try {
        const current = await getSession(chatId);
        const queue = current.pendingQueue || [];
        if (queue.length > 0) {
            const next = queue.shift(); // Tomar el primero de la cola
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await setSession(chatId, { state: next.state, ctx: next.ctx, pendingQueue: queue, expiresAt });
            if (altChatId) await setSession(altChatId, { state: next.state, ctx: next.ctx, pendingQueue: queue, expiresAt });
            waLog.add(`📤 [COLA] Activando siguiente pendiente: ${next.state} para ${chatId}`);
            // Notificar al usuario del siguiente pendiente
            const tipoLabel = next.state === 'WAITING_VEHICLE_CONFIRM' ? 'asignación de vehículo' : 'asignación de tarea';
            const desc = next.ctx.tareaDesc || next.ctx.vehicleId || '';
            if (reply) await reply(`🔔 *Tienes otro pendiente:* ${tipoLabel}\n${desc ? `📋 "${desc}"` : ''}\n\nResponde con *ACEPTAR* o *RECHAZAR*.`);
        } else {
            await setSession(chatId, { state: 'IDLE', ctx: {}, pendingQueue: [], expiresAt: null });
            if (altChatId) await setSession(altChatId, { state: 'IDLE', ctx: {}, pendingQueue: [], expiresAt: null });
        }
    } catch(e) { waLog.add(`⚠️ Error en resolveSession: ${e.message?.substring(0,60)}`); }
}

// ── Utilidades del Bot WhatsApp ─────────────────────────────────────────
// 1.1 Respuestas variables (anti-robot)
const waRnd = arr => arr[Math.floor(Math.random() * arr.length)];
const WA_FRASES = {
    confirmado: ['✅ ¡Listo! Quedó registrado.','👍 Perfecto, guardado sin problema.','✅ Anotado. Todo en orden.','💪 Listo, queda en el sistema.'],
    avance: ['✅ ¡Avance reportado! El panel ya muestra la actualización.','💪 ¡Buen trabajo! Avance guardado correctamente.','✅ Listo. Tu reporte quedó en el historial del proyecto.','👍 Perfecto, avance registrado.'],
    error: ['No entendí ese mensaje 🤔\nEscribe *"ayuda"* para ver las opciones.','Hmm, no caché eso. 🤔\nEscribe *"menu"* para ver qué puedo hacer.','No estoy seguro de qué necesitas.\nEscribe *"hola"* para ver las opciones.'],
    tarea: ['🛠️ Claro, vamos a crear la tarea.','Perfecto, asignemos la tarea. 🛠️','Con gusto. Creemos la actividad.'],
    evento: ['📅 Claro, agendemos.','Perfecto, vamos con eso. 📋','Con gusto lo agendo.']
};

// Barra de progreso visual
const waFormatBarra = pct => {
    const p = Math.max(0, Math.min(100, pct||0));
    return '█'.repeat(Math.round(p/10)) + '░'.repeat(10-Math.round(p/10)) + ` ${p}%`;
};

// 3.1 Detección de perfil de usuario por teléfono
const WA_ADMIN_KEYWORDS = ['jacqueline','jaqueline','isabel','jacky'];
async function getUserProfile(resolvedId) {
    try {
        const phone = resolvedId.replace('@c.us','').replace(/\D/g,'').slice(-10);
        const users = await UserRef.find();
        const u = users.find(x => x.telefono && x.telefono.replace(/\D/g,'').slice(-10) === phone);
        if (!u) return { nombre: null, esAdmin: false };
        const esAdmin = WA_ADMIN_KEYWORDS.some(k => (u.nombre||'').toLowerCase().includes(k));
        return { nombre: u.nombre, apellido: u.apellido||'', esAdmin };
    } catch(e) { return { nombre: null, esAdmin: false }; }
}
// ────────────────────────────────────────────────────────────────────────

// ==========================================
// REGISTRO INTERNO: LID → chatId real
// Proceso aislado que SOLO resuelve el identificador LID de WhatsApp
// al número de teléfono real (ej. 52133...@c.us).
// No interfiere con ninguna otra lógica del bot.
// ==========================================
const lidToChatId = new Map(); // lid@lid  →  521XXXXXXXXXX@c.us

let waCurrentQR = null;
let waStatus = 'DESCONECTADO';

// Usamos una variable (let) para poder cambiar la ruta si es necesario limpiar bloqueos
let WA_DATA_PATH = require('path').join(require('os').tmpdir(), 'wa_auth');
try { fs.mkdirSync(WA_DATA_PATH, { recursive: true }); } catch(e) { 
    console.error('Error creando directorio temporal:', e); 
}

// Bandera para evitar múltiples instancias de Puppeteer simultáneas
let waInitializing = false;


// Helper GLOBAL para convertir teléfono a formato chatId de WhatsApp
// Definida FUERA de initWhatsApp para que sea accesible desde endpoints de API
function phoneToWaChatId(phone) {
    let cleanPhone = (phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
    if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
    return cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
}

const initWhatsApp = () => {
    if (waInitializing) {
        waLog.add('⚠️ Ya hay un init en progreso, ignorando llamada duplicada...');
        return;
    }
    waInitializing = true;
    waLog.add('🔄 Iniciando RemoteAuth con MongoDB...');
    const store = new CustomMongoStore({ mongoose: mongoose });
    
    waClient = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'nais-crm',
            store: store,
            backupSyncIntervalMs: 120000, // ✅ Reducido a 2 minutos
            dataPath: WA_DATA_PATH
        }),
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                // '--no-zygote',       // ❌ QUITAR: Causa conflictos de bloqueo
                '--disable-gpu',
                // '--single-process',  // ❌ QUITAR: Bloquea el IndexedDB y rompe RemoteAuth
                '--disable-extensions',
            ],
            protocolTimeout: 120000,
            timeout: 120000
        }
    });

    waClient.on('qr', (qr) => {
        waInitializing = false; // Puppeteer arrancó correctamente
        waCurrentQR = qr;
        waStatus = 'ESPERANDO_ESCANEO';
        waLog.add('📱 QR generado - esperando escaneo');
    });

    waClient.on('ready', () => {
        waInitializing = false;
        waCurrentQR = null;
        waStatus = 'CONECTADO';
        waLog.ultimaActividad = new Date();
        waLog.add('✅ Bot conectado — esperando 5s para estabilizar chats...');
        // Delay de estabilización: whatsapp-web.js dispara 'ready' antes de que
        // Puppeteer termine de hidratar los objetos de chat en memoria.
        // Enviar mensajes antes de ese tiempo causa: "Cannot read properties of undefined (reading 'getChat')"
        setTimeout(() => {
            waReady = true;
            waLog.add('✅ Bot listo para enviar mensajes');
        }, 5000);
    });

    waClient.on('remote_session_saved', () => {
        waLog.add('✅ SESIÓN GUARDADA EN MONGO ATLAS');
        console.log('✅ SESIÓN GUARDADA EN MONGO ATLAS');
    });

    waClient.on('disconnected', async (reason) => {
        waInitializing = false;
        waStatus = 'DESCONECTADO';
        waReady = false;
        waLog.add(`❌ Desconectado: ${reason}`);
        waLog.ultimoError = `Desconectado: ${reason}`;
        
        waLog.add('🔄 Reiniciando bot en 15 segundos...');
        setTimeout(async () => {
            try {
                waLog.add('🔄 Destruyendo cliente anterior...');
                try { await waClient.destroy(); } catch(_) {}
                waClient = null;
            } catch(_) {}
            waLog.add('🔄 Creando nuevo cliente WhatsApp...');
            initWhatsApp();
        }, 15000);
    });

    waClient.on('auth_failure', async (msg) => {
        waInitializing = false;
        waStatus = 'ERROR_AUTH';
        waReady = false;
        waLog.add(`🔐 Error de autenticación: ${msg}`);
        waLog.ultimoError = `Auth failure: ${msg}`;
        waLog.add('🔄 Reiniciando tras auth_failure en 20 segundos...');
        setTimeout(async () => {
            try { await waClient.destroy(); } catch(_) {}
            waClient = null;
            initWhatsApp();
        }, 20000);
    });

    waClient.on('change_state', state => {
        waLog.add(`⚠️ Estado de WhatsApp Web cambió a: ${state}`);
        if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'UNPAIRED') {
            waStatus = 'DESCONECTADO';
            waReady = false;
        }
    });

// Endpoint para ver el QR como imagen desde el navegador
// Helper para convertir telefono a formato WA
async function getChatIdFromPhone(phone) {
    return phoneToWaChatId(phone);
}

// Endpoint interactivo para la asignación de vehículos — Mensaje mejorado con foto y términos
app.post('/api/whatsapp/asignacion-vehiculo', async (req, res) => {
    try {
        const { txId, vehicleId, userName, marca, modelo, placas, bitacoraRevisada, checklistNotas, equipmentPhotoUrl, mainApiUrl } = req.body;
        const allUsers = await UserRef.find();
        const queryName = userName.trim().toLowerCase().replace(/\s+/g, ' ');
        const u = allUsers.find(x => {
            const fullName = `${(x.nombre||'').trim()} ${(x.apellido||'').trim()}`.trim().toLowerCase().replace(/\s+/g, ' ');
            if (!fullName) return false;
            return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
        });

        if (u && u.telefono) {
            const kitTxt = (bitacoraRevisada && bitacoraRevisada.length > 0)
                ? bitacoraRevisada.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
                : '  (Sin herramientas)';

            // --- Mensaje principal ---
            const msg =
`🚗 *VEHÍCULO PRE-ASIGNADO*

*${(marca || '').toUpperCase()} ${modelo}*
Placas: *${placas || 'S/P'}*

📦 *Equipamiento:*
${kitTxt}
${checklistNotas ? `\n📝 Notas: ${checklistNotas}` : ''}

─────────────────────
📋 *TÉRMINOS Y CONDICIONES:*
Al aceptar, confirmas la recepción del vehículo y su equipamiento en el estado descrito. Eres responsable de su resguardo y uso adecuado durante el período de asignación.
─────────────────────

Responde con una de estas palabras:
✅ *ACEPTAR* — para recibir el vehículo
❌ *RECHAZAR* — para declinar la asignación`;

            // --- Enviar foto del equipo primero (si existe) ---
            if (equipmentPhotoUrl && waClient && waReady) {
                try {
                    const { MessageMedia } = require('whatsapp-web.js');
                    let mediaObj = null;

                    if (equipmentPhotoUrl.startsWith('data:')) {
                        // Base64 inline
                        const [metaPart, dataPart] = equipmentPhotoUrl.split(',');
                        const mimeType = metaPart.match(/:(.*?);/)?.[1] || 'image/jpeg';
                        mediaObj = new MessageMedia(mimeType, dataPart, 'equipo_vehiculo.jpg');
                    } else {
                        // URL externa — descargar
                        mediaObj = await MessageMedia.fromUrl(equipmentPhotoUrl, { unsafeMime: true });
                    }

                    if (mediaObj) {
                        let cleanPhone = u.telefono.replace(/\D/g, '');
                        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
                        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
                        const chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
                        await waClient.sendMessage(chatId, mediaObj, { caption: `📸 Foto del equipamiento del vehículo *${modelo}* (${placas})` });
                    }
                } catch (photoErr) {
                    waLog.add(`⚠️ No se pudo enviar foto equipo: ${photoErr.message?.substring(0,60)}`);
                }
            }

            // --- Enviar mensaje de texto (Humanizado si está disponible) ---
            let finalMsg = msg;
            try {
                const BOT_URL = process.env.BOT_ADVANCED_URL || 'https://boot-production-5efa.up.railway.app';
                const SECRET = process.env.API_SECRET_TOKEN || 'tu_token_secreto_muy_seguro_123';
                if (typeof fetch !== 'undefined') {
                    const humanResponse = await fetch(`${BOT_URL}/api/bot/humanize`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-api-token': SECRET,
                            'Bypass-Tunnel-Reminder': 'true'
                        },
                        body: JSON.stringify({ texto: msg, tipo: 'asignacion_vehiculo', genero: inferirGenero(userName) })
                    });
                    if (humanResponse.ok) {
                        const humanData = await humanResponse.json();
                        if (humanData.humanizado) {
                            finalMsg = humanData.humanizado;
                        }
                    }
                }
            } catch (err) {
                console.error("Error contactando Cerebro para humanizar:", err.message);
            }

            await sendWhatsAppMessage(u.telefono, finalMsg);

            // --- Guardar sesión para respuesta ---
            const chatId = await getChatIdFromPhone(u.telefono);
            if (chatId) {
                const altChatId = chatId.startsWith('521') ? chatId.replace('521', '52') : chatId.replace('52', '521');
                const sessionData = { state: 'WAITING_VEHICLE_CONFIRM', ctx: { txId, vehicleId, mainApiUrl: mainApiUrl || 'https://entregables-production-b834.up.railway.app' } };
                await enqueueSession(chatId, sessionData);
                await enqueueSession(altChatId, sessionData);
                waLog.add(`📋 Sesión/Cola WAITING_VEHICLE_CONFIRM guardada para ${chatId}`);
            }
        }
        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/whatsapp/send', async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || !message) return res.status(400).json({ error: "Falta 'to' o 'message'" });
        await sendWhatsAppMessage(to, message);
        res.json({ success: true, message: "Mensaje de WhatsApp enviado" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/whatsapp/qr', async (req, res) => {
    if (waStatus === 'CONECTADO') {
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#4ade80"><h1>✅ WhatsApp Conectado</h1><p>El bot ya está vinculado y funcionando.</p></body></html>`);
    }
    if (!waCurrentQR) {
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#f59e0b"><h1>⏳ Generando QR...</h1><p>Estado: ${waStatus}</p><p>Recarga esta página en unos segundos.</p><script>setTimeout(()=>location.reload(), 3000)</script></body></html>`);
    }
    try {
        const qrImageUrl = await QRCode.toDataURL(waCurrentQR, { width: 300, margin: 2 });
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NAIS WhatsApp QR</title><style>body{background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;font-family:sans-serif;color:white}h1{margin-bottom:10px;color:#6366f1}p{color:#94a3b8;margin-bottom:20px}img{border-radius:12px;box-shadow:0 0 30px rgba(99,102,241,0.5)}</style><meta http-equiv="refresh" content="30"></head><body><h1>📱 Escanea con WhatsApp</h1><p>Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p><img src="${qrImageUrl}" width="300" /><p style="margin-top:15px;font-size:0.8rem">Esta página se actualiza automáticamente cada 30 segundos</p></body></html>`);
    } catch (e) {
        res.status(500).send('Error generando QR');
    }
});

// Panel de diagnostico en tiempo real
app.get('/whatsapp/status', (req, res) => {
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime/3600), m = Math.floor((uptime%3600)/60), s = uptime%60;
    const statusColor = waStatus === 'CONECTADO' ? '#4ade80' : waStatus === 'ESPERANDO_ESCANEO' ? '#f59e0b' : '#f87171';
    const statusIcon = waStatus === 'CONECTADO' ? '\u2705' : waStatus === 'ESPERANDO_ESCANEO' ? '\u23f3' : '\u274c';
    const ultimaAct = waLog.ultimaActividad ? waLog.ultimaActividad.toLocaleString('es-MX',{timeZone:'America/Mexico_City'}) : 'Nunca';
    const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const historialHTML = waLog.historial.map(l => `<div style="padding:4px 0;border-bottom:1px solid #1e293b;font-size:0.85rem">${esc(l)}</div>`).join('') || '<div style="color:#64748b">Sin actividad registrada</div>';
    const errorHTML = waLog.errores.length > 0
        ? waLog.errores.map(e => `<div style="padding:6px 0;border-bottom:1px solid #2d1515;white-space:pre-wrap;word-break:break-all">${esc(e)}</div>`).join('')
        : '<div style="color:#4ade80">\u2705 Sin errores registrados</div>';
    const css = `body{background:#0f172a;font-family:sans-serif;color:#e2e8f0;padding:30px;margin:0}h1{color:#6366f1;margin-bottom:5px}.card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:15px}.label{color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.value{font-size:1.1rem;font-weight:600}.status-badge{display:inline-block;padding:6px 16px;border-radius:99px;font-weight:700;font-size:1rem;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px}.scroll{max-height:360px;overflow-y:auto}.errlog{font-family:monospace;font-size:0.78rem;line-height:1.6;color:#fca5a5}`;
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NAIS Bot - Status</title><meta http-equiv="refresh" content="15"><style>${css}</style></head><body>
<h1>\ud83e\udd16 NAIS Bot - Panel de Estado</h1>
<p style="color:#64748b;margin-top:0">Se actualiza cada 15 segundos</p>
<div class="card"><div class="label">Estado del Bot</div><div style="margin-top:8px"><span class="status-badge">${statusIcon} ${waStatus}</span></div></div>
<div class="grid">
  <div class="card"><div class="label">Uptime del Servidor</div><div class="value">${h}h ${m}m ${s}s</div></div>
  <div class="card"><div class="label">\u00daltima Conexi\u00f3n</div><div class="value" style="font-size:0.9rem">${ultimaAct}</div></div>
  <div class="card"><div class="label">\u00daltimo Mensaje</div><div class="value" style="font-size:0.9rem">${waLog.ultimoMensaje || 'Ninguno'}</div></div>
</div>
<div class="card" style="border:1px solid #f8717166">
  <div class="label" style="color:#f87171">\ud83d\udd34 LOG DE ERRORES REALES \u2014 ${waLog.errores.length} capturados &nbsp;<a href="/whatsapp/errors" target="_blank" style="color:#6366f1;font-size:0.78rem;font-weight:normal">[ Ver JSON ]</a></div>
  <div class="scroll errlog" style="margin-top:10px">${errorHTML}</div>
</div>
<div class="card"><div class="label">Historial de Eventos (\u00faltimos 30)</div><div class="scroll" style="margin-top:10px">${historialHTML}</div></div>
${waStatus !== 'CONECTADO' ? '<div style="text-align:center;margin-top:15px"><a href="/whatsapp/qr" style="background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">\ud83d\udcf1 Ir a escanear QR</a></div>' : ''}
</body></html>`);
});

// Endpoint JSON de errores — diagnostico completo con stack traces
app.get('/whatsapp/errors', (req, res) => {
    res.json({
        total: waLog.errores.length,
        ultimoError: waLog.ultimoError,
        errores: waLog.errores
    });
});

// ─── DIAGNÓSTICO: ver si la sesión existe en MongoDB GridFS ───
app.get('/whatsapp/session-check', async (req, res) => {
    try {
        const db = mongoose.connection.db;
        let result = { sessionExists: false, files: [], chunks: 0, waStatus, waInitializing, waReady };
        
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name);
        result.collections = colNames.filter(n => n.includes('whatsapp'));
        
        if (colNames.includes('whatsapp-nais-crm.files')) {
            const files = await db.collection('whatsapp-nais-crm.files').find({}).toArray();
            result.files = files.map(f => ({ _id: f._id, filename: f.filename, length: f.length, uploadDate: f.uploadDate }));
            result.sessionExists = files.length > 0;
        }
        if (colNames.includes('whatsapp-nais-crm.chunks')) {
            result.chunks = await db.collection('whatsapp-nais-crm.chunks').countDocuments();
        }
        
        res.json(result);
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});
// ──────────────────────────────────────────────────────────────

// Endpoint para cerrar sesión, limpiar BD y generar nuevo QR
app.get('/whatsapp/reset', async (req, res) => {
    try {
        if (waClient) {
            waLog.add('🔄 Destruyendo cliente para evitar sesiones corruptas...');
            // Esperar explícitamente a que se destruya para que RemoteAuth no guarde backups zombie
            await Promise.race([
                waClient.destroy(),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]).catch(() => {});
            waClient = null;
        }
        
        waReady = false;
        waStatus = 'DESCONECTADO';
        waCurrentQR = null;
        waInitializing = false;

        // Forzar borrado de la colección de RemoteAuth en MongoDB (GridFS)
        try {
            await mongoose.connection.db.collection('whatsapp-RemoteAuth-nais-crm.files').drop();
            await mongoose.connection.db.collection('whatsapp-RemoteAuth-nais-crm.chunks').drop();
        } catch(e) { /* Ignorar si no existen */ }
        
        try {
            await mongoose.connection.db.collection('whatsapp-nais-crm.files').drop();
            await mongoose.connection.db.collection('whatsapp-nais-crm.chunks').drop();
        } catch(e) { /* Ignorar si no existen */ }

        // Forzar borrado de carpeta local temporal cambiando de ruta para evitar conflictos
        try {
            const fs = require('fs');
            try { fs.rmSync(WA_DATA_PATH, { recursive: true, force: true }); } catch(e) {}
            // Nueva ruta!
            WA_DATA_PATH = require('path').join(require('os').tmpdir(), 'wa_auth_' + Date.now());
            fs.mkdirSync(WA_DATA_PATH, { recursive: true });
        } catch(e) {}

        // Reiniciar el bot limpiamente
        setTimeout(() => {
            initWhatsApp();
        }, 5000);

        res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#4ade80">
            <h1>✅ Limpieza Profunda Completada</h1>
            <p>Se ha borrado la sesión de la nube y del servidor local.</p>
            <p>El bot se está reiniciando en segundo plano...</p>
            <p>Regresa a la pestaña de QR en unos 15 a 30 segundos, debería aparecer el nuevo código listo para escanear.</p>
            <script>setTimeout(()=>window.location.href='/whatsapp/qr', 10000)</script>
            </body></html>`);
    } catch(e) {
        res.status(500).send('Error al limpiar la sesión: ' + e.message);
    }
});



const waMessageHandler = async message => {
    try {
        const From = message.from; 
        const Body = message.body;

        if ((!Body && !message.hasMedia) || !From || From.includes('@g.us') || From === 'status@broadcast') return; // ignorar grupos y estados (permitir fotos sin caption)

        // -------------------------------------------------------
        // RESOLUCIÓN DE LID → chatId real (proceso interno aislado)
        // WhatsApp a veces entrega mensajes con From = "XXXXXX@lid"
        // en lugar del número real ("521...@c.us").
        // Aquí actualizamos el mapa y derivamos el From correcto.
        // -------------------------------------------------------
        let resolvedFrom = From;
        if (From.endsWith('@lid')) {
            // Si ya conocemos este LID, lo resolvemos de inmediato
            if (lidToChatId.has(From)) {
                resolvedFrom = lidToChatId.get(From);
                waLog.add(`🔗 LID resuelto: ${From} → ${resolvedFrom}`);
            } else {
                // Intentamos obtener el contacto para registrar su número real
                try {
                    const contact = await message.getContact();
                    if (contact && contact.id && contact.id._serialized && !contact.id._serialized.endsWith('@lid')) {
                        resolvedFrom = contact.id._serialized;
                        lidToChatId.set(From, resolvedFrom);
                        waLog.add(`🔗 LID registrado: ${From} → ${resolvedFrom}`);
                    } else if (contact && contact.number) {
                        // Fallback: construir chatId desde el número
                        let num = contact.number.replace(/\D/g, '');
                        if (num.length === 10) num = `521${num}`;
                        resolvedFrom = `${num}@c.us`;
                        lidToChatId.set(From, resolvedFrom);
                        waLog.add(`🔗 LID registrado (número): ${From} → ${resolvedFrom}`);
                    }
                } catch(e) {
                    waLog.add(`⚠️ No se pudo resolver LID ${From}: ${e.message?.substring(0,50)}`);
                }
            }
        } else {
            // Mensaje normal: guardar la relación por si en el futuro llega como LID
            // (registramos todos los chatIds que no sean LID para lookup inverso futuro)
            // No hacemos nada extra, solo dejamos pasar
        }
        // -------------------------------------------------------

        // Registrar actividad
        waLog.ultimoMensaje = new Date().toLocaleString('es-MX', {timeZone:'America/Mexico_City'});
        waLog.ultimaActividad = new Date();
        const bodyPreview = Body ? `"${Body.substring(0,40)}${Body.length>40?'...':''}"` : (message.hasMedia ? '[📸 Foto]' : '[sin texto]');
        waLog.add(`💬 Mensaje de ${From.replace('@c.us','').replace('@lid','(lid)')}: ${bodyPreview}`);

        // Helper local: usa reply() que es más confiable que sendMessage()
        const reply = async (text) => {
            try {
                await message.reply(text);
            } catch (e) {
                waLog.add(`⚠️ Error reply: ${e.message.substring(0,60)}`);
                // Fallback: intentar con sendMessage
                try {
                    const chat = await message.getChat();
                    await chat.sendMessage(text);
                } catch (e2) {
                    console.error('Error fallback sendMessage:', e2.message);
                }
            }
        };

        // =======================================================
        // 🛑 INTERCEPTOR DEL BOT AVANZADO (CEREBRO)
        // =======================================================
        const effectiveFrom = resolvedFrom;
        const altFrom = effectiveFrom.startsWith('521') ? effectiveFrom.replace('521', '52') : effectiveFrom.replace(/^52/, '521');
        
        const s = await getSession(effectiveFrom);
        const sFromAlt = await getSession(altFrom);
        
        // Si la sesión principal está IDLE pero la variante tiene estado activo, migrar y limpiar la variante
        if (s.state === 'IDLE' && sFromAlt && sFromAlt.state !== 'IDLE') {
            Object.assign(s, sFromAlt);
            await setSession(effectiveFrom, s);
            await setSession(altFrom, { state: 'IDLE', ctx: {} });
        }

        // SOLO interceptar con el bot de IA si no estamos en medio de un flujo interactivo
        if (s.state === 'IDLE') {
            try {
                const BOT_URL = process.env.BOT_ADVANCED_URL || 'https://boot-production-5efa.up.railway.app';
                const SECRET = process.env.API_SECRET_TOKEN || 'tu_token_secreto_muy_seguro_123';
                
                if (typeof fetch !== 'undefined') {
                    const botResponse = await fetch(`${BOT_URL}/api/bot/analyze`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'x-api-token': SECRET,
                            'Bypass-Tunnel-Reminder': 'true'
                        },
                        body: JSON.stringify({
                            from: resolvedFrom,
                            body: Body,
                            isGroup: message.isGroupMsg || false
                        })
                    });
                    
                    if (botResponse.ok) {
                        const botData = await botResponse.json();
                        if (botData.handled) {
                            waLog.add(`🤖 [Cerebro] se hizo cargo del mensaje de ${resolvedFrom}`);
                            if (botData.reply) await reply(botData.reply);
                            return; // 🛑 Detiene la ejecución. El bot viejo es ignorado.
                        }
                    }
                }
            } catch (botErr) {
                // Falla silenciosa: Si el bot nuevo está apagado, seguimos con el bot viejo
            }
        }
        // =======================================================

        const text = Body.trim().toLowerCase();
        
        // Cancelación Global (más flexible)
        if (text.includes('cancelar') || text === 'cancela' || text === 'salir' || text === 'reiniciar' || text.includes('abortar')) {
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
            await setSession(altFrom, { state: 'IDLE', ctx: {} }); // Limpiar también la variante por seguridad
            await reply("🚫 *Operación cancelada.*\n\n¿En qué más te puedo ayudar?");
            return;
        }

        // --- AUTOCLEANUP: Revisar si la confirmación pendiente sigue siendo válida ---
        if (s.state === 'WAITING_VEHICLE_CONFIRM' && s.ctx.txId) {
            try {
                const tx = await VehicleTransactionRef.findById(s.ctx.txId);
                let invalid = false;
                if (!tx) invalid = true;
                else {
                    // Si ya no está "Pendiente" o si el vehículo ya fue devuelto
                    if (tx.estadoConfirmacion && tx.estadoConfirmacion !== 'Pendiente' && tx.estadoConfirmacion !== 'Pendiente Confirmación') {
                        invalid = true;
                    }
                    if (!invalid && tx.vehicleId) {
                        const veh = await VehicleRef.findById(tx.vehicleId);
                        if (!veh || (veh.estado !== 'Prestado' && veh.estado !== 'Pendiente de Confirmación')) {
                            invalid = true; // El vehículo ya no está prestado ni pendiente
                        }
                    }
                }
                
                if (invalid) {
                    s.state = 'IDLE';
                    s.ctx = {};
                    await setSession(effectiveFrom, s);
                    waLog.add(`🧹 Auto-Limpieza: La sesión de ${effectiveFrom} estaba esperando confirmación de vehículo pero la transacción ya no es válida.`);
                }
            } catch (e) {
                console.error("Error validando sesión atascada:", e);
            }
        }

        if (s.state === 'IDLE') {
            // ── 3.1 Perfil de usuario ───────────────────────────────────
            if (!s.ctx.perfil) { s.ctx.perfil = await getUserProfile(effectiveFrom); await setSession(effectiveFrom, s); }
            const perfil = s.ctx.perfil || {};
            const nombreUsr = perfil.nombre || null;
            const esAdmin = perfil.esAdmin || false;

            // ── 1.3 NLP Ampliado ────────────────────────────────────────
            const esEnterado = text === 'enterado' || text === 'enterada' || text.includes('enterado');
            const esAvance = text.includes('avance') || text.includes('reportar') || text.includes('reporte') ||
                text.includes('ya terminé') || text.includes('ya acabe') || text.includes('ya acabé') ||
                text.includes('ya termine') || text.includes('progreso') || text.includes('cuanto llevo') || text.includes('cuánto llevo');
            const esLevantamiento = text.includes('levantamiento');
            const esCita = text.includes('cita') || text.includes('junta') || text.includes('reunion') ||
                text.includes('reunión') || text.includes('visita') || text.includes('llamada');
            const esTarea = text.includes('tarea') || text.includes('actividad') || text.includes('asignar') ||
                text.includes('programar') || text.includes('ponle') || text.includes('manda a') ||
                text.includes('le toca') || text.includes('necesito que');

            // ── 3.4 Comandos rápidos ────────────────────────────────────
            const esMisTareas = text === 'tareas' || text.includes('mis tareas') || text.includes('mis actividades') ||
                text.includes('qué tengo hoy') || text.includes('que tengo hoy') || text.includes('mi agenda') || text.includes('qué hago hoy');
            const esVerProyecto = text === 'proyectos' ||
                (text.includes('proyecto') && (text.includes('cómo va') || text.includes('como va') || text.includes('avance') || text.includes('estado')));
            const esBuscarCot = (text.includes('cotización') || text.includes('cotizacion') || text.includes('hay algo de') || text.includes('busca')) && text.length > 4;
            const esVentas = text === 'ventas' || text.includes('resumen del mes') ||
                (text.includes('cómo vamos') && !text.includes('proyecto')) || (text.includes('como vamos') && !text.includes('proyecto'));
            const esEquipo = text === 'equipo' || text.includes('quién está libre') || text.includes('quien esta libre') ||
                text.includes('disponible esta semana') || text.includes('carga del equipo');
            const esAyuda = text === 'ayuda' || text === 'menu' || text === 'menú' || text === 'hola' ||
                text === 'hi' || text === 'inicio' || text === 'help' || text === 'ola';

            if (esEnterado) {
                const sal = nombreUsr ? `, ${nombreUsr}` : '';
                await reply(`✅ *Confirmado${sal}.* Registrado que estás enterado.\n\nEscribe *"mis tareas"* para ver tu agenda de hoy.`);
                return;

            } else if (esMisTareas) {
                // ── 2.1 Mis tareas del día ──────────────────────────────
                try {
                    const hoyMx = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Mexico_City'}));
                    const yy=hoyMx.getFullYear(), mo=String(hoyMx.getMonth()+1).padStart(2,'0'), dd=String(hoyMx.getDate()).padStart(2,'0');
                    const dI=new Date(`${yy}-${mo}-${dd}T00:00:00.000Z`), dF=new Date(`${yy}-${mo}-${dd}T23:59:59.999Z`);
                    let tareas = [];
                    if (nombreUsr) {
                        const nom = nombreUsr.split(' ')[0];
                        tareas = await CRMActividad.find({ fechaVencimiento:{$gte:dI,$lte:dF}, estado:{$ne:'Completada'},
                            $or:[{asignadoANombre:{$regex:nom,$options:'i'}},{cuadrillaNombres:{$regex:nom,$options:'i'}}]
                        }).sort({horaInicio:1});
                    } else {
                        tareas = await CRMActividad.find({fechaVencimiento:{$gte:dI,$lte:dF},estado:{$ne:'Completada'}}).sort({horaInicio:1}).limit(8);
                    }
                    const hoyStr = hoyMx.toLocaleDateString('es-MX',{timeZone:'America/Mexico_City',weekday:'long',day:'numeric',month:'long'});
                    if (tareas.length === 0) {
                        await reply(`📅 *${hoyStr}*\n\n${nombreUsr?`Sin tareas asignadas para hoy, ${nombreUsr}. 🎉`:'No hay tareas para hoy. 🎉'}\n\n¿Quieres crear una nueva tarea?`);
                        return;
                    }
                    let msg = `📅 *Agenda — ${hoyStr}:*\n\n`;
                    for (let i=0; i<tareas.length; i++) {
                        const t = tareas[i];
                        const hora = t.horaInicio ? `${t.horaInicio}${t.horaFin?'-'+t.horaFin:''}` : 'Sin hora';
                        const pct = t.porcentajeAvance>0 ? ` (${t.porcentajeAvance}%)` : '';
                        msg += `${i+1}️⃣ 🕒 ${hora} — *${t.descripcion}*${pct}\n`;
                        if (t.proyectoId) msg += `   🏗️ ${t.proyectoId}\n`;
                        if (t.vehiculosAsignados && t.vehiculosAsignados.length>0) {
                            const vehs = await VehicleRef.find({_id:{$in:t.vehiculosAsignados}}).select('marca modelo');
                            if (vehs.length>0) msg += `   🚗 ${vehs.map(v=>`${v.marca||''} ${v.modelo}`).join(', ')}\n`;
                        }
                    }
                    msg += `\nEscribe *"avance"* para reportar progreso.`;
                    await reply(msg);
                } catch(e) { waLog.addError('mis-tareas',e); await reply('Error consultando tareas. Intenta de nuevo.'); }
                return;

            } else if (esVerProyecto) {
                // ── 2.3 Estado de proyectos ─────────────────────────────
                try {
                    const proys = await CRMProyecto.find({estado:{$in:['Activo','Pausado']}}).sort({fechaInicio:-1}).limit(10);
                    if (proys.length===0) { await reply('No hay proyectos activos en este momento.'); return; }
                    s.ctx.proyListQuery = proys.map((p,i)=>({num:i+1,id:p._id.toString(),folio:p.folio,nombre:p.nombre,pct:p.porcentajeAvance||0}));
                    s.state = 'WAITING_QUERY_PROYECTO';
                    await setSession(effectiveFrom, s);
                    const lista = s.ctx.proyListQuery.map(p=>`${p.num}. [${p.folio||'S/F'}] ${p.nombre}\n   ${waFormatBarra(p.pct)}`).join('\n\n');
                    await reply(`🏗️ *Proyectos Activos:*\n\n${lista}\n\n¿De cuál quieres el detalle? (Escribe el número)`);
                } catch(e) { waLog.addError('ver-proyectos',e); await reply('Error consultando proyectos.'); }
                return;

            } else if (esBuscarCot) {
                // ── 2.4 Buscar cotización ───────────────────────────────
                s.state = 'WAITING_BUSCAR_COT';
                await setSession(effectiveFrom, s);
                await reply(`🔍 ¿Qué cotización buscas?\nEscribe el nombre del cliente o el folio (ej: "García" o "C47")`);
                return;

            } else if (esVentas && esAdmin) {
                try {
                    const ahora=new Date(), ini=new Date(ahora.getFullYear(),ahora.getMonth(),1);
                    const [gan,act,per] = await Promise.all([
                        CRMCotizacion.find({estado:'Ganada',fechaCreacion:{$gte:ini}}),
                        CRMCotizacion.find({estado:{$in:['En Seguimiento','Cotizando','Neutral']}}),
                        CRMCotizacion.find({estado:{$in:['Perdida','Perdido']},fechaCreacion:{$gte:ini}})
                    ]);
                    const tG=gan.reduce((a,c)=>a+(c.total||0),0), tA=act.reduce((a,c)=>a+(c.total||0),0), tP=per.reduce((a,c)=>a+(c.total||0),0);
                    const mes=ahora.toLocaleDateString('es-MX',{month:'long',year:'numeric'});
                    let msg=`📈 *Ventas — ${mes}:*\n\n✅ Ganadas: ${gan.length} — $${tG.toLocaleString('es-MX')}\n🔄 En proceso: ${act.length} — $${tA.toLocaleString('es-MX')} potencial\n❌ Perdidas: ${per.length} — $${tP.toLocaleString('es-MX')}`;
                    if (act.length>0) { const top=[...act].sort((a,b)=>(b.total||0)-(a.total||0))[0]; msg+=`\n\n🏆 Mayor oportunidad:\n${top.folio||'S/F'} — ${top.clienteNombre} ($${(top.total||0).toLocaleString('es-MX')})`; }
                    await reply(msg);
                } catch(e) { await reply('Error consultando ventas.'); }
                return;

            } else if (esEquipo && esAdmin) {
                try {
                    const hoyE=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Mexico_City'}));
                    const lun=new Date(hoyE); lun.setDate(hoyE.getDate()-((hoyE.getDay()||7)-1)); lun.setHours(0,0,0,0);
                    const dom=new Date(lun); dom.setDate(lun.getDate()+6); dom.setHours(23,59,59,999);
                    const tarSem=await CRMActividad.find({fechaVencimiento:{$gte:lun,$lte:dom},estado:{$ne:'Completada'}});
                    const usrs=await UserRef.find().select('nombre').sort({nombre:1});
                    let msg=`👷 *Equipo esta semana:*\n\n`;
                    usrs.forEach(u=>{
                        const cnt=tarSem.filter(t=>(t.asignadoANombre||'').toLowerCase().includes((u.nombre||'').toLowerCase())||(t.cuadrillaNombres||[]).some(n=>(n||'').toLowerCase().includes((u.nombre||'').toLowerCase()))).length;
                        const ico=cnt===0?'🟢':cnt>=4?'🔴':'🟡';
                        msg+=`${ico} ${u.nombre}: ${cnt} tarea${cnt!==1?'s':''}\n`;
                    });
                    await reply(msg);
                } catch(e) { await reply('Error consultando equipo.'); }
                return;

            } else if (esAvance) {
                const proyectosActivos = await CRMProyecto.find({estado:{$in:['Activo','Pausado']}}).sort({fechaInicio:-1});
                let proyList = [], pNum = 1;
                proyList.push({num:pNum++,folio:'IND',nombre:'Tareas Independientes (Sin Proyecto)',id:'IND'});
                proyectosActivos.forEach(p=>{proyList.push({num:pNum++,folio:p.folio,nombre:p.nombre,id:p._id.toString()});});
                s.ctx.proyList = proyList;
                s.state = 'WAITING_AVANCE_PROYECTO';
                await setSession(effectiveFrom, s);
                await reply(`📊 *¿De qué proyecto vas a reportar?*\n\n${proyList.map(p=>`${p.num}. [${p.folio||'S/F'}] ${p.nombre}`).join('\n')}\n\n(Escribe el número)`);

            } else if (esLevantamiento || esCita) {
                s.ctx.type = esLevantamiento ? 'Levantamiento' : 'Junta';
                s.ctx.isEvento = true;
                s.state = 'WAITING_TAREA_DESC';
                await setSession(effectiveFrom, s);
                // 1.1 Respuesta variable
                await reply(`${waRnd(WA_FRASES.evento)} Vamos a agendar el ${s.ctx.type}.\n\n¿Cuál es la descripción o el asunto principal?`);

            } else if (esTarea) {
                s.ctx.isEvento = false;
                s.state = 'WAITING_TAREA_DESC';
                await setSession(effectiveFrom, s);
                // 1.1 Respuesta variable
                await reply(`${waRnd(WA_FRASES.tarea)}\n\n¿Cuál es la descripción de la actividad?`);

            } else if (esAyuda) {
                // ── 3.2 Menú contextual inteligente ────────────────────
                const saludos = ['¡Hola','¡Qué tal','¡Buenas','¡Hey'];
                const sal = nombreUsr ? ` ${nombreUsr}!` : '!';
                let menu = `${waRnd(saludos)}${sal} Soy NAIS, tu asistente del CRM.\n\n*¿Qué puedo hacer por ti?*\n\n`;
                menu += `📅 *"mis tareas"* — Tu agenda de hoy\n`;
                menu += `📊 *"avance"* — Reportar progreso\n`;
                menu += `🏗️ *"proyectos"* — Estado de proyectos activos\n`;
                menu += `🔍 *"busca [cliente]"* — Buscar cotización\n`;
                if (esAdmin) {
                    menu += `📈 *"ventas"* — Resumen del mes\n`;
                    menu += `👷 *"equipo"* — Carga de trabajo semanal\n`;
                }
                menu += `📋 *"levantamiento"* — Agendar visita\n`;
                menu += `🛠️ *"tarea"* — Asignar tarea al equipo`;
                // 3.3 Alertas contextuales
                try {
                    const hoyCtx=new Date(new Date().toLocaleString('en-US',{timeZone:'America/Mexico_City'}));
                    const yC=hoyCtx.getFullYear(),mC=String(hoyCtx.getMonth()+1).padStart(2,'0'),dC=String(hoyCtx.getDate()).padStart(2,'0');
                    const cotsHoy=await CRMCotizacion.find({fechaSeguimiento:{$gte:new Date(`${yC}-${mC}-${dC}T00:00:00.000Z`),$lte:new Date(`${yC}-${mC}-${dC}T23:59:59.999Z`)}});
                    if (cotsHoy.length>0 && esAdmin) menu=`🔔 *${cotsHoy.length} seguimiento${cotsHoy.length>1?'s':''} pendiente${cotsHoy.length>1?'s':''} hoy.*\n\n`+menu;
                } catch(_) {}
                await reply(menu);

            } else {
                // 1.1 Respuesta variable fallback
                await reply(waRnd(WA_FRASES.error));
            }
        } else if (s.state === 'WAITING_QUERY_PROYECTO') {
            // ── 2.3 Detalle del proyecto seleccionado ──────────────────
            const numQ = parseInt(text.trim());
            const pQ = (s.ctx.proyListQuery||[]).find(x=>x.num===numQ);
            if (!pQ) { await reply(`⚠️ Número no válido. Escribe un número de la lista.`); return; }
            try {
                const proj = await CRMProyecto.findById(pQ.id);
                if (!proj) { await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx}); await reply('Proyecto no encontrado.'); return; }
                const [tPend,tComp] = await Promise.all([
                    CRMActividad.find({proyectoId:pQ.id,estado:{$ne:'Completada'}}),
                    CRMActividad.find({proyectoId:pQ.id,estado:'Completada'})
                ]);
                let msg = `🏗️ *${proj.folio||'S/F'} — ${proj.nombre}*\n\n`;
                msg += `📈 ${waFormatBarra(proj.porcentajeAvance||0)}\n`;
                msg += `📋 ${proj.estado} | 👤 ${proj.clienteNombre||'N/A'}\n`;
                msg += `✅ Completadas: ${tComp.length} | ⏳ Pendientes: ${tPend.length}\n`;
                if (tPend.length>0) {
                    msg+=`\n*Tareas pendientes:*\n`;
                    tPend.slice(0,3).forEach((t,i)=>{msg+=`${i+1}. ${t.descripcion}\n`;});
                    if (tPend.length>3) msg+=`...y ${tPend.length-3} más.\n`;
                }
                if (proj.facturas && proj.facturas.length>0) {
                    const tot=proj.facturas.reduce((a,f)=>a+(f.monto||0),0);
                    msg+=`\n💰 Facturado: $${tot.toLocaleString('es-MX')}`;
                }
                // 3.3 Memoria: guardar contexto del proyecto
                s.ctx.lastProyectoId = pQ.id;
                s.ctx.lastProyectoNombre = proj.nombre;
                await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx});
                await reply(msg);
            } catch(e) { waLog.addError('query-proyecto',e); await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx}); await reply('Error cargando el proyecto.'); }

        } else if (s.state === 'WAITING_BUSCAR_COT') {
            // ── 2.4 Buscar cotización en BD ─────────────────────────────
            const termino = Body.trim();
            try {
                const esFolio = /^C\d+$/i.test(termino.trim());
                const cots = esFolio
                    ? await CRMCotizacion.find({folio:{$regex:termino,$options:'i'}}).limit(5)
                    : await CRMCotizacion.find({clienteNombre:{$regex:termino,$options:'i'}}).sort({fechaCreacion:-1}).limit(5);
                if (cots.length===0) {
                    await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx});
                    await reply(`No encontré cotizaciones para "${termino}".\n\nEscribe *"busca [nombre]"* para intentar de nuevo.`);
                    return;
                }
                const EMOJ={Ganada:'✅',Perdida:'❌',Neutral:'🔵','En Seguimiento':'🟡',Cotizando:'🟠',Cerrada:'⚫'};
                let msg=`🔍 *${cots.length} cotización${cots.length>1?'es':''}:*\n\n`;
                cots.forEach(c=>{
                    const tot=c.total?`$${c.total.toLocaleString('es-MX')}`:'Sin monto';
                    msg+=`${EMOJ[c.estado]||'📋'} *${c.folio||'S/F'}* — ${c.clienteNombre}\n   ${c.estado} | ${tot}\n\n`;
                });
                // 3.3 Memoria: guardar última búsqueda
                s.ctx.lastBusqueda = termino;
                await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx});
                await reply(msg);
            } catch(e) { waLog.addError('buscar-cot',e); await setSession(effectiveFrom,{state:'IDLE',ctx:s.ctx}); await reply('Error buscando cotizaciones.'); }

        } else if (s.state === 'WAITING_AVANCE_PROYECTO') {
            const num = parseInt(text.trim());
            const proy = (s.ctx.proyList || []).find(p => p.num === num);
            if (!proy) return reply(`⚠️ Número no válido. Por favor, escribe un número de la lista.`);
            s.ctx.proyectoId = proy.id;
            s.ctx.proyecto = proy.nombre;
            
            let tareas;
            if (proy.id === 'IND') {
                const allProys = await CRMProyecto.find().select('_id');
                const allProyIds = allProys.map(p => p._id.toString());
                tareas = await CRMActividad.find({ 
                    proyectoId: { $nin: allProyIds },
                    estado: { $ne: 'Completada' }
                });
            } else {
                tareas = await CRMActividad.find({ proyectoId: proy.id, estado: { $ne: 'Completada' } });
            }
            let tareasList = [];
            let tNum = 1;
            tareas.forEach(t => { tareasList.push({ num: tNum++, desc: t.descripcion, id: t._id.toString() }); });
            s.ctx.tareasList = tareasList;
            
            if (tareasList.length > 0) {
                let txt = tareasList.map(t => `${t.num}. ${t.desc}`).join('\n');
                s.state = 'WAITING_AVANCE_TAREA';
                await setSession(effectiveFrom, s);
                let msg = `🛠️ *TAREAS DEL PROYECTO*\n\n${txt}\n\n¿A qué *TAREA* le reportarás avance?\n(Escribe el número`;
                msg += proy.id === 'IND' ? ')' : ', o "0" para reportar al proyecto en general sin especificar tarea)';
                await reply(msg);
            } else {
                if (proy.id === 'IND') {
                    await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
                    return reply(`No hay tareas independientes pendientes en este momento.`);
                }
                s.ctx.tareaId = null;
                s.state = 'WAITING_AVANCE_PCT_TAREA';
                await setSession(effectiveFrom, s);
                await reply(`No hay tareas pendientes en este proyecto.\n\n¿Cuál es el *Porcentaje de Avance* de tu actividad? (1-100)`);
            }
        } else if (s.state === 'WAITING_AVANCE_TAREA') {
            const num = parseInt(text.trim());
            if (num === 0) {
                if (s.ctx.proyectoId === 'IND') return reply(`⚠️ Para tareas independientes debes seleccionar un número de tarea específico.`);
                s.ctx.tareaId = null;
                s.ctx.tareaDesc = 'General';
            } else {
                const t = (s.ctx.tareasList || []).find(x => x.num === num);
                if (!t) return reply(`⚠️ Número no válido. Escribe un número de la lista${s.ctx.proyectoId === 'IND' ? '' : ' o "0"'}.`);
                s.ctx.tareaId = t.id;
                s.ctx.tareaDesc = t.desc;
            }
            s.state = 'WAITING_AVANCE_PCT_TAREA';
            await setSession(effectiveFrom, s);
            await reply(`📈 Tarea: ${s.ctx.tareaDesc || 'General'}\n\n¿Cuál es el *Porcentaje de Avance* de esta actividad? (Escribe un número del 1 al 100)`);
        } else if (s.state === 'WAITING_AVANCE_PCT_TAREA') {
            const num = parseInt(text.trim());
            if (isNaN(num) || num < 0 || num > 100) return reply(`⚠️ Porcentaje inválido. Escribe un número del 1 al 100.`);
            s.ctx.pctTarea = num;
            if (s.ctx.proyectoId === 'IND') {
                s.ctx.pctProy = 0;
                s.state = 'WAITING_AVANCE_DESC';
                await setSession(effectiveFrom, s);
                await reply(`📈 Enterado (${num}%).\n\nEscribe un *Comentario o Descripción* del trabajo que se realizó hoy:`);
            } else {
                s.state = 'WAITING_AVANCE_PCT_PROY';
                await setSession(effectiveFrom, s);
                await reply(`📈 Enterado (${num}%).\n\n¿Cuál es el nuevo *Porcentaje Global del Proyecto* aportado? (1-100)`);
            }
        } else if (s.state === 'WAITING_AVANCE_PCT_PROY') {
            const num = parseInt(text.trim());
            if (isNaN(num) || num < 0 || num > 100) return reply(`⚠️ Porcentaje inválido. Escribe un número del 1 al 100.`);
            s.ctx.pctProy = num;
            s.state = 'WAITING_AVANCE_DESC';
            await setSession(effectiveFrom, s);
            await reply(`📝 Enterado (${num}%).\n\nEscribe un *Comentario o Descripción* del trabajo que se realizó hoy:`);
        } else if (s.state === 'WAITING_AVANCE_DESC') {
            s.ctx.comentario = Body.trim();
            s.ctx.fotos = [];
            s.state = 'WAITING_AVANCE_FOTOS';
            await setSession(effectiveFrom, s);
            await reply(`📸 Comentario guardado.\n\nPor último, puedes enviar hasta *5 FOTOS* de evidencia ahora mismo.\n\n(Las fotos se procesarán una por una). Cuando hayas terminado de enviar fotos, o si no enviarás ninguna, escribe *"listo"*.`);
        } else if (s.state === 'WAITING_AVANCE_FOTOS') {
            const finishAvanceLocal = async () => {
                try {
                    const cleanPhone = effectiveFrom.split('@')[0];
                    const user = await UserRef.findOne({ telefono: { $regex: cleanPhone + '$' } });
                    const empName = user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Trabajador WA';
                    
                    if (s.ctx.proyectoId !== 'IND') {
                        const mongooseQuery = require('mongoose');
                        let proj = null;
                        if (mongooseQuery.isValidObjectId(s.ctx.proyectoId)) {
                            proj = await CRMProyecto.findById(s.ctx.proyectoId);
                        } else {
                            const folioPuro = s.ctx.proyectoId.replace('Proyecto Activo -', '').split('-').pop().trim();
                            proj = await CRMProyecto.findOne({ 
                                $or: [{ folio: folioPuro }, { nombre: { $regex: folioPuro, $options: 'i' } }] 
                            });
                        }
                        if (!proj) throw new Error(`Proyecto no encontrado para ID/Folio: ${s.ctx.proyectoId}`);
                        
                        proj.avances.push({
                            empleado: empName,
                            porcentaje: s.ctx.pctTarea || 0,
                            porcentajeProyecto: s.ctx.pctProy || 0,
                            comentario: s.ctx.comentario,
                            fotos: s.ctx.fotos || []
                        });
                        if (s.ctx.pctProy > 0) {
                            proj.porcentajeAvance = s.ctx.pctProy;
                        }
                        await proj.save();
                    }
                    
                    if (s.ctx.tareaId) {
                        const act = await CRMActividad.findById(s.ctx.tareaId);
                        if (act) {
                            act.porcentajeAvance = s.ctx.pctTarea;
                            act.avanceReportado = true;
                            act.estado = s.ctx.pctTarea >= 100 ? 'Completada' : 'En Progreso';
                            
                            // Guardar explícitamente el avance y las fotos en la Tarea
                            if (!act.avances) act.avances = [];
                            act.avances.push({
                                empleado: empName,
                                porcentaje: s.ctx.pctTarea || 0,
                                comentario: s.ctx.comentario,
                                fotos: s.ctx.fotos || []
                            });
                            
                            if (s.ctx.proyectoId === 'IND') {
                                if (!act.comentarios) act.comentarios = [];
                                act.comentarios.push(`[${new Date().toLocaleDateString('es-MX', {timeZone: 'America/Mexico_City'})}] ${empName} (${s.ctx.pctTarea}%): ${s.ctx.comentario}`);
                            }
                            await act.save();
                        }
                    }
                    
                    if (s.ctx.proyectoId === 'IND') {
                        await reply(`${waRnd(WA_FRASES.avance)}\n\n📈 *Tarea independiente — ${s.ctx.pctTarea}%*\n📝 _${s.ctx.comentario}_\n📸 Fotos: ${(s.ctx.fotos || []).length}\n\nQueda registrado en el sistema. ✅`);
                    } else {
                        await reply(`${waRnd(WA_FRASES.avance)}\n\n🏗️ *${s.ctx.proyecto}*\n📈 Tarea: ${s.ctx.pctTarea}% | Proyecto: ${waFormatBarra(s.ctx.pctProy||0)}\n📝 _${s.ctx.comentario}_\n📸 Fotos: ${(s.ctx.fotos || []).length}\n\nEl panel operativo ha sido actualizado. ✅`);
                    }
                } catch(e) {
                    console.error("Error finalizando avance WA:", e);
                    await reply(`❌ Error al guardar el avance. Consulta al administrador.`);
                }
                // Al terminar, si hay otro pendiente en cola, mostrarlo:
                setTimeout(async () => { await resolveSession(effectiveFrom, altFrom, reply); }, 1200);
            };

            if (message.hasMedia) {
                try {
                    const media = await message.downloadMedia();
                    if (media && media.mimetype.startsWith('image/')) {
                        const ext = media.mimetype.split('/')[1] || 'jpeg';
                        const fileName = `wa_evidencia_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
                        
                        // Guardar en MongoDB (CRMArchivo) en lugar de disco local (efímero)
                        const archivo = new CRMArchivo({
                            nombre: fileName,
                            contentType: media.mimetype,
                            datos: media.data, // ya viene en base64 desde whatsapp-web.js
                            tamanio: Buffer.from(media.data, 'base64').length
                        });
                        const saved = await archivo.save();
                        
                        // 🛠️ FIX: Guardado Atómico ($push) para evitar Condición de Carrera cuando mandan 5 fotos juntas
                        const updatedSession = await WaSession.findOneAndUpdate(
                            { chatId: effectiveFrom },
                            { $push: { "ctx.fotos": `/api/archivos/${saved._id}` }, $set: { updatedAt: new Date() } },
                            { new: true, returnDocument: 'after' }
                        );
                        
                        s.ctx = updatedSession.ctx || s.ctx; // Sincronizar estado en memoria
                        
                        const numFotos = (s.ctx.fotos || []).length;
                        const msgText = (text || '').trim().toLowerCase();
                        
                        if (numFotos >= 5 || msgText === 'listo' || msgText === 'terminar') {
                            await reply(`✅ Foto guardada (${numFotos}). Procesando avance...`);
                            await finishAvanceLocal();
                        } else {
                            await reply(`📸 Foto recibida (${numFotos}/5). Envía otra o escribe *"listo"*.`);
                            waLog.add(`✅ Foto recibida de WA para avance. (${numFotos}/5)`);
                        }
                    } else {
                        await reply(`⚠️ Por favor envía una imagen válida, o escribe "listo" para terminar.`);
                    }
                } catch(e) {
                    console.error("Error descargando foto wa:", e);
                    await reply(`❌ Error recibiendo la imagen.`);
                }
            } else if (text === 'listo' || text === 'terminar') {
                await reply(`⏳ Procesando avance...`);
                await finishAvanceLocal();
            } else {
                await reply(`⚠️ Por favor envía fotos de evidencia o escribe *"listo"* para finalizar el reporte.`);
            }
        } else if (s.state === 'WAITING_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TIME';
            await setSession(effectiveFrom, s);
            await reply(`Perfecto, anotado para: *${s.ctx.dateStr}*.\n\n¿A qué hora sería?\n(Si no hay hora definida, responde "ninguna")`);
        } else if (s.state === 'WAITING_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_DESC';
            await setSession(effectiveFrom, s);
            await reply(`Enterado.\n\n¿Cuál es la descripción, el cliente o el proyecto de este ${s.ctx.type}?`);
        } else if (s.state === 'WAITING_DESC') {
            s.ctx.desc = Body.trim();
            
            // Obtener fecha actual en la zona horaria de México para evitar desfase de UTC (ej. si es 23:58 local, el servidor en UTC ya es mañana)
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            const rawDateStr = s.ctx.dateStr.toLowerCase();
            if (rawDateStr.includes('pasado mañana') || rawDateStr.includes('pasado manana')) {
                fecha.setDate(fecha.getDate() + 2);
            } else if (rawDateStr.includes('mañana') || rawDateStr.includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            }
            
            const yyyy = fecha.getFullYear();
            const mm = String(fecha.getMonth() + 1).padStart(2, '0');
            const dd = String(fecha.getDate()).padStart(2, '0');
            
            // Construir ISO string con huso horario -06:00 (CDMX)
            const baseTimeStr = s.ctx.timeStr && s.ctx.timeStr.toLowerCase() !== 'ninguna' ? s.ctx.timeStr : '09:00';
            const isoStringStart = `${yyyy}-${mm}-${dd}T${baseTimeStr.padStart(5, '0')}:00-06:00`;
            const fechaInicioFix = new Date(isoStringStart);
            const fechaFinFix = new Date(fechaInicioFix.getTime() + 60*60*1000);
            
            try {
                const ev = new CRMEvento({
                    tipo: s.ctx.type,
                    titulo: `[WA] ${s.ctx.type} - ${s.ctx.desc}`,
                    descripcion: `Hora solicitada: ${s.ctx.timeStr} | Fecha indicada: ${s.ctx.dateStr}\n(Agendado vía WhatsApp)`,
                    fechaInicio: fechaInicioFix,
                    fechaFin: fechaFinFix
                });
                await ev.save();
                await reply(`✅ ¡Listo! Tu ${s.ctx.type} ha sido agendado en el CRM exitosamente.\n\n*Detalles:*\n📝 ${s.ctx.desc}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr}\n\nPara agendar algo más, solo escríbeme.`);
            } catch(e) {
                console.error('Error guardando evento WA:', e);
                await reply(`Ocurrió un error al guardar. Intenta de nuevo diciendo "cancelar".`);
            }
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
        } 
        // --- FLUJO TAREAS ---
        else if (s.state === 'WAITING_TAREA_DESC') {
            s.ctx.desc = Body.trim();
            s.state = 'WAITING_TAREA_DATE';
            await setSession(effectiveFrom, s);
            await reply(`📝 Tarea: *${s.ctx.desc}*\n\n¿Para qué fecha es la tarea? (Ej: Mañana, hoy, 25/05/2026)`);
        } else if (s.state === 'WAITING_TAREA_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME';
            await setSession(effectiveFrom, s);
            await reply(`🗓️ Fecha: *${s.ctx.dateStr}*\n\n¿A qué hora *Inicia*? (Formato 24h, ej: 09:00 o 14:30)`);
        } else if (s.state === 'WAITING_TAREA_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME_END';
            await setSession(effectiveFrom, s);
            await reply(`⏰ Inicio: ${s.ctx.timeStr}\n\n¿A qué hora *Termina*? (Ej: 13:00). Si no tiene fin, responde "no".`);
        } else if (s.state === 'WAITING_TAREA_TIME_END') {
            s.ctx.timeEndStr = Body.trim().toLowerCase() === 'no' ? '18:00' : Body.trim();
            
            // Calc Date
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            const rawDateStr = s.ctx.dateStr.toLowerCase();
            if (rawDateStr.includes('pasado mañana') || rawDateStr.includes('pasado manana')) {
                fecha.setDate(fecha.getDate() + 2);
            } else if (rawDateStr.includes('mañana') || rawDateStr.includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            }
            
            const yyyy = fecha.getFullYear();
            const mm = String(fecha.getMonth() + 1).padStart(2, '0');
            const dd = String(fecha.getDate()).padStart(2, '0');
            const fechaBase = `${yyyy}-${mm}-${dd}`;
            
            const isoStringStart = `${fechaBase}T${(s.ctx.timeStr || '09:00').padStart(5, '0')}:00-06:00`;
            s.ctx.parsedFecha = new Date(isoStringStart);
            
            const diaInicio = new Date(`${fechaBase}T00:00:00-06:00`);
            const diaFin   = new Date(`${fechaBase}T23:59:59-06:00`);
            
            try {
                const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });
                const eventosDelDia = await CRMEvento.find({ fechaInicio: { $gte: diaInicio, $lte: diaFin } });

                let ocupados = [];
                let vehOcupados = [];

                tareasDelDia.forEach(t => {
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, t.horaInicio || null, t.horaFin || null)) return;
                    if (t.asignadoANombre) ocupados.push(t.asignadoANombre);
                    if (t.cuadrillaNombres) ocupados.push(...t.cuadrillaNombres);
                    if (t.vehiculosAsignados) vehOcupados.push(...t.vehiculosAsignados);
                });

                eventosDelDia.forEach(ev => {
                    // Extract HH:MM local time from Date
                    const horaIni = ev.fechaInicio ? ev.fechaInicio.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                    const horaFin = ev.fechaFin ? ev.fechaFin.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute:'2-digit' }) : null;
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, horaIni, horaFin)) return;
                    
                    if (ev.participantes) ocupados.push(...ev.participantes);
                    if (ev.vehiculosAsignados) vehOcupados.push(...ev.vehiculosAsignados);
                });
                
                const allUsers = await UserRef.find().sort({ nombre: 1 });
                const allVehs = await VehicleRef.find().sort({ modelo: 1 });
                
                let userList = [];
                let uNum = 1;
                allUsers.forEach(u => {
                    const isOcupado = ocupados.some(o => o && o.toLowerCase().includes(u.nombre.toLowerCase()));
                    userList.push({ num: uNum++, nombre: u.nombre, ocupado: isOcupado, id: u._id.toString() });
                });

                let vehList = [];
                let vNum = 1;
                allVehs.forEach(v => {
                    const isOcupado = vehOcupados.includes(v._id.toString()) || v.estado === 'Prestado';
                    vehList.push({ num: vNum++, modelo: `${v.marca || ''} ${v.modelo} ${v.placas || ''}`.trim(), ocupado: isOcupado, id: v._id.toString() });
                });

                s.ctx.userList = userList;
                s.ctx.vehList = vehList;
                
                let usersTxt = userList.map(u => `${u.num}. ${u.nombre} ${u.ocupado ? '🔴 Ocupado' : '🟢 Libre'}`).join('\n');
                
                s.state = 'WAITING_TAREA_ENCARGADO';
                await setSession(effectiveFrom, s);
                await reply(`📊 *LISTA DE PERSONAL*\n\n${usersTxt}\n\n👤 ¿Quién será el *ENCARGADO*? (Escribe el número)`);
            } catch(e) {
                console.error(e);
                await reply('Error consultando recursos.');
                await setSession(From, { state: 'IDLE', ctx: {} });
            }
        } else if (s.state === 'WAITING_TAREA_ENCARGADO') {
            const num = parseInt(Body.trim());
            const user = (s.ctx.userList || []).find(u => u.num === num);
            if (!user) {
                await reply(`⚠️ Número no válido. Por favor, escribe un número de la lista:`);
                return;
            }
            if (user.ocupado) {
                await reply(`❌ Error: Has seleccionado a ${user.nombre} que está 🔴 Ocupado en ese horario.\n\nPor favor, elige el número de alguien que esté 🟢 Libre.`);
                return; // Bloqueo estricto
            }
            s.ctx.encargado = user.nombre;
            s.state = 'WAITING_TAREA_ACOMPANANTES';
            await setSession(effectiveFrom, s);
            await reply(`👥 ¿Quiénes van de *ACOMPAÑANTES*?\n(Escribe los números separados por coma, o "ninguno"/"0")`);
        } else if (s.state === 'WAITING_TAREA_ACOMPANANTES') {
            const b = Body.trim().toLowerCase();
            if (b === 'ninguno' || b === 'no' || b === '0') {
                s.ctx.acompanantes = [];
            } else {
                const nums = b.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                const users = (s.ctx.userList || []).filter(u => nums.includes(u.num));
                s.ctx.acompanantes = users.map(u => u.nombre);
                
                const ocupadosSeleccionados = users.filter(u => u.ocupado).map(u => u.nombre);
                if (ocupadosSeleccionados.length > 0) {
                    await reply(`❌ Error: Has incluido acompañantes que están 🔴 Ocupados (${ocupadosSeleccionados.join(', ')}).\n\nPor favor, responde de nuevo con números de personas que estén 🟢 Libres (o "0" para ninguno).`);
                    return; // Bloqueo estricto
                }
            }

            let vehsTxt = (s.ctx.vehList || []).map(v => `${v.num}. ${v.modelo} ${v.ocupado ? '🔴 Ocupado' : '🟢 Libre'}`).join('\n');
            s.state = 'WAITING_TAREA_VEHICULOS';
            await setSession(effectiveFrom, s);
            await reply(`🚗 *LISTA DE VEHÍCULOS*\n\n${vehsTxt}\n\n¿Qué *VEHÍCULOS* se usarán? (Escribe los números separados por coma, o "ninguno"/"0")`);
        } else if (s.state === 'WAITING_TAREA_VEHICULOS') {
            const b = Body.trim().toLowerCase();
            if (b === 'ninguno' || b === 'no' || b === '0') {
                s.ctx.vehiculosIds = [];
                s.ctx.vehiculosTxt = 'Ninguno';
            } else {
                const nums = b.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
                const vehs = (s.ctx.vehList || []).filter(v => nums.includes(v.num));
                s.ctx.vehiculosIds = vehs.map(v => v.id);
                s.ctx.vehiculosTxt = vehs.map(v => v.modelo).join(', ');

                const ocupadosSeleccionados = vehs.filter(v => v.ocupado).map(v => v.modelo);
                if (ocupadosSeleccionados.length > 0) {
                    await reply(`❌ Error: Has seleccionado vehículos que están 🔴 Ocupados (${ocupadosSeleccionados.join(', ')}).\n\nPor favor, responde de nuevo con números de vehículos 🟢 Libres (o "0").`);
                    return; // Bloqueo estricto
                }
            }
            
            const proyectosActivos = await CRMProyecto.find({ estado: { $in: ['Activo', 'Pausado'] } }).sort({ fechaInicio: -1 });
            let proyList = [];
            let pNum = 1;
            proyectosActivos.forEach(p => { proyList.push({ num: pNum++, folio: p.folio, nombre: p.nombre, id: p._id.toString() }); });
            s.ctx.proyList = proyList;
            
            let proysTxt = proyList.length > 0 ? proyList.map(p => `${p.num}. [${p.folio || 'S/F'}] ${p.nombre}`).join('\n') : 'No hay proyectos activos.';

            s.state = 'WAITING_TAREA_PROYECTO';
            await setSession(effectiveFrom, s);
            await reply(`🏗️ *PROYECTOS ACTIVOS*\n\n${proysTxt}\n\n¿A qué *PROYECTO* deseas vincularlo?\n(Escribe el número, o "0"/"no" para ninguno)`);
        } else if (s.state === 'WAITING_TAREA_PROYECTO') {
            const b = Body.trim().toLowerCase();
            if (b === 'no' || b === 'ninguno' || b === '0') {
                s.ctx.proyecto = null;
                s.ctx.proyectoId = '';
            } else {
                const num = parseInt(b);
                const proy = (s.ctx.proyList || []).find(p => p.num === num);
                if (proy) {
                    s.ctx.proyecto = proy.folio ? `${proy.folio} - ${proy.nombre}` : proy.nombre;
                    s.ctx.proyectoId = proy.id;
                } else {
                    s.ctx.proyecto = Body.trim(); // Fallback si escriben nombre
                    s.ctx.proyectoId = '';
                }
            }
            
            try {
                if (s.ctx.isEvento) {
                    // Guardar como Junta/Levantamiento/Cita (CRMEvento)
                    
                    // Asegurar que si hay hora fin, se guarde correctamente en base a parsedFecha
                    let fechaFinCalc;
                    if (s.ctx.timeEndStr) {
                        const yyyy = s.ctx.parsedFecha.getFullYear();
                        const mm = String(s.ctx.parsedFecha.getMonth() + 1).padStart(2, '0');
                        const dd = String(s.ctx.parsedFecha.getDate()).padStart(2, '0');
                        fechaFinCalc = new Date(`${yyyy}-${mm}-${dd}T${s.ctx.timeEndStr.padStart(5, '0')}:00-06:00`);
                    } else {
                        fechaFinCalc = new Date(s.ctx.parsedFecha.getTime() + 60*60*1000);
                    }
                    
                    const nEvento = new CRMEvento({
                        tipo: s.ctx.type,
                        titulo: `[WA] ${s.ctx.type} - ${s.ctx.desc}`,
                        descripcion: `Proyecto: ${s.ctx.proyecto || 'Ninguno'} | Agendado vía WhatsApp`,
                        fechaInicio: s.ctx.parsedFecha,
                        fechaFin: fechaFinCalc,
                        participantes: [s.ctx.encargado, ...s.ctx.acompanantes],
                        vehiculosAsignados: s.ctx.vehiculosIds || []
                    });
                    await nEvento.save();
                    await reply(`${waRnd(WA_FRASES.confirmado)} Tu ${s.ctx.type} quedó agendado:\n\n📋 "${s.ctx.desc}"\n👤 Encargado: *${s.ctx.encargado}*\n👥 Acompañantes: ${s.ctx.acompanantes.join(', ') || 'Ninguno'}\n🚗 ${s.ctx.vehiculosTxt || 'Sin vehículo'}\n🏗️ ${s.ctx.proyecto || 'Sin proyecto'}\n📅 ${s.ctx.dateStr} · 🕒 ${s.ctx.timeStr}-${s.ctx.timeEndStr||'?'}\n\nAvisando al personal... 📲`);
                } else {
                    // Guardar como Tarea (CRMActividad)
                    const nTarea = new CRMActividad({
                        descripcion: s.ctx.desc,
                        asignadoANombre: s.ctx.encargado,
                        cuadrillaNombres: s.ctx.acompanantes,
                        vehiculosAsignados: s.ctx.vehiculosIds || [],
                        proyectoId: s.ctx.proyectoId || s.ctx.proyecto || '',
                        estado: 'Pendiente',
                        fechaVencimiento: s.ctx.parsedFecha,
                        horaInicio: s.ctx.timeStr,
                        horaFin: s.ctx.timeEndStr,
                        tipoDestino: s.ctx.proyecto ? 'Proyecto vinculado' : 'Asignación vía WhatsApp'
                    });
                    await nTarea.save();
                    await reply(`${waRnd(WA_FRASES.confirmado)} La tarea quedó lista:\n\n📋 "${s.ctx.desc}"\n👤 Encargado: *${s.ctx.encargado}*\n👥 Acompañantes: ${s.ctx.acompanantes.join(', ') || 'Ninguno'}\n🚗 ${s.ctx.vehiculosTxt || 'Sin vehículo'}\n🏗️ ${s.ctx.proyecto || 'Sin proyecto'}\n📅 ${s.ctx.dateStr} · 🕒 ${s.ctx.timeStr}-${s.ctx.timeEndStr||'?'}\n\nAvisando al personal... 📲`);
                }
                
                // NOTIFICACIONES WHATSAPP
                const allUsers = await UserRef.find();
                
                const findPhone = (name) => {
                    const u = allUsers.find(x => x.nombre && x.nombre.toLowerCase().includes(name.toLowerCase()));
                    return u && u.telefono ? u.telefono : null;
                };

                const telEncargado = findPhone(s.ctx.encargado);
                if (telEncargado) {
                    const msgEncargado = `🚨 *NUEVA TAREA ASIGNADA (Encargado)* 🚨\n\n📋 Tarea: ${s.ctx.desc}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}\n👥 Te acompañan: ${s.ctx.acompanantes.join(', ') || 'Nadie'}\n🚗 Vehículo(s): ${s.ctx.vehiculosTxt}\n🏗️ Proyecto/Cliente: ${s.ctx.proyecto || 'No vinculado'}\n\nResponde con:\n✅ *ACEPTAR* — para confirmar tu participación\n❌ *RECHAZAR* — si no puedes realizarla`;
                    await sendWhatsAppMessage(telEncargado, msgEncargado, { tipo: 'tarea_encargado' });
                    // Encolar WAITING_TASK_CONFIRM (sin sobreescribir sesión activa)
                    const chatIdEnc = await getChatIdFromPhone(telEncargado);
                    const altChatIdEnc = chatIdEnc.startsWith('521') ? chatIdEnc.replace('521','52') : chatIdEnc.replace('52','521');
                    const taskSessionData = { state: 'WAITING_TASK_CONFIRM', ctx: { tareaDesc: s.ctx.desc, nombreTrabajador: s.ctx.encargado, tareaId: (nEvento || nTarea)._id.toString(), proyectoId: s.ctx.proyectoId || s.ctx.proyecto || 'IND' } };
                    await enqueueSession(chatIdEnc, taskSessionData);
                    await enqueueSession(altChatIdEnc, taskSessionData);
                    waLog.add(`📋 [COLA] WAITING_TASK_CONFIRM encolado para encargado: ${chatIdEnc}`);
                }
                
                for (let ac of s.ctx.acompanantes) {
                    const telAc = findPhone(ac);
                    if (telAc) {
                        const msgAc = `🔔 *NUEVA TAREA ASIGNADA (Acompañante)* 🔔\n\n📋 Tarea: ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}\n\nResponde con:\n✅ *ACEPTAR* — para confirmar tu participación\n❌ *RECHAZAR* — si no puedes realizarla`;
                        await sendWhatsAppMessage(telAc, msgAc, { tipo: 'tarea_acompanante' });
                        // Encolar WAITING_TASK_CONFIRM (sin sobreescribir sesión activa)
                        const chatIdAc = await getChatIdFromPhone(telAc);
                        const altChatIdAc = chatIdAc.startsWith('521') ? chatIdAc.replace('521','52') : chatIdAc.replace('52','521');
                        const acSessionData = { state: 'WAITING_TASK_CONFIRM', ctx: { tareaDesc: s.ctx.desc, nombreTrabajador: ac, tareaId: (nEvento || nTarea)._id.toString(), proyectoId: s.ctx.proyectoId || s.ctx.proyecto || 'IND' } };
                        await enqueueSession(chatIdAc, acSessionData);
                        await enqueueSession(altChatIdAc, acSessionData);
                        waLog.add(`📋 [COLA] WAITING_TASK_CONFIRM encolado para acompañante: ${chatIdAc}`);
                    }
                }
                
            } catch (e) {
                console.error('Error guardando tarea WA:', e);
                await reply(`❌ Error al crear la tarea. Intenta de nuevo.`);
            }
            await setSession(effectiveFrom, { state: 'IDLE', ctx: {} });
        } else if (s.state === 'WAITING_VEHICLE_CONFIRM') {
            const b = text.trim().toLowerCase();
            if (b === '1' || b === 'aceptar' || b === 'acepto' || b === 'si' || b === 'sí') {
                try {
                    let mainApiUrl = s.ctx.mainApiUrl || 'https://entregables-production-b834.up.railway.app';
                    // Normalizar dominio viejo por si la sesión se generó antes del fix
                    mainApiUrl = mainApiUrl.replace('naisa.newbox.mx', 'entregables-production-b834.up.railway.app').replace('www.naisata.com', 'entregables-production-b834.up.railway.app');
                    // Asegurarnos de que tenga https:// si lo reemplazamos sin protocolo
                    if (!mainApiUrl.startsWith('http')) mainApiUrl = `https://${mainApiUrl}`;
                    const txId = s.ctx.txId;
                    const confirmUrl = `${mainApiUrl}/api/assignments/vehicle/${txId}/confirm`;
                    waLog.add(`🔗 Intentando confirmar: txId=${txId} url=${confirmUrl}`);
                    // Llamar al endpoint principal para confirmar
                    const confirmRes = await fetch(confirmUrl, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ firma: 'whatsapp-confirmation' })
                    });
                    if (confirmRes.ok) {
                        await reply(`✅ *VEHÍCULO ACEPTADO*\n\n¡Perfecto! La asignación quedó confirmada. Ya puedes disponer del vehículo.\n\n🚗 ¡Buen viaje y maneja con precaución!`);
                        // Resolver sesión DESPUES del mensaje (para que llegue en orden correcto)
                        setTimeout(async () => { await resolveSession(effectiveFrom, altFrom, reply); }, 1200);
                    } else {
                        const errData = await confirmRes.json().catch(() => ({}));
                        waLog.add(`⚠️ Confirm HTTP ${confirmRes.status}: ${JSON.stringify(errData).substring(0,80)}`);
                        await resolveSession(effectiveFrom, altFrom, null);
                        return reply(`⚠️ No se pudo confirmar: ${errData.error || 'La asignación ya no es válida'}. Se ha cancelado el proceso actual.`);
                    }
                } catch(e) {
                    const cause = e.cause ? ` | causa: ${e.cause.message || e.cause}` : '';
                    waLog.addError(`Confirmando vehiculo via WA (txId=${s.ctx.txId} url=${s.ctx.mainApiUrl})`, new Error(e.message + cause));
                    await resolveSession(effectiveFrom, altFrom, null);
                    return reply(`❌ Error de conexión al confirmar. Intenta desde la app o contacta al administrador.`);
                }
            } else if (b === '2' || b === 'rechazar' || b === 'rechazo' || b === 'no') {
                try {
                    let mainApiUrl = s.ctx.mainApiUrl || 'https://entregables-production-b834.up.railway.app';
                    // Normalizar dominio viejo por si la sesión se generó antes del fix
                    mainApiUrl = mainApiUrl.replace('naisa.newbox.mx', 'entregables-production-b834.up.railway.app').replace('www.naisata.com', 'entregables-production-b834.up.railway.app');
                    if (!mainApiUrl.startsWith('http')) mainApiUrl = `https://${mainApiUrl}`;
                    const txId = s.ctx.txId;
                    const rejectUrl = `${mainApiUrl}/api/assignments/vehicle/${txId}/reject`;
                    waLog.add(`🔗 Intentando rechazar: txId=${txId} url=${rejectUrl}`);
                    const rejectRes = await fetch(rejectUrl, { method: 'PUT' });
                    if (!rejectRes.ok) {
                        waLog.add(`⚠️ Reject HTTP ${rejectRes.status}`);
                    }
                } catch(e) {
                    const cause = e.cause ? ` | causa: ${e.cause.message || e.cause}` : '';
                    waLog.addError(`Rechazando vehiculo via WA (txId=${s.ctx.txId} url=${s.ctx.mainApiUrl})`, new Error(e.message + cause));
                }
                await reply(`❌ *ASIGNACIÓN RECHAZADA*\n\nHas rechazado la asignación del vehículo. El administrador ha sido notificado.`);
                setTimeout(async () => { await resolveSession(effectiveFrom, altFrom, reply); }, 1200);
                return;
            } else {
                return reply(`⚠️ Respuesta no reconocida.\n\nEscribe *ACEPTAR* para confirmar la recepción o *RECHAZAR* para declinar. Si deseas salir de esto, escribe *CANCELAR*.`);
            }
        } else if (s.state === 'WAITING_TASK_CONFIRM') {
            const b = text.trim().toLowerCase();
            const tareaDesc = s.ctx.tareaDesc || 'Sin descripción';
            const nombreTrabajador = s.ctx.nombreTrabajador || 'Un trabajador';

            // Buscar teléfono de Jonathan para notificarle
            const notifyJonathan = async (msgJonathan) => {
                try {
                    const allUsersJ = await UserRef.find();
                    const jonathan = allUsersJ.find(x => x.nombre && x.nombre.toLowerCase().includes('jonathan'));
                    if (jonathan && jonathan.telefono) {
                        await sendWhatsAppMessage(jonathan.telefono, msgJonathan);
                        waLog.add(`📲 Jonathan notificado sobre confirmación de tarea de ${nombreTrabajador}`);
                    } else {
                        waLog.add(`⚠️ No se encontró a Jonathan en la base de datos para notificar.`);
                    }
                } catch(e) {
                    waLog.add(`❌ Error notificando a Jonathan: ${e.message}`);
                }
            };

            const isAvance = b.includes('avance') || b.includes('reporte') || b.includes('progreso') || b.includes('ya terminé') || b.includes('ya acabe');

            if (b === 'aceptar' || b === 'acepto' || b === '1' || b === 'si' || b === 'sí' || isAvance) {
                await notifyJonathan(`✅ *CONFIRMACIÓN DE TAREA*\n\n*${nombreTrabajador}* ha *ACEPTADO* la siguiente tarea${isAvance ? ' (Implícitamente al reportar avance)' : ''}:\n\n📋 "${tareaDesc}"`);
                
                if (isAvance) {
                    await reply(`✅ Confirmé tu tarea automáticamente.\n\n📈 ¿Qué porcentaje de avance llevas en esta tarea? (Escribe un número del 1 al 100)`);
                    s.state = 'WAITING_AVANCE_PCT_TAREA';
                    await WaSession.findOneAndUpdate({ chatId: effectiveFrom }, { state: s.state, ctx: s.ctx });
                    // No reinyectamos el mensaje porque ya hicimos la pregunta para la siguiente etapa.
                    return;
                } else {
                    await reply(`✅ ¡Órale! Confirmado tu participación. ¡Mucho éxito en la tarea!`);
                    setTimeout(async () => { await resolveSession(effectiveFrom, altFrom, reply); }, 1200);
                    return;
                }
            } else if (b === 'rechazar' || b === 'rechazo' || b === '2' || b === 'no') {
                await notifyJonathan(`❌ *TAREA RECHAZADA*\n\n*${nombreTrabajador}* ha *RECHAZADO* la siguiente tarea:\n\n📋 "${tareaDesc}"\n\nSe requiere reasignación.`);
                await reply(`❌ Enterado, declinación registrada. El administrador ha sido notificado.`);
                setTimeout(async () => { await resolveSession(effectiveFrom, altFrom, reply); }, 1200);
                return;
            } else {
                return reply(`⚠️ No entendí eso. Responde con *ACEPTAR* para confirmar o *RECHAZAR* si no puedes. Escribe *CANCELAR* para salir.`);
            }
        }

    } catch (err) {
        console.error('Error procesando mensaje de WhatsApp:', err);
    }
};

    waClient.on('message', waMessageHandler);
    waClient.initialize();
};

if (mongoose.connection.readyState === 1) {
    initWhatsApp();
} else {
    mongoose.connection.once('open', initWhatsApp);
}

// --- WATCHDOG: Reiniciar bot si lleva mucho tiempo desconectado ---
// Si a los 3 minutos de arrancar el servidor el bot sigue DESCONECTADO
// (sin haber llegado a ESPERANDO_ESCANEO ni CONECTADO), lo reinicia solo.
let waInitTimestamp = Date.now();
setInterval(async () => {
    if (waStatus === 'CONECTADO' || waStatus === 'ESPERANDO_ESCANEO') {
        waInitTimestamp = Date.now();
        return;
    }
    const minutosSinConectar = (Date.now() - waInitTimestamp) / 60000;
    if (minutosSinConectar >= 3) {
        waLog.add(`🐕 Watchdog: ${Math.floor(minutosSinConectar)}min en "${waStatus}". Forzando reinicio...`);
        waInitTimestamp = Date.now();
        // Forzar reset del flag para romper el deadlock si Puppeteer se colgó
        waInitializing = false;
        try {
            if (waClient) {
                try { await waClient.destroy(); } catch(_) {}
                waClient = null;
            }
        } catch(_) {}
        setTimeout(() => initWhatsApp(), 3000);
    }
}, 60000);
// -------------------------------------------------------

// Favicon (evitar 404 en el log)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- Recordatorios automáticos de eventos ---
setInterval(async () => {
    try {
        if (!waReady || waStatus !== 'CONECTADO') return;
        
        const ahora = new Date();
        const enHoraYMedia = new Date(ahora.getTime() + 90 * 60 * 1000);
        
        // Buscar eventos (SOLO Juntas y Levantamientos) que comiencen en los próximos 90 minutos
        const eventos = await CRMEvento.find({
            tipo: { $in: ['Junta', 'Levantamiento'] },
            fechaInicio: { $gt: ahora, $lte: enHoraYMedia },
            recordatorioEnviado: { $ne: true }
        });
        
        if (eventos.length === 0) return;
        
        const allUsers = await UserRef.find();
        const findPhone = (name) => {
            const queryName = name.trim().toLowerCase().replace(/\s+/g, ' ');
            const u = allUsers.find(x => {
                const soloNombre = (x.nombre || '').trim().toLowerCase();
                const soloApellido = (x.apellido || '').trim().toLowerCase();
                const fullName = `${soloNombre} ${soloApellido}`.trim().replace(/\s+/g, ' ');
                if (!fullName) return false;
                return fullName === queryName || fullName.includes(queryName) || queryName.includes(fullName);
            });
            return u && u.telefono ? u.telefono : null;
        };

        for (const ev of eventos) {
            const timeStr = ev.fechaInicio.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute:'2-digit' });
            
            for (const participante of (ev.participantes || [])) {
                const tel = findPhone(participante);
                if (tel) {
                    const msg = `⏰ *RECORDATORIO DE ${ev.tipo.toUpperCase()}*\n\nHola ${participante}, te recordamos que tienes programado: *${ev.titulo}*.\n\n🕒 Inicia a las: ${timeStr}\n📝 Detalles: ${ev.descripcion}\n\nPor favor, prepárate con anticipación.`;
                    await sendWhatsAppMessage(tel, msg, { tipo: 'recordatorio' }).catch(e => console.error("Error enviando recordatorio WA:", e));
                }
            }
            
            ev.recordatorioEnviado = true;
            await ev.save();
        }
    } catch(err) {
        console.error('Error en loop de recordatorios:', err);
    }
}, 60000); // Revisar cada minuto

// --- RECORDATORIOS AUTOMÁTICOS DE TAREAS (8:00 PM México, día anterior) ---
let _ultimoRecordatorioTareasFecha = '';
setInterval(async () => {
    try {
        if (!waReady || waStatus !== 'CONECTADO') return;

        // Calcular hora actual en México
        const ahoraISO = new Date().toLocaleString('en-CA', { timeZone: 'America/Mexico_City', hour12: false });
        // ahoraISO tiene formato: "2026-06-04, 20:00:05"
        const [fechaHoyMx, tiempoMx] = ahoraISO.split(', ');
        const [horaActual, minActual] = tiempoMx.split(':').map(Number);

        // Ejecutar solo entre 20:00 y 20:01 (ventana de 1 minuto) y solo 1 vez por día
        if (horaActual !== 20 || minActual > 1) return;
        if (_ultimoRecordatorioTareasFecha === fechaHoyMx) return;
        _ultimoRecordatorioTareasFecha = fechaHoyMx;

        waLog.add('⏰ [CRON] Iniciando envío de recordatorios de tareas para mañana...');

        // Calcular rango de mañana
        const mañana = new Date(fechaHoyMx + 'T12:00:00.000Z');
        mañana.setDate(mañana.getDate() + 1);
        const mañanaStr = mañana.toISOString().split('T')[0];
        const mañanaInicio = new Date(mañanaStr + 'T00:00:00.000Z');
        const mañanaFin    = new Date(mañanaStr + 'T23:59:59.999Z');

        // Buscar tareas de mañana no completadas
        const tareasManana = await CRMActividad.find({
            fechaVencimiento: { $gte: mañanaInicio, $lte: mañanaFin },
            estado: { $nin: ['Completada', 'Cancelada'] }
        });

        if (tareasManana.length === 0) {
            waLog.add('⏰ [CRON] Sin tareas para mañana. Nada que recordar.');
            return;
        }

        const allUsers = await UserRef.find();
        const allVehs  = await VehicleRef.find();

        const findPhoneCron = (name) => {
            const q = name.trim().toLowerCase().replace(/\s+/g, ' ');
            const u = allUsers.find(x => {
                const full = `${(x.nombre||'').trim()} ${(x.apellido||'').trim()}`.trim().toLowerCase().replace(/\s+/g,' ');
                return full === q || full.includes(q) || q.includes(full);
            });
            return u && u.telefono ? u.telefono : null;
        };

        // Calcular nombre del día de mañana en español
        const diaMañana = mañana.toLocaleDateString('es-MX', { weekday: 'long', timeZone: 'America/Mexico_City' });
        const numMañana = mañana.toLocaleDateString('es-MX', { day: '2-digit', timeZone: 'America/Mexico_City' });
        const fechaTxtMañana = `${diaMañana} - ${numMañana}`;

        const yaNotificados = new Set();

        for (const t of tareasManana) {
            const vehiculosNombres = (t.vehiculosAsignados || []).map(vId => {
                const v = allVehs.find(x => x._id.toString() === vId);
                return v ? v.modelo : 'Desconocido';
            }).join(', ') || 'Ninguno';

            let encargadosArr = [];
            if (Array.isArray(t.asignadoANombre)) encargadosArr = t.asignadoANombre.filter(Boolean);
            else if (typeof t.asignadoANombre === 'string') encargadosArr = t.asignadoANombre.split(',').map(s => s.trim()).filter(Boolean);

            let acompanantesArr = [];
            if (Array.isArray(t.cuadrillaNombres)) acompanantesArr = t.cuadrillaNombres.filter(Boolean);
            else if (typeof t.cuadrillaNombres === 'string') acompanantesArr = t.cuadrillaNombres.split(',').map(s => s.trim()).filter(Boolean);

            const todosAsignados = [...new Set([...encargadosArr, ...acompanantesArr])];

            for (const persona of todosAsignados) {
                const tel = findPhoneCron(persona);
                if (!tel) continue;
                const clave = `${t._id}-${tel}`;
                if (yaNotificados.has(clave)) continue;
                yaNotificados.add(clave);

                const esEncargado = encargadosArr.includes(persona);
                const rolTxt = esEncargado ? '👷 *Eres el Encargado*' : '👥 *Vas como Acompañante*';
                const encargadosTxt = encargadosArr.join(', ') || 'Sin encargado';
                const acompanantesTxtCron = acompanantesArr.join(', ') || 'Nadie';

                // Mensaje COMPLETO de asignación con ACEPTAR/RECHAZAR (igual que si fuera hoy)
                let msgCron;
                if (esEncargado) {
                    msgCron = `🚨 *TAREA PARA MAÑANA (Tú eres el Encargado)* 🚨\n\n📝 Tarea: ${t.descripcion || 'Sin descripción'}\n📅 Fecha: ${fechaTxtMañana}\n🕒 Horario: ${t.horaInicio || 'No definido'} a ${t.horaFin || 'No definido'}\n🏗️ Proyecto: ${t.proyectoId || 'Sin proyecto'}\n🚗 Vehículo(s): ${vehiculosNombres}\n👥 Te acompañan: ${acompanantesTxtCron}\n\nResponde con:\n✅ *ACEPTAR* — para confirmar tu participación\n❌ *RECHAZAR* — si no puedes realizarla`;
                } else {
                    msgCron = `🔔 *TAREA PARA MAÑANA (Vas como Acompañante)* 🔔\n\n📝 Tarea: ${t.descripcion || 'Sin descripción'}\n📅 Fecha: ${fechaTxtMañana}\n🕒 Horario: ${t.horaInicio || 'No definido'} a ${t.horaFin || 'No definido'}\n👤 Encargado: ${encargadosTxt}\n🚗 Vehículo(s): ${vehiculosNombres}\n\nResponde con:\n✅ *ACEPTAR* — para confirmar tu participación\n❌ *RECHAZAR* — si no puedes realizarla`;
                }

                try {
                    await sendWhatsAppMessage(tel, msgCron, { tipo: esEncargado ? 'tarea_encargado' : 'tarea_acompanante', genero: inferirGenero(persona) });
                    waLog.add(`✅ [CRON] Asignación completa enviada a ${persona} (${tel})`);
                    // Encolar sesión WAITING_TASK_CONFIRM ahora que sí se manda la petición de confirmación
                    try {
                        const chatIdCron = phoneToWaChatId(tel);
                        const altChatIdCron = chatIdCron.startsWith('521') ? chatIdCron.replace('521','52') : chatIdCron.replace(/^52/, '521');
                        const sessionDataCron = { state: 'WAITING_TASK_CONFIRM', ctx: { tareaDesc: t.descripcion, nombreTrabajador: persona, tareaId: t._id ? t._id.toString() : null, proyectoId: t.proyectoId || 'IND' } };
                        await enqueueSession(chatIdCron, sessionDataCron);
                        await enqueueSession(altChatIdCron, sessionDataCron);
                        waLog.add(`📋 [CRON] WAITING_TASK_CONFIRM encolado para ${persona}`);
                    } catch(eQ) { console.error('Error encolando sesión cron:', eQ); }
                } catch(e) {
                    waLog.add(`❌ [CRON] Error enviando asignación a ${persona}: ${e.message}`);
                }
            }
        }

        waLog.add(`⏰ [CRON] Recordatorios finalizados. ${yaNotificados.size} mensaje(s) enviado(s).`);
    } catch(err) {
        console.error('Error en cron de recordatorios de tareas:', err);
        if (typeof waLog !== 'undefined' && waLog.add) waLog.add(`❌ [CRON] Error crítico: ${err.message}`);
    }
}, 60000); // Revisar cada minuto
// --- FIN RECORDATORIOS DE TAREAS ---

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    // console.log(`🚀 Servidor CRM corriendo en el puerto ${PORT}`);
});
