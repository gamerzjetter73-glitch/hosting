const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  choice:  String,
  amount:  Number,
  odds:    String,
  won:     { type: Boolean, default: false },
  payout:  { type: Number, default: 0 }
}, { _id: false });

const wingoRoundSchema = new mongoose.Schema({
  periodId:    { type: String, required: true, unique: true },
  gameId:      { type: String, default: 'wingo3m' },
  result:      { type: Number, default: null },
  resultColor: { type: String, default: null },
  bets:        [betSchema],
  totalBets:   { type: Number, default: 0 },
  totalPayout: { type: Number, default: 0 },
  houseProfit: { type: Number, default: 0 },
  isOpen:      { type: Boolean, default: true },
  isResolved:  { type: Boolean, default: false },
  startedAt:   { type: Date, default: Date.now },
  resolvedAt:  { type: Date, default: null }
});

module.exports = mongoose.model('WingoRound', wingoRoundSchema);
