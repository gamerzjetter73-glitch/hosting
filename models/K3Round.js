const mongoose = require('mongoose');

const k3RoundSchema = new mongoose.Schema({
  periodId:   { type: String, required: true, unique: true },
  dice:       [Number],           // [d1, d2, d3] results
  sum:        Number,
  isResolved: { type: Boolean, default: false },
  isOpen:     { type: Boolean, default: true },
  bets: [{
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    choice:  String,   // 'Big','Small','Odd','Even','Triple','Sum:X','Triple:X'
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

module.exports = mongoose.model('K3Round', k3RoundSchema);
