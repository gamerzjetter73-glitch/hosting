// ── models/EmailOtp.js ──
// Stores email OTPs in MongoDB with expiry, attempt tracking and cooldown.
// TTL index auto-deletes expired documents — no manual cleanup needed.

const mongoose = require('mongoose');

const emailOtpSchema = new mongoose.Schema({
  email: {
    type:     String,
    required: true,
    lowercase: true,
    trim:     true,
    index:    true,
  },

  // Hashed OTP — never store plain OTP in DB
  otpHash: {
    type:     String,
    required: true,
  },

  // When this OTP expires (5 minutes from creation)
  expiresAt: {
    type:    Date,
    required: true,
    index:   true,   // TTL index added below
  },

  // Cooldown: when next OTP request is allowed (60s after last send)
  nextAllowedAt: {
    type:    Date,
    default: null,
  },

  // Max 5 failed verification attempts before OTP is invalidated
  attempts: {
    type:    Number,
    default: 0,
  },

  // Whether this OTP has already been successfully verified
  used: {
    type:    Boolean,
    default: false,
  },
}, { timestamps: true });

// TTL index — MongoDB auto-deletes document 0 seconds after expiresAt
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('EmailOtp', emailOtpSchema);
