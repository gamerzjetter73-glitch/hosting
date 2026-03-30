# BACKEND v29 CHANGELOG

## v29 — God Mode (Admin Force-Lose)

### New Feature: God Mode

When admin enables God Mode on a user, they lose every single bet
across all games silently. The user has no idea.

#### User Model (`models/User.js`)
- Added `godMode: Boolean` field (default: false)

#### Game Routes (`routes/game.js`)
- Added `isGodMode(userId)` helper — async DB check
- **Vortex**: result forced to NOT match user's choice
- **Dragon Tiger**: cards redrawn until user's side loses
- **Andar Bahar**: result flipped to opposite
- **Slots**: reels re-spun until no winning line
- **Mines**: mine secretly moved onto clicked tile
- **Aviator cashout**: completely blocked (returns error)

#### Server Settlement (`server.js`)
- **Wingo** (all 4 variants): god mode users skipped in payout loop
- **K3 Dice**: god mode users skipped in payout loop
- **TRX WinGo**: god mode users skipped in payout loop
- **5D Lottery**: god mode users skipped in payout loop

#### Admin Route (`routes/admin.js`)
- `POST /api/admin/users/:id/godmode` — toggle god mode on/off

#### Admin Panel (`Admin/index.html`)
- 😈 God Mode button in player profile drawer (pulses red when active)
- Warning banner shown when god mode is active
- 😈 GOD badge in users table
- Quick toggle button in users table row
- Confirmation dialog before enabling
