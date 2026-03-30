// ═══════════════════════════════════════════════════════════════════════════
//  scripts/seedIPLMatches.js  — IPL 2026 Seeder  (auto-runs on server start)
//
//  Can also be run manually:  node scripts/seedIPLMatches.js
// ═══════════════════════════════════════════════════════════════════════════

const TEAMS = {
  CSK:  { name: 'Chennai Super Kings',         short: 'CSK'  },
  MI:   { name: 'Mumbai Indians',               short: 'MI'   },
  RCB:  { name: 'Royal Challengers Bengaluru',  short: 'RCB'  },
  KKR:  { name: 'Kolkata Knight Riders',        short: 'KKR'  },
  DC:   { name: 'Delhi Capitals',               short: 'DC'   },
  SRH:  { name: 'Sunrisers Hyderabad',          short: 'SRH'  },
  PBKS: { name: 'Punjab Kings',                 short: 'PBKS' },
  RR:   { name: 'Rajasthan Royals',             short: 'RR'   },
  GT:   { name: 'Gujarat Titans',               short: 'GT'   },
  LSG:  { name: 'Lucknow Super Giants',         short: 'LSG'  },
};

// All times UTC: 14:00 UTC = 7:30 PM IST | 08:30 UTC = 2:00 PM IST (afternoon DH)
// Season starts 28 March 2026
const IPL_MATCHES = [
  // ── Week 1 (28 Mar – 5 Apr 2026) ──
  { id:'ipl26_m01', teamA:'MI',   teamB:'CSK',  date:'2026-03-28T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m02', teamA:'RCB',  teamB:'KKR',  date:'2026-03-29T10:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m03', teamA:'SRH',  teamB:'DC',   date:'2026-03-29T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m04', teamA:'RR',   teamB:'GT',   date:'2026-03-30T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  { id:'ipl26_m05', teamA:'PBKS', teamB:'LSG',  date:'2026-03-31T14:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m06', teamA:'KKR',  teamB:'SRH',  date:'2026-04-01T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m07', teamA:'CSK',  teamB:'RR',   date:'2026-04-02T14:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m08', teamA:'DC',   teamB:'MI',   date:'2026-04-03T14:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m09', teamA:'GT',   teamB:'RCB',  date:'2026-04-04T10:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m10', teamA:'LSG',  teamB:'PBKS', date:'2026-04-04T14:00:00Z', venue:'BRSABV Ekana Cricket Stadium, Lucknow' },
  // ── Week 2 (5–11 Apr 2026) ──
  { id:'ipl26_m11', teamA:'MI',   teamB:'KKR',  date:'2026-04-05T10:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m12', teamA:'CSK',  teamB:'DC',   date:'2026-04-05T14:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m13', teamA:'RCB',  teamB:'SRH',  date:'2026-04-06T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m14', teamA:'RR',   teamB:'LSG',  date:'2026-04-07T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  { id:'ipl26_m15', teamA:'GT',   teamB:'PBKS', date:'2026-04-08T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m16', teamA:'DC',   teamB:'KKR',  date:'2026-04-09T14:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m17', teamA:'SRH',  teamB:'CSK',  date:'2026-04-10T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m18', teamA:'MI',   teamB:'RR',   date:'2026-04-11T10:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m19', teamA:'LSG',  teamB:'RCB',  date:'2026-04-11T14:00:00Z', venue:'BRSABV Ekana Cricket Stadium, Lucknow' },
  // ── Week 3 (12–18 Apr 2026) ──
  { id:'ipl26_m20', teamA:'PBKS', teamB:'CSK',  date:'2026-04-12T10:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m21', teamA:'GT',   teamB:'DC',   date:'2026-04-12T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m22', teamA:'KKR',  teamB:'RR',   date:'2026-04-13T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m23', teamA:'SRH',  teamB:'MI',   date:'2026-04-14T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m24', teamA:'RCB',  teamB:'CSK',  date:'2026-04-15T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m25', teamA:'DC',   teamB:'LSG',  date:'2026-04-16T14:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m26', teamA:'RR',   teamB:'PBKS', date:'2026-04-17T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  { id:'ipl26_m27', teamA:'MI',   teamB:'GT',   date:'2026-04-18T10:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m28', teamA:'KKR',  teamB:'SRH',  date:'2026-04-18T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  // ── Week 4 (19–25 Apr 2026) ──
  { id:'ipl26_m29', teamA:'CSK',  teamB:'LSG',  date:'2026-04-19T10:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m30', teamA:'RCB',  teamB:'RR',   date:'2026-04-19T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m31', teamA:'PBKS', teamB:'DC',   date:'2026-04-20T14:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m32', teamA:'GT',   teamB:'KKR',  date:'2026-04-21T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m33', teamA:'LSG',  teamB:'MI',   date:'2026-04-22T14:00:00Z', venue:'BRSABV Ekana Cricket Stadium, Lucknow' },
  { id:'ipl26_m34', teamA:'SRH',  teamB:'RR',   date:'2026-04-23T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m35', teamA:'DC',   teamB:'RCB',  date:'2026-04-24T14:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m36', teamA:'CSK',  teamB:'GT',   date:'2026-04-25T10:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m37', teamA:'MI',   teamB:'PBKS', date:'2026-04-25T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  // ── Week 5 (26 Apr – 2 May 2026) ──
  { id:'ipl26_m38', teamA:'KKR',  teamB:'LSG',  date:'2026-04-26T10:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m39', teamA:'RR',   teamB:'DC',   date:'2026-04-26T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  { id:'ipl26_m40', teamA:'RCB',  teamB:'PBKS', date:'2026-04-27T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m41', teamA:'GT',   teamB:'SRH',  date:'2026-04-28T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m42', teamA:'MI',   teamB:'DC',   date:'2026-04-29T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m43', teamA:'CSK',  teamB:'KKR',  date:'2026-04-30T14:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m44', teamA:'LSG',  teamB:'GT',   date:'2026-05-01T14:00:00Z', venue:'BRSABV Ekana Cricket Stadium, Lucknow' },
  { id:'ipl26_m45', teamA:'PBKS', teamB:'SRH',  date:'2026-05-02T10:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m46', teamA:'RR',   teamB:'MI',   date:'2026-05-02T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  // ── Week 6 (3–9 May 2026) ──
  { id:'ipl26_m47', teamA:'DC',   teamB:'CSK',  date:'2026-05-03T10:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m48', teamA:'KKR',  teamB:'RCB',  date:'2026-05-03T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m49', teamA:'SRH',  teamB:'LSG',  date:'2026-05-04T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m50', teamA:'GT',   teamB:'RR',   date:'2026-05-05T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m51', teamA:'MI',   teamB:'RCB',  date:'2026-05-06T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m52', teamA:'PBKS', teamB:'KKR',  date:'2026-05-07T14:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m53', teamA:'CSK',  teamB:'RR',   date:'2026-05-08T14:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m54', teamA:'DC',   teamB:'GT',   date:'2026-05-09T10:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m55', teamA:'LSG',  teamB:'SRH',  date:'2026-05-09T14:00:00Z', venue:'BRSABV Ekana Cricket Stadium, Lucknow' },
  // ── Week 7 (10–16 May 2026) ──
  { id:'ipl26_m56', teamA:'RCB',  teamB:'MI',   date:'2026-05-10T10:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m57', teamA:'KKR',  teamB:'GT',   date:'2026-05-10T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m58', teamA:'RR',   teamB:'PBKS', date:'2026-05-11T14:00:00Z', venue:'Sawai Mansingh Stadium, Jaipur' },
  { id:'ipl26_m59', teamA:'SRH',  teamB:'CSK',  date:'2026-05-12T14:00:00Z', venue:'Rajiv Gandhi International Stadium, Hyderabad' },
  { id:'ipl26_m60', teamA:'DC',   teamB:'LSG',  date:'2026-05-13T14:00:00Z', venue:'Arun Jaitley Stadium, Delhi' },
  { id:'ipl26_m61', teamA:'MI',   teamB:'GT',   date:'2026-05-14T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m62', teamA:'RCB',  teamB:'RR',   date:'2026-05-15T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m63', teamA:'KKR',  teamB:'PBKS', date:'2026-05-16T10:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_m64', teamA:'CSK',  teamB:'DC',   date:'2026-05-16T14:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  // ── Week 8 – Final League (17–20 May 2026) ──
  { id:'ipl26_m65', teamA:'GT',   teamB:'LSG',  date:'2026-05-17T10:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_m66', teamA:'MI',   teamB:'SRH',  date:'2026-05-17T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_m67', teamA:'PBKS', teamB:'RR',   date:'2026-05-18T10:00:00Z', venue:'Maharaja Yadavindra Singh Stadium, Mullanpur' },
  { id:'ipl26_m68', teamA:'RCB',  teamB:'DC',   date:'2026-05-18T14:00:00Z', venue:'M Chinnaswamy Stadium, Bengaluru' },
  { id:'ipl26_m69', teamA:'CSK',  teamB:'KKR',  date:'2026-05-19T10:00:00Z', venue:'MA Chidambaram Stadium, Chennai' },
  { id:'ipl26_m70', teamA:'GT',   teamB:'SRH',  date:'2026-05-19T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  // ── Playoffs ──
  { id:'ipl26_q1',  teamA:'TBD1', teamB:'TBD2', date:'2026-05-26T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
  { id:'ipl26_q2',  teamA:'TBD3', teamB:'TBD4', date:'2026-05-27T14:00:00Z', venue:'Eden Gardens, Kolkata' },
  { id:'ipl26_el',  teamA:'TBD',  teamB:'TBD',  date:'2026-05-29T14:00:00Z', venue:'Wankhede Stadium, Mumbai' },
  { id:'ipl26_fin', teamA:'TBD',  teamB:'TBD',  date:'2026-06-01T14:00:00Z', venue:'Narendra Modi Stadium, Ahmedabad' },
];

function buildMarkets(a, b) {
  return [
    // 1. Toss Winner
    { marketId:'toss_winner', type:'toss_winner', label:'Toss Winner',
      options:[{key:a,label:`${a} wins toss`,odds:1.90},{key:b,label:`${b} wins toss`,odds:1.90}], status:'open' },
    // 2. Match Winner
    { marketId:'match_winner', type:'match_winner', label:'Match Winner',
      options:[{key:a,label:a,odds:1.85},{key:b,label:b,odds:1.85}], status:'open' },
    // 3. 1st Innings Runs
    { marketId:'innings1_runs', type:'innings_runs', label:`${a} 1st Innings Runs`,
      options:[
        {key:'0-139',   label:'Under 140', odds:1.90},
        {key:'140-159', label:'140–159',   odds:2.20},
        {key:'160-179', label:'160–179',   odds:2.00},
        {key:'180-199', label:'180–199',   odds:2.80},
        {key:'200+',    label:'200+',      odds:4.50},
      ], status:'open' },
    // 4. 2nd Innings Runs
    { marketId:'innings2_runs', type:'innings_runs', label:`${b} 2nd Innings Runs`,
      options:[
        {key:'0-139',   label:'Under 140', odds:1.90},
        {key:'140-159', label:'140–159',   odds:2.20},
        {key:'160-179', label:'160–179',   odds:2.00},
        {key:'180-199', label:'180–199',   odds:2.80},
        {key:'200+',    label:'200+',      odds:4.50},
      ], status:'open' },
    // 5. Powerplay Runs (overs 1-6)
    { marketId:'powerplay_runs', type:'powerplay_runs', label:'Powerplay Runs (Overs 1–6)',
      options:[
        {key:'0-39',  label:'Under 40',  odds:2.80},
        {key:'40-49', label:'40–49',     odds:2.00},
        {key:'50-59', label:'50–59',     odds:2.20},
        {key:'60-69', label:'60–69',     odds:3.00},
        {key:'70+',   label:'70+ Runs',  odds:4.50},
      ], status:'open' },
    // 6. Over 1 Runs (live sync adds more overs automatically)
    { marketId:'over_1_runs', type:'over_runs', label:'Over 1 – Runs Scored',
      options:[
        {key:'0-5',   label:'0–5 Runs',   odds:2.50},
        {key:'6-10',  label:'6–10 Runs',  odds:2.00},
        {key:'11-15', label:'11–15 Runs', odds:2.80},
        {key:'16+',   label:'16+ Runs',   odds:3.50},
      ], status:'open' },
    // 7. Ball 1.1 (live sync adds more balls automatically)
    { marketId:'ball_1.1', type:'ball_outcome', label:'Ball 1.1 – What happens?',
      options:[
        {key:'0',      label:'Dot Ball',   odds:2.00},
        {key:'1',      label:'1 Run',      odds:3.00},
        {key:'2',      label:'2 Runs',     odds:4.50},
        {key:'3',      label:'3 Runs',     odds:8.00},
        {key:'4',      label:'FOUR! 🏏',   odds:3.50},
        {key:'6',      label:'SIX! 💥',    odds:5.00},
        {key:'wicket', label:'Wicket! 🎯', odds:6.00},
        {key:'wide',   label:'Wide / NB',  odds:4.00},
      ], status:'open' },
    // 8. Total Sixes
    { marketId:'total_sixes', type:'total_sixes', label:'Total Sixes in Match',
      options:[
        {key:'0-9',   label:'Under 10',    odds:2.20},
        {key:'10-14', label:'10–14 Sixes', odds:1.90},
        {key:'15-19', label:'15–19 Sixes', odds:2.50},
        {key:'20+',   label:'20+ Sixes',   odds:3.80},
      ], status:'open' },
    // 9. 1st Wicket Method
    { marketId:'first_wicket_method', type:'first_wicket_method', label:'1st Wicket – How Out?',
      options:[
        {key:'caught',  label:'Caught',  odds:2.20},
        {key:'bowled',  label:'Bowled',  odds:3.50},
        {key:'lbw',     label:'LBW',     odds:5.00},
        {key:'run_out', label:'Run Out', odds:7.00},
        {key:'stumped', label:'Stumped', odds:9.00},
        {key:'other',   label:'Other',   odds:12.0},
      ], status:'open' },
    // 10. 1st Wicket Over
    { marketId:'first_wicket_over', type:'first_wicket_over', label:'1st Wicket – Which Over?',
      options:[
        {key:'pp_1_6',    label:'Powerplay (1–6)',  odds:2.20},
        {key:'mid_7_14',  label:'Middle (7–14)',    odds:2.50},
        {key:'death_15p', label:'Death (15–20)',    odds:4.00},
      ], status:'open' },
    // 11. Super Over?
    { marketId:'super_over', type:'yes_no', label:'Super Over?',
      options:[
        {key:'yes', label:'Yes', odds:12.00},
        {key:'no',  label:'No',  odds:1.08},
      ], status:'open' },
  ];
}

// ── Main export — used by server.js auto-seed ────────────────────────────────
async function seedIPLMatches(CricketMatch) {
  let created = 0, skipped = 0;
  for (const m of IPL_MATCHES) {
    const tA = TEAMS[m.teamA] || { name: m.teamA, short: m.teamA };
    const tB = TEAMS[m.teamB] || { name: m.teamB, short: m.teamB };
    const existing = await CricketMatch.findOne({ matchId: m.id });
    if (existing) { skipped++; continue; }
    await CricketMatch.create({
      matchId:       m.id,
      title:         `${tA.name} vs ${tB.name}, IPL 2026`,
      teamA:         tA.name,  teamB:      tB.name,
      teamAShort:    tA.short, teamBShort: tB.short,
      tournament:    'IPL 2026',
      venue:         m.venue,
      matchType:     'T20',
      scheduledAt:   new Date(m.date),
      status:        'upcoming',
      isBettingOpen: true,
      markets:       buildMarkets(tA.short, tB.short),
    });
    const ist = new Date(m.date).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', dateStyle:'medium', timeStyle:'short' });
    console.log(`  ✅ [IPL Seed] ${m.id} — ${tA.short} vs ${tB.short}  [${ist} IST]`);
    created++;
  }
  return { created, skipped };
}

module.exports = { seedIPLMatches };

// ── Allow manual run: node scripts/seedIPLMatches.js ────────────────────────
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
  const connectDB    = require('../config/db');
  const CricketMatch = require('../models/CricketMatch');
  connectDB().then(async () => {
    console.log('🏏 Seeding IPL 2026 matches manually...\n');
    const { created, skipped } = await seedIPLMatches(CricketMatch);
    console.log(`\n✅ Done! Created: ${created}  Skipped: ${skipped}`);
    process.exit(0);
  }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
