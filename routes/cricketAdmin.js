// ── routes/cricketAdmin.js  v1.0 ──
// Admin-only cricket betting management.
// All routes protected by x-admin-key header (adminProtect middleware).
//
// FULL ADMIN WORKFLOW:
//   1. POST /api/admin/cricket/match          → Create match + default markets
//   2. POST /api/admin/cricket/market/add-over → Add "Over X Runs" market
//   3. POST /api/admin/cricket/market/add-ball → Add "Ball X.Y Outcome" market
//   4. POST /api/admin/cricket/market/add      → Add any custom market
//   5. POST /api/admin/cricket/market/odds     → Update odds live
//   6. POST /api/admin/cricket/match/live      → Open betting, mark match live
//   7. POST /api/admin/cricket/score           → Update live scoreboard
//   8. POST /api/admin/cricket/market/lock     → Lock market (stop new bets)
//   9. POST /api/admin/cricket/market/settle   → Declare winner, pay out
//  10. POST /api/admin/cricket/match/complete  → End match, settle all remaining
//  11. DELETE /api/admin/cricket/match/:matchId → Cancel match, refund all bets
//  12. GET  /api/admin/cricket/matches         → List all matches (with stats)
//  13. GET  /api/admin/cricket/match/:matchId/stats → Detailed P&L per market

const express          = require('express');
const CricketMatch     = require('../models/CricketMatch');
const CricketBet       = require('../models/CricketBet');
const User             = require('../models/User');
const Transaction      = require('../models/Transaction');
const { adminProtect } = require('../middleware/auth');
const { logger }       = require('../middleware/logger');

// ── Default option builders ───────────────────────────────────────────────────
function matchWinnerOptions(a, b) {
  return [
    { key: a, label: a, odds: 1.85 },
    { key: b, label: b, odds: 1.85 },
  ];
}
function tossOptions(a, b) {
  return [
    { key: a, label: `${a} wins toss`, odds: 1.90 },
    { key: b, label: `${b} wins toss`, odds: 1.90 },
  ];
}
function overRunsOptions() {
  return [
    { key: '0-5',   label: '0–5 Runs',   odds: 2.5 },
    { key: '6-10',  label: '6–10 Runs',  odds: 2.0 },
    { key: '11-15', label: '11–15 Runs', odds: 2.8 },
    { key: '16+',   label: '16+ Runs',   odds: 3.5 },
  ];
}
function ballOutcomeOptions() {
  return [
    { key: '0',      label: 'Dot Ball',   odds: 2.0 },
    { key: '1',      label: '1 Run',      odds: 3.0 },
    { key: '2',      label: '2 Runs',     odds: 4.5 },
    { key: '3',      label: '3 Runs',     odds: 8.0 },
    { key: '4',      label: 'FOUR! 🏏',   odds: 3.5 },
    { key: '6',      label: 'SIX! 🚀',    odds: 5.0 },
    { key: 'wicket', label: 'Wicket! 🎯', odds: 6.0 },
    { key: 'wide',   label: 'Wide/NB',    odds: 4.0 },
  ];
}
function inningsRunsOptions(matchType) {
  if (matchType === 'T20') return [
    { key: '0-139',   label: 'Under 140', odds: 1.9 },
    { key: '140-159', label: '140–159',   odds: 2.2 },
    { key: '160-179', label: '160–179',   odds: 2.0 },
    { key: '180+',    label: '180+',      odds: 2.5 },
  ];
  return [
    { key: '0-249',   label: 'Under 250', odds: 1.9 },
    { key: '250-299', label: '250–299',   odds: 2.0 },
    { key: '300-349', label: '300–349',   odds: 2.2 },
    { key: '350+',    label: '350+',      odds: 2.8 },
  ];
}

