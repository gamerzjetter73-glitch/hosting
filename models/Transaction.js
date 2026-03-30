const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:   { type: String, enum: ['deposit', 'withdraw', 'win', 'loss', 'bonus'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'success' },
  note:   { type: String, default: '' },
  razorpayOrderId:   { type: String, index: true, sparse: true },
  razorpayPaymentId: { type: String, index: true, sparse: true, unique: true },
  // Manual withdrawal — UPI ID the user wants payment sent to
  withdrawUpi: { type: String, default: '' },
  // Manual UPI deposits (QR/UPI collect) approved by admin
  upiUtr:   { type: String, index: true, sparse: true, unique: true },
  upiVpa:   { type: String, default: '' },   // merchant/admin UPI ID shown to user
  payerUpi: { type: String, default: '' },   // user-provided payer UPI ID (optional)
  provider: { type: String, default: '' },   // e.g. 'fampay'
  screenshotUrl: { type: String, default: '' },
  ocrText: { type: String, default: '' },
  ocrVerdict: { type: String, enum: ['unknown', 'match', 'no_match', 'error'], default: 'unknown' },
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
