require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// --- Configuración ---
// PLAYLIST_URL ahora solo sirve para "descubrir" archivos nuevos, no para el orden de reproducción.
const {
    PLAYLIST_URL,       
    RTMP_URL,           
    INTERNAL_API_KEY    
} = process.env;

const LOCAL_PLAYLIST_PATH = path.join(__dirname, 'playlist.txt');
const DISK_CACHE_PATH = '/mnt/disk'; 

let ffmpegProcess = null;

// ==========================================
// 1. LÓGICA DEL DJ LOCAL (AUTODIDACTA)
// ==========================================

/**
 * Función "Fisher-Yates Shuffle" para mezclar array aleatoriamente
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Escanea el disco, busca mp3/m4a, los mezcla y genera el playlist.txt
 */
async function generarPlaylistLocal() {
    console.log("💿 [DJ Local] Escaneando biblioteca en disco...");
    
    try {
        // 1. Leer todos los archivos en la carpeta de caché
        const archivos = await fsp.readdir(DISK_CACHE_PATH);
        
        // 2. Filtrar solo archivos de audio válidos
        // (Asegúrate de que tus archivos tengan extensión, si no, quita el filtro)
        const canciones = archivos.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.m4a', '.aac', '.wav'].includes(ext);
        });

        if (canciones.length === 0) {
            console.error("⚠️ [DJ Local] ¡No encontré canciones en el disco! Esperando sincronización...");
            return false;
        }

        console.log(`🎵 [DJ Local] Se encontraron ${canciones.length} canciones.`);

        // 3. MEZCLAR LAS CANCIONES (Shuffle)
        const playlistMezclada = shuffleArray(canciones);

        // 4. Construir el contenido del archivo playlist
        let contenidoPlaylist = "ffconcat version 1.0\n";
        
        playlistMezclada.forEach(cancion => {
            const rutaAbsoluta = path.join(DISK_CACHE_PATH, cancion);
            contenidoPlaylist += `file '${rutaAbsoluta}'\n`;
        });

        // 5. Guardar el archivo
        await fsp.writeFile(LOCAL_PLAYLIST_PATH, contenidoPlaylist, 'utf8');
        console.log("✅ [DJ Local] Nueva playlist generada y guardada localmente.");
        return true;

    } catch (error) {
        console.error("❌ Error generando playlist local:", error);
        return false;
    }
}

// ==========================================
// 2. FUNCIONES DE STREAMING (FFMPEG)
// ==========================================

function startFfmpeg() {
    if (!RTMP_URL) {
        console.error("❌ ERROR FATAL: 'RTMP_URL' no definida.");
        return;
    }

    // Asegurarnos de que existe el playlist antes de arrancar
    if (!fs.existsSync(LOCAL_PLAYLIST_PATH)) {
        console.warn("⚠️ No existe playlist.txt todavía. Intentando generar uno...");
        generarPlaylistLocal().then(exito => {
            if (exito) startFfmpeg();
        });
        return;
    }
    
    console.log("-----------------------------------------");
    console.log(`🚀 Iniciando FFmpeg (Modo Autodidacta)...`);
    console.log(`Transmitiendo a: ${RTMP_URL}`);
    console.log("-----------------------------------------");

    const args = [
        '-re',
        '-f', 'concat',
        '-safe', '0',
        '-protocol_whitelist', 'file,http,https,tcp,tls',
        '-stream_loop', '-1', // Bucle infinito de la lista actual
        '-i', LOCAL_PLAYLIST_PATH,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-vn',
        '-f', 'flv',
        RTMP_URL
    ];

    ffmpegProcess = spawn('ffmpeg', args);

    ffmpegProcess.stderr.on('data', (data) => {
        // Descomenta esto si quieres ver logs detallados de ffmpeg
        // console.log(`[FFmpeg]: ${data.toString()}`);
    });

    ffmpegProcess.on('close', (code) => {
        if (ffmpegProcess) { 
             console.warn(`⚠️ FFmpeg se detuvo (código ${code}). Reiniciando en 5s...`);
             setTimeout(startFfmpeg, 5000);
        }
    });

    ffmpegProcess.on('error', (err) => {
        console.error('❌ Error fatal al iniciar FFmpeg:', err);
    });
}

function stopFfmpeg() {
    if (ffmpegProcess) {
        console.log("🛑 Deteniendo FFmpeg...");
        ffmpegProcess.removeAllListeners('close'); 
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null; 
    }
}

// ==========================================
// 3. UTILIDADES DE DESCARGA
// ==========================================

const downloadFile = (url, dest) => new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
        if (response.statusCode > 300 && response.statusCode < 400 && response.headers.location) {
            https.get(response.headers.location, (res) => {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        } else {
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }
    }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
    });
});

