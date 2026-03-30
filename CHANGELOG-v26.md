# BACKEND v26 CHANGELOG

## v26 — Aviator Fixes

### 🐛 Bug Fixes

#### 1. CRITICAL: Countdown Timer Now Correct (10 seconds = 10 real seconds)
- **Root cause in v25**: `setInterval` was set to 100ms, but the waiting-phase countdown decremented on every tick — meaning a 10-second countdown finished in ~1 second.
- **Fix**: Split into two separate intervals:
  - `setInterval(..., 1000)` — handles only the waiting countdown (1 decrement per second)
  - `setInterval(..., 100)` — handles only the flying multiplier ticks (10 ticks per second for smooth display)

#### 2. Post-Crash Bet Window Popup — REMOVED COMPLETELY
- The `av25BetWindow` overlay that popped up after every crash was causing UI glitches and confusion.
- **Removed from**: `server.js` (no more `aviator:bet_window` emit), `app.js` (removed socket listener + all handler functions), `index.html` (removed HTML block), `styles.css` (removed all `.av25-bw-*` styles)
- Players now simply place bets during the normal 10-second waiting phase countdown, which is clearly shown.

#### 3. Crash State Button Fix
- After crash, the BET button is now disabled during the brief transition period.
- The `aviator:waiting` event re-enables it cleanly when the new round is ready for bets.
- Eliminates any race condition where a user could click BET before the new round was created in the DB.

### ✨ New Features

#### 4. Visual Countdown Bar
- Added a green progress bar in the canvas overlay during the waiting phase.
- Bar shrinks from full → empty as the 10s countdown runs.
- Color changes: green (10–7s) → orange (6–4s) → red (3–1s)
- Shows the remaining seconds numerically alongside the bar.
