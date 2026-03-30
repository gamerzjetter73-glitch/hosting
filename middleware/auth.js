// ── middleware/auth.js  v15 ──
// Changes vs v14:
//   • Checks token blacklist on every request (logout invalidation)
//   • isBlocked check remains (already existed)

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// ─── User JWT Auth ───────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'No token provided' });

    const token = header.split(' ')[1];

    // Check blacklist (logged-out tokens)
    // Lazy-require to avoid circular dependency at startup
    const authRoutes = require('../routes/auth');
    if (authRoutes.tokenBlacklist && authRoutes.tokenBlacklist.has(token))
      return res.status(401).json({ success: false, message: 'Session ended. Please log in again.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password');

    if (!user)          return res.status(401).json({ success: false, message: 'User not found' });
    if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account blocked. Contact support.' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ─── Admin Key Auth ──────────────────────────────────────────────────────────
const adminProtect = (req, res, next) => {
  const key    = req.headers['x-admin-key'];
  const envKey = process.env.ADMIN_KEY;
  if (!key || !envKey || key !== envKey)
    return res.status(403).json({ success: false, message: 'Admin access denied' });
  next();
};

module.exports = { protect, adminProtect };
