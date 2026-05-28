require('dotenv').config();

// Desactivar logs de consola para evitar ruido en Railway y ahorrar espacio
console.log = function() {};
console.info = function() {};
console.error = function() {};
console.warn = function() {};

// Evitar que errores no manejados (como el ZIP de RemoteAuth) maten el servidor
process.on('uncaughtException', (err) => {
    waLog.ultimoError = `[${new Date().toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}] ${err.message}`;
});
process.on('unhandledRejection', (reason) => {
    if (reason && reason.message) waLog.ultimoError = `[${new Date().toLocaleString('es-MX',{timeZone:'America/Mexico_City'})}] Rechazo: ${reason.message}`;
});

// Registro de diagnóstico en memoria (sin logs)
const waLog = {
    ultimoError: null,
    ultimaActividad: null,
    ultimoMensaje: null,
    historial: [],
    add(msg) {
        const ts = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        this.historial.unshift(`[${ts}] ${msg}`);
        if (this.historial.length > 30) this.historial.pop();
    }
};
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
const MONGODB_URI = 'mongodb://naisata:Hola2025@ac-6t8mbw2-shard-00-00.kwletg6.mongodb.net:27017,ac-6t8mbw2-shard-00-01.kwletg6.mongodb.net:27017,ac-6t8mbw2-shard-00-02.kwletg6.mongodb.net:27017/naisata_db?ssl=true&replicaSet=atlas-ri4kdo-shard-0&authSource=admin&retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ CRM Conectado a MongoDB exitosamente'))
    .catch(err => console.error('❌ Error conectando a MongoDB desde CRM:', err.message));

// --- Schemas (Específicos para CRM/ERP) ---

// Schemas para lectura cruzada desde la DB principal (Tracking App)
const VehicleTransactionRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    vehicleId: { type: String, ref: 'VehicleRef' }, // String en lugar de ObjectId (migración BD)
    userId: String,
    userName: String,
    tipoMovimiento: String,
    proyectoId: String,
    notas: String,          // Contiene "[Destino CRM: P-003]" cuando viene del bot
    fecha: Date
}, { collection: 'vehicletransactions' });
const VehicleRefSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    placas: String, modelo: String, marca: String, estado: String, destinoSugeridoCRM: String
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

const VehicleTransactionRef = mongoose.model('VehicleTransactionRef', VehicleTransactionRefSchema);
const VehicleRef = mongoose.model('VehicleRef', VehicleRefSchema);
const InvTransactionRef = mongoose.model('InvTransactionRef', InvTransactionRefSchema);
const InvItemRef = mongoose.model('InvItemRef', InvItemRefSchema);
const UserRef = mongoose.model('UserRef', UserRefSchema);

const CRMCotizacionSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    folio: { type: String, unique: true, sparse: true },
    clienteId: String,
    clienteNombre: String,
    vendedorId: String,
    descripcion: String,
    lugarEjecucion: String,
    contacto: String,
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
        marca: String
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
    estado: { type: String, enum: ['Activo', 'Pausado', 'Terminado', 'Cancelado'], default: 'Activo' },
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
    // Buscar el mayor número de folio existente con formato C-NNN
    const cots = await CRMCotizacion.find({ folio: { $regex: /^C-\d+$/ } }).select('folio');
    let maxNum = folioInicio - 1;
    cots.forEach(c => {
        const num = parseInt(c.folio.replace('C-', ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return Math.max(maxNum + 1, folioInicio);
}

// --- API Routes ---

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
        const users = await UserRef.find().select('nombre apellido').sort('nombre');
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
            cot.folio = `C-${String(num).padStart(3, '0')}`;
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
                folioGenerado = `C-${String(num).padStart(3, '0')}`;
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
        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, data, { new: true });
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
        
        const updatedCot = await CRMCotizacion.findByIdAndUpdate(id, { estado: estado }, { new: true });
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
        
        let folioFinal = `P-${String(count + 1).padStart(3, '0')}`;
        
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
        const updatedProy = await CRMProyecto.findByIdAndUpdate(id, data, { new: true });
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
        let archivoUrl = null;
        if (req.file) {
            const archivo = new CRMArchivo({
                nombre: req.file.originalname,
                contentType: req.file.mimetype,
                datos: req.file.buffer.toString('base64'),
                tamanio: req.file.size
            });
            const saved = await archivo.save();
            archivoUrl = `/api/archivos/${saved._id}`;
        }
        
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

app.post('/api/proyectos/:id/avance', upload.array('fotos', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { empleado, porcentaje, comentario, actividadId } = req.body;
        
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
        if (!proj) return res.status(404).send("Proyecto no encontrado");

        // Si se envió el ID de la actividad, verificar que no se haya reportado ya
        if (actividadId) {
            const act = await CRMActividad.findById(actividadId);
            if (act) {
                if (act.avanceReportado) {
                    return res.status(400).send("Ya se reportó un avance para esta tarea.");
                }
                act.avanceReportado = true;
                await act.save();
            }
        }

        const pct = parseInt(porcentaje, 10) || 0;
        
        proj.avances.push({
            empleado,
            porcentaje: pct,
            comentario,
            fotos: fotosUrls
        });
        
        // Sumar el porcentaje reportado al total del proyecto (máximo 100)
        // Eliminado: el avance ahora lo gestiona manualmente el administrador.
        // proj.porcentajeAvance = Math.min(100, (proj.porcentajeAvance || 0) + pct);
        
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

        // Todas las tareas de ese día
        const tareasDelDia = await CRMActividad.find({
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin }
        });

        const vehiculosOcupados = [];
        const empleadosOcupados = [];

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
            const todosEmpleados = [t.asignadoANombre, ...(t.cuadrillaNombres || [])].filter(Boolean);
            todosEmpleados.forEach(nombre => {
                if (empleados.includes(nombre) && !empleadosOcupados.find(x => x.nombre === nombre)) {
                    empleadosOcupados.push({ nombre, tarea: t.descripcion, horaInicio: t.horaInicio, horaFin: t.horaFin });
                }
            });
        });

        // Vehículos bloqueados de Tracking: Prestado O Pendiente de Confirmación
        const bloqueadosTracking = await VehicleRef.find({
            estado: { $in: ['Prestado', 'Pendiente de Confirmación'] }
        }).select('_id estado');

        const vehiculosBloqueados = bloqueadosTracking
            .filter(v => vehiculos.includes(v._id.toString()))
            .map(v => ({ id: v._id.toString(), estado: v.estado }));

        res.json({ vehiculosOcupados, empleadosOcupados, vehiculosBloqueados });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

// Obtener tareas de hoy para un empleado (para portal de empleados)
app.get('/api/empleados/mis-tareas-hoy', async (req, res) => {
    try {
        const { nombre } = req.query;
        if (!nombre) return res.status(400).json({error: 'Falta nombre'});

        // Rango de hoy en UTC
        const hoy = new Date();
        const fechaIso = hoy.toISOString().split('T')[0];
        const diaInicio = new Date(fechaIso + 'T00:00:00.000Z');
        const diaFin   = new Date(fechaIso + 'T23:59:59.999Z');

        // Buscar actividades donde sea asignado (encargado) o esté en cuadrilla
        const tareas = await CRMActividad.find({
            fechaVencimiento: { $gte: diaInicio, $lte: diaFin },
            $or: [
                { asignadoANombre: nombre },
                { cuadrillaNombres: nombre }
            ]
        });

        // Enriquecer con info de vehículos y proyectos (archivos)
        const tareasEnriquecidas = await Promise.all(tareas.map(async (t) => {
            const tObj = t.toObject();
            tObj.isEncargado = t.asignadoANombre === nombre;

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

app.post('/api/actividades', async (req, res) => {
    try {
        const data = req.body;

        // --- Guard: verificar conflictos antes de guardar ---
        if (data.fechaVencimiento) {
            const fecha = new Date(data.fechaVencimiento).toISOString().split('T')[0];
            const diaInicio = new Date(fecha + 'T00:00:00.000Z');
            const diaFin   = new Date(fecha + 'T23:59:59.999Z');
            const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });

            const conflictos = [];
            tareasDelDia.forEach(t => {
                if (!solapan(data.horaInicio || null, data.horaFin || null, t.horaInicio || null, t.horaFin || null)) return;
                (t.vehiculosAsignados || []).forEach(vId => {
                    if ((data.vehiculosAsignados || []).includes(vId))
                        conflictos.push(`Vehículo ocupado en tarea: "${t.descripcion}"`);
                });
                const empleadosNuevos = [data.asignadoANombre, ...(data.cuadrillaNombres || [])].filter(Boolean);
                const empleadosExist  = [t.asignadoANombre,  ...(t.cuadrillaNombres  || [])].filter(Boolean);
                empleadosNuevos.forEach(n => {
                    if (empleadosExist.includes(n))
                        conflictos.push(`Empleado "${n}" ya asignado en: "${t.descripcion}"`);
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
                await VehicleRef.findByIdAndUpdate(vId, { destinoSugeridoCRM: label });
            }
        }

        res.json({ message: 'Actividad creada con éxito', data: newAct });
    } catch(err) { res.status(500).json({error: err.message}); }
});
app.put('/api/actividades/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const updatedAct = await CRMActividad.findByIdAndUpdate(id, data, { new: true });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        
        if (data.vehiculosAsignados && data.vehiculosAsignados.length > 0) {
            let label = data.destinoSugeridoCRMText || data.descripcion || 'Tarea de CRM';
            for (const vId of data.vehiculosAsignados) {
                await VehicleRef.findByIdAndUpdate(vId, { destinoSugeridoCRM: label });
            }
        }
        res.json({ message: 'Actividad actualizada con éxito', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/actividades/:id/estado', async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        const updatedAct = await CRMActividad.findByIdAndUpdate(id, { estado }, { new: true });
        if (!updatedAct) return res.status(404).json({ error: 'Actividad no encontrada' });
        res.json({ message: 'Estado actualizado', data: updatedAct });
    } catch(err) { res.status(500).json({ error: err.message }); }
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
const { MongoStore } = require('wwebjs-mongo');
const QRCode = require('qrcode');

const waSessions = new Map();
let waCurrentQR = null;
let waStatus = 'DESCONECTADO';
let waReady = false;
let waClient = null;

// Directorio temporal para los ZIP de sesión de RemoteAuth.
// /tmp siempre tiene permisos de escritura en Railway y contenedores Linux.
const WA_DATA_PATH = '/tmp/wa-sessions';
try { fs.mkdirSync(WA_DATA_PATH, { recursive: true }); } catch(_) {}

const initWhatsApp = () => {
    console.log('Iniciando RemoteAuth con MongoDB...');
    const store = new MongoStore({ mongoose: mongoose });
    
    waClient = new Client({
        authStrategy: new RemoteAuth({
            clientId: 'nais-crm',
            store: store,
            backupSyncIntervalMs: 300000,
            dataPath: WA_DATA_PATH
        }),
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1040156871-alpha.html',
        },
        puppeteer: {
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',         // Reduce memory usage on Railway
                '--disable-extensions'
            ],
            protocolTimeout: 120000,        // 2 minutes - prevents callFunctionOn timeout
            timeout: 120000
        }
    });

    waClient.on('qr', (qr) => {
        waCurrentQR = qr;
        waStatus = 'ESPERANDO_ESCANEO';
        waLog.add('📱 QR generado - esperando escaneo');
    });

    waClient.on('ready', () => {
        waCurrentQR = null;
        waStatus = 'CONECTADO';
        waReady = true;
        waLog.ultimaActividad = new Date();
        waLog.add('✅ Bot conectado y listo');
    });

    waClient.on('disconnected', (reason) => {
        waStatus = 'DESCONECTADO';
        waReady = false;
        waLog.add(`❌ Desconectado: ${reason}`);
        waLog.ultimoError = `Desconectado: ${reason}`;
        
        // Auto-reconectar después de 10 segundos
        waLog.add('🔄 Reconectando en 10 segundos...');
        setTimeout(() => {
            try {
                waLog.add('🔄 Intentando reconexión automática...');
                waClient.initialize();
            } catch(e) {
                waLog.ultimoError = `Error reconectando: ${e.message}`;
            }
        }, 10000);
    });

    waClient.on('auth_failure', (msg) => {
        waStatus = 'ERROR_AUTH';
        waReady = false;
        waLog.add(`🔐 Error de autenticación: ${msg}`);
        waLog.ultimoError = `Auth failure: ${msg}`;
    });

// Endpoint para ver el QR como imagen desde el navegador
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

// Panel de diagnóstico en tiempo real
app.get('/whatsapp/status', (req, res) => {
    const ahora = new Date();
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime/3600), m = Math.floor((uptime%3600)/60), s = uptime%60;
    const statusColor = waStatus === 'CONECTADO' ? '#4ade80' : waStatus === 'ESPERANDO_ESCANEO' ? '#f59e0b' : '#f87171';
    const statusIcon = waStatus === 'CONECTADO' ? '✅' : waStatus === 'ESPERANDO_ESCANEO' ? '⏳' : '❌';
    const ultimaAct = waLog.ultimaActividad ? waLog.ultimaActividad.toLocaleString('es-MX',{timeZone:'America/Mexico_City'}) : 'Nunca';
    const historialHTML = waLog.historial.map(l => `<div style="padding:4px 0;border-bottom:1px solid #1e293b;font-size:0.85rem">${l}</div>`).join('') || '<div style="color:#64748b">Sin actividad registrada</div>';
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NAIS Bot - Status</title><meta http-equiv="refresh" content="15"><style>body{background:#0f172a;font-family:sans-serif;color:#e2e8f0;padding:30px;margin:0}h1{color:#6366f1;margin-bottom:5px}.card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:15px}.label{color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.value{font-size:1.1rem;font-weight:600}.status-badge{display:inline-block;padding:6px 16px;border-radius:99px;font-weight:700;font-size:1rem;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}}.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px}.historial{max-height:300px;overflow-y:auto}.refresh{color:#64748b;font-size:0.75rem;margin-top:20px;text-align:center}</style></head><body><h1>🤖 NAIS Bot - Panel de Estado</h1><p style="color:#64748b;margin-top:0">Se actualiza automáticamente cada 15 segundos</p><div class="card"><div class="label">Estado del Bot</div><div style="margin-top:8px"><span class="status-badge">${statusIcon} ${waStatus}</span></div></div><div class="grid"><div class="card"><div class="label">Uptime del Servidor</div><div class="value">${h}h ${m}m ${s}s</div></div><div class="card"><div class="label">Última Conexión</div><div class="value" style="font-size:0.9rem">${ultimaAct}</div></div><div class="card"><div class="label">Último Mensaje</div><div class="value" style="font-size:0.9rem">${waLog.ultimoMensaje || 'Ninguno'}</div></div></div>${waLog.ultimoError ? `<div class="card" style="border:1px solid #f8717133"><div class="label" style="color:#f87171">⚠️ Último Error</div><div style="color:#f87171;margin-top:4px;font-size:0.9rem">${waLog.ultimoError}</div></div>` : ''}<div class="card"><div class="label">Historial de Eventos (últimos 30)</div><div class="historial" style="margin-top:10px">${historialHTML}</div></div>${waStatus !== 'CONECTADO' ? '<div style="text-align:center;margin-top:15px"><a href="/whatsapp/qr" style="background:#6366f1;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600">📱 Ir a escanear QR</a></div>' : ''}</body></html>`);
});


// Endpoint para cerrar sesión y cambiar de número de WhatsApp
app.get('/whatsapp/reset', async (req, res) => {
    try {
        if (waClient) {
            await waClient.logout();
            waReady = false;
            waStatus = 'DESCONECTADO';
            res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#4ade80"><h1>✅ Sesión cerrada exitosamente</h1><p>Se ha borrado la sesión actual de la base de datos.<br><br><b>Reinicia tu servidor en Railway</b> y luego visita <b>/whatsapp/qr</b> para escanear con tu nuevo número.</p></body></html>`);
        } else {
            res.send('El cliente de WhatsApp no está inicializado.');
        }
    } catch(e) {
        res.status(500).send('Error al cerrar sesión: ' + e.message);
    }
});

async function sendWhatsAppMessage(to, body) {
    if (!waReady) {
        waLog.add('⚠️ Intentó enviar mensaje pero WhatsApp no está listo');
        await new Promise(r => setTimeout(r, 3000));
    }
    try {
        // Limpiar el número (quitar espacios, guiones, etc)
        let cleanPhone = to.replace(/\D/g, '');
        // Si el número tiene 10 dígitos (formato México local), agregar 521
        if (cleanPhone.length === 10) cleanPhone = `521${cleanPhone}`;
        // Si tiene 12 dígitos y empieza con 52 pero sin el 1 de celular, agregarlo (opcional, WhatsApp a veces acepta 52)
        if (cleanPhone.length === 12 && cleanPhone.startsWith('52')) cleanPhone = `521${cleanPhone.substring(2)}`;
        
        const chatId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;
        await waClient.sendMessage(chatId, body);
        waLog.add(`✅ Notificación enviada a ${chatId}`);
    } catch (e) {
        waLog.ultimoError = `[Enviando a ${to}]: ${e.message}`;
        waLog.add(`❌ Error notificando a ${to}: ${e.message.substring(0,50)}`);
    }
}

const waMessageHandler = async message => {
    try {
        const From = message.from; 
        const Body = message.body;

        if (!Body || !From || From.includes('@g.us') || From === 'status@broadcast') return; // ignorar grupos y estados

        // Registrar actividad
        waLog.ultimoMensaje = new Date().toLocaleString('es-MX', {timeZone:'America/Mexico_City'});
        waLog.ultimaActividad = new Date();
        waLog.add(`💬 Mensaje de ${From.replace('@c.us','')}: "${Body.substring(0,40)}${Body.length>40?'...':''}"`);

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

        const text = Body.trim().toLowerCase();
        
        if (!waSessions.has(From)) {
            waSessions.set(From, { state: 'IDLE', ctx: {} });
        }
        const s = waSessions.get(From);
        
        // Cancelación Global
        if (text === 'cancelar' || text === 'salir' || text === 'reiniciar') {
            waSessions.set(From, { state: 'IDLE', ctx: {} });
            await reply("Operación cancelada. ¿En qué más te puedo ayudar?");
            return;
        }

        if (s.state === 'IDLE') {
            const esLevantamiento = text.includes('levantamiento');
            const esCita = text.includes('cita') || text.includes('junta') || text.includes('reunion') || text.includes('reunión');
            const esTarea = text.includes('tarea') || text.includes('actividad') || text.includes('asignar');
            
            if (esLevantamiento || esCita) {
                s.state = 'WAITING_DATE';
                s.ctx.type = esLevantamiento ? 'Levantamiento' : 'Junta';
                await reply(`📅 Claro, vamos a agendar tu ${s.ctx.type}.\n\n¿Para qué fecha lo necesitas? (Ej: Mañana, El viernes, 12 de octubre)`);
            } else if (esTarea) {
                s.state = 'WAITING_TAREA_DESC';
                await reply(`🛠️ Vamos a asignar una *Nueva Tarea*.\n\n¿Cuál es la descripción o nombre de la actividad?`);
            } else {
                await reply("🤖 ¡Hola! Soy NAIS desde tu CRM.\n\nPuedo ayudarte a:\n- Agendar *juntas* o *levantamientos*\n- Asignar *tareas* al equipo\n\n¿Qué deseas hacer?");
            }
        } else if (s.state === 'WAITING_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TIME';
            await reply(`Perfecto, anotado para: *${s.ctx.dateStr}*.\n\n¿A qué hora sería?\n(Si no hay hora definida, responde "ninguna")`);
        } else if (s.state === 'WAITING_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_DESC';
            await reply(`Enterado.\n\n¿Cuál es la descripción, el cliente o el proyecto de este ${s.ctx.type}?`);
        } else if (s.state === 'WAITING_DESC') {
            s.ctx.desc = Body.trim();
            
            // Obtener fecha actual en la zona horaria de México para evitar desfase de UTC (ej. si es 23:58 local, el servidor en UTC ya es mañana)
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            if (s.ctx.dateStr.toLowerCase().includes('mañana') || s.ctx.dateStr.toLowerCase().includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            } else if (s.ctx.dateStr.toLowerCase().includes('pasado')) {
                fecha.setDate(fecha.getDate() + 2);
            }
            
            try {
                const ev = new CRMEvento({
                    tipo: s.ctx.type,
                    titulo: `[WA] ${s.ctx.type} - ${s.ctx.desc}`,
                    descripcion: `Hora solicitada: ${s.ctx.timeStr} | Fecha indicada: ${s.ctx.dateStr}\n(Agendado vía WhatsApp)`,
                    fechaInicio: fecha,
                    fechaFin: new Date(fecha.getTime() + 60*60*1000)
                });
                await ev.save();
                await reply(`✅ ¡Listo! Tu ${s.ctx.type} ha sido agendado en el CRM exitosamente.\n\n*Detalles:*\n📝 ${s.ctx.desc}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr}\n\nPara agendar algo más, solo escríbeme.`);
            } catch(e) {
                console.error('Error guardando evento WA:', e);
                await reply(`Ocurrió un error al guardar. Intenta de nuevo diciendo "cancelar".`);
            }
            waSessions.set(From, { state: 'IDLE', ctx: {} });
        } 
        // --- FLUJO TAREAS ---
        else if (s.state === 'WAITING_TAREA_DESC') {
            s.ctx.desc = Body.trim();
            s.state = 'WAITING_TAREA_DATE';
            await reply(`📝 Tarea: *${s.ctx.desc}*\n\n¿Para qué fecha es la tarea? (Ej: Mañana, hoy, 25/05/2026)`);
        } else if (s.state === 'WAITING_TAREA_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME';
            await reply(`🗓️ Fecha: *${s.ctx.dateStr}*\n\n¿A qué hora *Inicia*? (Formato 24h, ej: 09:00 o 14:30)`);
        } else if (s.state === 'WAITING_TAREA_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME_END';
            await reply(`⏰ Inicio: ${s.ctx.timeStr}\n\n¿A qué hora *Termina*? (Ej: 13:00). Si no tiene fin, responde "no".`);
        } else if (s.state === 'WAITING_TAREA_TIME_END') {
            s.ctx.timeEndStr = Body.trim().toLowerCase() === 'no' ? null : Body.trim();
            
            // Calc Date
            let mxTimeStr = new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" });
            let fecha = new Date(mxTimeStr);
            if (s.ctx.dateStr.toLowerCase().includes('mañana') || s.ctx.dateStr.toLowerCase().includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            } else if (s.ctx.dateStr.toLowerCase().includes('pasado')) {
                fecha.setDate(fecha.getDate() + 2);
            }
            s.ctx.parsedFecha = fecha;
            
            const fechaBase = fecha.toISOString().split('T')[0];
            const diaInicio = new Date(fechaBase + 'T00:00:00.000Z');
            const diaFin   = new Date(fechaBase + 'T23:59:59.999Z');
            
            try {
                const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });
                let ocupados = [];
                let vehOcupados = [];
                tareasDelDia.forEach(t => {
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, t.horaInicio || null, t.horaFin || null)) return;
                    if (t.asignadoANombre) ocupados.push(t.asignadoANombre);
                    if (t.cuadrillaNombres) ocupados.push(...t.cuadrillaNombres);
                    if (t.vehiculosAsignados) vehOcupados.push(...t.vehiculosAsignados);
                });
                
                const allUsers = await UserRef.find();
                const allVehs = await VehicleRef.find();
                
                const disponiblesStr = allUsers.filter(u => !ocupados.some(o => o && o.toLowerCase().includes(u.nombre.toLowerCase()))).map(u => u.nombre).join(', ');
                const vehDisponibles = allVehs.filter(v => !vehOcupados.includes(v._id.toString()) && v.estado !== 'Prestado').map(v => v.modelo).join(', ');
                
                s.state = 'WAITING_TAREA_ENCARGADO';
                await reply(`📊 *RECURSOS DISPONIBLES*\n\n👥 *Personal:* ${disponiblesStr || 'Ninguno'}\n🚗 *Vehículos:* ${vehDisponibles || 'Ninguno'}\n\n👤 ¿Quién será el *ENCARGADO* de esta tarea?`);
            } catch(e) {
                console.error(e);
                await reply('Error consultando recursos.');
                waSessions.set(From, { state: 'IDLE', ctx: {} });
            }
        } else if (s.state === 'WAITING_TAREA_ENCARGADO') {
            s.ctx.encargado = Body.trim();
            s.state = 'WAITING_TAREA_ACOMPANANTES';
            await reply(`👥 ¿Quiénes van de *ACOMPAÑANTES*?\n(Escribe los nombres separados por coma, o "ninguno")`);
        } else if (s.state === 'WAITING_TAREA_ACOMPANANTES') {
            const b = Body.trim().toLowerCase();
            s.ctx.acompanantes = (b === 'ninguno' || b === 'no') ? [] : Body.trim().split(',').map(x => x.trim());
            s.state = 'WAITING_TAREA_VEHICULOS';
            await reply(`🚗 ¿Qué *VEHÍCULOS* se usarán?\n(Escribe los modelos separados por coma, o "ninguno")`);
        } else if (s.state === 'WAITING_TAREA_VEHICULOS') {
            s.ctx.vehiculosTxt = Body.trim().toLowerCase();
            s.state = 'WAITING_TAREA_PROYECTO';
            await reply(`🏗️ ¿Deseas vincularla a un *PROYECTO o CLIENTE* activo?\n(Escribe el folio/nombre, o "no")`);
        } else if (s.state === 'WAITING_TAREA_PROYECTO') {
            const b = Body.trim().toLowerCase();
            s.ctx.proyecto = (b === 'no' || b === 'ninguno') ? null : Body.trim();
            
            // Resolve Vehicles
            let vehIds = [];
            if (s.ctx.vehiculosTxt !== 'ninguno' && s.ctx.vehiculosTxt !== 'no') {
                const allVehs = await VehicleRef.find();
                const vnames = s.ctx.vehiculosTxt.split(',').map(x => x.trim().toLowerCase());
                vnames.forEach(vn => {
                    const found = allVehs.find(v => v.modelo.toLowerCase().includes(vn) || (v.placas && v.placas.toLowerCase().includes(vn)));
                    if (found) vehIds.push(found._id.toString());
                });
            }
            
            try {
                const nTarea = new CRMActividad({
                    descripcion: s.ctx.desc,
                    asignadoANombre: s.ctx.encargado,
                    cuadrillaNombres: s.ctx.acompanantes,
                    vehiculosAsignados: vehIds,
                    proyectoId: s.ctx.proyecto || '',
                    estado: 'Pendiente',
                    fechaVencimiento: s.ctx.parsedFecha,
                    horaInicio: s.ctx.timeStr,
                    horaFin: s.ctx.timeEndStr,
                    tipoDestino: s.ctx.proyecto ? 'Proyecto vinculado' : 'Asignación vía WhatsApp'
                });
                await nTarea.save();

                await reply(`✅ *TAREA CREADA EXITOSAMENTE*\n\n📋 ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n👥 Acompañantes: ${s.ctx.acompanantes.join(', ') || 'Ninguno'}\n🚗 Vehículos: ${s.ctx.vehiculosTxt}\n🏗️ Proyecto: ${s.ctx.proyecto || 'Ninguno'}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr} - ${s.ctx.timeEndStr || 'Sin hora fin'}\n\nEnviando notificaciones al personal...`);
                
                // NOTIFICACIONES WHATSAPP
                const allUsers = await UserRef.find();
                
                const findPhone = (name) => {
                    const u = allUsers.find(x => x.nombre && x.nombre.toLowerCase().includes(name.toLowerCase()));
                    return u && u.telefono ? u.telefono : null;
                };

                const telEncargado = findPhone(s.ctx.encargado);
                if (telEncargado) {
                    const msgEncargado = `🚨 *NUEVA TAREA ASIGNADA (Encargado)* 🚨\n\n📋 Tarea: ${s.ctx.desc}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}\n👥 Te acompañan: ${s.ctx.acompanantes.join(', ') || 'Nadie'}\n🚗 Vehículo(s): ${s.ctx.vehiculosTxt}\n🏗️ Proyecto/Cliente: ${s.ctx.proyecto || 'No vinculado'}`;
                    await sendWhatsAppMessage(telEncargado, msgEncargado);
                }
                
                for (let ac of s.ctx.acompanantes) {
                    const telAc = findPhone(ac);
                    if (telAc) {
                        const msgAc = `🔔 *NUEVA TAREA ASIGNADA (Acompañante)* 🔔\n\n📋 Tarea: ${s.ctx.desc}\n👤 Encargado: ${s.ctx.encargado}\n📅 Fecha: ${s.ctx.dateStr}\n🕒 Horario: ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}`;
                        await sendWhatsAppMessage(telAc, msgAc);
                    }
                }
                
            } catch (e) {
                console.error('Error guardando tarea WA:', e);
                await reply(`❌ Error al crear la tarea. Intenta de nuevo.`);
            }
            waSessions.set(From, { state: 'IDLE', ctx: {} });
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

// Favicon (evitar 404 en el log)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    // console.log(`🚀 Servidor CRM corriendo en el puerto ${PORT}`);
});
