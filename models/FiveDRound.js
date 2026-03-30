const mongoose = require('mongoose');
const fiveDSchema = new mongoose.Schema({
  periodId:   { type: String, required: true, unique: true },
  result:     [Number],        // [A,B,C,D,E] each 0-9
  isResolved: { type: Boolean, default: false },
  isOpen:     { type: Boolean, default: true },
  bets: [{
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    betType: String,   // 'A','B','C','D','E','sum_big','sum_small','sum_odd','sum_even'
    choice:  String,   // digit 0-9 or 'Big'/'Small'/'Odd'/'Even'
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
module.exports = mongoose.model('FiveDRound', fiveDSchema);
