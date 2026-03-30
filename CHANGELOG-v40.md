# CHANGELOG v40

## Bug Fixes

### Fix 1: Wingo House Profit Showing ₹0 After Admin Result Manipulation
- **File:** `routes/admin.js`
- **Problem:** When admin sets result while round is still running, the result is queued for end of timer. The API response was immediately fetching the DB record (not yet settled), returning `houseProfit: 0`.
- **Fix:** Backend now detects the `queued` state and returns `queued: true` with a clear message instead of fake ₹0 profit. Admin panel UI updated to show "⏳ Queued: X (color) | Bets so far: ₹X | profit shown after round ends" when queued, and full accurate profit when settled immediately.

### Fix 2: Bell Icon (🔔) and Arrow (⬇) Buttons Not Working
- **File:** `Mainpro/index.html`, `Mainpro/app.js`, `Mainpro/styles.css`
- **Problem:** Both top-bar icon buttons had no `onclick` handlers — completely non-functional.
- **Fix:**
  - 🔔 Bell icon → opens a Notification Panel modal showing recent announcements/promotions. Red dot clears on open.
  - ⬇ Arrow icon → navigates to the Wallet/Deposit page (`goTo('wallet')`).
  - Added `openNotifPanel()` / `closeNotifPanel()` JS functions.
  - Added notification panel HTML with 3 default notifications.
  - Added `.notif-item`, `.notif-icon`, `.modal-box` CSS styles.

### Fix 3: Announcement Ticker Only Had 2 Entries
- **File:** `Mainpro/index.html`
- **Problem:** The scrolling announcement bar had only 2 hardcoded user wins, making it look empty and repetitive.
- **Fix:** Added 100 randomly generated user win entries across all games (Aviator, Vortex, WinGo, K3 Dice, 5D Lottery, TRX WinGo, Mines, Slots) with realistic win amounts. Ticker now scrolls consistently with rich, varied content.

