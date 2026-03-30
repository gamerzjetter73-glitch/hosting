// ── routes/emailOtp.js ──
// Email OTP authentication endpoints.
// POST /api/auth/email-otp/send    — generate & send OTP to email
// POST /api/auth/email-otp/verify  — verify OTP and return JWT
//
// Security features:
//   • OTP expires in 5 minutes (MongoDB TTL index auto-cleans)
//   • Max 5 verification attempts before OTP is invalidated
//   • 60-second cooldown between OTP requests (per email)
//   • OTP is SHA-256 hashed before storing in DB — plain OTP never persisted
//   • Rate limited via existing express-rate-limit on /api/auth/*
//   • In production: devOtp is NOT returned in response

const express      = require('express');
const crypto       = require('crypto');
const router       = express.Router();
const jwt          = require('jsonwebtoken');
const User         = require('../models/User');
const EmailOtp     = require('../models/EmailOtp');
const { sendOtpEmail } = require('../services/emailService');
const { logger }   = require('../middleware/logger');

// ── Constants ────────────────────────────────────────────────────────────────
const OTP_EXPIRY_MINUTES = 5;
const OTP_EXPIRY_MS      = OTP_EXPIRY_MINUTES * 60 * 1000;
const COOLDOWN_SECONDS   = 60;
const COOLDOWN_MS        = COOLDOWN_SECONDS * 1000;
const MAX_ATTEMPTS       = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function generateOtp() {
  // Cryptographically secure 6-digit OTP (100000–999999)
  const bytes = crypto.randomBytes(4);
  const num   = bytes.readUInt32BE(0);
  return String(100000 + (num % 900000));
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── POST /api/auth/email-otp/send ───────────────────────────────────────────
// Generates a 6-digit OTP, stores hashed version in MongoDB, sends to email.
router.post('/send', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    // ── Validate email format ────────────────────────────────────────────────
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format' });
    }

    // ── Cooldown check — prevent spamming OTP requests ──────────────────────
    const existing = await EmailOtp.findOne({ email }).sort({ createdAt: -1 }).lean();
    if (existing && existing.nextAllowedAt && new Date() < existing.nextAllowedAt) {
      const secondsLeft = Math.ceil((existing.nextAllowedAt - Date.now()) / 1000);
      return res.status(429).json({
        success:     false,
        message:     `Please wait ${secondsLeft} seconds before requesting a new OTP.`,
        retryAfter:  secondsLeft,
      });
    }

    // ── Generate OTP and compute expiry/cooldown times ───────────────────────
    const otp           = generateOtp();
    const otpHash       = hashOtp(otp);
    const now           = Date.now();
    const expiresAt     = new Date(now + OTP_EXPIRY_MS);
    const nextAllowedAt = new Date(now + COOLDOWN_MS);

    // ── Upsert OTP record (replace any existing one for this email) ──────────
    await EmailOtp.findOneAndUpdate(
      { email },
      {
        email,
        otpHash,
        expiresAt,
        nextAllowedAt,
        attempts: 0,
        used:     false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ── Send OTP email ───────────────────────────────────────────────────────
    await sendOtpEmail(email, otp, OTP_EXPIRY_MINUTES);

    logger.info(`[email-otp/send] OTP sent to ${email}`);

    return res.json({
      success:     true,
      message:     `Verification code sent to ${email}. Check your inbox (and spam folder).`,
      expiresIn:   OTP_EXPIRY_MINUTES * 60,   // seconds
      retryAfter:  COOLDOWN_SECONDS,
      // ⚠️ devOtp only exposed in non-production — REMOVE before going live
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    });

  } catch (err) {
    logger.error('[email-otp/send] ' + err.message);
    // Don't expose internal error details to client
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});


// ─── POST /api/auth/email-otp/verify ─────────────────────────────────────────
// Verifies submitted OTP. On success, returns a JWT.
// Behaviour:
//   • If user with this email exists → logs them in
//   • If no user found → returns success:false (registration flow handled by client)
router.post('/verify', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp   = String(req.body.otp   || '').trim();

    // ── Basic validation ─────────────────────────────────────────────────────
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'OTP must be a 6-digit number' });
    }

    // ── Fetch OTP record ─────────────────────────────────────────────────────
    const record = await EmailOtp.findOne({ email });
    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this email. Please request a new one.',
      });
    }

    // ── Already used ─────────────────────────────────────────────────────────
    if (record.used) {
      return res.status(400).json({
        success: false,
        message: 'This OTP has already been used. Please request a new one.',
      });
    }

    // ── Expired check ────────────────────────────────────────────────────────
    if (new Date() > record.expiresAt) {
      await EmailOtp.deleteOne({ email });
      return res.status(400).json({
        success: false,
        message: `OTP expired. Please request a new one.`,
      });
    }

    // ── Too many attempts ────────────────────────────────────────────────────
    if (record.attempts >= MAX_ATTEMPTS) {
      await EmailOtp.deleteOne({ email });
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. OTP invalidated. Please request a new one.`,
      });
    }

    // ── Verify OTP hash ──────────────────────────────────────────────────────
    const submittedHash = hashOtp(otp);
    if (submittedHash !== record.otpHash) {
      // Increment attempt counter
      await EmailOtp.updateOne({ email }, { $inc: { attempts: 1 } });
      const attemptsLeft = MAX_ATTEMPTS - (record.attempts + 1);
      return res.status(400).json({
        success:      false,
        message:      attemptsLeft > 0
          ? `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`
          : 'Incorrect OTP. OTP invalidated — please request a new one.',
        attemptsLeft: Math.max(0, attemptsLeft),
      });
    }

    // ── OTP is valid — mark as used ──────────────────────────────────────────
    await EmailOtp.updateOne({ email }, { used: true });

    // ── Look up user by email ────────────────────────────────────────────────
    const user = await User.findOne({ email }).select('-password');

    if (!user) {
      // Email verified but no account — tell client to proceed with registration
      logger.info(`[email-otp/verify] Email verified (no account yet): ${email}`);
      return res.json({
        success:      true,
        verified:     true,
        hasAccount:   false,
        message:      'Email verified. Please complete registration.',
        email,
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Account is blocked. Contact support.',
      });
    }

    // ── Issue JWT ────────────────────────────────────────────────────────────
    const token = signToken(user._id);
    logger.info(`[email-otp/verify] Login success for ${email} — user: ${user._id}`);

    return res.json({
      success:    true,
      verified:   true,
      hasAccount: true,
      token,
      user: {
        id:           user._id,
        name:         user.name,
        phone:        user.phone,
        email:        user.email,
        balance:      user.balance,
        referralCode: user.referralCode,
      },
    });

  } catch (err) {
    logger.error('[email-otp/verify] ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

module.exports = router;
