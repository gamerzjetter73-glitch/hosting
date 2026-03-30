// ── routes/wallet.js  v13 ──
// Changes vs v12:
//   • Withdrawals auto-trigger Cashfree Payout API (UPI transfer)
//   • Razorpay webhook endpoint for server-side deposit confirmation
//   • Withdrawal validation: UPI ID format check
//   • Balance only deducted AFTER payout is accepted by Cashfree (not before)
//   • Cashfree payout status stored on transaction for admin visibility

const express     = require('express');
const router      = express.Router();
const Razorpay    = require('razorpay');
const crypto      = require('crypto');
const https       = require('https');
const path        = require('path');
const fs          = require('fs');
const multer      = require('multer');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');
const { runOcrOnImage, verifyOcr } = require('../services/upiOcr');

// ── Deposit Wager Increment ───────────────────────────────────────────────────
// On every deposit, add depositAmount × 2 to wagerRequired.
// This STACKS on top of any remaining wager from the signup bonus.
//
// HOW THE FULL WAGER SYSTEM WORKS:
//   1. Register  → bonus ₹100 added → wagerRequired = ₹200 (2× bonus)
//   2. User bets with bonus balance → wagerCompleted increases
//   3. If user deposits ₹100 before finishing bonus wager:
//        wagerRequired += ₹200 (deposit × 2)
//        Total remaining = (200 - wagerCompleted) + 200
//   4. If user completes ₹200 bonus wager WITHOUT depositing → withdraw unlocked ✅
//   5. Wagers always stack — deposit wager is always added on top of whatever is left
async function addDepositWager(userId, depositAmount) {
  try {
    const wagerAdd = depositAmount * 2;
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { wagerRequired: wagerAdd } },
      { new: true }
    ).select('wagerRequired wagerCompleted');
    const remaining = Math.max(0, (user.wagerRequired || 0) - (user.wagerCompleted || 0));
    console.log(`[Wager] +₹${wagerAdd} wager added for ₹${depositAmount} deposit by user ${userId} | Total remaining: ₹${remaining}`);
  } catch (e) {
    console.error('[Wager] Error updating wager requirement:', e.message);
  }
}
// Called after any deposit is confirmed. If this user was referred and hasn't
// triggered the reward yet, and deposit >= ₹100, pay the referrer ₹100.
async function maybePayReferralReward(userId, depositAmount) {
  if (depositAmount < 100) return;
  try {
    // Atomically mark referralRewarded=true so we never double-pay
    const user = await User.findOneAndUpdate(
      { _id: userId, referredBy: { $ne: null }, referralRewarded: false },
      { $set: { referralRewarded: true } },
      { new: true }
    ).select('referredBy name').lean();
    if (!user || !user.referredBy) return; // already rewarded or no referrer

    // Find the referrer by their referral code
    const referrer = await User.findOneAndUpdate(
      { referralCode: user.referredBy },
      { $inc: { balance: 100 } },
      { new: true }
    ).select('_id name').lean();
    if (!referrer) return;

    await Transaction.create({
      user: referrer._id,
      type: 'bonus',
      amount: 100,
      status: 'success',
      note: `Referral reward — ${user.name} made their first deposit`,
    });
    console.log(`[Referral] ₹100 paid to ${referrer.name} for referring ${user.name}`);
  } catch (e) {
    console.error('[Referral] Error paying referral reward:', e.message);
  }
}

const MIN_DEPOSIT  = 1,   MAX_DEPOSIT  = 100000;
const MIN_WITHDRAW = 50,  MAX_WITHDRAW = 50000;  // Min ₹50, no practical upper limit

function getDepositMode() {
  return String(process.env.DEPOSIT_MODE || 'razorpay').toLowerCase(); // 'razorpay' | 'upi_manual'
}

function getUpiConfig() {
  return {
    provider: String(process.env.UPI_PROVIDER || 'fampay'),
    vpa: String(process.env.UPI_VPA || '').trim(),
    qrUrl: String(process.env.UPI_QR_URL || '').trim(),
    payeeName: String(process.env.UPI_PAYEE_NAME || '').trim(),
  };
}

