# LEGIT CLUB — Backend v17 (FINAL)

## What Changed in v17

### 🔴 Security / Race Condition Fixes
- **Deposit double-credit fixed** — `/deposit/verify` and the Razorpay webhook both now use `findByIdAndUpdate + $inc` (atomic). Two simultaneous verify requests can no longer both credit the same payment.
- **All game bets atomic** — every game (Dragon Tiger, Andar Bahar, Vortex, Slots, Mines, WinGo, TRX, K3, 5D, Aviator) now uses `findOneAndUpdate({ balance: { $gte: amount } })` to deduct bets. Negative balance is impossible even under concurrent load.
- **Logout invalidates token** — `POST /api/auth/logout` adds the token to an in-memory blacklist. The middleware checks it on every request. Blocked users' tokens are also rejected immediately.
- **JWT shortened** — 30 days → 7 days. Reduces exposure window if a token is stolen.

### 🟠 New Features
- **Password reset flow** — `POST /api/auth/forgot-password` generates a 6-digit OTP (10 min TTL). `POST /api/auth/reset-password` validates it and sets the new password. In `development` mode the OTP is returned in the response. In `production` wire it to SMS (MSG91 / Fast2SMS / Twilio).
- **Referral code collision fix** — now uses `crypto.randomBytes(3)` with up to 5 retry attempts on collision. `Math.random()` removed from referral code generation.
- **`/health` rate limited** — 30 requests/minute to prevent abuse.

### 🟡 Model / DB Fixes
- **`Transaction.user` indexed** — all transaction queries by user are now fast.
- **`Transaction.razorpayPaymentId` unique + indexed** — prevents duplicate payment records at the DB level.
- **`User.balance` has `min: 0`** — schema-level floor, backed by atomic operations in all routes.
- **`User.phone` indexed** — login lookups are fast.
- **`logs/` added to `.gitignore`** — log files won't be committed to git.

---

## Setup

```bash
npm install
cp .env .env.bak
# Edit .env — fill in all REPLACE_* values
npm run gen-secret    # generates JWT_SECRET
npm start             # or: pm2 start ecosystem.config.js --env production
```

---

## ✅ Final Pre-Launch Checklist

### Secrets
- [ ] `JWT_SECRET` — `npm run gen-secret`
- [ ] `ADMIN_KEY` — strong passphrase
- [ ] `NODE_ENV=production`

### Payments
- [ ] `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — live keys
- [ ] `RAZORPAY_WEBHOOK_SECRET` — from Razorpay Dashboard → Webhooks
- [ ] `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` / `CASHFREE_MODE=PROD`

### Infrastructure
- [ ] `MONGO_URI` — production MongoDB URI
- [ ] `ALLOWED_ORIGINS` — your frontend domain
- [ ] Nginx + Let's Encrypt SSL (config below)
- [ ] `pm2 start ecosystem.config.js --env production`
- [ ] `pm2 startup && pm2 save`

### SMS for Password Reset (production)
- [ ] Sign up with MSG91 / Fast2SMS / Twilio
- [ ] Add `SMS_API_KEY` to `.env`
- [ ] Uncomment SMS call in `routes/auth.js` → `forgot-password` handler

### Optional
- [ ] `S3_BUCKET` + AWS keys for offsite backup
- [ ] Add `/health` URL to UptimeRobot

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Register (referral code optional) |
| POST | `/api/auth/login` | — | Login |
| POST | `/api/auth/logout` | JWT | Invalidate token |
| POST | `/api/auth/forgot-password` | — | Send OTP to phone |
| POST | `/api/auth/reset-password` | — | Verify OTP + set new password |
| GET  | `/api/auth/me` | JWT | Get current user |
| PUT  | `/api/auth/update` | JWT | Update name/email/password |

### Wallet
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/wallet/balance` | JWT | Balance + stats |
| GET  | `/api/wallet/transactions` | JWT | Transaction history |
| POST | `/api/wallet/deposit/create-order` | JWT | Create Razorpay order |
| POST | `/api/wallet/deposit/verify` | JWT | Client-side payment verify |
| POST | `/api/wallet/razorpay-webhook` | Signature | Server-side deposit webhook |
| POST | `/api/wallet/withdraw` | JWT | Withdraw via Cashfree UPI |

### Games (JWT required)
WinGo, TRX WinGo, K3, 5D, Aviator, Mines, Slots, Dragon Tiger, Andar Bahar, Vortex

### Admin (`x-admin-key` header required)
Stats, game control, user management, withdrawal approval, analytics

### System
| GET | `/health` | — | `{ ok, db, uptime, ts }` |

---

## Nginx + SSL

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
server { listen 80; server_name yourdomain.com; return 301 https://$host$request_uri; }
```

`sudo certbot --nginx -d yourdomain.com`

---

## PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 startup && pm2 save
pm2 logs legitclub
```

---

## Logs

```
logs/app-YYYY-MM-DD.log   — all requests + errors
logs/pm2-out.log          — stdout
logs/pm2-err.log          — stderr
```
