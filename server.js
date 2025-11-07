require('dotenv').config();
const express = require('express');
const { spawn } = require('child_process');
const axios = require('axios'); // Para descargar la playlist
const https = require('https'); // Para descargar los archivos de audio
const fs = require('fs'); // Para manejar archivos (síncrono)
const fsp = require('fs').promises; // Para manejar archivos (asíncrono)
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// --- Variables de Entorno (¡Debes configurarlas en Render!) ---
const {
    PLAYLIST_URL,       // La "URL Mágica" de tu API Central (Servidor A)
    RTMP_URL,           // La URL de Desdeparaguay
    INTERNAL_API_KEY    // La clave secreta entre A y B
} = process.env;

// --- ¡NUEVAS CONSTANTES DE CACHÉ! ---
// Esta es la ruta al archivo físico local que FFmpeg estará leyendo
const LOCAL_PLAYLIST_PATH = path.join(__dirname, 'playlist.txt');
// Esta es la ruta a tu Disco Persistente en Render (¡debe coincidir!)
const DISK_CACHE_PATH = '/mnt/disk'; 

// Variable global para guardar el proceso de FFmpeg
let ffmpegProcess = null;

/**
 * Inicia el proceso de FFmpeg.
 * (Sin cambios, sigue leyendo el 'playlist.txt' local)
 */
function startFfmpeg() {
    if (!RTMP_URL) {
        console.error("❌ ERROR FATAL: 'RTMP_URL' no está definida. El stream no puede iniciar.");
        return;
    }
    
    console.log("-----------------------------------------");
    console.log(`🚀 Iniciando FFmpeg...`);
    console.log(`Leyendo playlist CACHEADA local: ${LOCAL_PLAYLIST_PATH}`);
    console.log(`Transmitiendo a: ${RTMP_URL}`);
    console.log("-----------------------------------------");

    const args = [
        '-re',
        '-f', 'concat',
        '-safe', '0',
        '-protocol_whitelist', 'file,http,https,tcp,tls',
        '-stream_loop', '-1',
        '-i', LOCAL_PLAYLIST_PATH, // ¡Lee el archivo local que generamos!
        '-c:a', 'aac',
        '-b:a', '128k',
        '-vn',
        '-f', 'flv',
        RTMP_URL
    ];

    ffmpegProcess = spawn('ffmpeg', args);

    ffmpegProcess.stderr.on('data', (data) => {
        console.log(`[FFmpeg]: ${data.toString()}`);
    });

    ffmpegProcess.on('close', (code) => {
        if (ffmpegProcess) { 
             console.warn(`⚠️ FFmpeg se detuvo inesperadamente (código ${code}). Reiniciando en 5 segundos...`);
             setTimeout(startFfmpeg, 5000);
        }
    });

    ffmpegProcess.on('error', (err) => {
        console.error('❌ Error fatal al iniciar FFmpeg:', err);
    });
}

/**
 * Detiene el proceso de FFmpeg.
 * (Sin cambios)
 */
function stopFfmpeg() {
    if (ffmpegProcess) {
        console.log("🛑 Deteniendo proceso actual de FFmpeg...");
        ffmpegProcess.removeAllListeners('close'); 
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null; 
        console.log("Proceso FFmpeg detenido manualmente.");
    }
}

/**
 * ¡NUEVA FUNCIÓN HELPER!
 * Descarga un archivo de una URL a un destino en el disco.
 */
const downloadFile = (url, dest) => new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
        // Manejar redirecciones (Cloudinary puede usarlas)
        if (response.statusCode > 300 && response.statusCode < 400 && response.headers.location) {
            https.get(response.headers.location, (res) => {
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
            }).on('error', (err) => {
                fs.unlink(dest, () => reject(err)); // Borrar archivo si falla
            });
        } else {
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }
    }).on('error', (err) => {
        fs.unlink(dest, () => reject(err)); // Borrar archivo si falla
    });
});

// --- Middleware de seguridad ---
// (Sin cambios)
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
 * ¡LA RUTA DE ACTUALIZACIÓN (REHECHA CON CACHÉ)!
 */
