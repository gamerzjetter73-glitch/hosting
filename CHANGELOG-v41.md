# CHANGELOG v41

## Bug Fixes (all carried from v40 reports)

### Fix 1: Notification Panel ✕ Close Button Not Working
- **File:** `Mainpro/index.html`, `Mainpro/app.js`
- **Root cause:** The inner modal-box had `onclick="event.stopPropagation()"` which was swallowing
  the ✕ button click before it could fire `closeNotifPanel()`.
- **Fix:** Removed all inline onclick handlers from the panel. Replaced the ✕ `<span>` with a
  proper `<button id="notif-close-btn">`. Wired close button and backdrop via
  `addEventListener` inside `DOMContentLoaded` — this bypasses the stopPropagation conflict
  entirely. Clicking ✕ or clicking outside the panel both correctly close it.

### Fix 2: Arrow (⬇) Button Not Opening Deposit Page
- **File:** `Mainpro/index.html`
- **Root cause:** Arrow called `goTo('wallet')` but no `id="page-wallet"` page exists in the app.
  `goTo()` silently failed with a null lookup.
- **Fix:** Changed arrow button to call `openDeposit()` directly, which opens the deposit
  modal correctly for logged-in users (or shows auth screen if not logged in).

### Fix 3: Announcement Ticker Not Scrolling Properly
- **File:** `Mainpro/styles.css`, `Mainpro/app.js`
- **Root cause 1:** Animation was `22s` for 104 entries (~43,000px of text) — impossibly fast,
  browser effectively throttled it to nothing visible.
- **Root cause 2:** `translateX(100%)` as start only moves by viewport width, not enough to
  start text off-screen on the right.
- **Fix (CSS):** Changed start keyframe to `translateX(100vw)` so text begins just off the
  right screen edge. End keyframe `translateX(-100%)` correctly ends when text exits left.
  Set fallback duration to `280s`.
- **Fix (JS):** Added `DOMContentLoaded` ticker init that measures the real rendered text
  width via `scrollWidth`, then calculates exact animation duration at 120px/sec for a smooth,
  comfortable reading speed regardless of content length.
