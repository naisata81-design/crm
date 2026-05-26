require('dotenv').config();
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
const MONGODB_URI = 'mongodb://naisata:Hola2025@ac-gt3ul3j-shard-00-00.vjplkwp.mongodb.net:27017,ac-gt3ul3j-shard-00-01.vjplkwp.mongodb.net:27017,ac-gt3ul3j-shard-00-02.vjplkwp.mongodb.net:27017/naisata_db?ssl=true&replicaSet=atlas-wpn2mu-shard-0&authSource=admin&retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
    // .then(() => console.log('✅ CRM Conectado a MongoDB exitosamente'))
    .catch(err => console.error('❌ Error conectando a MongoDB desde CRM:', err));

// --- Schemas (Específicos para CRM/ERP) ---

// Schemas para lectura cruzada desde la DB principal (Tracking App)
const VehicleTransactionRefSchema = new mongoose.Schema({
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'VehicleRef' },
    userName: String,
    tipoMovimiento: String,
    proyectoId: String,
    fecha: Date
}, { collection: 'vehicletransactions' });
const VehicleRefSchema = new mongoose.Schema({
    placas: String, modelo: String, marca: String, destinoSugeridoCRM: String
}, { collection: 'vehicles' });
const InvTransactionRefSchema = new mongoose.Schema({
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvItemRef' },
    tipoMovimiento: String, cantidad: Number, responsable: String, proyectoId: String, fecha: Date
}, { collection: 'inventorytransactions' });
const InvItemRefSchema = new mongoose.Schema({
    nombre: String, tipo: String
}, { collection: 'inventoryitems' });
const UserRefSchema = new mongoose.Schema({
    nombre: String, apellido: String
}, { collection: 'users' });

const VehicleTransactionRef = mongoose.model('VehicleTransactionRef', VehicleTransactionRefSchema);
const VehicleRef = mongoose.model('VehicleRef', VehicleRefSchema);
const InvTransactionRef = mongoose.model('InvTransactionRef', InvTransactionRefSchema);
const InvItemRef = mongoose.model('InvItemRef', InvItemRefSchema);
const UserRef = mongoose.model('UserRef', UserRefSchema);

const CRMCotizacionSchema = new mongoose.Schema({
    folio: String,
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
    proyectoActivoId: String // Se llena cuando se aprueba y pasa a ERP
});
const CRMCotizacion = mongoose.model('CRMCotizacion', CRMCotizacionSchema);

const CRMProyectoSchema = new mongoose.Schema({
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
    nombre: String,
    contentType: String,
    datos: String, // Base64
    tamanio: Number,
    fechaSubida: { type: Date, default: Date.now }
});
const CRMArchivo = mongoose.model('CRMArchivo', CRMArchivoSchema);

