require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const radioRoutes = require('./routes/radio');

const app = express();
// Usamos puerto 3000 internamente para la API, NGINX usará el 8080 para fuera si es necesario,
// pero para simplificar, haremos que Node escuche en el puerto que Render espera (PORT o 8080).
const PORT = process.env.PORT || 3000; 

app.use(cors());
app.use(express.json());

// Conexión a MongoDB
if (!process.env.MONGODB_URI) {
    console.error("❌ ERROR: Falta la variable MONGODB_URI en el .env");
}
mongoose.connect(process.env.MONGODB_URI || '')
    .then(() => console.log('✅ Motor conectado a MongoDB'))
    .catch(err => console.error('❌ Error de conexión a MongoDB:', err));

// Rutas
app.use('/api', radioRoutes);

// Ruta base para health check
app.get('/', (req, res) => {
    res.send('Radio Motor Backend is RUNNING 24/7');
});

app.listen(PORT, () => {
    console.log(`🔥 API del Motor escuchando en el puerto ${PORT}`);
});