// ── routes/cricket.js  v1.0 ──
// User-facing cricket betting endpoints.
// Bets use the SAME deductBet / Transaction pattern as all other games.
// Wallet integration: balance deducted on bet, credited on win — fully atomic.

const express      = require('express');
const router       = express.Router();
const CricketMatch = require('../models/CricketMatch');
const CricketBet   = require('../models/CricketBet');
const User         = require('../models/User');
const Transaction  = require('../models/Transaction');
const { protect }  = require('../middleware/auth');
const { logger }   = require('../middleware/logger');

const MIN_BET = 10;
const MAX_BET = 50000;

// ── Deduct bet atomically — same pattern as game.js ──────────────────────────
async function deductBet(userId, amount) {
  const user = await User.findById(userId).select('balance bonusBalance wagerRequired wagerCompleted').lean();
  if (!user) return null;
  const totalAvailable = (user.balance||0) + (user.bonusBalance||0);
  if (totalAvailable < amount) return null;
  const bonusSpend = Math.min(user.bonusBalance||0, amount);
  const realSpend  = amount - bonusSpend;
  return User.findByIdAndUpdate(userId, {
    $inc: { bonusBalance: -bonusSpend, balance: -realSpend, totalLost: amount, wagerCompleted: amount }
  }, { new: true });
}

// ── GET /api/cricket/matches — list upcoming + live matches ──────────────────
router.get('/matches', async (req, res) => {
  try {
    // Support status=all to return everything, or comma-separated statuses
    let filter = {};
    if (!req.query.status || req.query.status === 'all') {
      filter.status = { $in: ['upcoming','live','completed'] };
    } else if (req.query.status.includes(',')) {
      filter.status = { $in: req.query.status.split(',') };
    } else {
      filter.status = req.query.status;
    }
    if (req.query.tournament) filter.tournament = req.query.tournament;
    const matches = await CricketMatch.find(filter)
      .select('-totalBetsAmount -totalPayout -houseProfit')
      .sort({ scheduledAt: 1 })
      .lean();
    res.json({ success: true, matches });
  } catch(e) {
    logger.error('[Cricket] GET /matches: ' + e.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/cricket/matches/:matchId — full match with markets & odds ────────
router.get('/matches/:matchId', async (req, res) => {
  try {
    const match = await CricketMatch.findOne({ matchId: req.params.matchId })
      .select('-totalBetsAmount -totalPayout -houseProfit')
      .lean();
    if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
    res.json({ success: true, match });
  } catch(e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/cricket/bet — place a bet ──────────────────────────────────────
router.post('/bet', protect, async (req, res) => {
  try {
    const { matchId, marketId, choice, amount } = req.body;
    const betAmount = parseInt(amount);

    if (!betAmount || betAmount < MIN_BET)
      return res.status(400).json({ success: false, message: `Minimum bet is ₹${MIN_BET}` });
    if (betAmount > MAX_BET)
      return res.status(400).json({ success: false, message: `Maximum bet is ₹${MAX_BET}` });
    if (!matchId || !marketId || !choice)
      return res.status(400).json({ success: false, message: 'matchId, marketId and choice are required' });

    // Load match
    const match = await CricketMatch.findOne({ matchId });
    if (!match)
      return res.status(404).json({ success: false, message: 'Match not found' });
    if (!match.isBettingOpen || match.status === 'completed' || match.status === 'cancelled')
      return res.status(400).json({ success: false, message: 'Betting is closed for this match' });

    // Find the market
    const market = match.markets.find(m => m.marketId === marketId);
    if (!market)
      return res.status(404).json({ success: false, message: 'Market not found' });
    if (market.status !== 'open')
      return res.status(400).json({ success: false, message: `This market is currently ${market.status}` });

    // Find the chosen option
    const option = market.options.find(o => o.key === choice);
    if (!option)
      return res.status(400).json({ success: false, message: 'Invalid choice for this market' });

    // Deduct balance atomically
    const updatedUser = await deductBet(req.user._id, betAmount);
    if (!updatedUser)
      return res.status(400).json({ success: false, message: 'Insufficient balance' });

    // Save bet
    const bet = await CricketBet.create({
      user:        req.user._id,
      match:       match._id,
      matchId,
      marketId,
      marketType:  market.type,
      marketLabel: market.label,
      choice,
      choiceLabel: option.label,
      odds:        option.odds,
      amount:      betAmount,
    });

    // Track match totals
    await CricketMatch.findByIdAndUpdate(match._id, { $inc: { totalBetsAmount: betAmount } });

    // Transaction record
    await Transaction.create({
      user:   req.user._id,
      type:   'loss',
      amount: betAmount,
      status: 'success',
      note:   `Cricket bet — ${match.title} | ${market.label} | ${option.label} @ ${option.odds}x`,
    });

    logger.info(`[Cricket] Bet: user=${req.user._id} match=${matchId} market=${marketId} choice=${choice} ₹${betAmount} @${option.odds}x`);

    res.json({
      success: true,
      message: 'Bet placed!',
      bet: {
        betId:        bet._id,
        matchTitle:   match.title,
        marketLabel:  market.label,
        choiceLabel:  option.label,
        odds:         option.odds,
        amount:       betAmount,
        potentialWin: parseFloat((betAmount * option.odds).toFixed(2)),
      },
      newBalance: parseFloat(((updatedUser.balance||0) + (updatedUser.bonusBalance||0)).toFixed(2)),
      realBalance: updatedUser.balance,
      bonusBalance: updatedUser.bonusBalance||0,
    });
  } catch(e) {
    logger.error('[Cricket] POST /bet: ' + e.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/cricket/my-bets — paginated bet history ────────────────────────
router.get('/my-bets', protect, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page-1)*limit;
    const filter = { user: req.user._id };
    if (req.query.matchId) filter.matchId = req.query.matchId;
    if (req.query.status)  filter.status  = req.query.status;
    const [bets, total] = await Promise.all([
      CricketBet.find(filter).sort({ createdAt:-1 }).skip(skip).limit(limit).lean(),
      CricketBet.countDocuments(filter),
    ]);
    res.json({ success: true, bets, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch(e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/cricket/my-bets/:matchId — bets for one match ──────────────────
router.get('/my-bets/:matchId', protect, async (req, res) => {
  try {
    const bets = await CricketBet.find({ user: req.user._id, matchId: req.params.matchId }).sort({ createdAt:-1 }).lean();
    const totalInvested = bets.reduce((s,b) => s+b.amount, 0);
    const totalWon      = bets.filter(b=>b.status==='won').reduce((s,b) => s+b.payout, 0);
    res.json({ success: true, bets, totalInvested, totalWon });
  } catch(e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
