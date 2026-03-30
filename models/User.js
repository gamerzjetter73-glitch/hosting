// ── models/User.js  v16 ──
// v36: Added deviceFingerprint + registrationIp for multi-account prevention
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:              { type: String, required: true, trim: true },
  phone:             { type: String, trim: true, sparse: true, unique: true, index: true },
  password:          { type: String, required: true },
  balance:           { type: Number, default: 0, min: 0 },   // real withdrawable balance only
  bonusBalance:      { type: Number, default: 0, min: 0 },   // signup/referral bonus (non-withdrawable)
  wagerRequired:     { type: Number, default: 0 },            // total bet amount needed to clear bonus
  wagerCompleted:    { type: Number, default: 0 },            // total bet amount placed so far
  totalDeposited:    { type: Number, default: 0 },
  totalWithdrawn:    { type: Number, default: 0 },
  totalWon:          { type: Number, default: 0 },
  totalLost:         { type: Number, default: 0 },
  referralCode:      { type: String, unique: true, sparse: true },
  referredBy:        { type: String, default: null },
  referralRewarded:  { type: Boolean, default: false }, // true after referrer has been paid ₹100
  isBlocked:         { type: Boolean, default: false },
  godMode:           { type: Boolean, default: false },
  vipLevel:          { type: Number, default: 0 },
  email:             { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
  // v36: Device & IP tracking — multi-account prevention
  deviceFingerprint: { type: String, default: null },   // browser fingerprint hash
  registrationIp:    { type: String, default: null },   // IP at registration time
  lastLoginIp:       { type: String, default: null },
}, { timestamps: true });

// Hash password on save if modified
userSchema.pre('save', async function() {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
});

userSchema.methods.matchPassword = async function(enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
