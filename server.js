// ═══════════════════════════════════════════════════════════════
//  LEGIT CLUB — server.js  v18.0
//
//  NEW vs v17:
//    • Cricket Betting System added (matches, over bets, ball bets)
//    • /api/cricket  — user-facing: list matches, place bets, my-bets
//    • /api/admin/cricket — admin: create match, add markets, go-live,
//      update score, lock/settle markets, complete/cancel match
//    • CricketMatch + CricketBet models added
//    • Socket.io events: cricket:sync, cricket:match_live,
//      cricket:score_update, cricket:market_added, cricket:market_locked,
//      cricket:market_settled, cricket:match_completed, cricket:odds_update
//    • Cricket bets use same deductBet / Transaction pattern as all games
//    • Admin P&L, user profiles extended to include cricket bets
// ═══════════════════════════════════════════════════════════════
require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  override: true,
});

// ── Startup guards ──────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET) { console.error('❌  FATAL: JWT_SECRET is not set.'); process.exit(1); }
if (isProd  && process.env.JWT_SECRET.includes('change_me')) { console.error('❌  FATAL: JWT_SECRET is default.'); process.exit(1); }
if (!isProd && process.env.JWT_SECRET.includes('change_me')) { console.warn('⚠️   WARNING: JWT_SECRET is default.'); }
if (!process.env.ADMIN_KEY) { console.error('❌  FATAL: ADMIN_KEY is not set.'); process.exit(1); }
if (isProd  && process.env.ADMIN_KEY === 'admin@club91') { console.error('❌  FATAL: ADMIN_KEY is default.'); process.exit(1); }
if (!isProd && process.env.ADMIN_KEY === 'admin@club91') { console.warn('⚠️   WARNING: ADMIN_KEY is default.'); }

const express       = require('express');
const http          = require('http');
const { Server }    = require('socket.io');
const cors          = require('cors');
const helmet        = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const path          = require('path');
const rateLimit     = require('express-rate-limit');
const connectDB     = require('./config/db');
const { requestLogger, logger } = require('./middleware/logger');
const fs            = require('fs');

