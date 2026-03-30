// ═══════════════════════════════════════════════════════════════════════════
//  services/cricketLiveSync.js  — Auto Live Cricket Sync (CricketData.org)
//
//  API:  cricketdata.org  (formerly CricAPI)  →  host: api.cricapi.com
//
//  FREE KEY:  100 calls/day  — good for testing, 1-2 live matches
//  PAID KEY:  Higher limits  — for production with real users
//
//  ENDPOINTS USED:
//    GET https://api.cricapi.com/v1/currentMatches?apikey=KEY&offset=0
//         → lists all live + recent matches with basic scores
//
//  ADD TO .env:
//    CRICAPI_KEY=your-key-from-cricketdata.org
//    CRICKET_AUTO_SYNC=true
//    CRICKET_SYNC_INTERVAL=30000   ← 30s recommended (free plan = 100 calls/day)
//
//  FIXES in this version:
//    1. Over run settlement now uses REAL runs from API (not hardcoded 8)
//    2. overStartRuns tracked per-over so we know exact runs scored in that over
//    3. CRICKET_SYNC_INTERVAL warning added if set too high (>300000 = 5min)
//    4. crickapiGet URL fixed — endpoint already has '?' so use '&apikey'
//    5. Stale match re-fetch after over settlement fixed
// ═══════════════════════════════════════════════════════════════════════════

const CricketMatch = require('../models/CricketMatch');
const CricketBet   = require('../models/CricketBet');
const User         = require('../models/User');
const Transaction  = require('../models/Transaction');
const { logger }   = require('../middleware/logger');

const CRICAPI_BASE = 'https://api.cricapi.com/v1';

// ─── Market option builders ────────────────────────────────────────────────
function overRunsOptions() {
  return [
    { key: '0-5',   label: '0-5 Runs',   odds: 2.5 },
    { key: '6-10',  label: '6-10 Runs',  odds: 2.0 },
    { key: '11-15', label: '11-15 Runs', odds: 2.8 },
    { key: '16+',   label: '16+ Runs',   odds: 3.5 },
  ];
}
function ballOutcomeOptions() {
  return [
    { key: '0',      label: 'Dot Ball',   odds: 2.0 },
    { key: '1',      label: '1 Run',      odds: 3.0 },
    { key: '2',      label: '2 Runs',     odds: 4.5 },
    { key: '3',      label: '3 Runs',     odds: 8.0 },
    { key: '4',      label: 'FOUR!',      odds: 3.5 },
    { key: '6',      label: 'SIX!',       odds: 5.0 },
    { key: 'wicket', label: 'Wicket!',    odds: 6.0 },
    { key: 'wide',   label: 'Wide/NB',    odds: 4.0 },
  ];
}
function matchWinnerOptions(a, b) {
  return [
    { key: a, label: a, odds: 1.85 },
    { key: b, label: b, odds: 1.85 },
  ];
}
function inningsRunsOptions(matchType) {
  if (matchType === 'T20') return [
    { key: '0-139',   label: 'Under 140', odds: 1.9 },
    { key: '140-159', label: '140-159',   odds: 2.2 },
    { key: '160-179', label: '160-179',   odds: 2.0 },
    { key: '180+',    label: '180+',      odds: 2.5 },
  ];
  return [
    { key: '0-249',   label: 'Under 250', odds: 1.9 },
    { key: '250-299', label: '250-299',   odds: 2.0 },
    { key: '300-349', label: '300-349',   odds: 2.2 },
    { key: '350+',    label: '350+',      odds: 2.8 },
  ];
}

// ─── Map actual run count to market key ────────────────────────────────────
function mapOverRunKey(runs) {
  const r = parseInt(runs) || 0;
  if (r <= 5)  return '0-5';
  if (r <= 10) return '6-10';
  if (r <= 15) return '11-15';
  return '16+';
}

function parseOvers(oversStr) {
  const parts = String(oversStr || '0.0').split('.');
  return { over: parseInt(parts[0]) || 0, ball: parseInt(parts[1]) || 0 };
}

function detectMatchType(apiType) {
  const t = (apiType || '').toUpperCase();
  if (t.includes('TEST')) return 'Test';
  if (t.includes('ODI'))  return 'ODI';
  return 'T20';
}

function shortCode(name) {
  if (!name) return 'UNK';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().substring(0, 4);
  return name.substring(0, 4).toUpperCase();
}