function normalizeUtr(utr) {
  return String(utr || '').trim().replace(/\s+/g, '').toUpperCase();
}

function isValidUtr(utr) {
  // UPI UTR/reference is often 12 digits, but can be alphanumeric depending on app/bank.
  // Keep this permissive but safe.
  return /^[A-Z0-9]{10,30}$/.test(utr);
}

function safeFileName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

const depositUploadDir = path.join(__dirname, '..', 'uploads', 'deposits');
try { fs.mkdirSync(depositUploadDir, { recursive: true }); } catch(e) {}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, depositUploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      const base = safeFileName(`dep_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      cb(null, base + ext);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.mimetype);
    if (!ok) return cb(new Error('Only image files are allowed (png/jpg/webp).'));
    cb(null, true);
  },
});

async function tryAutoApproveUpiDeposit(txId) {
  // Best-effort: OCR the screenshot, and auto-approve ONLY on strong match.
  try {
    const tx = await Transaction.findById(txId).lean();
    if (!tx || tx.type !== 'deposit' || tx.status !== 'pending') return;
    if (!tx.screenshotUrl) return;

    const abs = path.join(__dirname, '..', tx.screenshotUrl.replace(/^\//, ''));
    const ocrText = await runOcrOnImage(abs);
    const check = verifyOcr({ ocrText, utr: tx.upiUtr, vpa: tx.upiVpa, amount: tx.amount });

    await Transaction.findByIdAndUpdate(txId, {
      $set: { ocrText, ocrVerdict: check.verdict },
    });

    // Only auto-approve on HIGH confidence (UTR + VPA + amount)
    if (!(check.verdict === 'match' && check.confidence === 'high')) return;

    // Approve atomically: only if still pending.
    const bonus = tx.amount >= 500 ? Math.floor(tx.amount * 0.20) : 0;
    const updatedTx = await Transaction.findOneAndUpdate(
      { _id: txId, status: 'pending' },
      { $set: { status: 'success', note: (tx.note ? tx.note + ' | ' : '') + 'Auto-approved (OCR matched)' } },
      { new: true }
    );
    if (!updatedTx) return;

    const user = await User.findByIdAndUpdate(
      tx.user,
      { $inc: { balance: tx.amount + bonus, totalDeposited: tx.amount } },
      { new: true }
    );
    if (bonus > 0) {
      await Transaction.create({ user: tx.user, type: 'bonus', amount: bonus, status: 'success', note: 'Deposit bonus 20% (auto OCR)' });
    }
    // Add deposit wager requirement (2× deposit amount)
    await addDepositWager(tx.user, tx.amount);
    // Referral reward: pay referrer ₹100 if this is the user's first deposit ≥ ₹100
    await maybePayReferralReward(tx.user, tx.amount);
    return user;
  } catch (e) {
    try { await Transaction.findByIdAndUpdate(txId, { $set: { ocrVerdict: 'error' } }); } catch {}
    console.error('[deposit/ocr]', e);
  }
}

// ── Razorpay instance (lazy) ──────────────────────────────────────────────────
function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID || '';
  if (!key_id || key_id.includes('XXXXX') || key_id.includes('xxxxxxxxxx')) return null;
  return new Razorpay({ key_id, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// ── Cashfree Payout helper ───────────────────────────────────────────────────
// Docs: https://docs.cashfree.com/docs/payout-create-beneficiary
async function cashfreePayout({ transferId, upiId, name, amount }) {
  const appId = process.env.CASHFREE_APP_ID || '';
  const secret = process.env.CASHFREE_SECRET_KEY || '';
  const mode = (process.env.CASHFREE_MODE || 'TEST').toUpperCase();

  if (!appId || appId.includes('REPLACE') || !secret || secret.includes('REPLACE')) {
    return { ok: false, reason: 'Cashfree not configured' };
  }

  const baseUrl = mode === 'PROD'
    ? 'https://payout-api.cashfree.com'
    : 'https://payout-gamma.cashfree.com';

  // Step 1: Get auth token
  const authRes = await fetchJSON(`${baseUrl}/payout/v1/authorize`, 'POST', null, {
    'X-Client-Id': appId,
    'X-Client-Secret': secret,
  });
  if (!authRes?.status === 'SUCCESS' && !authRes?.data?.token) {
    return { ok: false, reason: 'Cashfree auth failed: ' + JSON.stringify(authRes) };
  }
  const token = authRes.data.token;

  // Step 2: Request transfer
  const body = {
    beneDetails: {
      beneId:  `bene_${transferId}`,
      name:    name || 'User',
      email:   `${transferId}@legitclub.in`,
      phone:   '9999999999',
      vpa:     upiId,
    },
    amount:     String(amount),
    transferId: transferId,
    transferMode: 'upi',
    remarks:   'LEGITCLUB withdrawal',
  };

  const txRes = await fetchJSON(`${baseUrl}/payout/v1/directTransfer`, 'POST', body, {
    'Authorization': `Bearer ${token}`,
  });

  if (txRes?.status === 'SUCCESS' || txRes?.data?.utr) {
    return { ok: true, utr: txRes?.data?.utr, cfTransferId: txRes?.data?.referenceId };
  }
  return { ok: false, reason: txRes?.message || JSON.stringify(txRes) };
}

// Tiny fetch wrapper using native https (no extra dep)
function fetchJSON(url, method, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// UPI ID basic format check: something@something
function isValidUpi(upi) {
  return /^[\w.\-+]+@[\w]+$/.test(upi);
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/balance', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('balance bonusBalance wagerRequired wagerCompleted totalWon totalLost totalDeposited totalWithdrawn');
    const wagerRequired  = user.wagerRequired  || 0;
    const wagerCompleted = user.wagerCompleted || 0;
    const wagerRemaining = Math.max(0, wagerRequired - wagerCompleted);
    // withdrawalUnlocked: true when either no wager was ever set, OR all wager is complete
    const withdrawalUnlocked = wagerRequired === 0 || wagerRemaining === 0;
    res.json({
      success: true,
      balance: user.balance,
      bonusBalance: user.bonusBalance || 0,
      wagerRequired,
      wagerCompleted,
      wagerRemaining,
      withdrawalUnlocked,
      bonusCleared: withdrawalUnlocked && wagerRequired > 0,
      totalWon: user.totalWon,
      totalLost: user.totalLost,
      totalDeposited: user.totalDeposited,
      totalWithdrawn: user.totalWithdrawn,
    });
  } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

router.get('/transactions', protect, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const txs   = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await Transaction.countDocuments({ user: req.user._id });
    res.json({ success: true, transactions: txs, total, page });
  } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
});

// ─── Deposit: UPI (manual) config ────────────────────────────────────────────
router.get('/deposit/config', protect, async (req, res) => {
  const mode = getDepositMode();
  const upi = getUpiConfig();
  res.json({
    success: true,
    mode,
    upi: {
      provider: upi.provider,
      vpa: upi.vpa,
      qrUrl: upi.qrUrl,
      payeeName: upi.payeeName,
    },
    minDeposit: MIN_DEPOSIT,
    maxDeposit: MAX_DEPOSIT,
    bonusRule: { threshold: 500, percent: 20 },
  });
});

// ─── Deposit: UPI (manual) request ───────────────────────────────────────────
router.post('/deposit/request', protect, upload.single('screenshot'), async (req, res) => {
  try {
    const mode = getDepositMode();
    if (mode !== 'upi_manual')
      return res.status(400).json({ success: false, message: 'UPI manual deposits are not enabled' });

    const amount = parseInt(req.body.amount);
    const utr = normalizeUtr(req.body.utr);
    const payerUpi = String(req.body.payerUpi || '').trim();
    const file = req.file;

    if (!amount || amount < MIN_DEPOSIT)
      return res.status(400).json({ success: false, message: `Minimum deposit is ₹${MIN_DEPOSIT}` });
    if (amount > MAX_DEPOSIT)
      return res.status(400).json({ success: false, message: `Maximum deposit is ₹${MAX_DEPOSIT}` });
    if (!utr || !isValidUtr(utr))
      return res.status(400).json({ success: false, message: 'Please enter a valid UTR/Ref No.' });
    if (!file)
      return res.status(400).json({ success: false, message: 'Please upload payment screenshot with UTR visible.' });

    // Idempotency by UTR (prevents double-credit across users too)
    const existing = await Transaction.findOne({ upiUtr: utr });
    if (existing) {
      return res.status(409).json({ success: false, message: 'This UTR is already submitted.' });
    }

    const upi = getUpiConfig();
    if (!upi.vpa) {
      return res.status(503).json({ success: false, message: 'UPI deposit is not configured. Contact admin.' });
    }

    const screenshotUrl = `/uploads/deposits/${path.basename(file.path)}`;
    const tx = await Transaction.create({
      user: req.user._id,
      type: 'deposit',
      amount,
      status: 'pending',
      note: `UPI deposit request | UTR: ${utr}`,
      upiUtr: utr,
      upiVpa: upi.vpa,
      payerUpi,
      provider: upi.provider,
      screenshotUrl,
    });

    // OCR runs async; if it strongly matches, it will auto-approve.
    setTimeout(() => { tryAutoApproveUpiDeposit(tx._id); }, 50);

    res.json({ success: true, message: 'Deposit request submitted. Checking screenshot...', depositId: tx._id, autoCheck: true });
  } catch (e) {
    console.error('[deposit/request]', e);
    if (e && String(e.message || '').includes('Only image files are allowed'))
      return res.status(400).json({ success: false, message: e.message });
    if (e && String(e.message || '').includes('File too large'))
      return res.status(400).json({ success: false, message: 'Screenshot too large (max 2MB).' });
    // Handle duplicate key (race) for UTR
    if (e && e.code === 11000) return res.status(409).json({ success: false, message: 'This UTR is already submitted.' });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Deposit: create Razorpay order ─────────────────────────────────────────
router.post('/deposit/create-order', protect, async (req, res) => {
  try {
    if (getDepositMode() === 'upi_manual') {
      return res.status(400).json({
        success: false,
        message: 'Deposits are currently via UPI QR. Please submit UTR after payment.',
        mode: 'upi_manual',
      });
    }

    const amount = parseInt(req.body.amount);
    if (!amount || amount < MIN_DEPOSIT)
      return res.status(400).json({ success: false, message: `Minimum deposit is ₹${MIN_DEPOSIT}` });
    if (amount > MAX_DEPOSIT)
      return res.status(400).json({ success: false, message: `Maximum deposit is ₹${MAX_DEPOSIT}` });

    const rzp = getRazorpay();
    if (!rzp) {
      if (process.env.NODE_ENV === 'production')
        return res.status(503).json({ success: false, message: 'Payment gateway not configured. Contact admin.' });
      // DEV MODE — instant credit
      const user  = await User.findById(req.user._id);
      const bonus = amount >= 500 ? Math.floor(amount * 0.20) : 0;
      const total = amount + bonus;
      user.balance += total; user.totalDeposited += amount;
      await user.save();
      await Transaction.create({ user: user._id, type: 'deposit', amount, status: 'success', note: 'DEV MODE deposit' });
      if (bonus > 0)
        await Transaction.create({ user: user._id, type: 'bonus', amount: bonus, status: 'success', note: 'Deposit bonus 20%' });
      return res.json({ success: true, devMode: true, newBalance: user.balance, bonus, message: `DEV MODE: ₹${total} added` });
    }

    const order = await rzp.orders.create({
      amount:   amount * 100,
      currency: 'INR',
      receipt:  'rcpt_' + Date.now(),
      notes:    { userId: String(req.user._id) },  // used by webhook to credit correct user
    });
    res.json({ success: true, key: process.env.RAZORPAY_KEY_ID, order });
  } catch (e) {
    console.error('[deposit/create-order]', e);
    res.status(500).json({ success: false, message: 'Could not create payment order' });
  }
});

// ─── Deposit: client-side verify (fallback) ──────────────────────────────────
router.post('/deposit/verify', protect, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !amount)
      return res.status(400).json({ success: false, message: 'Missing payment fields' });

    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
    if (expected !== razorpay_signature)
      return res.status(400).json({ success: false, message: 'Payment verification failed' });

    // Idempotency
    const existing = await Transaction.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (existing) return res.json({ success: true, message: 'Already processed' });

    const depositAmount = parseInt(amount);
    if (!depositAmount || depositAmount < MIN_DEPOSIT)
      return res.status(400).json({ success: false, message: 'Invalid amount' });

    const bonus = depositAmount >= 500 ? Math.floor(depositAmount * 0.20) : 0;
    // Atomic credit — prevents double-credit if two verify requests race
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { balance: depositAmount + bonus, totalDeposited: depositAmount } },
      { new: true }
    );
    await Transaction.create({
      user: user._id, type: 'deposit', amount: depositAmount, status: 'success',
      note: 'Razorpay deposit', razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id,
    });
    if (bonus > 0)
      await Transaction.create({ user: user._id, type: 'bonus', amount: bonus, status: 'success', note: 'Deposit bonus 20%' });
    await addDepositWager(user._id, depositAmount);
    await maybePayReferralReward(user._id, depositAmount);
    res.json({ success: true, newBalance: user.balance, bonus });
  } catch (e) {
    console.error('[deposit/verify]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Razorpay Webhook (server-side — more reliable than client verify) ────────
// Register this URL in Razorpay Dashboard → Webhooks: https://yourdomain.com/api/wallet/razorpay-webhook
// Event: payment.captured
router.post('/razorpay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig    = req.headers['x-razorpay-signature'] || '';
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

    if (!secret || secret.includes('REPLACE')) {
      console.warn('[webhook] RAZORPAY_WEBHOOK_SECRET not set — skipping verification');
    } else {
      const expected = crypto.createHmac('sha256', secret)
        .update(req.body).digest('hex');
      if (expected !== sig) {
        console.warn('[webhook] Invalid Razorpay signature');
        return res.status(400).json({ error: 'Invalid signature' });
      }
    }

    const event = JSON.parse(req.body.toString());
    if (event.event !== 'payment.captured') return res.json({ ok: true }); // ignore other events

    const payment = event.payload?.payment?.entity;
    if (!payment) return res.json({ ok: true });

    const paymentId = payment.id;
    const orderId   = payment.order_id;
    const amountINR = Math.floor(payment.amount / 100);

    // Idempotency — don't credit twice
    const existing = await Transaction.findOne({ razorpayPaymentId: paymentId });
    if (existing) return res.json({ ok: true, msg: 'Already processed' });

    // Find user via notes.userId we store in order creation, or fall back to description
    // Razorpay orders can carry a `notes` object — we store userId when creating the order
    const notes  = payment.notes || {};
    const userId = notes.userId;
    if (!userId) {
      console.warn('[webhook] payment.captured but no userId in notes — manual action needed', paymentId);
      return res.json({ ok: true });
    }

    const bonus = amountINR >= 500 ? Math.floor(amountINR * 0.20) : 0;
    const user  = await User.findByIdAndUpdate(
      userId,
      { $inc: { balance: amountINR + bonus, totalDeposited: amountINR } },
      { new: true }
    );
    if (!user) return res.json({ ok: true });
    await Transaction.create({
      user: user._id, type: 'deposit', amount: amountINR, status: 'success',
      note: 'Razorpay webhook deposit', razorpayOrderId: orderId, razorpayPaymentId: paymentId,
    });
    if (bonus > 0)
      await Transaction.create({ user: user._id, type: 'bonus', amount: bonus, status: 'success', note: 'Deposit bonus 20%' });
    await addDepositWager(user._id, amountINR);
    await maybePayReferralReward(user._id, amountINR);

    console.log(`[webhook] Credited ₹${amountINR} + ₹${bonus} bonus to user ${userId}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[razorpay-webhook]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Withdraw: auto UPI payout via Cashfree ───────────────────────────────────
router.post('/withdraw', protect, async (req, res) => {
  try {
    const amount  = parseInt(req.body.amount);
    const account = String(req.body.account || '').trim();

    if (!amount || amount < MIN_WITHDRAW)
      return res.status(400).json({ success: false, message: `Minimum withdrawal is ₹${MIN_WITHDRAW}` });
    if (amount > MAX_WITHDRAW)
      return res.status(400).json({ success: false, message: `Maximum withdrawal is ₹${MAX_WITHDRAW}` });
    if (!account)
      return res.status(400).json({ success: false, message: 'UPI ID is required' });
    if (!isValidUpi(account))
      return res.status(400).json({ success: false, message: 'Invalid UPI ID format (example: name@upi)' });

    // ── Wagering requirement check ────────────────────────────────────────────
    // User must complete their full wager requirement before withdrawing.
    // wagerRequired is set at signup (2× bonus = ₹200) and increases with each
    // deposit (2× deposit amount). ALL bets (bonus + real) count toward wagerCompleted.
    // If user completes bonus wager without depositing → withdrawal is unlocked.
    // If user deposits before finishing bonus wager → deposit wager is added on top.
    const userCheck = await User.findById(req.user._id).select('bonusBalance wagerRequired wagerCompleted');
    const wagerRequired  = userCheck.wagerRequired  || 0;
    const wagerCompleted = userCheck.wagerCompleted || 0;
    const wagerRemaining = Math.max(0, wagerRequired - wagerCompleted);

    if (wagerRemaining > 0) {
      return res.status(400).json({
        success: false,
        message: `Complete wagering first. You need to bet ₹${wagerRemaining} more to unlock withdrawal.`,
        wagerRemaining,
        wagerCompleted,
        wagerRequired,
      });
    }

    // ── Atomic balance deduction — prevents double-spend race condition ──────
    // findOneAndUpdate with $inc only succeeds if balance is sufficient.
    // Two simultaneous requests cannot both pass this check.
    const user = await User.findOneAndUpdate(
      { _id: req.user._id, balance: { $gte: amount } },
      { $inc: { balance: -amount, totalWithdrawn: amount } },
      { new: true }
    );
    if (!user)
      return res.status(400).json({ success: false, message: 'Insufficient balance' });

    // Unique transfer ID for Cashfree idempotency
    const transferId = `91c_${user._id}_${Date.now()}`;

    // Attempt Cashfree payout (balance already held)
    const cfResult = await cashfreePayout({
      transferId,
      upiId:  account,
      name:   user.name,
      amount,
    });

    if (!cfResult.ok) {
      const cfNotConfigured = cfResult.reason === 'Cashfree not configured';
      if (!cfNotConfigured) {
        // Cashfree rejected — refund the held balance atomically
        await User.findByIdAndUpdate(user._id, { $inc: { balance: amount, totalWithdrawn: -amount } });
        console.error('[withdraw] Cashfree error:', cfResult.reason);
        return res.status(502).json({ success: false, message: `Payout failed: ${cfResult.reason}. Please try again or contact support.` });
      }

      // Cashfree not configured → manual queue (balance stays held)
      await Transaction.create({
        user: user._id, type: 'withdraw', amount, status: 'pending',
        note: `Manual withdrawal to ${account}`,
        withdrawUpi: account,
      });
      return res.json({ success: true, newBalance: user.balance, message: 'Withdrawal submitted. Will be processed by admin within 24 hours.', manual: true });
    }

    // Cashfree accepted
    await Transaction.create({
      user: user._id, type: 'withdraw', amount, status: 'success',
      note: `UPI payout to ${account} | UTR: ${cfResult.utr || 'pending'} | CF: ${cfResult.cfTransferId || transferId}`,
    });

    res.json({
      success: true,
      newBalance: user.balance,
      message: `₹${amount} sent to ${account}. UTR: ${cfResult.utr || 'Processing...'}`,
      utr: cfResult.utr,
    });
  } catch (e) {
    console.error('[withdraw]', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
module.exports.maybePayReferralReward = maybePayReferralReward;
module.exports.addDepositWager = addDepositWager;
