# BACKEND v21 — Changelog

## Fixes in this version

### Fix #4 — Aviator Cashout Race Condition (CRITICAL)
**File:** `routes/game.js`

**Problem:** `/api/game/aviator/cashout` used read-then-write pattern:
1. `findById` → check `cashedOut`
2. `round.save()` → mark cashed out + credit balance

If two requests arrived simultaneously (double-tap, network retry), both could pass the `cashedOut === false` check before either write completed — resulting in double payout.

**Fix:** Replaced with single atomic `findOneAndUpdate` using the `cashedOut: false` filter condition. MongoDB guarantees only ONE request can match and update this document. The second concurrent request gets `null` back and is rejected with 400.

```
// OLD (race condition)
const round = await AviatorRound.findById(av.dbRoundId);
if (!bet || bet.cashedOut) return reject...
bet.cashedOut = true; await round.save();  ← two requests can both pass here

// NEW (atomic)
const round = await AviatorRound.findOneAndUpdate(
  { _id: av.dbRoundId, 'bets.userId': userId, 'bets.cashedOut': false },
  { $set: { 'bets.$.cashedOut': true, 'bets.$.cashMult': mult } },
  { new: true }
);
if (!round) return reject...  ← second request gets null here, no double pay
```

---

### Fix #8 — History Endpoints Pagination
**File:** `routes/game.js`

**Problem:** All 7 history routes had hardcoded `.limit(20)` with no way to paginate. Frontend had no way to load older records.

**Fix:** All history routes now accept `?page=N&limit=N` query params.
- Default: `page=1`, `limit=20`
- Max limit: `100` (capped server-side to prevent abuse)
- All responses now include `pagination` object

**Affected routes:**
| Route | Model |
|-------|-------|
| `GET /api/game/history` | WingoRound |
| `GET /api/game/my-bets` | WingoRound |
| `GET /api/game/trxwingo/history` | TrxWingoRound |
| `GET /api/game/fived/history` | FiveDRound |
| `GET /api/game/aviator/history` | AviatorRound |
| `GET /api/game/k3/history` | K3Round |
| `GET /api/game/slots/history` | SlotsGame |

**Response format (all paginated routes):**
```json
{
  "success": true,
  "rounds": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 482,
    "pages": 25
  }
}
```

**Usage example:**
```
GET /api/game/history?gameId=wingo1m&page=2&limit=50
```
