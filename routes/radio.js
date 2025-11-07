const express = require('express');
const router = express.Router();
const radioController = require('../controllers/radioController');

// Middleware simple de seguridad para admin
const requireKey = (req, res, next) => {
    if (req.headers['x-api-key'] === process.env.ADMIN_API_KEY) next();
    else res.status(403).json({ error: "Sin permiso" });
};

router.get('/playlist', radioController.getPlaylist);
router.post('/item', requireKey, radioController.addItem);
router.post('/reorder', requireKey, radioController.updateOrder);

module.exports = router;