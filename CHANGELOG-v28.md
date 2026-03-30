# BACKEND v28 CHANGELOG

## v28 — Aviator Pattern Queue System

### ✨ New Feature: Admin Crash Pattern Queue

#### Server (`server.js`)
- Added `crashQueue: []` to `avState`
- `genAvCrash()` now follows priority order:
  1. Single override (`adminCrash`) — immediate, next round only
  2. Pattern queue (`crashQueue`) — drain front entry each round
  3. Normal random generation — when queue is empty
- Broadcasts `admin:av_queue_update` socket event after each queued round is consumed
- Added `app.locals` exports: `getAvQueue`, `setAvQueue`, `clearAvQueue`

#### Admin Routes (`routes/admin.js`)
- `GET  /api/admin/aviator/queue`        — get current queue state
- `POST /api/admin/aviator/queue/set`    — replace entire queue (max 100 rounds)
- `POST /api/admin/aviator/queue/clear`  — wipe queue, return to random
- `POST /api/admin/aviator/queue/append` — add single value to end
- `POST /api/admin/aviator/queue/remove` — remove entry by index

#### Admin Panel (`Admin/index.html`)
- Full Pattern Queue Builder UI with:
  - Add single values or bulk paste comma-separated list
  - Visual color-coded queue list (💀 red < 1.5×, 🚀 green 5–10×, 🌟 purple > 10×)
  - Per-entry ✕ remove buttons
  - Live queue counter updates via socket when rounds are consumed
  - 5 presets: House Mode, Lure & Trap, Generous Mix, Spike Pattern, Grind
- Single override section preserved for quick one-round control
- Recent crashes table with improved color coding
