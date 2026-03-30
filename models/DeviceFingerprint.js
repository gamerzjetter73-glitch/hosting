// ── models/DeviceFingerprint.js  v1 ──
// Tracks device fingerprint + IP per user to prevent multi-account abuse.
// One document per (fingerprint OR ip) → userId mapping.

const mongoose = require('mongoose');

const deviceFingerprintSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fingerprint: { type: String, index: true },   // browser canvas/hw fingerprint hash
  ip:          { type: String, index: true },   // registration IP
  userAgent:   { type: String },
  registeredAt:{ type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('DeviceFingerprint', deviceFingerprintSchema);