// ─── Settle market and pay winners ─────────────────────────────────────────
async function settleMarket(match, marketId, winningKey, io) {
  // Always re-fetch fresh to avoid stale state
  const freshMatch  = await CricketMatch.findById(match._id);
  const freshMarket = freshMatch.markets.find(m => m.marketId === marketId);
  if (!freshMarket || freshMarket.status === 'settled') return { settled: 0, paid: 0 };

  const bets = await CricketBet.find({ matchId: freshMatch.matchId, marketId, status: 'pending' }).lean();
  let totalPayout = 0;

  for (const bet of bets) {
    if (bet.choice === winningKey) {
      const payout = parseFloat((bet.amount * bet.odds).toFixed(2));
      await Promise.all([
        CricketBet.findByIdAndUpdate(bet._id, { status: 'won', payout, settledAt: new Date() }),
        User.findByIdAndUpdate(bet.user, { $inc: { balance: payout, totalWon: payout } }),
        Transaction.create({
          user: bet.user, type: 'win', amount: payout, status: 'success',
          note: `Cricket WIN - ${freshMatch.title} | ${freshMarket.label} | ${bet.choiceLabel} @ ${bet.odds}x`,
        }),
      ]);
      totalPayout += payout;
    } else {
      await CricketBet.findByIdAndUpdate(bet._id, { status: 'lost', payout: 0, settledAt: new Date() });
    }
  }

  freshMarket.status    = 'settled';
  freshMarket.result    = winningKey;
  freshMarket.settledAt = new Date();
  await freshMatch.save();

  const totalBet = bets.reduce((s, b) => s + b.amount, 0);
  await CricketMatch.findByIdAndUpdate(freshMatch._id, {
    $inc: { totalPayout, houseProfit: totalBet - totalPayout },
  });

  logger.info(`[CricketSync] Settled ${marketId} winner=${winningKey} bets=${bets.length} payout=Rs${totalPayout}`);

  if (io) {
    io.emit('cricket:market_settled', {
      matchId:      freshMatch.matchId,
      marketId,
      marketLabel:  freshMarket.label,
      winningKey,
      winningLabel: freshMarket.options.find(o => o.key === winningKey)?.label || winningKey,
    });
  }
  return { settled: bets.length, paid: totalPayout };
}

