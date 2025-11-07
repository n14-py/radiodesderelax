require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process'); // Usamos 'spawn' para tener mejor control de FFmpeg
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

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
    console.log("-----------------------------------------");
    console.log(`🚀 Iniciando FFmpeg...`);
    console.log(`Leyendo playlist local: ${LOCAL_PLAYLIST_PATH}`);
    console.log(`Transmitiendo a: ${RTMP_URL}`);
    console.log("-----------------------------------------");

    // Argumentos para FFmpeg
    const args = [
        '-re',
        '-f', 'concat',
        '-safe', '0',
        '-protocol_whitelist', 'file,http,https,tcp,tls',
        '-i', LOCAL_PLAYLIST_PATH,
        '-stream_loop', '-1', // Bucle infinito del archivo local
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        '-f', 'flv',
        RTMP_URL
    ];

    // Lanzamos FFmpeg
    ffmpegProcess = spawn('ffmpeg', args);

    // Capturamos los logs de FFmpeg para verlos en Render
    ffmpegProcess.stdout.on('data', (data) => {
        console.log(`[FFmpeg STDOUT]: ${data}`);
    });

    ffmpegProcess.stderr.on('data', (data) => {
        // Los logs de progreso de FFmpeg salen por stderr
        console.error(`[FFmpeg STDERR]: ${data}`);
    });

    // Manejo de reinicio: Si FFmpeg muere, lo reiniciamos (excepto si lo matamos nosotros)
    ffmpegProcess.on('close', (code) => {
        console.warn(`⚠️ FFmpeg se detuvo (código ${code}). Reiniciando en 5 segundos...`);
        if (code !== 0) { // Si no fue una parada limpia
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
        ffmpegProcess.kill('SIGINT'); // Envía señal de interrupción
        ffmpegProcess = null;
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

        // 2. Sobrescribir el archivo local
        await fs.writeFile(LOCAL_PLAYLIST_PATH, nuevaPlaylist, 'utf8');
        console.log(`✅ Archivo local 'playlist.txt' actualizado.`);

        // 3. Reiniciar FFmpeg
        stopFfmpeg();
        setTimeout(startFfmpeg, 1000); // Dar 1 segundo para que libere el archivo

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
    res.send('Servidor Transmisor Híbrido v2.0 - Listo para recibir órdenes.');
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