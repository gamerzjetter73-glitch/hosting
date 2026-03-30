// ── models/AviatorRound.js ──
const mongoose = require('mongoose');

const avBetSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount:     Number,
  cashedOut:  { type: Boolean, default: false },
  cashMult:   { type: Number, default: null },
  payout:     { type: Number, default: 0 }
}, { _id: false });

const aviatorRoundSchema = new mongoose.Schema({
  periodId:   { type: String, required: true, unique: true },
  crashAt:    { type: Number, required: true },
  actualCrash:{ type: Number, default: null },
  bets:       [avBetSchema],
  totalBets:  { type: Number, default: 0 },
  totalPayout:{ type: Number, default: 0 },
  houseProfit:{ type: Number, default: 0 },
  phase:      { type: String, enum: ['waiting','flying','crashed'], default: 'waiting' },
  startedAt:  { type: Date, default: Date.now },
  crashedAt:  { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('AviatorRound', aviatorRoundSchema);
