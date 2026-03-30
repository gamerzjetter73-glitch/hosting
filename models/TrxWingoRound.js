const mongoose = require('mongoose');
const trxWingoSchema = new mongoose.Schema({
  periodId:    { type: String, required: true, unique: true },
  trxHash:     { type: String, default: '' },   // simulated TRX hash
  result:      { type: Number, min:0, max:9 },
  resultColor: String,
  isResolved:  { type: Boolean, default: false },
  isOpen:      { type: Boolean, default: true },
  bets: [{
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    choice:  String,
    amount:  Number,
    odds:    Number,
    won:     { type: Boolean, default: false },
    payout:  { type: Number, default: 0 },
  }],
  totalBets:   { type: Number, default: 0 },
  totalPayout: { type: Number, default: 0 },
  houseProfit: { type: Number, default: 0 },
  resolvedAt:  Date,
}, { timestamps: true });
module.exports = mongoose.model('TrxWingoRound', trxWingoSchema);