// ── Settle one market and credit winners ──────────────────────────────────────
async function settleMarket(match, marketId, winningKey, io) {
  const market = match.markets.find(m => m.marketId === marketId);
  if (!market || market.status === 'settled') return { settled: 0, paid: 0 };

  const bets = await CricketBet.find({ matchId: match.matchId, marketId, status: 'pending' }).lean();
  let totalPayout = 0;

  for (const bet of bets) {
    if (bet.choice === winningKey) {
      const payout = parseFloat((bet.amount * bet.odds).toFixed(2));
      await Promise.all([
        CricketBet.findByIdAndUpdate(bet._id, { status: 'won', payout, settledAt: new Date() }),
        User.findByIdAndUpdate(bet.user, { $inc: { balance: payout, totalWon: payout } }),
        Transaction.create({
          user:   bet.user,
          type:   'win',
          amount: payout,
          status: 'success',
          note:   `Cricket WIN — ${match.title} | ${bet.marketLabel} | ${bet.choiceLabel} @ ${bet.odds}x`,
        }),
      ]);
      totalPayout += payout;
    } else {
      await CricketBet.findByIdAndUpdate(bet._id, { status: 'lost', payout: 0, settledAt: new Date() });
    }
  }

  // Mark market settled on the match document
  market.status    = 'settled';
  market.result    = winningKey;
  market.settledAt = new Date();
  await match.save();

  const totalBetOnMarket = bets.reduce((s,b) => s+b.amount, 0);
  const profit = totalBetOnMarket - totalPayout;
  await CricketMatch.findByIdAndUpdate(match._id, { $inc: { totalPayout, houseProfit: profit } });

  logger.info(`[Cricket] Settled: ${match.matchId}/${marketId} winner=${winningKey} bets=${bets.length} payout=₹${totalPayout} profit=₹${profit}`);

  if (io) {
    io.emit('cricket:market_settled', {
      matchId:      match.matchId,
      marketId,
      marketLabel:  market.label,
      winningKey,
      winningLabel: market.options.find(o => o.key === winningKey)?.label || winningKey,
    });
  }
  return { settled: bets.length, paid: totalPayout };
}

// ── Refund all pending bets for a match ───────────────────────────────────────
async function refundAllBets(match) {
  const bets = await CricketBet.find({ matchId: match.matchId, status: 'pending' }).lean();
  for (const bet of bets) {
    await Promise.all([
      CricketBet.findByIdAndUpdate(bet._id, { status: 'refunded', settledAt: new Date() }),
      User.findByIdAndUpdate(bet.user, { $inc: { balance: bet.amount } }),
      Transaction.create({
        user:   bet.user,
        type:   'bonus',
        amount: bet.amount,
        status: 'success',
        note:   `Cricket refund — ${match.title} (match cancelled)`,
      }),
    ]);
  }
  return bets.length;
}

