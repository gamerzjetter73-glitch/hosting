// ── models/CricketBet.js ──
const mongoose = require('mongoose');

const cricketBetSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  match:       { type: mongoose.Schema.Types.ObjectId, ref: 'CricketMatch', required: true },
  matchId:     { type: String, required: true },
  marketId:    { type: String, required: true },
  marketType:  { type: String, required: true },
  marketLabel: { type: String, default: '' },
  choice:      { type: String, required: true },
  choiceLabel: { type: String, default: '' },
  odds:        { type: Number, required: true },
  amount:      { type: Number, required: true },
  payout:      { type: Number, default: 0 },
  status:      { type: String, enum: ['pending','won','lost','refunded'], default: 'pending' },
  settledAt:   { type: Date, default: null },
}, { timestamps: true });

cricketBetSchema.index({ user: 1, matchId: 1 });
cricketBetSchema.index({ matchId: 1, marketId: 1, status: 1 });

module.exports = mongoose.model('CricketBet', cricketBetSchema);
