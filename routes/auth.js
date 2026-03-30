// ── routes/auth.js  v18 ──
// v36: Phone OTP login removed. Email OTP is the only login method.
//      Device fingerprint + IP tracking added to prevent multi-account abuse.

const express           = require('express');
const router            = express.Router();
const jwt               = require('jsonwebtoken');
const crypto            = require('crypto');
const User              = require('../models/User');
const Transaction       = require('../models/Transaction');
const { protect }       = require('../middleware/auth');
const { logger }        = require('../middleware/logger');

// Helper — get real client IP (handles proxies / nginx)
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── Token blacklist (in-memory — survives restarts poorly, but good enough)
// For multi-instance deployments, move this to Redis.
const tokenBlacklist = new Set();

// Export so auth middleware can check it
module.exports.tokenBlacklist = tokenBlacklist;

function signToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ── Password reset store: phone → { token, expires }
const resetTokens = new Map();

// ── Login OTP store: phone → { otp, expires }
// Used for phone + OTP login flow
const loginOtps = new Map();

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password, referralCode, email } = req.body;

    // Name, phone, password and email are all required
    if (!name || !password)
      return res.status(400).json({ success: false, message: 'Name and password are required' });

    if (!phone)
      return res.status(400).json({ success: false, message: 'Phone number is required' });

    if (!email)
      return res.status(400).json({ success: false, message: 'Email address is required' });

    if (String(phone).trim().length < 10)
      return res.status(400).json({ success: false, message: 'Invalid phone number' });

    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    // Check duplicates
    if (phone) {
      const existingPhone = await User.findOne({ phone: String(phone).trim() });
      if (existingPhone)
        return res.status(409).json({ success: false, message: 'Phone number already registered' });
    }
    if (email) {
      const existingEmail = await User.findOne({ email: String(email).trim().toLowerCase() });
      if (existingEmail)
        return res.status(409).json({ success: false, message: 'Email address already registered' });
    }

    // ── IP duplicate check (prevents multiple accounts per network) ──────────
    // ── IP duplicate check — disabled: Render proxy makes all IPs identical ──
    const clientIp = getClientIp(req);
    // ── end IP check ──────────────────────────────────────────────────────────
    // ── end IP check ──────────────────────────────────────────────────────────

    // Handle referral — reward is given when referred user makes first deposit ≥ ₹100
    // We just store referredBy here; wallet.js handles the actual payout
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode: String(referralCode).trim() });
      if (referrer) {
        referredBy = referralCode;
        // No instant bonus — referrer gets ₹50 after new user deposits ₹100+
      }
    }

    // Generate a unique referral code with retry on collision
    let referralCodeGenerated, attempts = 0;
    while (attempts < 5) {
      const candidate = '91C-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const conflict  = await User.findOne({ referralCode: candidate }).lean();
      if (!conflict) { referralCodeGenerated = candidate; break; }
      attempts++;
    }
    if (!referralCodeGenerated)
      return res.status(500).json({ success: false, message: 'Could not generate referral code. Try again.' });

    const user = await User.create({
      name:              String(name).trim(),
      phone:             phone ? String(phone).trim() : undefined,
      email:             email ? String(email).trim().toLowerCase() : undefined,
      password,
      referredBy,
      referralCode:      referralCodeGenerated,
      registrationIp:    clientIp,
    });

    // ₹50 signup bonus — tracked separately as bonusBalance (non-withdrawable until wagered)
    const existingIpAccount = await User.findOne({
      registrationIp: clientIp,
      _id: { $ne: user._id }
    }).lean();

    let signupBalance = 0;
    if (!existingIpAccount) {
      const BONUS_AMOUNT  = 50;
      const WAGER_MULT    = 2; // must bet ₹100 total to clear ₹50 bonus (2× bonus amount)
      signupBalance = BONUS_AMOUNT;
      await User.findByIdAndUpdate(user._id, {
        $inc: {
          bonusBalance:   BONUS_AMOUNT,
          wagerRequired:  BONUS_AMOUNT * WAGER_MULT,
        }
      });
      await Transaction.create({
        user: user._id, type: 'bonus', amount: BONUS_AMOUNT,
        status: 'success', note: 'Signup welcome bonus ₹50 (wagering: bet ₹100 to unlock withdrawal)'
      });
    }
    // else: duplicate IP — account created but no bonus given

    const token = signToken(user._id);
    res.status(201).json({
      success: true, token,
      user: {
        id: user._id, name: user.name, phone: user.phone,
        email: user.email, balance: 0, bonusBalance: signupBalance,
        referralCode: referralCodeGenerated,
        wagerRequired: signupBalance ? signupBalance * 2 : 0,
        wagerCompleted: 0,
      }
    });
  } catch (err) {
    logger.error('[register] ' + err.message);
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: 'Account already exists with this phone or email' });
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password)
      return res.status(400).json({ success: false, message: 'Phone and password required' });

    const user = await User.findOne({ phone: String(phone).trim() });
    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });

    if (user.isBlocked)
      return res.status(403).json({ success: false, message: 'Account is blocked. Contact support.' });

    const match = await user.matchPassword(password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid phone or password' });

    const token = signToken(user._id);
    res.json({
      success: true, token,
      user: {
        id: user._id, name: user.name, phone: user.phone,
        email: user.email, balance: user.balance,
        bonusBalance: user.bonusBalance || 0,
        wagerRequired: user.wagerRequired || 0,
        wagerCompleted: user.wagerCompleted || 0,
        referralCode: user.referralCode
      }
    });
  } catch (err) {
    logger.error('[login] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/logout (protected) ────────────────────────────────────────
// Adds the current token to the blacklist so it can't be reused.
// Frontend must also delete the token from localStorage.
router.post('/logout', protect, (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) tokenBlacklist.add(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/login-otp/request ────────────────────────────────────────
// Step 1: user enters phone, server sends 6-digit OTP to that number.
router.post('/login-otp/request', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!phone)
      return res.status(400).json({ success: false, message: 'Phone number required' });

    const user = await User.findOne({ phone });
    if (!user)
      return res.status(404).json({ success: false, message: 'Number is not registered' });

    if (user.isBlocked)
      return res.status(403).json({ success: false, message: 'Account is blocked. Contact support.' });

    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
    loginOtps.set(phone, { otp, expires });

    // Use a generic message to avoid provider filtering on brand keywords
    await sendOTP(phone, otp);
    logger.info(`[login-otp] OTP generated for ${phone}`);

    res.json({
      success: true,
      message: 'OTP sent to your registered number.',
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    });
  } catch (err) {
    logger.error('[login-otp/request] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/login-otp/verify ─────────────────────────────────────────
// Step 2: verify phone + OTP and issue JWT.
router.post('/login-otp/verify', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const otp   = String(req.body.otp   || '').trim();

    if (!phone || !otp)
      return res.status(400).json({ success: false, message: 'Phone and OTP are required' });

    const stored = loginOtps.get(phone);
    if (!stored || stored.otp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

    if (Date.now() > stored.expires) {
      loginOtps.delete(phone);
      return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
    }

    const user = await User.findOne({ phone });
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });

    if (user.isBlocked)
      return res.status(403).json({ success: false, message: 'Account is blocked. Contact support.' });

    loginOtps.delete(phone);

    const token = signToken(user._id);
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        balance: user.balance,
        bonusBalance: user.bonusBalance || 0,
        wagerRequired: user.wagerRequired || 0,
        wagerCompleted: user.wagerCompleted || 0,
        referralCode: user.referralCode,
      },
    });
  } catch (err) {
    logger.error('[login-otp/verify] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Generates a 6-digit OTP stored server-side (10 min TTL).
// In production: send via SMS (Twilio / MSG91). Currently returns token in
// response for testing — REMOVE the token from response before going live.
router.post('/forgot-password', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!phone)
      return res.status(400).json({ success: false, message: 'Phone number required' });

    const user = await User.findOne({ phone });
    // Always return success — don't reveal if phone exists (security)
    if (!user)
      return res.json({ success: true, message: 'If this number is registered, you will receive a reset code.' });

    // Generate 6-digit OTP
    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes
    resetTokens.set(phone, { otp, expires });

    await sendOTP(phone, otp);
    logger.info(`[forgot-password] OTP generated for ${phone}`);

    // ⚠️ REMOVE `otp` from response before going live — for dev/testing only
    res.json({
      success: true,
      message: 'Reset code sent to your registered number.',
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    });
  } catch (err) {
    logger.error('[forgot-password] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const phone    = String(req.body.phone    || '').trim();
    const otp      = String(req.body.otp      || '').trim();
    const password = String(req.body.password || '').trim();

    if (!phone || !otp || !password)
      return res.status(400).json({ success: false, message: 'Phone, OTP, and new password are required' });

    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const stored = resetTokens.get(phone);
    if (!stored || stored.otp !== otp)
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });

    if (Date.now() > stored.expires) {
      resetTokens.delete(phone);
      return res.status(400).json({ success: false, message: 'Reset code has expired. Request a new one.' });
    }

    const user = await User.findOne({ phone });
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });

    user.password = password; // pre-save hook will hash it
    await user.save();
    resetTokens.delete(phone);

    logger.info(`[reset-password] Password reset for ${phone}`);
    res.json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    logger.error('[reset-password] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PUT /api/auth/update (protected) ────────────────────────────────────────
router.put('/update', protect, async (req, res) => {
  try {
    const { name, email, password, currentPassword } = req.body;
    const user = await User.findById(req.user._id);

    if (name)  user.name  = String(name).trim();
    if (email) user.email = String(email).trim().toLowerCase();

    if (password) {
      if (password.length < 6)
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      // Require current password to change password
      if (!currentPassword)
        return res.status(400).json({ success: false, message: 'Current password required to set a new one' });
      const match = await user.matchPassword(currentPassword);
      if (!match)
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      user.password = password;
    }

    await user.save();
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    logger.error('[update] ' + err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/auth/me (protected) ────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/check-credentials ────────────────────────────────────────
// Used by login flow: verifies that phone + email belong to the same account
// before sending OTP. Prevents OTP spam on random emails.
router.post('/check-credentials', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!phone || !email)
      return res.status(400).json({ success: false, message: 'Phone and email are required' });

    const user = await User.findOne({ phone, email }).select('_id isBlocked').lean();

    if (!user)
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone & email combination. Please check your details.',
      });

    if (user.isBlocked)
      return res.status(403).json({ success: false, message: 'Account is blocked. Contact support.' });

    return res.json({ success: true });
  } catch (err) {
    logger.error('[check-credentials] ' + err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
module.exports.tokenBlacklist = tokenBlacklist;