// ═════════════════════════════════════════════════════════════════════════════
module.exports = function cricketAdminRoutes(io) {
  const router = express.Router();
  router.use(adminProtect);

  // ── GET all matches ─────────────────────────────────────────────────────────
  router.get('/matches', async (req, res) => {
    try {
      const matches = await CricketMatch.find().sort({ scheduledAt: -1 }).limit(100).lean();
      res.json({ success: true, matches });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST create match ────────────────────────────────────────────────────────
  // Required body: matchId, title, teamA, teamB, teamAShort, teamBShort, scheduledAt
  // Optional: tournament, venue, matchType
  router.post('/match', async (req, res) => {
    try {
      const { matchId, title, teamA, teamB, teamAShort, teamBShort, tournament='IPL', venue='', matchType='T20', scheduledAt } = req.body;
      if (!matchId||!title||!teamA||!teamB||!teamAShort||!teamBShort||!scheduledAt)
        return res.status(400).json({ success: false, message: 'Required: matchId, title, teamA, teamB, teamAShort, teamBShort, scheduledAt' });

      const markets = [
        { marketId: 'toss_winner',   type: 'toss_winner',   label: 'Toss Winner',                    options: tossOptions(teamAShort, teamBShort),          status: 'open' },
        { marketId: 'match_winner',  type: 'match_winner',  label: 'Match Winner',                   options: matchWinnerOptions(teamAShort, teamBShort),   status: 'open' },
        { marketId: 'innings1_runs', type: 'innings_runs',  label: `${teamAShort} 1st Innings Runs`, options: inningsRunsOptions(matchType),                status: 'open' },
        { marketId: 'innings2_runs', type: 'innings_runs',  label: `${teamBShort} 2nd Innings Runs`, options: inningsRunsOptions(matchType),                status: 'open' },
      ];

      const match = await CricketMatch.create({ matchId, title, teamA, teamB, teamAShort, teamBShort, tournament, venue, matchType, scheduledAt: new Date(scheduledAt), markets, isBettingOpen: false, status: 'upcoming' });
      logger.info(`[Cricket] Match created: ${matchId} — ${title}`);
      res.json({ success: true, message: 'Match created with 4 default markets (Toss, Match Winner, Innings Runs x2)', match });
    } catch(e) {
      if (e.code===11000) return res.status(400).json({ success: false, message: 'Match ID already exists' });
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── POST add over runs market ────────────────────────────────────────────────
  // Body: { matchId, overNumber }
  router.post('/market/add-over', async (req, res) => {
    try {
      const { matchId, overNumber } = req.body;
      if (!matchId||!overNumber) return res.status(400).json({ success: false, message: 'matchId and overNumber required' });
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const marketId = `over_${overNumber}_runs`;
      if (match.markets.find(m=>m.marketId===marketId)) return res.status(400).json({ success: false, message: `Over ${overNumber} market already exists` });
      const newMarket = { marketId, type: 'over_runs', label: `Over ${overNumber} — Runs Scored`, options: overRunsOptions(), status: 'open' };
      match.markets.push(newMarket);
      await match.save();
      io.emit('cricket:market_added', { matchId, market: newMarket });
      res.json({ success: true, message: `Over ${overNumber} market added`, marketId });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST add ball outcome market ─────────────────────────────────────────────
  // Body: { matchId, over, ball }  e.g. over=19 ball=6 → "Ball 19.6 — What happens?"
  router.post('/market/add-ball', async (req, res) => {
    try {
      const { matchId, over, ball } = req.body;
      if (!matchId||over==null||ball==null) return res.status(400).json({ success: false, message: 'matchId, over, ball required' });
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const marketId = `ball_${over}.${ball}`;
      if (match.markets.find(m=>m.marketId===marketId)) return res.status(400).json({ success: false, message: `Ball ${over}.${ball} market already exists` });
      const newMarket = { marketId, type: 'ball_outcome', label: `Ball ${over}.${ball} — What happens?`, options: ballOutcomeOptions(), status: 'open' };
      match.markets.push(newMarket);
      await match.save();
      io.emit('cricket:market_added', { matchId, market: newMarket });
      res.json({ success: true, message: `Ball ${over}.${ball} market added`, marketId });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST settle toss — convenience endpoint ───────────────────────────────────
  // Body: { matchId, winner }  winner = teamAShort of the team that won the toss
  // Automatically locks the toss market first, then settles it.
  router.post('/market/settle-toss', async (req, res) => {
    try {
      const { matchId, winner } = req.body;
      if (!matchId || !winner) return res.status(400).json({ success: false, message: 'matchId and winner required' });
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const market = match.markets.find(m => m.marketId === 'toss_winner');
      if (!market) return res.status(404).json({ success: false, message: 'Toss market not found on this match' });
      if (market.status === 'settled') return res.status(400).json({ success: false, message: 'Toss already settled' });
      if (!market.options.find(o => o.key === winner))
        return res.status(400).json({ success: false, message: `"${winner}" is not a valid toss option. Use the team short code.` });
      // Lock first to stop new bets
      market.status = 'locked';
      market.lockedAt = new Date();
      await match.save();
      // Settle
      const result = await settleMarket(match, 'toss_winner', winner, io);
      io.emit('cricket:toss_result', { matchId, winner, title: match.title });
      logger.info(`[Cricket] Toss settled: ${matchId} winner=${winner} paid=${result.paid}`);
      res.json({ success: true, message: `Toss settled — ${winner} won the toss`, ...result });
    } catch(e) {
      logger.error('[Cricket] settle-toss: ' + e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── POST add fully custom market ─────────────────────────────────────────────
  // Body: { matchId, marketId, type, label, options: [{key, label, odds}] }
  router.post('/market/add', async (req, res) => {
    try {
      const { matchId, marketId, type, label, options } = req.body;
      if (!matchId||!marketId||!type||!label||!options?.length) return res.status(400).json({ success: false, message: 'matchId, marketId, type, label, options required' });
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      if (match.markets.find(m=>m.marketId===marketId)) return res.status(400).json({ success: false, message: 'Market ID already exists' });
      const newMarket = { marketId, type, label, options, status: 'open' };
      match.markets.push(newMarket);
      await match.save();
      io.emit('cricket:market_added', { matchId, market: newMarket });
      res.json({ success: true, message: 'Market added', marketId });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST go live ─────────────────────────────────────────────────────────────
  router.post('/match/live', async (req, res) => {
    try {
      const { matchId } = req.body;
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      match.status = 'live'; match.isBettingOpen = true;
      await match.save();
      io.emit('cricket:match_live', { matchId, title: match.title, teamA: match.teamA, teamB: match.teamB, markets: match.markets.filter(m=>m.status==='open') });
      logger.info(`[Cricket] Match LIVE: ${matchId}`);
      res.json({ success: true, message: 'Match is live, betting open' });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST update live score ────────────────────────────────────────────────────
  // Body: { matchId, teamAInnings1?, teamBInnings1?, currentOver?, currentBall?, batting?, lastBall?, commentary? }
  router.post('/score', async (req, res) => {
    try {
      const { matchId, ...scoreUpdate } = req.body;
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const allowed = ['teamAInnings1','teamBInnings1','currentOver','currentBall','batting','lastBall','commentary'];
      for (const f of allowed) { if (scoreUpdate[f] !== undefined) match.score[f] = scoreUpdate[f]; }
      await match.save();
      io.emit('cricket:score_update', { matchId, score: match.score, title: match.title });
      res.json({ success: true, message: 'Score updated', score: match.score });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST lock market ──────────────────────────────────────────────────────────
  router.post('/market/lock', async (req, res) => {
    try {
      const { matchId, marketId } = req.body;
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const market = match.markets.find(m=>m.marketId===marketId);
      if (!market) return res.status(404).json({ success: false, message: 'Market not found' });
      market.status = 'locked'; market.lockedAt = new Date();
      await match.save();
      io.emit('cricket:market_locked', { matchId, marketId, label: market.label });
      res.json({ success: true, message: `"${market.label}" locked` });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST settle market ────────────────────────────────────────────────────────
  // Body: { matchId, marketId, winningKey }
  router.post('/market/settle', async (req, res) => {
    try {
      const { matchId, marketId, winningKey } = req.body;
      if (!matchId||!marketId||!winningKey) return res.status(400).json({ success: false, message: 'matchId, marketId, winningKey required' });
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const market = match.markets.find(m=>m.marketId===marketId);
      if (!market) return res.status(404).json({ success: false, message: 'Market not found' });
      if (!market.options.find(o=>o.key===winningKey)) return res.status(400).json({ success: false, message: 'winningKey is not a valid option' });
      if (market.status==='settled') return res.status(400).json({ success: false, message: 'Market already settled' });
      const result = await settleMarket(match, marketId, winningKey, io);
      res.json({ success: true, message: 'Market settled', ...result });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST complete match ───────────────────────────────────────────────────────
  // Settles match_winner using declared winner, refunds all other unsettled markets
  // Body: { matchId, winner }  winner = teamAShort or teamBShort
  router.post('/match/complete', async (req, res) => {
    try {
      const { matchId, winner } = req.body;
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      let totalSettled=0, totalPaid=0;
      for (const market of match.markets) {
        if (market.status==='settled'||market.status==='cancelled') continue;
        if (market.type==='match_winner'&&winner) {
          const r = await settleMarket(match, market.marketId, winner, io);
          totalSettled += r.settled; totalPaid += r.paid;
        } else {
          // Refund unsettled markets
          const unsettled = await CricketBet.find({ matchId, marketId: market.marketId, status: 'pending' }).lean();
          for (const bet of unsettled) {
            await Promise.all([
              CricketBet.findByIdAndUpdate(bet._id, { status: 'refunded', settledAt: new Date() }),
              User.findByIdAndUpdate(bet.user, { $inc: { balance: bet.amount } }),
              Transaction.create({ user: bet.user, type: 'bonus', amount: bet.amount, status: 'success', note: `Cricket refund — ${match.title} | ${market.label} (unsettled)` }),
            ]);
          }
          market.status = 'cancelled';
          totalSettled += unsettled.length;
        }
      }
      match.status = 'completed'; match.isBettingOpen = false; match.winner = winner||null;
      await match.save();
      io.emit('cricket:match_completed', { matchId, title: match.title, winner });
      logger.info(`[Cricket] Match completed: ${matchId} winner=${winner} settled=${totalSettled}`);
      res.json({ success: true, message: 'Match completed', totalSettled, totalPaid });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── DELETE cancel match — refund everything ───────────────────────────────────
  router.delete('/match/:matchId', async (req, res) => {
    try {
      const match = await CricketMatch.findOne({ matchId: req.params.matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      if (match.status==='completed') return res.status(400).json({ success: false, message: 'Cannot cancel a completed match' });
      match.status = 'cancelled'; match.isBettingOpen = false;
      await match.save();
      const refunded = await refundAllBets(match);
      io.emit('cricket:match_cancelled', { matchId: match.matchId, title: match.title });
      logger.info(`[Cricket] Match cancelled: ${match.matchId} — ${refunded} bets refunded`);
      res.json({ success: true, message: `Match cancelled, ${refunded} bets refunded` });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST update odds ──────────────────────────────────────────────────────────
  // Body: { matchId, marketId, options: [{key, odds}] }
  router.post('/market/odds', async (req, res) => {
    try {
      const { matchId, marketId, options } = req.body;
      const match = await CricketMatch.findOne({ matchId });
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const market = match.markets.find(m=>m.marketId===marketId);
      if (!market) return res.status(404).json({ success: false, message: 'Market not found' });
      for (const upd of options) {
        const opt = market.options.find(o=>o.key===upd.key);
        if (opt&&upd.odds>0) opt.odds = upd.odds;
      }
      await match.save();
      io.emit('cricket:odds_update', { matchId, marketId, options: market.options });
      res.json({ success: true, message: 'Odds updated', options: market.options });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── GET match stats ───────────────────────────────────────────────────────────
  router.get('/match/:matchId/stats', async (req, res) => {
    try {
      const match = await CricketMatch.findOne({ matchId: req.params.matchId }).lean();
      if (!match) return res.status(404).json({ success: false, message: 'Match not found' });
      const bets = await CricketBet.find({ matchId: req.params.matchId }).lean();
      const byMarket = {};
      for (const bet of bets) {
        if (!byMarket[bet.marketId]) byMarket[bet.marketId] = { total:0, bets:0, byChoice:{} };
        byMarket[bet.marketId].total += bet.amount;
        byMarket[bet.marketId].bets  += 1;
        byMarket[bet.marketId].byChoice[bet.choice] = (byMarket[bet.marketId].byChoice[bet.choice]||0) + bet.amount;
      }
      res.json({
        success: true,
        match: { matchId: match.matchId, title: match.title, status: match.status, totalBetsAmount: match.totalBetsAmount, totalPayout: match.totalPayout, houseProfit: match.houseProfit },
        totalBets: bets.length,
        byMarket,
      });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ── POST /api/admin/cricket/seed — manually trigger IPL seeder ──────────────
  router.post('/seed', adminProtect, async (req, res) => {
    try {
      const { seedIPLMatches } = require('../scripts/seedIPLMatches');
      const { created, skipped } = await seedIPLMatches(CricketMatch);
      res.json({ success: true, message: `Seeded ${created} new matches, skipped ${skipped} existing.`, created, skipped });
    } catch(e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
};
