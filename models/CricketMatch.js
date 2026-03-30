// ── models/CricketMatch.js ──
const mongoose = require('mongoose');

const marketOptionSchema = new mongoose.Schema({
  key:   { type: String, required: true },
  label: { type: String, required: true },
  odds:  { type: Number, required: true },
}, { _id: false });

const marketSchema = new mongoose.Schema({
  marketId:   { type: String, required: true },
  type:       { type: String, required: true }, // 'match_winner'|'over_runs'|'ball_outcome'|'innings_runs'
  label:      { type: String, required: true },
  options:    [marketOptionSchema],
  status:     { type: String, enum: ['open','locked','settled','cancelled'], default: 'open' },
  result:     { type: String, default: null },
  lockedAt:   { type: Date, default: null },
  settledAt:  { type: Date, default: null },
}, { _id: false });

const cricketMatchSchema = new mongoose.Schema({
  matchId:        { type: String, required: true, unique: true },
  title:          { type: String, required: true },
  teamA:          { type: String, required: true },
  teamB:          { type: String, required: true },
  teamAShort:     { type: String, required: true },
  teamBShort:     { type: String, required: true },
  tournament:     { type: String, default: 'IPL' },
  venue:          { type: String, default: '' },
  matchType:      { type: String, enum: ['T20','ODI','Test'], default: 'T20' },
  scheduledAt:    { type: Date, required: true },
  status:         { type: String, enum: ['upcoming','live','completed','cancelled'], default: 'upcoming' },
  isBettingOpen:  { type: Boolean, default: false },
  winner:         { type: String, default: null },
  score: {
    teamAInnings1: { type: String, default: '' },
    teamBInnings1: { type: String, default: '' },
    currentOver:   { type: Number, default: 0 },
    currentBall:   { type: Number, default: 0 },
    batting:       { type: String, default: '' },
    lastBall:      { type: String, default: '' },
    commentary:    { type: String, default: '' },
    overStartRuns: { type: Number, default: 0 }, // ← runs at start of current over (for over settlement)
  },
  markets:          [marketSchema],
  totalBetsAmount:  { type: Number, default: 0 },
  totalPayout:      { type: Number, default: 0 },
  houseProfit:      { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('CricketMatch', cricketMatchSchema);