// ==========================================
// 4. RUTAS DE LA API
// ==========================================

app.use(express.json());
app.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (req.path === '/' || (apiKey && apiKey === INTERNAL_API_KEY)) {
        next();
    } else {
        res.status(403).json({ error: "Acceso no autorizado" });
    }
});

/**
 * RUTA 1: SINCRONIZAR BIBLIOTECA (Descargar canciones nuevas)
 * Esta ruta NO reinicia el stream necesariamente, solo baja archivos.
 */
app.post('/sync-library', async (req, res) => {
    console.log("📥 [Sync] Iniciando descarga de biblioteca...");
    
    if (!PLAYLIST_URL) return res.status(500).json({ error: "Falta PLAYLIST_URL" });

    let nuevos = 0;
    let existentes = 0;

    try {
        // 1. Obtener lista maestra de la API central
        const response = await axios.get(PLAYLIST_URL);
        const playlistMaestra = response.data;

        const lineas = playlistMaestra.split('\n');
        const urlsParaProcesar = [];
        for (const linea of lineas) {
            if (linea.startsWith("file 'http")) {
                urlsParaProcesar.push(linea.substring(6, linea.length - 1));
            }
        }

        console.log(`🔎 Analizando ${urlsParaProcesar.length} canciones remotas...`);

        // 2. Descargar solo lo que falta
        for (const url of urlsParaProcesar) {
            const nombreArchivo = path.basename(new URL(url).pathname);
            const rutaLocal = path.join(DISK_CACHE_PATH, nombreArchivo);

            if (fs.existsSync(rutaLocal)) {
                existentes++;
            } else {
                console.log(`⬇️ Descargando nuevo: ${nombreArchivo}`);
                await downloadFile(url, rutaLocal);
                nuevos++;
            }
        }

        res.json({ message: "Biblioteca actualizada", nuevos, existentes });

    } catch (error) {
        console.error("Error en sync-library:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * RUTA 2: REGENERAR PLAYLIST (El DJ baraja de nuevo)
 * Llama a esto si quieres cambiar el orden de las canciones o incluir las recién descargadas.
 */
app.post('/mezclar-radio', async (req, res) => {
    console.log("🔀 [Orden Manual] Solicitud de re-mezcla recibida.");
    
    const exito = await generarPlaylistLocal();
    if (exito) {
        // Reiniciamos FFmpeg para que tome la nueva lista
        stopFfmpeg();
        setTimeout(startFfmpeg, 1000);
        res.json({ message: "Radio re-mezclada y reiniciada." });
    } else {
        res.status(500).json({ error: "No se pudo generar la playlist (¿carpeta vacía?)" });
    }
});

/**
 * RUTA LEGACY: Mantenemos la ruta anterior por compatibilidad,
 * pero ahora hace las dos cosas: Sincroniza Y Mezcla.
 */
app.post('/actualizar-playlist', async (req, res) => {
    console.log("🔄 [Legacy] Actualización completa solicitada...");
    
    // 1. Llamamos internamente a la lógica de sync (podrías refactorizarlo, pero lo simulamos aquí)
    // Para simplificar, redirigimos la lógica:
    try {
        // Paso A: Sync
        // (Copiado lógica breve para no duplicar código complejo aquí, 
        //  en producción idealmente extraes la lógica de sync a una función aparte)
        const response = await axios.get(PLAYLIST_URL);
        const playlistMaestra = response.data;
        const lineas = playlistMaestra.split('\n');
        let descargados = 0;
        
        for (const linea of lineas) {
            if (linea.startsWith("file 'http")) {
                const url = linea.substring(6, linea.length - 1);
                const rutaLocal = path.join(DISK_CACHE_PATH, path.basename(new URL(url).pathname));
                if (!fs.existsSync(rutaLocal)) {
                    await downloadFile(url, rutaLocal);
                    descargados++;
                }
            }
        }

        // Paso B: Generar Playlist y Reiniciar
        await generarPlaylistLocal();
        stopFfmpeg();
        setTimeout(startFfmpeg, 1000);

        res.json({ message: "Sistema actualizado y reiniciado.", downloaded: descargados });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/', (req, res) => res.send('📻 Radio Autodidacta - Online'));

// --- ARRANQUE ---
app.listen(PORT, async () => {
    console.log(`📡 Servidor Radio Autodidacta en puerto ${PORT}`);
    console.log(`📂 Carpeta de música: ${DISK_CACHE_PATH}`);

    // Al arrancar, intenta generar playlist de lo que ya tenga y empieza a transmitir
    // No espera a Internet para empezar a sonar.
    const tieneMusica = await generarPlaylistLocal();
    if (tieneMusica) {
        setTimeout(startFfmpeg, 3000);
    } else {
        console.log("⚠️ Esperando primera sincronización para arrancar stream...");
    }
});