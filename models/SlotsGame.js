const mongoose = require('mongoose');
const slotsSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  betAmount: Number,
  reels:    [[String]],   // 3x3 grid result
  won:      Boolean,
  prize:    { type: Number, default: 0 },
  multiplier: { type: Number, default: 0 },
  winLine:  String,
}, { timestamps: true });
module.exports = mongoose.model('SlotsGame', slotsSchema);
