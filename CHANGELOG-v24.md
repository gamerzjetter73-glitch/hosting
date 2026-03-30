# BACKEND v24 — Changelog

## Fixes in this version

---

### Fix #1 — Aviator Cashout Button Broken After Post-Crash Bet (CRITICAL)
**File:** `Mainpro/app.js` — `avReset()`

**Problem:** When a player placed a bet during the post-crash betting window, the next round's cashout button would be permanently disabled. The flow was:

1. Crash → player bets during 10s window → `avBetAmt = 50` ✅
2. `aviator:waiting` fires → `avReset()` runs → **`avBetAmt = 0`** ❌
3. `aviator:fly_start` fires → `avCashBtn.disabled = (avBetAmt <= 0)` → **disabled = true** ❌

The player had a live bet on the server but could never cash out from the frontend.

**Fix:** `avReset()` no longer clears `avBetAmt`. The variable is now only reset in:
- `avHandleCrash()` — on a loss (or after a completed cashout round)
- `avCashOut()` — on a successful cashout (sets `avCashedOut = true`, cleaned up on next crash)

Status text during countdown now shows "Bet ₹X placed! Xs to launch..." if a bet is already live.

```js
// OLD — wipes avBetAmt, breaks cashout button next round
function avReset(countdown, periodId) {
  avFlying=false; avBetAmt=0; avCashedOut=false; ...
  document.getElementById('avCashBtn').disabled=true;
}

// NEW — preserves avBetAmt set during crash window
function avReset(countdown, periodId) {
  avFlying=false; avCashedOut=false; ...
  document.getElementById('avBetBtn').disabled=(avBetAmt>0);
  document.getElementById('avCashBtn').disabled=true;
  // status shows bet confirmation if already placed
}
```

---

### Fix #2 — Bet Amount Capped at ₹1000 (UI)
**Files:** `Mainpro/index.html`, `Mainpro/app.js`

**Problem:** The bet chip UI only went up to ₹1000. The server allows up to ₹50,000 (`MAX_BET = 50000`) but there was no way to reach it. No manual input existed.

**Fix:**
- Added chips: `₹1K`, `₹2K`, `₹5K` to both the main bet row and post-crash window
- Added a custom amount text input (`avCustomAmt`) — players can type any amount ₹10–₹50,000
- Added `avSetCustomAmt()` — syncs typed value into `_gameBetAmt['av']`, deselects chips
- Added `avClearAmt()` — resets to default chip selection, clears input
- Clicking a chip clears the custom input field (and vice versa) so they don't conflict
- Custom input is also cleared after a successful bet placement

---

### Fix #3 — Cashout Payout Not Saved to DB Subdocument
**File:** `routes/game.js` — `POST /aviator/cashout`

**Problem:** The second update that saves `payout` to the bet subdocument used MongoDB's positional `$` operator without the required matching filter. The `$` operator can only resolve when the query filter identifies which array element matched — but `findByIdAndUpdate` only filters on `_id`, so `$` had no array element to resolve to. Result: `payout` field stayed `0` in DB for all wins, making round history and house profit calculations wrong. Player balances were credited correctly (that happened via `creditWin`), but the data was corrupt.

**Fix:** Changed to `findOneAndUpdate` with `{ _id, 'bets.userId': req.user._id }` so MongoDB can correctly resolve the `$` positional operator.

```js
// OLD — $ can't resolve, payout stays 0 in DB
await AviatorRound.findByIdAndUpdate(av.dbRoundId, {
  $set: { 'bets.$.payout': prize },
  $inc: { totalPayout: prize },
});

// NEW — bets.userId filter lets $ resolve correctly
await AviatorRound.findOneAndUpdate(
  { _id: av.dbRoundId, 'bets.userId': req.user._id },
  { $set: { 'bets.$.payout': prize }, $inc: { totalPayout: prize } }
);
```

---

## No breaking changes
- All socket events and API routes unchanged
- DB schema unchanged
- Existing round history unaffected (payout fix is forward-only)