const CRMActividadSchema = new mongoose.Schema({
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
        // Generar folio usando el número configurado
        if (!data.folio || data.folio.trim() === '' || data.folio === 'Sin folio') {
            const num = await getNextFolioNumber();
            data.folio = `C-${String(num).padStart(3, '0')}`;
        }
        
        const newCotizacion = new CRMCotizacion(data);
        await newCotizacion.save();
        res.json({ message: 'Cotización creada con éxito', data: newCotizacion });
    } catch(err) { 
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
        }
        
        if (proj.nombre && proj.nombre.trim() !== '') {
            // Escape special chars from project name for regex safety, just in case
            const safeSearch = proj.nombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
        } else if (proj.clienteNombre && proj.clienteNombre.trim() !== '') {
            const safeSearch = proj.clienteNombre.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            orConditions.push({ proyectoId: { $regex: safeSearch, $options: 'i' } });
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
        const actividadesProy = await CRMActividad.find({
            $or: [
                { proyectoId: proj._id.toString() },
                { proyectoId: proj.folio },
                { proyectoId: { $regex: (proj.nombre||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } }
            ]
        });

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
// INTEGRACION WHATSAPP CLOUD API - NAIS BOT
// ==========================================
const axios = require('axios');
const waToken = 'EAAToSuEDcpoBRvF1zCexZAlV1hqXggWpZBj34ay01MNSENvwzqXPJ91x18JA6tqKZAh0PVj0PRHvpAiZA0BV7kxR8ePE7ZA1OpfD5sgmhzfhiHrtZBZB8I2BonDOhT1C1vth4pRsGDWnegP7qObqvoHQ70uZCg4MczL6A0dgZAxZAlZCStSEKfZBffIxMegwrMBUiAZDZD';
const waPhoneNumberId = '1192425800610427';
const waVerifyToken = 'nais_crm_secreto_2026'; // Úsalo al configurar el Webhook en Meta

const waSessions = new Map();

async function sendWhatsAppMessage(to, body) {
    try {
        await axios.post(`https://graph.facebook.com/v19.0/${waPhoneNumberId}/messages`, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: body }
        }, {
            headers: {
                'Authorization': `Bearer ${waToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (e) {
        console.error('Error enviando mensaje de WhatsApp:', e.response ? e.response.data : e.message);
    }
}

// Validación del Webhook por parte de Meta
app.get('/api/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === waVerifyToken) {
            console.log('✅ Webhook verificado por Meta');
            res.status(200).send(challenge);
        } else {
            res.status(403).send('Forbidden');
        }
    } else {
        res.status(400).send('Bad Request');
    }
});

app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
        const body = req.body;

        // Comprobar que es un evento de WhatsApp API
        if (!body.object || body.object !== 'whatsapp_business_account') {
            return res.status(200).send('OK');
        }

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;
        
        // Si no hay mensajes (pueden ser actualizaciones de estado de mensajes), ignorar
        if (!messages || messages.length === 0) {
            return res.status(200).send('OK');
        }

        const message = messages[0];
        
        // Ignorar mensajes que no sean de texto
        if (message.type !== 'text') {
             return res.status(200).send('OK');
        }

        const From = message.from; 
        const Body = message.text.body;

        if (!Body || !From) return res.status(200).send('OK');

        const text = Body.trim().toLowerCase();
        
        // Obtener estado conversacional del usuario
        if (!waSessions.has(From)) {
            waSessions.set(From, { state: 'IDLE', ctx: {} });
        }
        const s = waSessions.get(From);
        
        // Rutina de Cancelación Global
        if (text === 'cancelar' || text === 'salir' || text === 'reiniciar') {
            waSessions.set(From, { state: 'IDLE', ctx: {} });
            await sendWhatsAppMessage(From, "Operación cancelada. ¿En qué más te puedo ayudar?");
            return res.status(200).send('OK');
        }

        if (s.state === 'IDLE') {
            const esLevantamiento = text.includes('levantamiento');
            const esCita = text.includes('cita') || text.includes('junta') || text.includes('reunion') || text.includes('reunin');
            const esTarea = text.includes('tarea') || text.includes('actividad') || text.includes('asignar');
            
            if (esLevantamiento || esCita) {
                s.state = 'WAITING_DATE';
                s.ctx.type = esLevantamiento ? 'Levantamiento' : 'Junta';
                await sendWhatsAppMessage(From, `📅 Claro, vamos a agendar tu ${s.ctx.type}. \n\n¿Para qué fecha lo necesitas? (Ej: Mañana, El viernes, 12 de octubre)`);
            } else if (esTarea) {
                s.state = 'WAITING_TAREA_DESC';
                await sendWhatsAppMessage(From, `🛠️ Vamos a asignar una *Nueva Tarea*. \n\n¿Cuál es la descripción o nombre de la actividad?`);
            } else {
                await sendWhatsAppMessage(From, "🤖 ¡Hola! Soy NAIS desde tu CRM. Puedo ayudarte a agendar citas, levantamientos y asignar nuevas tareas directamente desde WhatsApp.\n\n¿Qué deseas hacer?");
            }
        } else if (s.state === 'WAITING_DATE') {
            s.ctx.dateStr = Body.trim(); // Guardamos formato original
            s.state = 'WAITING_TIME';
            await sendWhatsAppMessage(From, `Perfecto, anotado para: *${s.ctx.dateStr}*.\n\n¿A qué hora sería? \n(Si es todo el día o no hay hora, responde "ninguna")`);
        } else if (s.state === 'WAITING_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_DESC';
            await sendWhatsAppMessage(From, `Enterado. \n\n¿Cuál es la descripción, el cliente o el proyecto de este ${s.ctx.type}?`);
        } else if (s.state === 'WAITING_DESC') {
            s.ctx.desc = Body.trim();
            
            // Finalizar y crear evento
            let fecha = new Date(); // Base 
            
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
                await sendWhatsAppMessage(From, `✅ ¡Listo! Tu ${s.ctx.type} ha sido agendado en el CRM exitosamente.\n\n*Detalles:*\n📝 ${s.ctx.desc}\n📅 ${s.ctx.dateStr}\n🕒 ${s.ctx.timeStr}\n\nPara agendar algo más o cancelar, solo escríbeme.`);
            } catch(e) {
                console.error('Error guardando evento WA:', e);
                await sendWhatsAppMessage(From, `Ocurrió un error al intentar guardar en el CRM. Por favor, intenta de nuevo diciendo "cancelar".`);
            }
            waSessions.set(From, { state: 'IDLE', ctx: {} });
        } 
        // --- FLUJO TAREAS ---
        else if (s.state === 'WAITING_TAREA_DESC') {
            s.ctx.desc = Body.trim();
            s.state = 'WAITING_TAREA_DATE';
            await sendWhatsAppMessage(From, `📝 Tarea: ${s.ctx.desc}\n\n¿Para qué fecha es la tarea? (Ej: Mañana, hoy, 25/05/2026)`);
        } else if (s.state === 'WAITING_TAREA_DATE') {
            s.ctx.dateStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME';
            await sendWhatsAppMessage(From, `🗓️ Fecha: ${s.ctx.dateStr}\n\n¿A qué hora *Inicia*? (Formato 24h, ej: 09:00 o 14:30)`);
        } else if (s.state === 'WAITING_TAREA_TIME') {
            s.ctx.timeStr = Body.trim();
            s.state = 'WAITING_TAREA_TIME_END';
            await sendWhatsAppMessage(From, `⏰ Inicio: ${s.ctx.timeStr}\n\n¿A qué hora *Termina*? (Ej: 13:00). Si no tiene fin definido, responde "no".`);
        } else if (s.state === 'WAITING_TAREA_TIME_END') {
            s.ctx.timeEndStr = Body.trim().toLowerCase() === 'no' ? null : Body.trim();
            s.state = 'WAITING_TAREA_PERSON';
            await sendWhatsAppMessage(From, `👤 ¿A quién le vamos a asignar esta tarea? (Escribe el nombre del trabajador, ej: Daniel, Jacqueline)`);
        } else if (s.state === 'WAITING_TAREA_PERSON') {
            s.ctx.person = Body.trim();
            
            let fecha = new Date();
            if (s.ctx.dateStr.toLowerCase().includes('mañana') || s.ctx.dateStr.toLowerCase().includes('manana')) {
                fecha.setDate(fecha.getDate() + 1);
            } else if (s.ctx.dateStr.toLowerCase().includes('pasado')) {
                fecha.setDate(fecha.getDate() + 2);
            }
            
            const fechaBase = fecha.toISOString().split('T')[0];
            const diaInicio = new Date(fechaBase + 'T00:00:00.000Z');
            const diaFin   = new Date(fechaBase + 'T23:59:59.999Z');
            
            try {
                const tareasDelDia = await CRMActividad.find({ fechaVencimiento: { $gte: diaInicio, $lte: diaFin } });
                const conflictos = [];
                
                tareasDelDia.forEach(t => {
                    if (!solapan(s.ctx.timeStr || null, s.ctx.timeEndStr || null, t.horaInicio || null, t.horaFin || null)) return;
                    const empleadosExist = [t.asignadoANombre, ...(t.cuadrillaNombres || [])].filter(Boolean);
                    
                    const personLower = s.ctx.person.toLowerCase();
                    if (empleadosExist.some(emp => emp.toLowerCase().includes(personLower))) {
                        conflictos.push(`El empleado "${s.ctx.person}" ya tiene la tarea: "${t.descripcion}" (De ${t.horaInicio} a ${t.horaFin || '?'})`);
                    }
                });

                if (conflictos.length > 0) {
                    await sendWhatsAppMessage(From, `⚠️ *ALERTA DE CONFLICTO*\n\nNo se pudo asignar la tarea porque se detectó sobreposición de horarios:\n\n${conflictos.join('\n')}\n\n*Operación cancelada.* Puedes intentar asignar la tarea en otro horario mandando "asignar tarea".`);
                    waSessions.set(From, { state: 'IDLE', ctx: {} });
                    return res.status(200).send('OK');
                }

                const nTarea = new CRMActividad({
                    descripcion: s.ctx.desc,
                    asignadoANombre: s.ctx.person,
                    estado: 'Pendiente',
                    fechaVencimiento: fecha,
                    horaInicio: s.ctx.timeStr,
                    horaFin: s.ctx.timeEndStr,
                    tipoDestino: 'Asignación vía WhatsApp'
                });
                await nTarea.save();

                await sendWhatsAppMessage(From, `✅ *TAREA ASIGNADA CON ÉXITO*\nSe ha creado la tarea en el CRM sin conflictos.\n\n*Descripción:* ${s.ctx.desc}\n*Encargado:* ${s.ctx.person}\n*Fecha:* ${s.ctx.dateStr}\n*Horario:* ${s.ctx.timeStr} a ${s.ctx.timeEndStr || 'No definido'}\n\n¿En qué más te ayudo?`);

            } catch (e) {
                console.error('Error guardando tarea WA:', e);
                await sendWhatsAppMessage(From, `❌ Ocurrió un error al intentar crear la tarea. Intenta de nuevo.`);
            }
            waSessions.set(From, { state: 'IDLE', ctx: {} });
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error('Error procesando webhook de WhatsApp:', err);
        res.status(200).send('OK'); // Siempre responder 200 a Meta para que no reintenten infinitamente
    }
});

// Favicon (evitar 404 en el log)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    // console.log(`🚀 Servidor CRM corriendo en el puerto ${PORT}`);
});
