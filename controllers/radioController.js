const fs = require('fs/promises');
const path = require('path');
const PlaylistItem = require('../models/playlistItem');
const { v4: uuidv4 } = require('uuid');

// Ruta absoluta a playlist.txt en la raíz del contenedor
const PLAYLIST_FILE_PATH = '/usr/src/app/playlist.txt';

// --- FUNCIONES INTERNAS ---
function generatePlaylistContent(playlist) {
    let content = 'ffconcat version 1.0\n';
    playlist.forEach(item => {
        content += `file '${item.audioUrl}'\n`;
    });
    // Si la playlist está vacía, añadimos una pausa dummy para que ffmpeg no muera
    if (playlist.length === 0) {
        content += `# Playlist vacia, esperando canciones...\n`;
    }
    return content;
}

async function _generateAndWriteTxt() {
    try {
        const newPlaylist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
        const fileContent = generatePlaylistContent(newPlaylist);
        await fs.writeFile(PLAYLIST_FILE_PATH, fileContent, 'utf8');
        console.log(`✅ playlist.txt actualizado con ${newPlaylist.length} items.`);
    } catch (error) {
        console.error("❌ Error actualizando playlist.txt:", error);
    }
}

// --- FUNCIONES PÚBLICAS ---
exports.addItem = async (req, res) => {
    try {
        const { title, audioUrl, durationSeconds, type } = req.body;
        const lastItem = await PlaylistItem.findOne().sort({ order: -1 });
        const newOrder = lastItem ? lastItem.order + 1 : 1;

        const newItem = new PlaylistItem({
            uuid: uuidv4(),
            title, audioUrl, durationSeconds, type,
            order: newOrder, isActive: true
        });
        await newItem.save();
        await _generateAndWriteTxt();
        res.json({ message: "Item añadido", item: newItem });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getPlaylist = async (req, res) => {
    const playlist = await PlaylistItem.find({ isActive: true }).sort({ order: 1 });
    res.json(playlist);
};

// Función vital para reordenar desde el frontend
exports.updateOrder = async (req, res) => {
    const { items } = req.body; // Espera [{uuid: '...', order: 1}, ...]
    if (!items) return res.status(400).json({error: "Faltan items"});
    
    const ops = items.map(item => ({
        updateOne: { filter: { uuid: item.uuid }, update: { $set: { order: item.order } } }
    }));
    await PlaylistItem.bulkWrite(ops);
    await _generateAndWriteTxt();
    // NOTA: FFmpeg leerá el cambio automáticamente en el próximo bucle o reinicio suave.
    res.json({ success: true });
};