const app    = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
const rawOrigins    = process.env.ALLOWED_ORIGINS || '';
const allowedOrigins = rawOrigins ? rawOrigins.split(',').map(o => o.trim()).filter(Boolean) : [];
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-key','x-razorpay-signature'],
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS not allowed'));
    },
    methods: ['GET','POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use('/api/wallet/razorpay-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(mongoSanitize());
app.use(requestLogger);

// ── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { success:false, message:'Too many attempts. Try again in 15 minutes.' }, standardHeaders:true, legacyHeaders:false });
const apiLimiter  = rateLimit({ windowMs: 1*60*1000,  max: 120, message: { success:false, message:'Too many requests. Slow down.' } });
app.use('/api/auth', authLimiter);
app.use('/api/',     apiLimiter);

// ── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'Mainpro')));
app.use('/admin', express.static(path.join(__dirname, 'Admin')));
const uploadsDir = path.join(__dirname, 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch(e) {}
app.use('/uploads', express.static(uploadsDir));

// ── Routes ───────────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth');
const walletRoutes    = require('./routes/wallet');
const gameRoutes      = require('./routes/game');
const adminRoutes     = require('./routes/admin');
const emailOtpRoutes  = require('./routes/emailOtp');
const cricketRoutes   = require('./routes/cricket');        // ← NEW
const cricketAdminRoutes = require('./routes/cricketAdmin'); // ← NEW
const { startCricketLiveSync } = require('./services/cricketLiveSync'); // ← AUTO SYNC

app.use('/api/auth',           authRoutes);
app.use('/api/auth/email-otp', emailOtpRoutes);
app.use('/api/wallet',         walletRoutes);
app.use('/api/game',           gameRoutes(io));
app.use('/api/admin',          adminRoutes(io));
app.use('/api/cricket',        cricketRoutes);               // ← NEW
app.use('/api/admin/cricket',  cricketAdminRoutes(io));      // ← NEW

// ── Health Check ─────────────────────────────────────────────────────────────
const healthLimiter = rateLimit({ windowMs: 60*1000, max: 30, standardHeaders:true, legacyHeaders:false });
app.get('/health', healthLimiter, (req, res) => {
  const { readyState } = require('mongoose').connection;
  const dbStatus = ['disconnected','connected','connecting','disconnecting'][readyState] || 'unknown';
  res.status(readyState === 1 ? 200 : 503).json({ ok: readyState===1, db: dbStatus, uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
});
app.get('/',      (req, res) => res.sendFile(path.join(__dirname, 'Mainpro', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'Admin',   'index.html')));

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS:'))
    return res.status(403).json({ success:false, message: err.message });
  console.error('[Server Error]', err);
  res.status(500).json({ success:false, message:'Internal server error' });
});

// ═══════════════════════════════════════════════════════════════
//  SHARED MODELS
// ═══════════════════════════════════════════════════════════════
const WingoRound    = require('./models/WingoRound');
const AviatorRound  = require('./models/AviatorRound');
const K3Round       = require('./models/K3Round');
const TrxWingoRound = require('./models/TrxWingoRound');
const FiveDRound    = require('./models/FiveDRound');
const User          = require('./models/User');
const Transaction   = require('./models/Transaction');
const CricketMatch  = require('./models/CricketMatch'); // ← NEW

// ═══════════════════════════════════════════════════════════════
//  WAGER HELPERS (shared across all games including cricket)
// ═══════════════════════════════════════════════════════════════
async function deductRoundBet(userId, amount) {
  const user = await User.findById(userId).select('balance bonusBalance').lean();
  if (!user) return null;
  const totalAvail = (user.balance || 0) + (user.bonusBalance || 0);
  if (totalAvail < amount) return null;
  const bonusSpend = Math.min(user.bonusBalance || 0, amount);
  const realSpend  = amount - bonusSpend;
  return User.findByIdAndUpdate(userId, {
    $inc: { bonusBalance: -bonusSpend, balance: -realSpend, totalLost: amount, wagerCompleted: realSpend }
  }, { new: true });
}

async function creditRoundWin(userId, payout) {
  if (payout <= 0) return;
  await User.findByIdAndUpdate(userId, { $inc: { balance: payout, totalWon: payout } });
}

const NUM_COLOR = { 0:'Violet',1:'Green',2:'Red',3:'Green',4:'Red',5:'Violet',6:'Red',7:'Green',8:'Red',9:'Green' };

// ═══════════════════════════════════════════════════════════════
//  WIN GO ENGINE
// ═══════════════════════════════════════════════════════════════
const WINGO_GAMES = {
  wingo30s: { duration: 30,  label: '30 Sec', closeAt: 5  },
  wingo1m:  { duration: 60,  label: '1 Min',  closeAt: 10 },
  wingo3m:  { duration: 180, label: '3 Min',  closeAt: 10 },
  wingo5m:  { duration: 300, label: '5 Min',  closeAt: 10 },
};

const wingoState = {};
for (const gid of Object.keys(WINGO_GAMES)) {
  wingoState[gid] = { sec: 0, periodId: '', roundOpen: false, adminResult: null, startedAt: null };
}

function generatePeriodId(prefix) {
  const now  = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g,'');
  const seq  = String(Math.floor(now.getTime()/1000)).slice(-6);
  return `${prefix}_${date}${seq}`;
}

async function settleWingoRound(gid, result, periodId) {
  const round = await WingoRound.findOne({ periodId });
  if (!round || round.isResolved) return;
  const color = NUM_COLOR[result];
  round.result = result; round.resultColor = color;
  round.isResolved = true; round.isOpen = false;
  round.resolvedAt = new Date();
  let totalPayout = 0;
  for (const bet of round.bets) {
    let wins = false;
    if (bet.choice === 'Big')        wins = (result >= 5);
    else if (bet.choice === 'Small') wins = (result <= 4);
    else wins = (bet.choice === String(result) || bet.choice === color);
    if (!wins) continue;
    try {
      const betUser = await User.findById(bet.userId).select('godMode').lean();
      if ((betUser && betUser.godMode) || globalGodMode) continue;
    } catch(e) {}
    const payout = Math.floor(bet.amount * parseFloat(bet.odds));
    try {
      bet.won = true; bet.payout = payout; totalPayout += payout;
      await creditRoundWin(bet.userId, payout);
      await Transaction.create({ user: bet.userId, type:'win', amount:payout, status:'success', note:`Win Go WIN · ${bet.choice}→${result}(${color}) · ${periodId}` });
    } catch(e) { console.error('[settle wingo user]', e.message); }
  }
  round.totalPayout = totalPayout;
  round.houseProfit = round.totalBets - totalPayout;
  await round.save();
  io.emit(`${gid}:round_result`, { result, periodId, color });
  console.log(`[${gid}] Result=${result}(${color}) Bets=₹${round.totalBets} Payout=₹${totalPayout} House=₹${round.houseProfit}`);
}

async function startWingoRound(gid) {
  const cfg = WINGO_GAMES[gid], st = wingoState[gid];
  st.sec = cfg.duration; st.startedAt = Date.now();
  st.periodId = generatePeriodId(gid); st.roundOpen = true; st.adminResult = null;
  try { await WingoRound.create({ periodId: st.periodId, gameId: gid }); } catch(e) { console.error('[startWingoRound]', e.message); }
  io.emit(`${gid}:new_round`, { periodId: st.periodId, secondsLeft: st.sec });
  console.log(`[${gid}] New round: ${st.periodId} (${cfg.label})`);
}

function startWingoInterval() {
  setInterval(async () => {
    for (const gid of Object.keys(WINGO_GAMES)) {
      const st = wingoState[gid], cfg = WINGO_GAMES[gid];
      if (st.sec <= 0 && !st.periodId) continue;
      st.sec--;
      io.emit(`${gid}:timer_tick`, { secondsLeft: st.sec, periodId: st.periodId });
      if (st.sec === cfg.closeAt && st.roundOpen) {
        st.roundOpen = false;
        try { await WingoRound.findOneAndUpdate({ periodId: st.periodId }, { isOpen: false }); } catch(e) {}
        io.emit(`${gid}:round_ended`, { periodId: st.periodId });
      }
      if (st.sec <= 0) {
        const AUTO   = process.env.AUTO_RESULT !== '0';
        const result = (st.adminResult !== null) ? st.adminResult : (AUTO ? Math.floor(Math.random()*10) : null);
        const periodId = st.periodId;
        st.adminResult = null; st.periodId = '';
        if (result !== null) {
          try { await settleWingoRound(gid, result, periodId); } catch(e) { console.error('[wingo settle]', e.message); }
        } else {
          io.emit('admin:result_needed', { gid, periodId });
          console.warn(`[${gid}] ⚠️  No result set`);
        }
        try { await startWingoRound(gid); } catch(e) { console.error('[wingo start]', e.message); }
      }
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
//  AVIATOR ENGINE
// ═══════════════════════════════════════════════════════════════
let avState = {
  phase: 'waiting', mult: 1.0, crashAt: 1.0,
  periodId: '', countdown: 10, adminCrash: null,
  dbRoundId: null, flyStartTime: null, betCountdown: 0,
  crashQueue: [],
};

function genAvCrash() {
  if (avState.adminCrash !== null) { const v = avState.adminCrash; avState.adminCrash = null; return v; }
  if (avState.crashQueue.length > 0) {
    const v = avState.crashQueue.shift();
    console.log(`[Aviator] Queue: using ${v}x — ${avState.crashQueue.length} remaining`);
    io.emit('admin:av_queue_update', { queue: avState.crashQueue });
    return parseFloat(v);
  }
  const r = Math.random();
  if (r < 0.35) return parseFloat((1 + Math.random()*0.8).toFixed(2));
  if (r < 0.60) return parseFloat((1.8 + Math.random()*1.5).toFixed(2));
  if (r < 0.80) return parseFloat((3 + Math.random()*4).toFixed(2));
  if (r < 0.93) return parseFloat((7 + Math.random()*10).toFixed(2));
  return parseFloat((15 + Math.random()*35).toFixed(2));
}

async function startAvWaiting() {
  avState.phase = 'waiting'; avState.countdown = 10; avState.mult = 1.0;
  avState.periodId = 'av_' + Date.now(); avState.crashAt = genAvCrash();
  avState.dbRoundId = null; avState.flyStartTime = null;
  _avGodCheckAt = 0; _avGodModeActive = false;
  try { const doc = await AviatorRound.create({ periodId: avState.periodId, crashAt: avState.crashAt }); avState.dbRoundId = doc._id; }
  catch(e) { console.error('[av db create]', e.message); }
  io.emit('aviator:waiting', { periodId: avState.periodId, countdown: avState.countdown });
}

async function crashAviator() {
  avState.phase = 'crashed'; avState.betCountdown = 10; avState.betTickAcc = 0;
  const finalMult = avState.mult;
  io.emit('aviator:crash', { mult: finalMult, periodId: avState.periodId });
  console.log(`[Aviator] CRASH at ${finalMult}x`);
  try {
    const round = await AviatorRound.findById(avState.dbRoundId);
    if (round) {
      round.phase = 'crashed'; round.actualCrash = finalMult; round.crashedAt = new Date();
      for (const bet of round.bets) { if (!bet.cashedOut) { bet.payout = 0; } }
      const totalPayout = round.bets.reduce((s,b) => s+(b.payout||0), 0);
      round.totalPayout = totalPayout; round.houseProfit = round.totalBets - totalPayout;
      await round.save();
    }
  } catch(e) { console.error('[av db crash]', e.message); }
  try { await startAvWaiting(); } catch(e) { console.error('[av startWaiting after crash]', e.message); }
}

let _avGodCheckAt = 0, _avGodModeActive = false;

function startAvInterval() {
  setInterval(async () => {
    if (avState.phase === 'waiting') {
      avState.countdown--;
      io.emit('aviator:countdown', { countdown: avState.countdown, periodId: avState.periodId });
      if (avState.countdown <= 0) {
        avState.phase = 'flying'; avState.flyStartTime = Date.now(); avState.mult = 1.0;
        try { await AviatorRound.findByIdAndUpdate(avState.dbRoundId, { phase: 'flying' }); } catch(e) {}
        io.emit('aviator:fly_start', { periodId: avState.periodId });
      }
    }
  }, 1000);

  setInterval(async () => {
    if (avState.phase === 'flying') {
      const elapsedSec = (Date.now() - avState.flyStartTime) / 1000;
      avState.mult = parseFloat(Math.pow(Math.E, 0.06*elapsedSec).toFixed(2));
      io.emit('aviator:tick', { mult: avState.mult, periodId: avState.periodId });
      const now = Date.now();
      if (avState.dbRoundId && (now - _avGodCheckAt) >= 100) {
        _avGodCheckAt = now;
        try {
          const round = await AviatorRound.findById(avState.dbRoundId).select('bets').lean();
          if (round && round.bets && round.bets.length > 0) {
            const activeBets = round.bets.filter(b => !b.cashedOut);
            if (activeBets.length > 0) {
              _avGodModeActive = globalGodMode || await (async () => {
                const userIds = activeBets.map(b => b.userId);
                const godUsers = await User.find({ _id: { $in: userIds }, godMode: true }).select('_id').lean();
                return godUsers.length > 0;
              })();
            } else { _avGodModeActive = false; }
          }
        } catch(e) {}
      }
      if (_avGodModeActive && avState.phase === 'flying' && avState.mult >= 1.01) {
        avState.mult = 1.01; avState.phase = 'crashed';
        await crashAviator(); return;
      }
      if (avState.mult >= avState.crashAt) {
        avState.mult = avState.crashAt; avState.phase = 'crashed';
        await crashAviator();
      }
    }
  }, 100);
}

// ═══════════════════════════════════════════════════════════════
//  K3 DICE ENGINE
// ═══════════════════════════════════════════════════════════════
const K3_DURATION = 60;
let k3State = { sec: 0, periodId: '', roundOpen: false, adminDice: null };

function generateK3PeriodId() {
  const now = new Date();
  return `k3_${now.toISOString().slice(0,10).replace(/-/g,'')}${String(Math.floor(now.getTime()/1000)).slice(-6)}`;
}

async function settleK3Round(dice, periodId) {
  const sum = dice[0]+dice[1]+dice[2];
  const round = await K3Round.findOne({ periodId });
  if (!round || round.isResolved) return;
  const isTriple = dice[0]===dice[1] && dice[1]===dice[2];
  round.dice = dice; round.sum = sum; round.isResolved = true; round.isOpen = false; round.resolvedAt = new Date();
  let totalPayout = 0;
  for (const bet of round.bets) {
    let won = false;
    if      (bet.choice==='Big')    won = sum>=11&&sum<=17&&!isTriple;
    else if (bet.choice==='Small')  won = sum>=4&&sum<=10&&!isTriple;
    else if (bet.choice==='Odd')    won = sum%2!==0&&!isTriple;
    else if (bet.choice==='Even')   won = sum%2===0&&!isTriple;
    else if (bet.choice==='Triple') won = isTriple;
    else if (bet.choice.startsWith('Triple:')) won = dice.every(d=>d===parseInt(bet.choice.split(':')[1]));
    else if (bet.choice.startsWith('Sum:'))    won = sum===parseInt(bet.choice.split(':')[1]);
    if (won) {
      try { const betUser = await User.findById(bet.userId).select('godMode').lean(); if((betUser&&betUser.godMode)||globalGodMode) continue; } catch(e) {}
      const payout = Math.floor(bet.amount * bet.odds);
      try {
        bet.won=true; bet.payout=payout; totalPayout+=payout;
        await creditRoundWin(bet.userId, payout);
        await Transaction.create({ user:bet.userId, type:'win', amount:payout, status:'success', note:`K3 WIN · ${bet.choice}→${dice.join(',')} sum:${sum}` });
      } catch(e) { console.error('[k3 settle user]', e.message); }
    }
  }
  round.totalPayout = totalPayout; round.houseProfit = round.totalBets - totalPayout;
  await round.save();
  io.emit('k3:round_result', { dice, sum, periodId });
  console.log(`[K3] Dice=${dice.join(',')} Sum=${sum} Bets=₹${round.totalBets} Payout=₹${totalPayout}`);
}

async function startK3Round() {
  k3State.sec = K3_DURATION; k3State.periodId = generateK3PeriodId();
  k3State.roundOpen = true; k3State.adminDice = null;
  try { await K3Round.create({ periodId: k3State.periodId }); } catch(e) { console.error('[k3 start]', e.message); }
  io.emit('k3:new_round', { periodId: k3State.periodId, secondsLeft: K3_DURATION });
  console.log(`[K3] New round: ${k3State.periodId}`);
}

function startK3Interval() {
  setInterval(async () => {
    if (k3State.sec<=0&&!k3State.periodId) return;
    k3State.sec--;
    io.emit('k3:timer_tick', { secondsLeft: k3State.sec, periodId: k3State.periodId });
    if (k3State.sec===10&&k3State.roundOpen) {
      k3State.roundOpen=false;
      try { await K3Round.findOneAndUpdate({ periodId: k3State.periodId }, { isOpen: false }); } catch(e) {}
      io.emit('k3:round_ended', { periodId: k3State.periodId });
    }
    if (k3State.sec<=0) {
      const dice = k3State.adminDice || [Math.floor(Math.random()*6)+1, Math.floor(Math.random()*6)+1, Math.floor(Math.random()*6)+1];
      const periodId = k3State.periodId;
      k3State.adminDice=null; k3State.periodId='';
      try { await settleK3Round(dice, periodId); } catch(e) { console.error('[k3 settle]', e.message); }
      try { await startK3Round(); }               catch(e) { console.error('[k3 start]', e.message); }
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
//  TRX WINGO ENGINE
// ═══════════════════════════════════════════════════════════════
const TRX_DURATION  = 60;
const TRX_NUM_COLOR = { 0:'Violet',1:'Green',2:'Red',3:'Green',4:'Red',5:'Violet',6:'Red',7:'Green',8:'Red',9:'Green' };
let trxState = { sec: 0, periodId: '', roundOpen: false, adminResult: null };

function genTrxHash() { const c='0123456789abcdef'; let h=''; for(let i=0;i<64;i++) h+=c[Math.floor(Math.random()*16)]; return h; }
function genTrxResult(hash) { return parseInt(hash[hash.length-1], 16)%10; }
function generateTrxPeriodId() {
  const now = new Date();
  return `trx_${now.toISOString().slice(0,10).replace(/-/g,'')}${String(Math.floor(now.getTime()/1000)).slice(-6)}`;
}

async function settleTrxRound(result, hash, periodId) {
  const color = TRX_NUM_COLOR[result];
  const round = await TrxWingoRound.findOne({ periodId });
  if (!round||round.isResolved) return;
  round.result=result; round.resultColor=color; round.trxHash=hash;
  round.isResolved=true; round.isOpen=false; round.resolvedAt=new Date();
  let totalPayout=0;
  for (const bet of round.bets) {
    let wins=false;
    if (bet.choice==='Big')        wins=(result>=5);
    else if (bet.choice==='Small') wins=(result<=4);
    else wins=(bet.choice===String(result)||bet.choice===color);
    if (!wins) continue;
    try { const betUser=await User.findById(bet.userId).select('godMode').lean(); if((betUser&&betUser.godMode)||globalGodMode) continue; } catch(e) {}
    const payout=Math.floor(bet.amount*bet.odds);
    try {
      bet.won=true; bet.payout=payout; totalPayout+=payout;
      await creditRoundWin(bet.userId, payout);
      await Transaction.create({ user:bet.userId, type:'win', amount:payout, status:'success', note:`TRX Win Go WIN · ${bet.choice}→${result}(${color}) · ${periodId}` });
    } catch(e) { console.error('[trx settle user]', e.message); }
  }
  round.totalPayout=totalPayout; round.houseProfit=round.totalBets-totalPayout;
  await round.save();
  io.emit('trxwingo:round_result', { result, color, hash, periodId });
  console.log(`[TRX WinGo] Result=${result}(${color}) Hash=${hash.slice(0,8)}...`);
}

async function startTrxRound() {
  trxState.sec=TRX_DURATION; trxState.periodId=generateTrxPeriodId();
  trxState.roundOpen=true; trxState.adminResult=null;
  try { await TrxWingoRound.create({ periodId: trxState.periodId }); } catch(e) { console.error('[trx start]', e.message); }
  io.emit('trxwingo:new_round', { periodId: trxState.periodId, secondsLeft: TRX_DURATION });
  console.log(`[TRX WinGo] New round: ${trxState.periodId}`);
}

function startTrxInterval() {
  setInterval(async () => {
    if (trxState.sec<=0&&!trxState.periodId) return;
    trxState.sec--;
    io.emit('trxwingo:timer_tick', { secondsLeft: trxState.sec, periodId: trxState.periodId });
    if (trxState.sec===10&&trxState.roundOpen) {
      trxState.roundOpen=false;
      try { await TrxWingoRound.findOneAndUpdate({ periodId: trxState.periodId }, { isOpen: false }); } catch(e) {}
      io.emit('trxwingo:round_ended', { periodId: trxState.periodId });
    }
    if (trxState.sec<=0) {
      const hash=genTrxHash(), result=trxState.adminResult!==null?trxState.adminResult:genTrxResult(hash);
      const periodId=trxState.periodId;
      trxState.adminResult=null; trxState.periodId='';
      try { await settleTrxRound(result, hash, periodId); } catch(e) { console.error('[trx settle]', e.message); }
      try { await startTrxRound(); }                        catch(e) { console.error('[trx start]', e.message); }
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
//  5D LOTTERY ENGINE
// ═══════════════════════════════════════════════════════════════
const FIVED_DURATION = 180;
let fiveDState = { sec: 0, periodId: '', roundOpen: false, adminResult: null };

function generateFiveDPeriodId() {
  const now = new Date();
  return `5d_${now.toISOString().slice(0,10).replace(/-/g,'')}${String(Math.floor(now.getTime()/1000)).slice(-6)}`;
}

async function settleFiveDRound(nums, periodId) {
  const round = await FiveDRound.findOne({ periodId });
  if (!round||round.isResolved) return;
  const sum = nums.reduce((a,b)=>a+b,0);
  round.result=nums; round.isResolved=true; round.isOpen=false; round.resolvedAt=new Date();
  let totalPayout=0;
  const positions={A:0,B:1,C:2,D:3,E:4};
  for (const bet of round.bets) {
    let won=false;
    if (['A','B','C','D','E'].includes(bet.betType)) {
      const idx=positions[bet.betType];
      if      (bet.choice==='Big')   won=nums[idx]>=5;
      else if (bet.choice==='Small') won=nums[idx]<=4;
      else if (bet.choice==='Odd')   won=nums[idx]%2!==0;
      else if (bet.choice==='Even')  won=nums[idx]%2===0;
      else won=nums[idx]===parseInt(bet.choice);
    } else if (bet.betType==='sum') {
      if      (bet.choice==='Big')   won=sum>=23;
      else if (bet.choice==='Small') won=sum<=22;
      else if (bet.choice==='Odd')   won=sum%2!==0;
      else if (bet.choice==='Even')  won=sum%2===0;
    }
    if (won) {
      try { const betUser=await User.findById(bet.userId).select('godMode').lean(); if((betUser&&betUser.godMode)||globalGodMode) continue; } catch(e) {}
      const payout=Math.floor(bet.amount*bet.odds);
      try {
        bet.won=true; bet.payout=payout; totalPayout+=payout;
        await creditRoundWin(bet.userId, payout);
        await Transaction.create({ user:bet.userId, type:'win', amount:payout, status:'success', note:`5D WIN · ${bet.betType}:${bet.choice}→${nums.join('')}` });
      } catch(e) { console.error('[5d settle user]', e.message); }
    }
  }
  round.totalPayout=totalPayout; round.houseProfit=round.totalBets-totalPayout;
  await round.save();
  io.emit('fived:round_result', { result: nums, sum, periodId });
  console.log(`[5D] Result=${nums.join('')} Sum=${sum} Bets=₹${round.totalBets} Payout=₹${totalPayout}`);
}

async function startFiveDRound() {
  fiveDState.sec=FIVED_DURATION; fiveDState.periodId=generateFiveDPeriodId();
  fiveDState.roundOpen=true; fiveDState.adminResult=null;
  try { await FiveDRound.create({ periodId: fiveDState.periodId }); } catch(e) { console.error('[5d start]', e.message); }
  io.emit('fived:new_round', { periodId: fiveDState.periodId, secondsLeft: FIVED_DURATION });
  console.log(`[5D] New round: ${fiveDState.periodId}`);
}

function startFiveDInterval() {
  setInterval(async () => {
    if (fiveDState.sec<=0&&!fiveDState.periodId) return;
    fiveDState.sec--;
    io.emit('fived:timer_tick', { secondsLeft: fiveDState.sec, periodId: fiveDState.periodId });
    if (fiveDState.sec===15&&fiveDState.roundOpen) {
      fiveDState.roundOpen=false;
      try { await FiveDRound.findOneAndUpdate({ periodId: fiveDState.periodId }, { isOpen: false }); } catch(e) {}
      io.emit('fived:round_ended', { periodId: fiveDState.periodId });
    }
    if (fiveDState.sec<=0) {
      const nums=fiveDState.adminResult||Array.from({length:5},()=>Math.floor(Math.random()*10));
      const periodId=fiveDState.periodId;
      fiveDState.adminResult=null; fiveDState.periodId='';
      try { await settleFiveDRound(nums, periodId); } catch(e) { console.error('[5d settle]', e.message); }
      try { await startFiveDRound(); }               catch(e) { console.error('[5d start]', e.message); }
    }
  }, 1000);
}

// ═══════════════════════════════════════════════════════════════
//  EXPOSE STATE TO ROUTES
// ═══════════════════════════════════════════════════════════════
app.locals.getWingoState       = (gid) => wingoState[gid] || null;
app.locals.getAllWingoStates    = () => wingoState;
app.locals.setWingoAdminResult = (gid, result) => { if (wingoState[gid]) wingoState[gid].adminResult = result; };
app.locals.settleWingoRound    = settleWingoRound;
app.locals.getAvState          = () => avState;
app.locals.setAdminCrash       = (v) => { avState.adminCrash = v; };
app.locals.getAvQueue          = () => avState.crashQueue;
app.locals.setAvQueue          = (arr) => { avState.crashQueue = arr.map(v=>parseFloat(v)).filter(v=>v>=1.01); };
app.locals.clearAvQueue        = () => { avState.crashQueue = []; };
app.locals.WINGO_GAMES         = WINGO_GAMES;
app.locals.getK3State          = () => k3State;
app.locals.setK3AdminDice      = (dice) => { k3State.adminDice = dice; };
app.locals.settleK3Round       = settleK3Round;
app.locals.getTrxState         = () => trxState;
app.locals.setTrxAdminResult   = (v) => { trxState.adminResult = v; };
app.locals.getFiveDState        = () => fiveDState;
app.locals.setFiveDAdminResult  = (v) => { fiveDState.adminResult = v; };

// ── Global God Mode ──────────────────────────────────────────────────────────
let globalGodMode = false;
app.locals.getGlobalGodMode = () => globalGodMode;
app.locals.setGlobalGodMode = (v) => {
  globalGodMode = !!v;
  console.log(`[GlobalGodMode] ${globalGodMode ? '😈 ENABLED' : '✅ DISABLED'}`);
  io.emit('admin:global_godmode', { enabled: globalGodMode });
};

// ═══════════════════════════════════════════════════════════════
//  SOCKET SYNC (existing games + cricket)
// ═══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  // Existing game sync
  for (const gid of Object.keys(WINGO_GAMES)) {
    const st = wingoState[gid];
    socket.emit(`${gid}:sync`, { periodId: st.periodId, secondsLeft: st.sec });
  }
  socket.emit('aviator:sync', { phase: avState.phase, mult: avState.mult, countdown: avState.countdown, periodId: avState.periodId });
  socket.emit('k3:sync',       { periodId: k3State.periodId,    secondsLeft: k3State.sec });
  socket.emit('trxwingo:sync', { periodId: trxState.periodId,   secondsLeft: trxState.sec });
  socket.emit('fived:sync',    { periodId: fiveDState.periodId, secondsLeft: fiveDState.sec });

  // ── Cricket sync: send all live/upcoming matches to newly connected client ──
  CricketMatch.find({ status: { $in: ['upcoming','live'] } })
    .select('matchId title teamA teamB teamAShort teamBShort tournament status score markets isBettingOpen scheduledAt')
    .lean()
    .then(matches => socket.emit('cricket:sync', { matches }))
    .catch(() => {});
});

// ═══════════════════════════════════════════════════════════════
//  BACKUP SCHEDULER
// ═══════════════════════════════════════════════════════════════
function startBackupScheduler() {
  const mins = parseInt(process.env.BACKUP_INTERVAL_MINUTES) || 0;
  if (!mins) { console.log('[Backup] Disabled (BACKUP_INTERVAL_MINUTES=0)'); return; }
  const { runBackup } = require('./scripts/backup');
  setInterval(() => { console.log('[Backup] Running...'); runBackup(); }, mins*60*1000);
  console.log(`[Backup] Scheduled every ${mins} minutes`);
}

// ═══════════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════════
connectDB().then(async () => {
  const PORT = process.env.PORT || 3000;

  // ── Wager migration ───────────────────────────────────────────────────────
  try {
    const MIGRATION_KEY = 'wager_migration_v2_done';
    const alreadyDone = await User.findOne({ name: '__migration__', referralCode: MIGRATION_KEY }).lean();
    if (!alreadyDone) {
      console.log('🔄  [Migration] Starting wager fix...');
      const users = await User.find({}).select('_id wagerRequired wagerCompleted totalDeposited bonusBalance').lean();
      let fixed=0, skipped=0;
      for (const u of users) {
        const correctWagerRequired = 200 + ((u.totalDeposited||0)*2);
        const safeWagerRequired    = Math.max(correctWagerRequired, u.wagerCompleted||0);
        if (u.wagerRequired !== safeWagerRequired) { await User.findByIdAndUpdate(u._id, { $set: { wagerRequired: safeWagerRequired } }); fixed++; }
        else skipped++;
      }
      await User.create({ name:'__migration__', phone:null, email:`migration_${Date.now()}@system.internal`, password:'not_a_real_user_'+Date.now(), referralCode: MIGRATION_KEY });
      console.log(`✅  [Migration] Done! Fixed: ${fixed}, Skipped: ${skipped}`);
    } else { console.log('✅  [Migration] Already done, skipping.'); }
  } catch(migErr) { console.error('⚠️  [Migration] Error (non-fatal):', migErr.message); }

  const { verifyEmailService } = require('./services/emailService');
  verifyEmailService().catch(() => {});

  server.listen(PORT, async () => {
    console.log(`✅  LEGIT CLUB v18.0 → http://localhost:${PORT}`);
    console.log(`🔧  Admin panel → http://localhost:${PORT}/admin`);
    console.log(`🏏  Cricket betting → /api/cricket`);
    console.log(`🎮  Auto-result: ${process.env.AUTO_RESULT !== '0' ? 'ON (random)' : 'OFF (manual only)'}`);

    startWingoInterval();
    startAvInterval();
    startK3Interval();
    startTrxInterval();
    startFiveDInterval();

    const gids = Object.keys(WINGO_GAMES);
    for (let i=0; i<gids.length; i++) setTimeout(() => startWingoRound(gids[i]), i*1500);
    setTimeout(startAvWaiting,  gids.length*1500+1000);
    setTimeout(startK3Round,    3000);
    setTimeout(startTrxRound,   4000);
    setTimeout(startFiveDRound, 5000);

    startBackupScheduler();

    // ── AUTO-SEED IPL 2026 matches on every startup (skips existing) ────────
    try {
      const { seedIPLMatches } = require('./scripts/seedIPLMatches');
      console.log('🏏  [IPL Seed] Starting IPL 2026 match seeding...');
      const { created, skipped } = await seedIPLMatches(CricketMatch);
      if (created > 0) {
        console.log(`🏏  [IPL Seed] ✅ Created ${created} new IPL 2026 matches (${skipped} already existed)`);
      } else {
        console.log(`🏏  [IPL Seed] ✅ All ${skipped} IPL 2026 matches already in DB — skipping`);
      }
    } catch(seedErr) {
      console.error('⚠️  [IPL Seed] Error during seeding:', seedErr.message);
      console.error('⚠️  [IPL Seed] Run manually: node scripts/seedIPLMatches.js');
    }

    startCricketLiveSync(io);  // ← AUTO LIVE CRICKET SYNC
    console.log('🎲  All game engines started');
    console.log('🏏  Cricket auto live sync active (set CRICAPI_KEY in .env)');
  });
}).catch(err => { console.error('❌  DB connection failed:', err.message); process.exit(1); });

process.on('SIGTERM', () => { logger.info('SIGTERM — shutting down...'); server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { logger.info('SIGINT — shutting down...');  server.close(() => process.exit(0)); });
process.on('uncaughtException',  (err) => { logger.error(`UNCAUGHT EXCEPTION: ${err.stack||err}`); });
process.on('unhandledRejection', (err) => { logger.error(`UNHANDLED REJECTION: ${err}`); });
