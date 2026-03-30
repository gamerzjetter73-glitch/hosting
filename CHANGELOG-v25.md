# BACKEND v25 — Changelog

## Aviator — Complete Frontend Rewrite

The entire Aviator game frontend has been rebuilt from scratch. All old `av*` code
has been deleted and replaced with a clean `av25*` system.

---

### Root Cause of Cashout Bug (Final Diagnosis)

The v24 cashout button issue was deeper than a single `avReset()` bug.
The real problem was **state leakage between the socket reconnect sync and local JS state**:

- On page load, `aviator:sync` fires with `phase: 'flying'`
- `avSyncState()` set `cashBtn.disabled = (avBetAmt <= 0)`
- `avBetAmt` is always `0` on a fresh load → button should be **disabled**
- But `aviator:fly_start` could fire milliseconds later (server broadcast) and re-evaluate
  the same condition — again `0` → still disabled
- The button appearing **enabled** in the screenshot meant something else was enabling it:
  the **HTML initial state** of the button had no `disabled` attribute on first render,
  and `avSyncState` was only called asynchronously after socket connected,
  leaving a brief window where the button was clickable with no bet

The full rewrite eliminates this class of bugs entirely.

---

### Architecture Changes

**Old system (v24 and prior):**
- Multiple scattered state variables: `avFlying`, `avBetAmt`, `avCashedOut`, `avServerMult`, `avPoints`
- Button state managed across 6+ separate functions that could conflict
- `avReset()` would wipe `avBetAmt` wiping post-crash window bets
- Socket reconnect sync (`avSyncState`) could enable cashout with no active bet

**New system (v25):**
- Single state object: `av25 = { phase, mult, betAmt, cashedOut, chipAmt, bwAmt, points, ... }`
- **`av25.betAmt` is the single source of truth** — only set on successful `POST /aviator/bet` response, only cleared on crash resolution or cashout
- Button state is only ever set in 3 places: `av25Sync`, `av25OnFlyStart`, `av25OnCrash`
- `av25Sync` (reconnect handler) only enables cashout if `av25.betAmt > 0` — impossible on fresh load

### New UI

- Redesigned canvas area with dark gradient background
- Multiplier displayed large and centered with color states (white=waiting, green=flying, red=crashed)
- Crash flash effect on plane crash
- Animated pulsing CASH OUT button when active
- History strip shows last 15 rounds with color-coded chips
- Chips: ₹10, ₹50, ₹100, ₹500, ₹1K, ₹2K, ₹5K
- Custom amount input for any value ₹10–₹50,000
- Post-crash betting window with SVG countdown arc + urgency shake at 3s
- Balance pill in top bar updates in real time

### Bug Fixes Carried Forward from v24

1. **Payout subdoc fix** (`routes/game.js`) — `findOneAndUpdate` with `bets.userId` filter so `$` positional operator resolves correctly
2. **Bet amount cap** — chips go up to ₹5K, custom input allows up to server MAX of ₹50,000

### What Was Deleted

All old aviator frontend code:
`avFlying`, `avBetAmt`, `avCashedOut`, `avServerMult`, `avPoints`, `avReset()`,
`avSyncState()`, `avHandleCrash()`, `avPlaceBet()`, `avCashOut()`, `avUpdateUI()`,
`avDrawFlight()`, `avDraw()`, `avResize()`, `loadAvHistory()`, `avLoadHistFull()`,
`switchAvPanel()`, `avAddHistChip()`, `avShowBetWindow()`, `avBwFireParticles()`,
`selectAvBwAmt()`, `avBetWindowPlace()`, `avHideBetWindow()`, `avHistPage()`

All old aviator HTML elements (`#avBetBtn`, `#avCashBtn`, `#avCanvas`, `#avWrap`,
`#avMult`, `#avStatus`, `#avPlane`, `#avHistStrip`, `#avBetWindow`, etc.)

No backend changes required — all socket events and API routes are identical.
