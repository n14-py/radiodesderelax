require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process'); // Usamos 'spawn' para tener mejor control de FFmpeg
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080; // Render usará este puerto

// --- Variables de Entorno (¡Debes configurarlas en Render!) ---
const {
    PLAYLIST_URL,       // La "URL Mágica" de tu API Central (Servidor A)
    RTMP_URL,           // La URL de Desdeparaguay
    INTERNAL_API_KEY    // La clave secreta entre A y B
} = process.env;

// Esta es la ruta al archivo físico local que FFmpeg estará leyendo
const LOCAL_PLAYLIST_PATH = path.join(__dirname, 'playlist.txt');

// Variable global para guardar el proceso de FFmpeg y poder "matarlo"
let ffmpegProcess = null;

/**
 * Inicia el proceso de FFmpeg.
 * Esta función es el "Músico".
 */
function startFfmpeg() {
    // Verificamos que las variables de entorno estén cargadas
    if (!RTMP_URL || !PLAYLIST_URL) {
        console.error("❌ ERROR FATAL: 'RTMP_URL' o 'PLAYLIST_URL' no están definidas. El stream no puede iniciar.");
        // No iniciamos FFmpeg si faltan URLs clave
        return; 
    }
    
    console.log("-----------------------------------------");
    console.log(`🚀 Iniciando FFmpeg...`);
    console.log(`Leyendo playlist local: ${LOCAL_PLAYLIST_PATH}`);
    console.log(`Transmitiendo a: ${RTMP_URL}`);
    console.log("-----------------------------------------");

    // --- ¡AQUÍ ESTÁ LA CORRECCIÓN! ---
    // El orden de los argumentos es el correcto,
    // coincidiendo con el comando que te pasaron.
    const args = [
        '-re',
        '-f', 'concat',
        '-safe', '0',
        '-protocol_whitelist', 'file,http,https,tcp,tls',
        '-stream_loop', '-1', // <-- ¡CORREGIDO! Opción de entrada (ANTES de -i)
        '-i', LOCAL_PLAYLIST_PATH, // <-- Archivo de entrada

        // Opciones de salida (las que te pasaron)
        '-c:a', 'aac',
        '-b:a', '128k',
        '-vn', // <-- Añadido -vn (sin video) como en tu comando original
        '-f', 'flv',
        RTMP_URL
    ];
    // --- FIN DE LA CORRECCIÓN ---

    // Lanzamos FFmpeg
    ffmpegProcess = spawn('ffmpeg', args);

    // Capturamos los logs de FFmpeg para verlos en Render
    ffmpegProcess.stdout.on('data', (data) => {
        console.log(`[FFmpeg STDOUT]: ${data}`);
    });

    ffmpegProcess.stderr.on('data', (data) => {
        // Los logs de progreso de FFmpeg (time=, bitrate=) salen por stderr
        // Usamos .toString() para que se muestren limpios en los logs de Render
        console.log(`[FFmpeg]: ${data.toString()}`);
    });

    // Manejo de reinicio: Si FFmpeg muere, lo reiniciamos
    ffmpegProcess.on('close', (code) => {
        // Solo reinicia si 'ffmpegProcess' no es 'null'
        // (si es 'null', significa que lo detuvimos manualmente con el botón)
        if (ffmpegProcess) { 
             console.warn(`⚠️ FFmpeg se detuvo inesperadamente (código ${code}). Reiniciando en 5 segundos...`);
             setTimeout(startFfmpeg, 5000); // Reiniciar automáticamente
        }
    });

    ffmpegProcess.on('error', (err) => {
        console.error('❌ Error fatal al iniciar FFmpeg:', err);
    });
}

/**
 * Detiene el proceso de FFmpeg de forma controlada.
 */
function stopFfmpeg() {
    if (ffmpegProcess) {
        console.log("🛑 Deteniendo proceso actual de FFmpeg...");
        // Quitamos el listener 'close' para evitar que se reinicie solo
        ffmpegProcess.removeAllListeners('close'); 
        ffmpegProcess.kill('SIGINT'); // Envía señal de interrupción
        ffmpegProcess = null; // Marcamos como nulo para que no se reinicie
        console.log("Proceso FFmpeg detenido manualmente.");
    }
}

// --- Middleware de seguridad ---
app.use(express.json());
app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === INTERNAL_API_KEY) {
        next();
    } else {
        console.warn("Intento de acceso RECHAZADO (clave incorrecta)");
        res.status(403).json({ error: "Acceso no autorizado" });
    }
});

/**
 * ¡LA RUTA DE ACTUALIZACIÓN MANUAL!
 * Tu Servidor A llamará a esta ruta.
 */
app.post('/actualizar-playlist', async (req, res) => {
    console.log("=========================================");
    console.log("📥 ¡Orden de actualización recibida desde Servidor A!");
    
    if (!PLAYLIST_URL) {
        console.error("❌ ERROR: PLAYLIST_URL no definida.");
        return res.status(500).json({ error: "Servidor no configurado (falta PLAYLIST_URL)" });
    }
    
    try {
        // 1. Descargar la nueva playlist
        console.log(`Descargando nueva playlist desde ${PLAYLIST_URL}...`);
        const response = await axios.get(PLAYLIST_URL);
        const nuevaPlaylist = response.data;
        
        // Verificación rápida de que no esté vacío
        if (!nuevaPlaylist || !nuevaPlaylist.includes("ffconcat")) {
            console.error("❌ ERROR: La playlist descargada está vacía o es inválida.");
            return res.status(500).json({ error: "La playlist descargada del Servidor A es inválida." });
        }

        // 2. Sobrescribir el archivo local
        await fs.writeFile(LOCAL_PLAYLIST_PATH, nuevaPlaylist, 'utf8');
        console.log(`✅ Archivo local 'playlist.txt' actualizado.`);

        // 3. Reiniciar FFmpeg
        stopFfmpeg(); // Detenemos el antiguo
        setTimeout(startFfmpeg, 1000); // Iniciamos el nuevo

        const successMsg = "¡Éxito! Stream reiniciado con la nueva playlist.";
        console.log(successMsg);
        console.log("=========================================");
        res.json({ message: successMsg });

    } catch (error) {
        console.error(`Error en el proceso de actualización: ${error.message}`);
        res.status(500).json({ error: "No se pudo descargar la playlist desde el Servidor A." });
    }
});

// Ruta de "salud" para que Render sepa que está vivo
app.get('/', (req, res) => {
    res.send('Servidor Transmisor Híbrido v2.3 (ffmpeg-corregido) - Listo.');
});

// --- ¡EL ARRANQUE! ---
// 1. Inicia el servidor web (el "Recepcionista")
app.listen(PORT, () => {
    console.log(`📡 Servidor Transmisor (Recepcionista) escuchando en puerto ${PORT}`);
    console.log("Deploy marcado como 'Live'.");
    
    // 2. ¡AHORA SÍ! Inicia FFmpeg (el "Músico") por primera vez
    // Damos un pequeño respiro para que todo se asiente
    setTimeout(startFfmpeg, 3000); 
});