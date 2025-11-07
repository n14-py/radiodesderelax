const mongoose = require('mongoose');

const PlaylistItemSchema = new mongoose.Schema({
    uuid: { type: String, required: true, unique: true }, 
    title: { type: String, required: true },
    audioUrl: { type: String, required: true },
    durationSeconds: { type: Number, required: true }, 
    type: { type: String, enum: ['song', 'jingle', 'advertisement'], default: 'song' },
    order: { type: Number, required: true, index: true }, 
    isActive: { type: Boolean, default: true, index: true }, 
}, { timestamps: true });

PlaylistItemSchema.index({ order: 1, isActive: 1 });
module.exports = mongoose.model('PlaylistItem', PlaylistItemSchema);