app.post('/actualizar-playlist', async (req, res) => {
    console.log("=========================================");
    console.log("📥 ¡Orden de actualización (con caché) recibida!");
    
    if (!PLAYLIST_URL) {
        console.error("❌ ERROR: PLAYLIST_URL no definida.");
        return res.status(500).json({ error: "Servidor no configurado (falta PLAYLIST_URL)" });
    }

    let nuevaPlaylistLocal = "ffconcat version 1.0\n"; // El contenido del *nuevo* playlist.txt local
    let archivosDescargados = 0;
    let archivosCacheados = 0;

    try {
        // 1. Descargar la "Lista Maestra" (de Cloudinary URLs)
        console.log(`Descargando Lista Maestra desde ${PLAYLIST_URL}...`);
        const response = await axios.get(PLAYLIST_URL);
        const playlistMaestra = response.data;

        if (!playlistMaestra || !playlistMaestra.includes("ffconcat")) {
            throw new Error("La playlist Maestra descargada es inválida.");
        }

        // 2. Parsear la Lista Maestra para obtener las URLs
        const lineas = playlistMaestra.split('\n');
        const urlsParaProcesar = [];
        for (const linea of lineas) {
            if (linea.startsWith("file 'http")) {
                const url = linea.substring(6, linea.length - 1);
                urlsParaProcesar.push(url);
            }
        }

        console.log(`Procesando ${urlsParaProcesar.length} canciones...`);

        // 3. Bucle de Sincronización (¡La Magia!)
        for (const url of urlsParaProcesar) {
            // Generar un nombre de archivo local (ej: a partir del final de la URL)
            const nombreArchivo = path.basename(new URL(url).pathname);
            const rutaLocal = path.join(DISK_CACHE_PATH, nombreArchivo);

            // 4. ¿Ya existe en el Disco Persistente?
            if (fs.existsSync(rutaLocal)) {
                // ¡SÍ! Ahorramos ancho de banda
                archivosCacheados++;
            } else {
                // ¡NO! Descargamos de Cloudinary
                console.log(`[CACHE MISS] Descargando ${nombreArchivo} a ${DISK_CACHE_PATH}...`);
                await downloadFile(url, rutaLocal);
                archivosDescargados++;
                console.log(`-> Descarga completa: ${nombreArchivo}`);
            }
            
            // 5. Añadir la *ruta local* (del disco) a nuestro nuevo playlist.txt
            nuevaPlaylistLocal += `file '${rutaLocal}'\n`;
        }

        // 6. Sobrescribir el 'playlist.txt' que lee FFmpeg
        await fsp.writeFile(LOCAL_PLAYLIST_PATH, nuevaPlaylistLocal, 'utf8');
        console.log(`✅ 'playlist.txt' local actualizado (apunta al disco persistente).`);
        console.log(`Reporte: ${archivosDescargados} descargados, ${archivosCacheados} desde caché.`);

        // 7. Reiniciar FFmpeg
        stopFfmpeg();
        setTimeout(startFfmpeg, 1000); // Iniciar el nuevo

        const successMsg = "¡Éxito! Stream reiniciado (Caché Sincronizado).";
        console.log(successMsg);
        console.log("=========================================");
        res.json({ message: successMsg, downloaded: archivosDescargados, cached: archivosCacheados });

    } catch (error) {
        console.error(`Error en el proceso de actualización (caché): ${error.message}`);
        res.status(500).json({ error: "No se pudo sincronizar la playlist con caché." });
    }
});

// Ruta de "salud"
app.get('/', (req, res) => {
    res.send('Servidor Transmisor  - Listo.');
});

// --- ¡EL ARRANQUE! ---
app.listen(PORT, () => {
    console.log(`📡 Servidor Transmisor (Recepcionista) escuchando en puerto ${PORT}`);
    console.log("Deploy marcado como 'Live'.");
    console.log(`Disco Persistente (Caché) conectado en: ${DISK_CACHE_PATH}`);
    
    // Inicia FFmpeg por primera vez (probablemente con la lista vacía)
    setTimeout(startFfmpeg, 3000); 
});