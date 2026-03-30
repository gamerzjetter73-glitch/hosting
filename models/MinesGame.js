const mongoose = require('mongoose');

const minesGameSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  betAmount:  { type: Number, required: true },
  minesCount: { type: Number, required: true, default: 3 },
  minePositions: [Number],      // 0-24 grid positions of mines
  revealed:   [Number],         // positions user has revealed (safe)
  status:     { type: String, enum: ['active','won','lost'], default: 'active' },
  currentMultiplier: { type: Number, default: 1 },
  payout:     { type: Number, default: 0 },
  cashedOut:  { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('MinesGame', minesGameSchema);