// ─── CricketData.org API fetch ──────────────────────────────────────────────
async function crickapiGet(endpoint) {
  const key = process.env.CRICAPI_KEY;
  if (!key) return null;
  try {
    // endpoint already includes '?offset=0' so append with '&'
    const url = `${CRICAPI_BASE}/${endpoint}&apikey=${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) { logger.warn(`[CricketSync] HTTP ${res.status} from cricapi`); return null; }
    const json = await res.json();
    if (json.status !== 'success') {
      logger.warn(`[CricketSync] API returned error: ${json.info || json.status}`);
      return null;
    }
    return json;
  } catch (e) {
    logger.warn('[CricketSync] fetch error: ' + e.message);
    return null;
  }
}

// ─── Process one live match ─────────────────────────────────────────────────
async function processLiveMatch(apiMatch, io) {
  const matchId    = `cricapi_${apiMatch.id}`;
  const teamAName  = apiMatch.teams?.[0] || 'Team A';
  const teamBName  = apiMatch.teams?.[1] || 'Team B';
  const teamAShort = shortCode(teamAName);
  const teamBShort = shortCode(teamBName);
  const matchType  = detectMatchType(apiMatch.matchType);

  const scoreArr   = apiMatch.score || [];
  const inn1       = scoreArr[0];
  const inn2       = scoreArr[1];
  const activeInns = inn2 || inn1;

  // Total runs in active innings right now
  const totalRunsNow = parseInt(activeInns?.r) || 0;

  const { over: currentOver, ball: currentBall } = parseOvers(activeInns?.overs);

  const teamAScore = inn1 ? `${inn1.r ?? 0}/${inn1.w ?? 0} (${inn1.overs || '0.0'})` : '';
  const teamBScore = inn2 ? `${inn2.r ?? 0}/${inn2.w ?? 0} (${inn2.overs || '0.0'})` : '';
  const batting    = inn2 ? teamBName : teamAName;
  const commentary = apiMatch.status || '';

  let match = await CricketMatch.findOne({ matchId });

  if (!match) {
    const markets = [
      { marketId: 'match_winner',  type: 'match_winner',  label: 'Match Winner',                      options: matchWinnerOptions(teamAShort, teamBShort), status: 'open' },
      { marketId: 'innings1_runs', type: 'innings_runs',   label: `${teamAShort} 1st Innings Runs`,    options: inningsRunsOptions(matchType),               status: 'open' },
      { marketId: 'innings2_runs', type: 'innings_runs',   label: `${teamBShort} 2nd Innings Runs`,    options: inningsRunsOptions(matchType),               status: 'open' },
    ];

    match = await CricketMatch.create({
      matchId,
      title:          apiMatch.name || `${teamAShort} vs ${teamBShort}`,
      teamA:          teamAName,
      teamB:          teamBName,
      teamAShort,
      teamBShort,
      tournament:     (apiMatch.name || 'International').split(',').slice(-1)[0]?.trim() || 'International',
      venue:          apiMatch.venue || '',
      matchType,
      scheduledAt:    apiMatch.dateTimeGMT ? new Date(apiMatch.dateTimeGMT) : new Date(),
      status:         'live',
      isBettingOpen:  true,
      markets,
      // ── FIX: store starting runs so we can calculate per-over runs ──
      score: {
        currentOver:   currentOver,
        currentBall:   currentBall,
        overStartRuns: totalRunsNow,   // ← track run count at start of each over
      },
    });

    logger.info(`[CricketSync] Auto-created: ${matchId} - ${match.title}`);
    io.emit('cricket:match_live', {
      matchId, title: match.title,
      teamA: match.teamA, teamB: match.teamB,
      markets: match.markets.filter(m => m.status === 'open'),
    });
  }

  const prevOver       = match.score?.currentOver    ?? 0;
  const prevBall       = match.score?.currentBall    ?? 0;
  // ── FIX: overStartRuns tells us how many runs were on board at start of prevOver
  const overStartRuns  = match.score?.overStartRuns  ?? 0;

  const ballChanged   = currentOver !== prevOver || currentBall !== prevBall;
  const overJustEnded = currentBall === 0 && currentOver > prevOver;

  // ── FIX: Settle finished over market using ACTUAL runs scored in that over ──
  if (overJustEnded && prevOver > 0) {
    const prevOverMarketId = `over_${prevOver}_runs`;
    const prevOverMarket   = match.markets.find(m => m.marketId === prevOverMarketId && m.status === 'open');
    if (prevOverMarket) {
      // Runs scored in the just-finished over = current total minus what we had at over start
      const runsInOver = totalRunsNow - overStartRuns;
      const winningKey = mapOverRunKey(runsInOver);
      logger.info(`[CricketSync] Over ${prevOver} ended — runs in over: ${runsInOver} → settling as '${winningKey}'`);
      await settleMarket(match, prevOverMarketId, winningKey, io);
      match = await CricketMatch.findOne({ matchId }); // re-fetch after settle
    }
  }

  // Auto-add upcoming over market
  const upcomingOver = currentOver + 1;
  const overMarketId = `over_${upcomingOver}_runs`;
  if (!match.markets.find(m => m.marketId === overMarketId)) {
    match.markets.push({
      marketId: overMarketId,
      type:     'over_runs',
      label:    `Over ${upcomingOver} - Runs Scored`,
      options:  overRunsOptions(),
      status:   'open',
    });
    await match.save();
    io.emit('cricket:market_added', { matchId, market: match.markets.find(m => m.marketId === overMarketId) });
    logger.info(`[CricketSync] Added over ${upcomingOver} market`);
  }

  // Lock previous ball market when ball changes
  if (ballChanged && prevBall > 0) {
    const prevBallMktId = `ball_${prevOver}.${prevBall}`;
    const prevBallMkt   = match.markets.find(m => m.marketId === prevBallMktId && m.status === 'open');
    if (prevBallMkt) {
      prevBallMkt.status   = 'locked';
      prevBallMkt.lockedAt = new Date();
      await match.save();
      io.emit('cricket:market_locked', { matchId, marketId: prevBallMktId, label: prevBallMkt.label });
    }
  }

  // Auto-add next ball market
  const nextBall     = currentBall + 1;
  const ballMarketId = `ball_${currentOver}.${nextBall}`;
  if (nextBall <= 6 && !match.markets.find(m => m.marketId === ballMarketId)) {
    match.markets.push({
      marketId: ballMarketId,
      type:     'ball_outcome',
      label:    `Ball ${currentOver}.${nextBall} - What happens?`,
      options:  ballOutcomeOptions(),
      status:   'open',
    });
    await match.save();
    io.emit('cricket:market_added', { matchId, market: match.markets.find(m => m.marketId === ballMarketId) });
    logger.info(`[CricketSync] Added ball ${currentOver}.${nextBall} market`);
  }

  // ── FIX: Update score + overStartRuns (reset when new over starts) ──
  await CricketMatch.findOneAndUpdate({ matchId }, {
    $set: {
      'score.teamAInnings1': teamAScore,
      'score.teamBInnings1': teamBScore,
      'score.currentOver':   currentOver,
      'score.currentBall':   currentBall,
      'score.batting':       batting,
      'score.lastBall':      commentary,
      'score.commentary':    commentary,
      // When a new over starts (ball resets to 0), snapshot the current total as overStartRuns
      'score.overStartRuns': overJustEnded ? totalRunsNow : overStartRuns,
      status:                'live',
      isBettingOpen:         true,
    },
  });

  io.emit('cricket:score_update', {
    matchId,
    title: match.title,
    score: {
      teamAInnings1: teamAScore,
      teamBInnings1: teamBScore,
      currentOver,
      currentBall,
      batting,
      lastBall:    commentary,
      commentary,
    },
  });
}

// ─── Handle ended matches ───────────────────────────────────────────────────
async function handleCompletedMatches(completedIds, io) {
  if (!completedIds.length) return;
  const matches = await CricketMatch.find({ matchId: { $in: completedIds }, status: 'live' });

  for (const match of matches) {
    match.status        = 'completed';
    match.isBettingOpen = false;
    for (const market of match.markets) {
      if (market.status !== 'open' && market.status !== 'locked') continue;
      const bets = await CricketBet.find({ matchId: match.matchId, marketId: market.marketId, status: 'pending' }).lean();
      for (const bet of bets) {
        await Promise.all([
          CricketBet.findByIdAndUpdate(bet._id, { status: 'refunded', settledAt: new Date() }),
          User.findByIdAndUpdate(bet.user, { $inc: { balance: bet.amount } }),
          Transaction.create({
            user: bet.user, type: 'bonus', amount: bet.amount, status: 'success',
            note: `Cricket refund - ${match.title} | ${market.label}`,
          }),
        ]);
      }
      market.status = 'cancelled';
    }
    await match.save();
    io.emit('cricket:match_completed', { matchId: match.matchId, title: match.title });
    logger.info(`[CricketSync] Completed: ${match.matchId}`);
  }
}

// ─── Main sync tick ─────────────────────────────────────────────────────────
async function syncLiveMatches(io) {
  try {
    const data = await crickapiGet('currentMatches?offset=0');
    if (!data) return;

    const all       = data.data || [];
    const live      = all.filter(m => m.matchStarted && !m.matchEnded);
    const completed = all.filter(m => m.matchEnded).map(m => `cricapi_${m.id}`);

    logger.info(`[CricketSync] Tick — Live=${live.length} Ended=${completed.length} Total=${all.length}`);

    for (const apiMatch of live) {
      try { await processLiveMatch(apiMatch, io); }
      catch (e) { logger.error(`[CricketSync] Error processing ${apiMatch.id}: ${e.message}\n${e.stack}`); }
    }

    await handleCompletedMatches(completed, io);
  } catch (e) {
    logger.error('[CricketSync] tick error: ' + e.message);
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────
function startCricketLiveSync(io) {
  if (process.env.CRICKET_AUTO_SYNC !== 'true') {
    logger.info('[CricketSync] Disabled (CRICKET_AUTO_SYNC != true)');
    return;
  }
  if (!process.env.CRICAPI_KEY) {
    logger.warn('[CricketSync] CRICAPI_KEY not set — get your key at cricketdata.org');
    return;
  }

  const interval = parseInt(process.env.CRICKET_SYNC_INTERVAL) || 30000;

  // Warn if interval is too high for live betting to be useful
  if (interval > 300000) {
    logger.warn(`[CricketSync] ⚠️  CRICKET_SYNC_INTERVAL is ${interval / 1000}s — this is very slow for live betting. Recommended: 30000 (30s)`);
  }

  logger.info(`[CricketSync] Started — polling every ${interval / 1000}s via api.cricapi.com`);

  syncLiveMatches(io);
  setInterval(() => syncLiveMatches(io), interval);
}

module.exports = { startCricketLiveSync, syncLiveMatches, settleMarket };
