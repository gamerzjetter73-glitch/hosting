// ═══════════════════════════════════════════════════
//  LEGIT CLUB — app.js  FINAL v27.0
//  v27 FIXES: Added all missing game functions (Vortex, K3, Dragon Tiger,
//             Andar Bahar, Mines), lag fix (socket gating), k3State declared
//  v26 FIXES: Aviator countdown timer, removed post-crash popup, goTo nav fix
//  v25 FIXES: Aviator full rewrite, server-driven state
// ═══════════════════════════════════════════════════
const API        = window.location.origin + '/api';
const SOCKET_URL = window.location.origin;

// ── BOTTOM NAV — Page switching ──────────────────────
function goTo(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show the target page
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById('nav-' + page);
  if (navEl) navEl.classList.add('active');
  // Side effects per page
  if (page === 'activity') {
    loadTransactions();
    renderActivity();
  }
  if (page === 'account') {
    const u = currentUser;
    if (u) {
      const n = document.getElementById('accName'); if (n) n.textContent = u.name || 'Player';
      const i = document.getElementById('accId');   if (i) i.textContent = 'ID: #' + (u.id || '').toString().slice(-6);
      const p = document.getElementById('accPhone'); if (p) p.textContent = u.phone || '';
    }
    fetchBalance();
  }
  if (page === 'wager') {
    loadWagerPage();
  }
  if (page === 'cricket') {
    if (typeof CricketUI !== 'undefined') CricketUI.init();
  }
}


let authToken   = localStorage.getItem('legitclub_token') || null;
let currentUser = JSON.parse(localStorage.getItem('legitclub_user') || 'null');
let wallet = (currentUser?.balance || 0) + (currentUser?.bonusBalance || 0);
let totalWon=0, totalLost=0, totalDep=0, totalWith=0;
let activityLog = [];
let currentFilter = 'all';
let claimedPromos = new Set();
let socket = null;

// ── API HELPER ──
async function api(method, path, body=null, auth=true) {
  const headers = { 'Content-Type':'application/json' };
  if (auth && authToken) headers['Authorization'] = 'Bearer ' + authToken;
  try {
    const res  = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : null });
    const data = await res.json().catch(()=>({}));
    if (auth && res.status === 401) doLogout();
    return data;
  } catch(err) {
    showToast('❌ Network error','rgba(255,80,80,0.5)');
    return { success:false, message:'Network error' };
  }
}

async function apiForm(path, formData, auth=true) {
  const headers = {};
  if (auth && authToken) headers['Authorization'] = 'Bearer ' + authToken;
  try {
    const res = await fetch(API + path, { method: 'POST', headers, body: formData });
    const data = await res.json().catch(()=>({}));
    if (auth && res.status === 401) doLogout();
    return data;
  } catch (err) {
    showToast('❌ Network error','rgba(255,80,80,0.5)');
    return { success:false, message:'Network error' };
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
// IP-based duplicate account prevention is handled server-side.

function showAuthScreen() { document.getElementById('authOverlay').classList.add('open'); document.body.style.overflow='hidden'; }
function hideAuthScreen() { document.getElementById('authOverlay').classList.remove('open'); document.body.style.overflow=''; }

function setErr(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.style.display='none'; el.textContent=''; return; }
  el.textContent = msg; el.style.display = 'block';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + tab);
  const formEl = document.getElementById('form-' + tab);
  if (tabEl) { tabEl.style.background = tab === 'login' ? 'var(--accent)' : 'var(--gold)'; tabEl.style.color = tab === 'login' ? '#fff' : '#1a1200'; tabEl.classList.add('active'); }
  // Reset inactive tab style
  const otherTab = document.getElementById(tab === 'login' ? 'tab-register' : 'tab-login');
  if (otherTab) { otherTab.style.background = 'none'; otherTab.style.color = 'var(--muted)'; }
  if (formEl) formEl.classList.add('active');
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN FLOW: Phone + Email → OTP sent to email → Verify → Login
// ══════════════════════════════════════════════════════════════════════════════
let loginCooldownTimer = null;

function loginSetErr(msg, step) {
  setErr(step === 2 ? 'loginError2' : 'loginError1', msg);
}

function startCooldown(timerElId, resendBtnId, seconds) {
  const timerEl   = document.getElementById(timerElId);
  const resendBtn = document.getElementById(resendBtnId);
  let remaining = seconds;
  if (resendBtn) { resendBtn.disabled = true; resendBtn.style.opacity = '0.4'; }
  if (timerEl) { timerEl.style.display = 'inline'; timerEl.textContent = `(${remaining}s)`; }
  const timer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(timer);
      if (timerEl) timerEl.style.display = 'none';
      if (resendBtn) { resendBtn.disabled = false; resendBtn.style.opacity = '1'; }
    } else {
      if (timerEl) timerEl.textContent = `(${remaining}s)`;
    }
  }, 1000);
}

async function loginSendOtp() {
  const phone = (document.getElementById('login-phone')?.value || '').trim();
  const email = (document.getElementById('login-email')?.value || '').trim().toLowerCase();
  loginSetErr('', 1);

  if (!phone || phone.length < 10) return loginSetErr('Please enter your registered phone number', 1);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return loginSetErr('Please enter your registered email address', 1);

  // Verify phone+email combo exists
  const btn = document.getElementById('login-send-btn');
  btn.textContent = 'Checking...'; btn.disabled = true;

  // Check if combo exists before sending OTP
  const checkData = await api('POST', '/auth/check-credentials', { phone, email }, false);
  if (!checkData.success) {
    btn.textContent = 'Send OTP to Email'; btn.disabled = false;
    return loginSetErr(checkData.message || 'Phone or email not found. Please check your details.', 1);
  }

  // Send OTP to email
  btn.textContent = 'Sending OTP...';
  const data = await api('POST', '/auth/email-otp/send', { email }, false);
  btn.textContent = 'Send OTP to Email'; btn.disabled = false;

  if (!data.success) {
    if (data.retryAfter) {
      loginSetErr(`Please wait ${data.retryAfter}s before requesting a new OTP.`, 1);
      startCooldown('login-cooldown-timer', 'login-resend-btn', data.retryAfter);
    } else {
      loginSetErr(data.message || 'Failed to send OTP. Try again.', 1);
    }
    return;
  }

  // Move to OTP step
  document.getElementById('login-step-1').style.display = 'none';
  document.getElementById('login-step-2').style.display = '';
  const sentTo = document.getElementById('login-sent-to');
  if (sentTo) sentTo.textContent = email;
  setTimeout(() => document.getElementById('login-otp-input')?.focus(), 100);
  showToast('📬 OTP sent! Check your inbox & spam folder.', 'rgba(79,142,247,0.6)');
  startCooldown('login-cooldown-timer', 'login-resend-btn', data.retryAfter || 60);
  if (data.devOtp) showToast('🔢 Dev OTP: ' + data.devOtp, 'rgba(79,142,247,0.5)');
}

async function loginVerifyOtp() {
  const email = (document.getElementById('login-email')?.value || '').trim().toLowerCase();
  const phone = (document.getElementById('login-phone')?.value || '').trim();
  const otp   = (document.getElementById('login-otp-input')?.value || '').trim();
  if (!otp || otp.length !== 6) return loginSetErr('Enter the 6-digit OTP from your email', 2);

  const btn = document.getElementById('login-verify-btn');
  btn.textContent = 'Verifying...'; btn.disabled = true;
  loginSetErr('', 2);

  const data = await api('POST', '/auth/email-otp/verify', { email, otp, phone }, false);
  btn.textContent = 'Verify & Login ✓'; btn.disabled = false;

  if (!data.success) {
    const inp = document.getElementById('login-otp-input');
    if (inp) { inp.style.borderColor = '#ff4d6a'; setTimeout(() => inp.style.borderColor = 'rgba(79,142,247,0.4)', 800); }
    return loginSetErr(data.message || 'Invalid OTP', 2);
  }

  if (!data.hasAccount) {
    return loginSetErr('No account found with these details. Please register.', 2);
  }

  saveAuth(data);
  showToast('✅ Welcome back, ' + currentUser.name + '!', 'rgba(22,163,74,0.5)');
}

async function loginResendOtp() {
  const email = (document.getElementById('login-email')?.value || '').trim().toLowerCase();
  if (!email) return;
  const data = await api('POST', '/auth/email-otp/send', { email }, false);
  if (data.success) {
    showToast('📬 New OTP sent!', 'rgba(79,142,247,0.6)');
    startCooldown('login-cooldown-timer', 'login-resend-btn', data.retryAfter || 60);
    if (data.devOtp) showToast('🔢 Dev OTP: ' + data.devOtp, 'rgba(79,142,247,0.5)');
  } else {
    loginSetErr(data.message || 'Could not resend OTP', 2);
  }
}

function loginGoBack() {
  document.getElementById('login-step-1').style.display = '';
  document.getElementById('login-step-2').style.display = 'none';
  document.getElementById('login-otp-input').value = '';
  loginSetErr('', 1); loginSetErr('', 2);
}

// ══════════════════════════════════════════════════════════════════════════════
// REGISTER FLOW:
//   Fill: Name, Phone*, Password, Referral(opt)
//   Then: Email → Send OTP → Verify → ✅ Green banner → Unlock Submit
// ══════════════════════════════════════════════════════════════════════════════
let regEmailVerified = false;

function setRegError(msg) { setErr('regError', msg); }
function setRegEmailError(msg) { setErr('regEmailError', msg); }

async function regSendEmailOtp() {
  const email = (document.getElementById('reg-email-input')?.value || '').trim().toLowerCase();
  setRegEmailError('');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setRegEmailError('Please enter a valid email address');

  const btn = document.getElementById('reg-email-otp-btn');
  btn.textContent = 'Sending...'; btn.disabled = true;

  const data = await api('POST', '/auth/email-otp/send', { email }, false);
  btn.textContent = 'Send OTP'; btn.disabled = false;

  if (!data.success) {
    if (data.retryAfter) {
      setRegEmailError(`Wait ${data.retryAfter}s before resending.`);
      startCooldown('reg-otp-cooldown', 'reg-resend-btn', data.retryAfter);
    } else {
      setRegEmailError(data.message || 'Failed to send OTP. Try again.');
    }
    return;
  }

  // Show OTP input row
  document.getElementById('reg-otp-row').style.display = '';
  setTimeout(() => document.getElementById('reg-otp-input')?.focus(), 100);
  showToast('📬 OTP sent to ' + email + '! Check inbox & spam.', 'rgba(124,111,255,0.6)');
  startCooldown('reg-otp-cooldown', 'reg-resend-btn', data.retryAfter || 60);
  if (data.devOtp) showToast('🔢 Dev OTP: ' + data.devOtp, 'rgba(124,111,255,0.5)');
}

async function regVerifyEmailOtp() {
  const email = (document.getElementById('reg-email-input')?.value || '').trim().toLowerCase();
  const otp   = (document.getElementById('reg-otp-input')?.value || '').trim();
  if (!otp || otp.length !== 6) return setRegEmailError('Enter the 6-digit OTP');

  const btn = document.getElementById('reg-otp-verify-btn');
  btn.textContent = 'Verifying...'; btn.disabled = true;
  setRegEmailError('');

  const data = await api('POST', '/auth/email-otp/verify', { email, otp }, false);
  btn.textContent = 'Verify ✓'; btn.disabled = false;

  if (!data.success) {
    const inp = document.getElementById('reg-otp-input');
    if (inp) { inp.style.borderColor = '#ff4d6a'; setTimeout(() => inp.style.borderColor = 'rgba(124,111,255,0.4)', 800); }
    return setRegEmailError(data.message || 'Invalid OTP');
  }

  // ✅ Email verified!
  regEmailVerified = true;
  document.getElementById('reg-email-verified').value = email;

  // Show green verified banner at top
  const banner = document.getElementById('reg-verified-banner');
  if (banner) banner.style.display = 'block';
  const bannerEmail = document.getElementById('reg-verified-email');
  if (bannerEmail) bannerEmail.textContent = email;

  // Lock email field + hide OTP section
  const emailInput = document.getElementById('reg-email-input');
  if (emailInput) { emailInput.disabled = true; emailInput.style.opacity = '0.6'; }
  document.getElementById('reg-otp-row').style.display = 'none';
  document.getElementById('reg-email-otp-btn').style.display = 'none';
  setRegEmailError('');

  // Unlock submit button
  const regBtn = document.getElementById('reg-btn');
  if (regBtn) { regBtn.disabled = false; regBtn.style.opacity = '1'; regBtn.style.cursor = 'pointer'; }

  showToast('✅ Email verified! Now click Create Account.', 'rgba(22,163,74,0.5)');
}

async function regResendEmailOtp() {
  const email = (document.getElementById('reg-email-input')?.value || '').trim().toLowerCase();
  if (!email) return;
  const data = await api('POST', '/auth/email-otp/send', { email }, false);
  if (data.success) {
    showToast('📬 New OTP sent!', 'rgba(124,111,255,0.6)');
    startCooldown('reg-otp-cooldown', 'reg-resend-btn', data.retryAfter || 60);
    if (data.devOtp) showToast('🔢 Dev OTP: ' + data.devOtp, 'rgba(124,111,255,0.5)');
  } else {
    setRegEmailError(data.message || 'Could not resend OTP');
  }
}

async function doRegister() {
  const name  = (document.getElementById('reg-name')?.value  || '').trim();
  const phone = (document.getElementById('reg-phone')?.value || '').trim();
  const pass  = (document.getElementById('reg-pass')?.value  || '').trim();
  const ref   = (document.getElementById('reg-ref')?.value   || '').trim();
  const email = (document.getElementById('reg-email-verified')?.value || '').trim();

  setRegError('');

  if (!name)            return setRegError('Please enter your full name');
  if (!phone)           return setRegError('Phone number is required');
  if (phone.length < 10) return setRegError('Enter a valid 10-digit phone number');
  if (!pass)            return setRegError('Please set a password');
  if (pass.length < 6)  return setRegError('Password must be at least 6 characters');
  if (!regEmailVerified || !email) return setRegError('Please verify your email address first');

  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creating Account...'; btn.disabled = true;

  const data = await api('POST', '/auth/register', { name, phone, password: pass, referralCode: ref, email }, false);
  btn.textContent = 'Create Account'; btn.disabled = false;

  if (!data.success) {
    setRegError(data.message || 'Registration failed');
    return showToast('❌ ' + (data.message || 'Registration failed'), 'rgba(255,80,80,0.5)');
  }

  // Reset register form
  regEmailVerified = false;
  ['reg-name','reg-phone','reg-pass','reg-ref','reg-email-input','reg-otp-input'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.value = ''; el.disabled = false; el.style.opacity = '1'; }
  });
  document.getElementById('reg-email-verified').value = '';
  document.getElementById('reg-verified-banner').style.display = 'none';
  document.getElementById('reg-otp-row').style.display = 'none';
  const otpBtn = document.getElementById('reg-email-otp-btn');
  if (otpBtn) otpBtn.style.display = '';

  saveAuth(data);
  const bonusAmt = (data.user && data.user.bonusBalance) ? data.user.bonusBalance : 0;
  if (bonusAmt > 0) {
    showToast('🎉 Welcome to LEGIT CLUB, ' + currentUser.name + '! ₹' + bonusAmt + ' bonus added!', 'rgba(22,163,74,0.5)');
  } else {
    showToast('🎉 Welcome to LEGIT CLUB, ' + currentUser.name + '!', 'rgba(22,163,74,0.5)');
  }
}

function saveAuth(data) {
  authToken=data.token; currentUser=data.user;
  localStorage.setItem('legitclub_token',authToken);
  localStorage.setItem('legitclub_user',JSON.stringify(currentUser));
  wallet = (currentUser.balance || 0) + (currentUser.bonusBalance || 0);
  // Persist bonus balance & wager info from register/login response
  if (currentUser.bonusBalance !== undefined) {
    localStorage.setItem('legitclub_bonusBalance', currentUser.bonusBalance);
  }
  if (currentUser.wagerRequired !== undefined) {
    localStorage.setItem('legitclub_wagerRequired', currentUser.wagerRequired);
  }
  if (currentUser.wagerCompleted !== undefined) {
    localStorage.setItem('legitclub_wagerCompleted', currentUser.wagerCompleted);
  }
  hideAuthScreen(); refreshWalletUI(); updateUserUI();
  fetchBalance(); loadTransactions(); connectSocket();
  checkMinesState();
}

function doLogout() {
  authToken=null; currentUser=null;
  localStorage.removeItem('legitclub_token'); localStorage.removeItem('legitclub_user');
  wallet=0; refreshWalletUI();
  if (socket) { socket.disconnect(); socket=null; }
  showAuthScreen();
}

async function confirmLogout() {
  if (!authToken) return showAuthScreen();
  if (!window.confirm('Are you sure you want to log out?')) return;
  // Best-effort notify backend so token is blacklisted
  try { await api('POST','/auth/logout', null, true); } catch(e) {}
  doLogout();
  showToast('✅ Logged out successfully','rgba(22,163,74,0.5)');
}

function updateUserUI() {
  if (!currentUser) return;
  const n=document.getElementById('accName'); if(n) n.textContent=currentUser.name;
  const i=document.getElementById('accId');   if(i) i.textContent='ID: #'+(currentUser.id||'').toString().slice(-6);
  const r=document.getElementById('refCode'); if(r) r.textContent=currentUser.referralCode||'91C-XXXX';
  const r2=document.getElementById('accRefCode'); if(r2) r2.textContent=currentUser.referralCode||'91C-XXXX';
}

// ── WALLET ──
function refreshWalletUI() {
  const fmt='₹'+wallet.toFixed(2);
  ['walletAmtHome','walletAmtAcc','witAvailAmt'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=fmt;});
  const g=document.getElementById('walletTodayHome'); if(g) g.textContent='↑ +₹'+totalDep.toFixed(2)+' deposited';
  const map={statWon:totalWon,statLost:totalLost,statDep:totalDep,statWith:totalWith};
  Object.entries(map).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.textContent='₹'+val.toFixed(2);});
  // Update all in-game balance displays
  // Original span balances (already have ₹ prefix in HTML)
  ['trx-wm-bal','fd-wm-bal','sl-wm-bal'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=wallet.toLocaleString('en-IN');});
  // New full-format balance displays
  ['wm-bal-display','k3-bal-display','av-bal-display','vx-bal-display','mines-bal-display','dt-bal-display','ab-bal-display'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='₹'+wallet.toLocaleString('en-IN');});
}

async function fetchBalance() {
  if (!authToken) return;
  const d=await api('GET','/wallet/balance');
  if (d.success) {
    // Show real balance + bonus balance combined so the ₹50 signup bonus is visible
    wallet=(d.balance||0)+(d.bonusBalance||0);
    totalWon=d.totalWon||0; totalLost=d.totalLost||0;
    totalDep=d.totalDeposited||0; totalWith=d.totalWithdrawn||0;
    // Persist bonus info for wager progress display
    if(d.bonusBalance!==undefined) localStorage.setItem('legitclub_bonusBalance', d.bonusBalance);
    if(d.wagerRequired!==undefined) localStorage.setItem('legitclub_wagerRequired', d.wagerRequired);
    if(d.wagerCompleted!==undefined) localStorage.setItem('legitclub_wagerCompleted', d.wagerCompleted);
    refreshWalletUI();
  }
}

// ── DEPOSIT ──
let _depositMode = ''; // cache so processDeposit doesn't need a second API call

async function loadDepositConfig() {
  if (!authToken) return;
  const d = await api('GET', '/wallet/deposit/config');
  if (!d || !d.success) return;
  _depositMode = d.mode || '';
  const vpaEl = document.getElementById('depUpiVpa');
  const nameEl = document.getElementById('depUpiName');
  const imgEl = document.getElementById('depQrImg');
  if (vpaEl) vpaEl.textContent = d.upi?.vpa || '—';
  if (nameEl) nameEl.textContent = d.upi?.payeeName ? `Payee: ${d.upi.payeeName}` : '';
  if (imgEl) {
    const url = d.upi?.qrUrl || '';
    if (url) { imgEl.src = url; imgEl.style.display = ''; }
    else { imgEl.removeAttribute('src'); imgEl.style.display = 'none'; }
  }
  // Preload Razorpay script if not in manual mode, so Pay button is instant
  if (_depositMode !== 'upi_manual' && !window.Razorpay) {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    document.body.appendChild(s);
  }
}

async function processDeposit() {
  if (!authToken) return showAuthScreen();
  const chipSel=document.querySelector('#depositModal .amount-chip.selected');
  const inputVal=document.getElementById('depAmount').value;
  const amt=parseInt(inputVal)||(chipSel?parseInt(chipSel.textContent.replace('₹','')):0);
  if (!amt||amt<1) return showToast('❌ Minimum deposit is ₹1','rgba(255,80,80,0.5)');
  const btn=document.querySelector('#depositModal .btn-primary');
  btn.textContent='Processing...'; btn.disabled=true;

  // Prefer manual UPI deposit request if the server is configured for it.
  const mode = _depositMode; // use cached value — no second API call needed
  if (mode === 'upi_manual') {
    const utr = (document.getElementById('depUtr')?.value || '').trim();
    const payerUpi = (document.getElementById('depPayerUpi')?.value || '').trim();
    const file = document.getElementById('depScreenshot')?.files?.[0] || null;
    if (!utr) { btn.textContent='✅ Submit UTR'; btn.disabled=false; return showToast('❌ Enter UTR / Ref No. (visible on screenshot)','rgba(255,80,80,0.5)'); }
    if (!file) { btn.textContent='✅ Submit UTR'; btn.disabled=false; return showToast('❌ Upload payment screenshot (UTR visible)','rgba(255,80,80,0.5)'); }
    const fd = new FormData();
    fd.append('amount', String(amt));
    fd.append('utr', utr);
    if (payerUpi) fd.append('payerUpi', payerUpi);
    fd.append('screenshot', file);
    const r = await apiForm('/wallet/deposit/request', fd, true);
    btn.textContent='✅ Submit UTR'; btn.disabled=false;
    if (!r.success) return showToast('❌ '+(r.message||'Could not submit deposit'), 'rgba(255,80,80,0.5)');
    closeModal('depositModal');
    showSuccess('⏳ Deposit Submitted','green','✅',`₹${amt} request submitted.\nWe are checking your screenshot now.`,false);
    loadTransactions();
    return;
  }

  // Fallback: Razorpay flow (existing behavior)
  const data=await api('POST','/wallet/deposit/create-order',{amount:amt});
  btn.textContent='💳 Proceed to Pay'; btn.disabled=false;
  if (!data.success) return showToast('❌ '+data.message,'rgba(255,80,80,0.5)');
  if (data.devMode) {
    wallet=data.newBalance; totalDep+=amt; refreshWalletUI();
    closeModal('depositModal');
    showSuccess('💰 Deposit Successful!','green','✅','₹'+amt+' added'+(data.bonus?'\n+₹'+data.bonus+' bonus (20%)!':''),false);
    addActivity('Deposit'+(data.bonus?' (+₹'+data.bonus+' bonus)':''),amt,'deposit');
    loadTransactions(); return;
  }
  closeModal('depositModal');
  const opts={
    key:data.key,amount:data.order.amount,currency:'INR',name:'LEGIT CLUB',description:'Wallet Deposit',order_id:data.order.id,
    handler:async function(resp){
      const v=await api('POST','/wallet/deposit/verify',{razorpay_order_id:resp.razorpay_order_id,razorpay_payment_id:resp.razorpay_payment_id,razorpay_signature:resp.razorpay_signature,amount:amt});
      if(v.success){wallet=v.newBalance;totalDep+=amt;refreshWalletUI();showSuccess('💰 Deposit Successful!','green','✅','₹'+amt+' added'+(v.bonus?'\n+₹'+v.bonus+' bonus!':''),false);addActivity('Deposit',amt,'deposit');loadTransactions();}
      else showToast('❌ Payment verification failed','rgba(255,80,80,0.5)');
    },theme:{color:'#4f8ef7'}
  };
  // Script was preloaded in loadDepositConfig — should be ready immediately
  if (!window.Razorpay) {
    const s=document.createElement('script');
    s.src='https://checkout.razorpay.com/v1/checkout.js';
    s.onload=()=>new window.Razorpay(opts).open();
    document.body.appendChild(s);
  } else {
    new window.Razorpay(opts).open();
  }
}

// ── WITHDRAW ──
async function processWithdraw() {
  if (!authToken) return showAuthScreen();
  const inputVal=document.getElementById('witAmount').value;
  const account=document.getElementById('witAccount').value.trim();
  const chipSel=document.querySelector('#withdrawModal .amount-chip.selected');
  const amt=parseInt(inputVal)||(chipSel?parseInt(chipSel.textContent.replace('₹','')):0);
  if (!amt||amt<50) return showToast('❌ Minimum withdrawal ₹50','rgba(255,80,80,0.5)');
  if (amt>wallet)   return showToast('❌ Insufficient balance','rgba(255,80,80,0.5)');
  if (!account)     return showToast('❌ Enter UPI ID or bank account','rgba(255,80,80,0.5)');
  const data=await api('POST','/wallet/withdraw',{amount:amt,account});
  if (!data.success) return showToast('❌ '+data.message,'rgba(255,80,80,0.5)');
  wallet=data.newBalance; totalWith+=amt; refreshWalletUI();
  closeModal('withdrawModal');
  addActivity('Withdrawal to '+account.substring(0,12)+'...',-amt,'withdraw');
  showSuccess('🏧 Withdrawal Requested!','green','✅','₹'+amt+' will be credited within 1–24 hours.',false);
  loadTransactions();
}

// ── TRANSACTIONS ──
async function loadTransactions() {
  if (!authToken) return;
  const data=await api('GET','/wallet/transactions');
  if (!data.success) return;
  activityLog=data.transactions.map(t=>({
    name:t.note||t.type,
    amount:['deposit','win','bonus'].includes(t.type)?t.amount:-t.amount,
    type:t.type,
    status:t.status||'success',
    time:new Date(t.createdAt).toLocaleString('en-IN'),
    icon:{win:'🏆',loss:'💸',deposit:'💰',withdraw:'🏧',bonus:'🎁'}[t.type]||'📋',
    cls:{win:'ai-win',loss:'ai-loss',deposit:'ai-deposit',withdraw:'ai-withdraw',bonus:'ai-deposit'}[t.type]||'ai-deposit'
  }));
  renderActivity();
}

function addActivity(name,amount,type) {
  const icons={win:'🏆',loss:'💸',deposit:'💰',withdraw:'🏧',bonus:'🎁'};
  const classes={win:'ai-win',loss:'ai-loss',deposit:'ai-deposit',withdraw:'ai-withdraw',bonus:'ai-deposit'};
  activityLog.unshift({name,amount,type,time:new Date().toLocaleString('en-IN'),icon:icons[type]||'📋',cls:classes[type]||'ai-deposit'});
  renderActivity();
}

function renderActivity() {
  const list=document.getElementById('activityList'); if(!list) return;
  const filtered=currentFilter==='all'?activityLog:activityLog.filter(a=>a.type===currentFilter);
  if (!filtered.length){list.innerHTML='<div style="text-align:center;padding:40px;color:var(--muted);font-size:14px;">No activity yet.</div>';return;}
  list.innerHTML=filtered.map(a=>{
    const showBadge=a.type==='withdraw'||a.type==='deposit';
    let badge='';
    if(showBadge){
      if(a.status==='pending') badge='<span style="font-size:10px;background:rgba(245,180,0,0.25);color:#f5c842;border:1px solid rgba(245,180,0,0.4);border-radius:4px;padding:1px 6px;margin-left:5px;">⏳ Pending</span>';
      else if(a.status==='success') badge='<span style="font-size:10px;background:rgba(34,214,122,0.2);color:#22d67a;border:1px solid rgba(34,214,122,0.35);border-radius:4px;padding:1px 6px;margin-left:5px;">✅ Success</span>';
      else if(a.status==='failed') badge='<span style="font-size:10px;background:rgba(255,77,106,0.2);color:#ff4d6a;border:1px solid rgba(255,77,106,0.35);border-radius:4px;padding:1px 6px;margin-left:5px;">❌ Failed</span>';
    }
    return `<div class="activity-item"><div class="activity-icon ${a.cls}">${a.icon}</div><div class="activity-info"><div class="activity-name">${a.name}${badge}</div><div class="activity-time">${a.time}</div></div><div class="activity-amt ${a.amount>=0?'pos':'neg'}">${a.amount>=0?'+':''}₹${Math.abs(a.amount).toFixed(2)}</div></div>`;
  }).join('');
}

function filterActivity(el,type) {
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active'); currentFilter=type; renderActivity();
}

// ═══════════════════════════════════════════════════
//  SOCKET.IO — everything hooked inside initSocket
// ═══════════════════════════════════════════════════
function connectSocket() {
  if (!window.io){const s=document.createElement('script');s.src=SOCKET_URL+'/socket.io/socket.io.js';s.onload=initSocket;document.body.appendChild(s);}
  else initSocket();
}

function initSocket() {
  if (socket) socket.disconnect();
  socket=io(SOCKET_URL,{reconnection:true,reconnectionDelay:2000});

  socket.on('connect',    ()=>console.log('[Socket] Connected'));
  socket.on('disconnect', ()=>console.log('[Socket] Disconnected'));

  // ── WIN GO — only update UI when overlay is open (lag fix) ──
  ['wingo30s','wingo1m','wingo3m','wingo5m'].forEach(gid=>{
    socket.on(gid+':sync',         ({periodId,secondsLeft})=>{ wgState[gid].periodId=periodId; wgState[gid].sec=secondsLeft; if(activeWgGame===gid && document.getElementById('wingoOverlay')?.classList.contains('open')) updateWgTimer(gid); });
    socket.on(gid+':timer_tick',   ({secondsLeft,periodId})=>{ wgState[gid].sec=secondsLeft; wgState[gid].periodId=periodId; if(activeWgGame===gid && document.getElementById('wingoOverlay')?.classList.contains('open')) updateWgTimer(gid); });
    socket.on(gid+':new_round',    ({periodId,secondsLeft})=>{ wgState[gid]={periodId,sec:secondsLeft,pendingBets:[]}; if(activeWgGame===gid && document.getElementById('wingoOverlay')?.classList.contains('open')) updateWgTimer(gid); });
    socket.on(gid+':round_ended',  ()=>{/* silent */});
    socket.on(gid+':round_result', ({result,periodId,color})=>{ showWingoResult(gid,result,periodId,color); fetchBalance(); });
  });

  // ── AVIATOR v25 — canvas/UI only updated when overlay is open (lag fix) ──
  const avOpen = () => document.getElementById('aviatorOverlay')?.classList.contains('open');
  socket.on('aviator:sync',       (d) => av25Sync(d));
  socket.on('aviator:waiting',    (d) => av25OnWaiting(d));
  socket.on('aviator:countdown',  (d) => { if(avOpen()) av25OnCountdown(d); else { av25.phase='waiting'; av25.mult=1.0; } });
  socket.on('aviator:fly_start',  (d) => { if(avOpen()) av25OnFlyStart(d); else { av25.phase='flying'; av25.points=[]; SFX._avStopEngine(); } });
  socket.on('aviator:tick',       (d) => { av25.mult=d.mult; av25.phase='flying'; if(avOpen()) av25OnTick(d); });
  socket.on('aviator:crash',      (d) => { if(avOpen()) av25OnCrash(d); else { SFX._avStopEngine(); av25.phase='crashed'; av25.betAmt=0; av25.cashedOut=false; } });
  socket.on('aviator:cashed_out', (d) => av25OnCashedOut(d));

  // ── K3 DICE — only process UI updates when overlay is open (lag fix) ──
  const k3Open = () => document.getElementById('k3Overlay')?.classList.contains('open');
  socket.on('k3:sync',         ({periodId,secondsLeft})=>{ k3State.periodId=periodId; k3State.sec=secondsLeft; if(k3Open()) updateK3Timer(); });
  socket.on('k3:timer_tick',   ({secondsLeft,periodId})=>{ k3State.sec=secondsLeft; k3State.periodId=periodId; if(k3Open()) updateK3Timer(); });
  socket.on('k3:new_round',    ({periodId,secondsLeft})=>{ k3State.periodId=periodId; k3State.sec=secondsLeft; k3State.pendingBets=[]; if(k3Open()){updateK3Timer();resetK3Dice();} });
  socket.on('k3:round_ended',  ()=>{/* silent */});
  socket.on('k3:round_result', ({dice,sum,periodId})=>{ if(k3Open()) showK3Result(dice,sum,periodId); fetchBalance(); });

  // ── TRX WINGO — only process UI updates when overlay is open (lag fix) ──
  const trxOpen = () => document.getElementById('trxWingoOverlay')?.classList.contains('open');
  socket.on('trxwingo:sync',         ({periodId,secondsLeft})=>{ trxClientState.periodId=periodId; trxClientState.sec=secondsLeft; if(trxOpen()) updateTrxTimer(); });
  socket.on('trxwingo:timer_tick',   ({secondsLeft,periodId})=>{ trxClientState.sec=secondsLeft; trxClientState.periodId=periodId; if(trxOpen()) updateTrxTimer(); });
  socket.on('trxwingo:new_round',    ({periodId,secondsLeft})=>{ trxClientState.periodId=periodId; trxClientState.sec=secondsLeft; trxClientState.pendingBets=[]; if(trxOpen()) updateTrxTimer(); });
  socket.on('trxwingo:round_ended',  ()=>{/* silent */});
  socket.on('trxwingo:round_result', ({result,color,hash,periodId})=>{ if(trxOpen()) showTrxResult(result,color,hash,periodId); fetchBalance(); });

  // ── 5D LOTTERY — only process UI updates when overlay is open (lag fix) ──
  const fdOpen = () => document.getElementById('fiveDOverlay')?.classList.contains('open');
  socket.on('fived:sync',         ({periodId,secondsLeft})=>{ fdClientState.periodId=periodId; fdClientState.sec=secondsLeft; if(fdOpen()) updateFiveDTimer(); });
  socket.on('fived:timer_tick',   ({secondsLeft,periodId})=>{ fdClientState.sec=secondsLeft; fdClientState.periodId=periodId; if(fdOpen()) updateFiveDTimer(); });
  socket.on('fived:new_round',    ({periodId,secondsLeft})=>{ fdClientState.periodId=periodId; fdClientState.sec=secondsLeft; fdClientState.pendingBets=[]; if(fdOpen()) updateFiveDTimer(); });
  socket.on('fived:round_ended',  ()=>{/* silent */});
  socket.on('fived:round_result', ({result,periodId})=>{ if(fdOpen()) showFiveDResult(result,periodId); fetchBalance(); });
}

// ═══════════════════════════════════════════════════
//  WIN GO
// ═══════════════════════════════════════════════════
const numColors={'0':'#7c3aed','1':'#16a34a','2':'#dc2626','3':'#16a34a','4':'#dc2626','5':'#7c3aed','6':'#dc2626','7':'#16a34a','8':'#dc2626','9':'#16a34a'};
const numColorNames={'0':'Violet','1':'Green','2':'Red','3':'Green','4':'Red','5':'Violet','6':'Red','7':'Green','8':'Red','9':'Green'};
let activeWgGame='wingo3m';
const wgState={wingo30s:{periodId:'',sec:0,pendingBets:[]},wingo1m:{periodId:'',sec:0,pendingBets:[]},wingo3m:{periodId:'',sec:0,pendingBets:[]},wingo5m:{periodId:'',sec:0,pendingBets:[]}};

function updateWgTimer(gid) {
  const st=wgState[gid], m=Math.floor(st.sec/60), s=st.sec%60, pad=n=>String(n).padStart(2,'0');
  if (activeWgGame===gid) {
    const mEl=document.getElementById('wm-m'); if(mEl) mEl.textContent=pad(m);
    const sEl=document.getElementById('wm-s'); if(sEl) sEl.textContent=pad(s);
    const pEl=document.getElementById('wm-period'); if(pEl) pEl.textContent=st.periodId;
  }
  if (gid==='wingo3m') {
    const bm=document.getElementById('banner-m'); if(bm) bm.textContent=pad(m);
    const bs=document.getElementById('banner-s'); if(bs) bs.textContent=pad(s);
  }
}

function openWingoGame(gid) {
  if (!authToken) return showAuthScreen();
  activeWgGame=gid;
  const labels={wingo30s:'⚡ WIN GO 30s',wingo1m:'🔥 WIN GO 1 Min',wingo3m:'👑 WIN GO 3 Min',wingo5m:'🎯 WIN GO 5 Min'};
  const t=document.getElementById('wmTitle'); if(t) t.textContent=labels[gid];
  document.querySelectorAll('.wingo-tab').forEach((el,i)=>el.classList.toggle('active',['wingo30s','wingo1m','wingo3m','wingo5m'][i]===gid));
  document.getElementById('wingoOverlay').classList.add('open'); document.body.style.overflow='hidden';
  updateWgTimer(gid); loadWingoHistory(gid);
  // FIX v23: reset page counters and always call switchWmPanel so panels are visible on open
  wmHistCurrent = 1; wmMyBetsCurrent = 1;
  switchWmPanel(wmActivePanel || 'history');
}

async function wingoBet(choice, odds) {
  if (!authToken) return showAuthScreen();
  const gid=activeWgGame, st=wgState[gid];
  const closeAt=gid==='wingo30s'?6:11;
  if (st.sec<closeAt) return showToast('⏳ Too late! Next round starting...','rgba(255,200,0,0.5)');
  const amt=getAmt('wm');
  if (wallet<amt) return showToast('❌ Insufficient balance','rgba(255,80,80,0.5)');
  const data=await api('POST','/game/bet',{choice,odds,amount:amt,gameId:gid});
  if (!data.success) return showToast('❌ '+data.message,'rgba(255,80,80,0.5)');
  if (!st.pendingBets) st.pendingBets=[];
  st.pendingBets.push({choice,odds,amt}); wallet=data.newBalance; refreshWalletUI();
  resetAmt('wm');
  showToast('🎯 Bet placed: '+choice+' · ₹'+amt+' · Odds '+odds);
}

function showWingoResult(gid,num,periodId,color) {
  const col=numColors[String(num)], colorName=color||numColorNames[String(num)];
  const isBig=(num>=5), sizeLabel=isBig?'Big':'Small';
  if (activeWgGame===gid) {
    const row=document.getElementById('wm-results-row');
    if(row){const dots=row.querySelectorAll('.wm-rdot');if(dots.length>=7)dots[dots.length-1].remove();const dot=document.createElement('div');dot.className='wm-rdot';dot.style.background=col;dot.textContent=num;row.insertBefore(dot,row.children[1]);}
  }
  const st=wgState[gid]; let prizeText='—',prizeColor='var(--muted)';
  if (st.pendingBets&&st.pendingBets.length>0&&activeWgGame===gid) {
    let totalWon=0, totalLost=0;
    for(const b of st.pendingBets){
      let won=false;
      if(b.choice==='Big') won=(num>=5);
      else if(b.choice==='Small') won=(num<=4);
      else won=(b.choice===colorName||b.choice===String(num));
      if(won){const prize=Math.floor(b.amt*parseFloat(b.odds));totalWon+=prize;addActivity('Win Go WIN · '+b.choice+'→'+num+' '+colorName,prize,'win');}
      else{totalLost+=b.amt;addActivity('Win Go LOSS · '+b.choice+'→'+num+' '+colorName,-b.amt,'loss');}
    }
    if(totalWon>0){prizeText='+₹'+totalWon;prizeColor='var(--green)';showWinCelebration(totalWon,wallet);showToast('🎉 Won ₹'+totalWon+'! Result: '+num+' '+colorName,'rgba(22,163,74,0.5)');}
    else{prizeText='-₹'+totalLost;prizeColor='var(--red)';showToast('😔 Result: '+num+' '+colorName,'rgba(255,80,80,0.5)');}
    st.pendingBets=[];
  }
  if (activeWgGame===gid) {
    const tbody=document.getElementById('wm-hist-body');
    if(tbody){const r=document.createElement('div');r.className='wm-history-row';r.innerHTML='<span class="wm-hr-period">#'+String(periodId).slice(-4)+'</span><span class="wm-hr-num">'+num+'</span><div class="wm-hr-colors"><div class="wm-hdot" style="background:'+col+'">'+colorName[0]+'</div></div><span class="wm-hr-prize" style="color:'+prizeColor+'">'+prizeText+'</span>';tbody.insertBefore(r,tbody.firstChild);if(tbody.children.length>8)tbody.lastChild.remove();}
  }
}

async function loadWingoHistory(gid) {
  const data=await api('GET','/game/history?gameId='+gid,null,false);
  if (!data.success) return;
  const row=document.getElementById('wm-results-row'); if(!row) return;
  row.querySelectorAll('.wm-rdot').forEach(d=>d.remove());
  data.rounds.slice(0,6).reverse().forEach(r=>{const dot=document.createElement('div');dot.className='wm-rdot';dot.style.background=numColors[String(r.result)];dot.textContent=r.result;row.appendChild(dot);});
}

// ═══════════════════════════════════════════════════
//  TRX WINGO — fully fixed
// ═══════════════════════════════════════════════════
let trxClientState = { sec:0, periodId:'', pendingBets:[] };

function updateTrxTimer() {
  const t=trxClientState.sec;
  const m=String(Math.floor(t/60)).padStart(2,'0'), s=String(t%60).padStart(2,'0');
  const mEl=document.getElementById('trx-wm-m'); if(mEl) mEl.textContent=m;
  const sEl=document.getElementById('trx-wm-s'); if(sEl) sEl.textContent=s;
  const home=document.getElementById('trx-home-timer'); if(home) home.textContent=m+':'+s;
  const pEl=document.getElementById('trx-period-num'); if(pEl) pEl.textContent=trxClientState.periodId;
}

function showTrxResult(result, color, hash, periodId) {
  const bg=color==='Green'?'#22d67a':color==='Red'?'#ff4d6a':'#a855f7';
  const msg=document.getElementById('trx-wm-msg');
  if(msg) msg.innerHTML=`Result: <b style="color:${bg}">${result} (${color})</b>`;
  const hashEl=document.getElementById('trx-wm-hash');
  if(hashEl) hashEl.textContent='hash: '+(hash||'').slice(0,24)+'...';

  // Show in history
  const hist=document.getElementById('trx-wm-history');
  if(hist){
    const span=document.createElement('span');
    span.style.cssText=`display:inline-block;width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;text-align:center;line-height:28px;font-weight:700;font-size:12px;margin:2px`;
    span.textContent=result; hist.insertBefore(span,hist.firstChild);
    if(hist.children.length>10) hist.lastChild.remove();
  }

  // Notify pending bet
  if(trxClientState.pendingBets&&trxClientState.pendingBets.length>0){
    let totalWon=0,totalLost=0;
    for(const b of trxClientState.pendingBets){
      let won=false;
      if(b.choice==='Big') won=(parseInt(result)>=5);
      else if(b.choice==='Small') won=(parseInt(result)<=4);
      else won=(b.choice===String(result)||b.choice===color);
      if(won){const prize=Math.floor(b.amount*parseFloat(b.odds));totalWon+=prize;addActivity('TRX WIN · '+b.choice+'→'+result,prize,'win');}
      else{totalLost+=b.amount;addActivity('TRX LOSS · '+b.choice+'→'+result,-b.amount,'loss');}
    }
    if(totalWon>0){showWinCelebration(totalWon,wallet);showToast('🎉 TRX WIN ₹'+totalWon+'!','rgba(22,163,74,0.5)');}
    else showToast('😔 TRX: '+result+'('+color+') Lost ₹'+totalLost,'rgba(255,80,80,0.5)');
    trxClientState.pendingBets=[];
  }
}

async function loadTrxHistory() {
  const r=await api('GET','/game/trxwingo/history',null,false);
  if(!r.success) return;
  const hist=document.getElementById('trx-wm-history'); if(!hist) return;
  hist.innerHTML=r.rounds.slice(0,10).map(rd=>{
    const c=rd.resultColor, bg=c==='Green'?'#22d67a':c==='Red'?'#ff4d6a':'#a855f7';
    return `<span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:${bg};color:#fff;text-align:center;line-height:28px;font-weight:700;font-size:12px;margin:2px">${rd.result??''}</span>`;
  }).join('');
}

// FIX: was using selectAmt(this,'trxAmt',10) with wrong signature — now uses hidden input correctly
function getTrxAmt() { return parseInt(document.getElementById('trxAmt').value)||10; }

async function placeTrxBet(choice, odds) {
  if (!authToken) return showAuthScreen();
  if (trxClientState.sec<11) return showToast('⏳ Too late! Wait for next round','rgba(255,200,0,0.5)');
  const amount=getTrxAmt();
  if (wallet<amount) return showToast('❌ Insufficient balance','rgba(255,80,80,0.5)');
  const msg=document.getElementById('trx-wm-msg'); if(msg) msg.textContent='Placing bet...';
  const r=await api('POST','/game/trxwingo/bet',{choice,odds,amount});
  if(r.success){
    wallet=r.newBalance; refreshWalletUI();
    if(!trxClientState.pendingBets) trxClientState.pendingBets=[];
    trxClientState.pendingBets.push({choice,odds,amount});
    if(msg) msg.innerHTML=`✅ Bet ₹${amount} on <b>${choice}</b>`;
    showToast('🎯 TRX bet: '+choice+' · ₹'+amount,'rgba(0,200,255,0.5)');
  } else {
    if(msg) msg.textContent=r.message||'Bet failed';
    showToast('❌ '+r.message,'rgba(255,80,80,0.5)');
  }
}

// Handle the chip amount selection for TRX (HTML uses selectAmt(this,'trxAmt',VALUE))
function selectTrxAmt(el, val) {
  document.querySelectorAll('#trxWingoOverlay .wm-amt').forEach(a=>a.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('trxAmt').value=val;
}

// ═══════════════════════════════════════════════════
//  5D LOTTERY — fully fixed
// ═══════════════════════════════════════════════════
let fdClientState = { sec:0, periodId:'', pendingBets:[] };
let fdSelectedPos = 'A';

function updateFiveDTimer() {
  const t=fdClientState.sec;
  const m=String(Math.floor(t/60)).padStart(2,'0'), s=String(t%60).padStart(2,'0');
  const mEl=document.getElementById('fd-wm-m'); if(mEl) mEl.textContent=m;
  const sEl=document.getElementById('fd-wm-s'); if(sEl) sEl.textContent=s;
  const home=document.getElementById('fd-home-timer'); if(home) home.textContent=m+':'+s;
  const pEl=document.getElementById('fd-wm-period'); if(pEl) pEl.textContent=fdClientState.periodId;
}

function showFiveDResult(nums, periodId) {
  const sum=nums.reduce((a,b)=>a+b,0);
  const msg=document.getElementById('fd-wm-msg');
  if(msg) msg.innerHTML=`🎲 Result: <b style="color:#ffd700">${nums.join(' ')}</b> Sum:${sum}`;

  // History row
  const hist=document.getElementById('fd-wm-history');
  if(hist){
    const row=document.createElement('div');
    row.style.cssText='background:#1e1a2e;border-radius:6px;padding:6px 10px;margin-bottom:4px;display:flex;align-items:center;gap:8px';
    row.innerHTML=nums.map(n=>`<span style="width:26px;height:26px;border-radius:50%;background:#7c6fff;color:#fff;text-align:center;line-height:26px;font-weight:700;display:inline-block">${n}</span>`).join('')+`<span style="color:#888;font-size:11px">Sum:${sum}</span>`;
    hist.insertBefore(row,hist.firstChild);
    if(hist.children.length>5) hist.lastChild.remove();
  }

  // Notify pending bet
  if(fdClientState.pendingBets&&fdClientState.pendingBets.length>0){
    let totalWon=0,totalLost=0;
    const positions={A:0,B:1,C:2,D:3,E:4};
    for(const {betType,choice,odds,amount} of fdClientState.pendingBets){
      let won=false;
      if(['A','B','C','D','E'].includes(betType)){
        const v=nums[positions[betType]];
        if(choice==='Big')won=v>=5; else if(choice==='Small')won=v<=4;
        else if(choice==='Odd')won=v%2!==0; else if(choice==='Even')won=v%2===0;
        else won=v===parseInt(choice);
      } else if(betType==='sum'){
        if(choice==='Big')won=sum>=23; else if(choice==='Small')won=sum<=22;
        else if(choice==='Odd')won=sum%2!==0; else if(choice==='Even')won=sum%2===0;
      }
      if(won){const prize=Math.floor(amount*parseFloat(odds));totalWon+=prize;addActivity('5D WIN · '+betType+':'+choice,prize,'win');}
      else{totalLost+=amount;addActivity('5D LOSS · '+betType+':'+choice,-amount,'loss');}
    }
    if(totalWon>0){showWinCelebration(totalWon,wallet);showToast('🎉 5D WIN ₹'+totalWon+'!','rgba(255,215,0,0.5)');}
    else showToast('😔 5D result: ['+nums.join('')+'] Lost ₹'+totalLost,'rgba(255,80,80,0.5)');
    fdClientState.pendingBets=[];
  }
}

async function loadFiveDHistory() {
  const r=await api('GET','/game/fived/history',null,false);
  if(!r.success) return;
  const hist=document.getElementById('fd-wm-history'); if(!hist) return;
  hist.innerHTML=r.rounds.slice(0,5).map(rd=>{
    const nums=rd.result||[], sum=nums.reduce((a,b)=>a+b,0);
    return `<div style="background:#1e1a2e;border-radius:6px;padding:6px 10px;margin-bottom:4px;display:flex;align-items:center;gap:8px">${nums.map(n=>`<span style="width:26px;height:26px;border-radius:50%;background:#7c6fff;color:#fff;text-align:center;line-height:26px;font-weight:700;display:inline-block">${n}</span>`).join('')}<span style="color:#888;font-size:11px">Sum:${sum}</span></div>`;
  }).join('');
}

function fdSelectPos(pos) {
  fdSelectedPos=pos;
  ['A','B','C','D','E','sum'].forEach(p=>{const el=document.getElementById('fd-sel-'+p);if(el)el.style.background=p===pos?'#7c6fff':'';});
  const msg=document.getElementById('fd-wm-msg'); if(msg) msg.textContent='Selected: Position '+pos;
}

function getFdAmt() { return parseInt(document.getElementById('fdAmt').value)||10; }

async function placeFiveDbet(choice) {
  if (!authToken) return showAuthScreen();
  if (fdClientState.sec<16) return showToast('⏳ Too late! Wait for next round','rgba(255,200,0,0.5)');
  const amount=getFdAmt(), betType=fdSelectedPos;
  const odds=isNaN(parseInt(choice))?1.95:9;
  if (wallet<amount) return showToast('❌ Insufficient balance','rgba(255,80,80,0.5)');
  const msg=document.getElementById('fd-wm-msg'); if(msg) msg.textContent='Placing bet...';
  const r=await api('POST','/game/fived/bet',{betType,choice,amount});
  if(r.success){
    wallet=r.newBalance; refreshWalletUI();
    if(!fdClientState.pendingBets) fdClientState.pendingBets=[];
    fdClientState.pendingBets.push({betType,choice,odds,amount});
    if(msg) msg.innerHTML=`✅ Bet ₹${amount} on <b>${betType}:${choice}</b> (${odds}×)`;
    showToast('🎲 5D bet: '+betType+':'+choice+' · ₹'+amount,'rgba(255,215,0,0.5)');
  } else {
    if(msg) msg.textContent=r.message||'Bet failed';
    showToast('❌ '+r.message,'rgba(255,80,80,0.5)');
  }
}

function selectFdAmt(el, val) {
  document.querySelectorAll('#fiveDOverlay .wm-amt').forEach(a=>a.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('fdAmt').value=val;
}

// ═══════════════════════════════════════════════════
//  K3 DICE — State & UI functions
// ═══════════════════════════════════════════════════
let k3State = { sec: 0, periodId: '', pendingBets: [], roundOpen: true };

function updateK3Timer() {
  const t = k3State.sec;
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  const mEl = document.getElementById('k3-m'); if (mEl) mEl.textContent = m;
  const sEl = document.getElementById('k3-s'); if (sEl) sEl.textContent = s;
  const pEl = document.getElementById('k3-period'); if (pEl) pEl.textContent = (k3State.periodId||'').slice(-8);
  // Lock betting in last 10s
  k3State.roundOpen = t > 10;
}

function resetK3Dice() {
  const d1 = document.getElementById('k3d1'); if (d1) d1.textContent = '?';
  const d2 = document.getElementById('k3d2'); if (d2) d2.textContent = '?';
  const d3 = document.getElementById('k3d3'); if (d3) d3.textContent = '?';
  const sum = document.getElementById('k3-sum-display'); if (sum) sum.textContent = 'Sum: —';
}

function showK3Result(dice, sum, periodId) {
  if (!dice || !dice.length) return;
  const faces = ['', '⚀','⚁','⚂','⚃','⚄','⚅'];
  const d1 = document.getElementById('k3d1'); if (d1) d1.textContent = faces[dice[0]] || dice[0];
  const d2 = document.getElementById('k3d2'); if (d2) d2.textContent = faces[dice[1]] || dice[1];
  const d3 = document.getElementById('k3d3'); if (d3) d3.textContent = faces[dice[2]] || dice[2];
  const sumEl = document.getElementById('k3-sum-display');
  if (sumEl) {
    const big = sum >= 11 && sum <= 17;
    const small = sum >= 4 && sum <= 10;
    sumEl.textContent = 'Sum: ' + sum + ' — ' + (big ? '🔴 BIG' : small ? '🟢 SMALL' : '');
    sumEl.style.color = big ? '#ff6b80' : '#22d67a';
  }
  // Check pending bets
  if (k3State.pendingBets && k3State.pendingBets.length) {
    k3State.pendingBets.forEach(({ choice, amt }) => {
      let won = false;
      if (choice === 'Big' && sum >= 11 && sum <= 17) won = true;
      else if (choice === 'Small' && sum >= 4 && sum <= 10) won = true;
      else if (choice === 'Odd' && sum % 2 !== 0) won = true;
      else if (choice === 'Even' && sum % 2 === 0) won = true;
      else if (choice === 'Triple' && dice[0] === dice[1] && dice[1] === dice[2]) won = true;
      else if (choice.startsWith('Sum:') && parseInt(choice.split(':')[1]) === sum) won = true;
      if (won) {
        const odds = choice === 'Triple' ? 24 : choice.startsWith('Sum:') ? k3SumOdds(sum) : 1.95;
        const prize = Math.floor(amt * odds);
        addActivity('K3 WIN · ' + choice, prize, 'win');
        showToast('🎲 K3 WIN! ' + choice + ' → ' + dice.join(',') + ' · +₹' + prize, 'rgba(22,163,74,0.5)');
      } else {
        addActivity('K3 LOSS · ' + choice, -amt, 'loss');
        showToast('🎲 K3: ' + choice + ' lost. Dice: ' + dice.join(','), 'rgba(255,80,80,0.5)');
      }
    });
    k3State.pendingBets = [];
  }
  k3LoadHistFull(1);
}

function k3SumOdds(sum) {
  const map = {4:50,5:20,6:14,7:8,8:6,9:4,10:3,11:3,12:4,13:6,14:8,15:14,16:20,17:50};
  return map[sum] || 2;
}

// ═══════════════════════════════════════════════════
//  SLOTS — fixed
// ═══════════════════════════════════════════════════
function getSlAmt() { return parseInt(document.getElementById('slAmt').value)||10; }

async function spinSlots() {
  if (!authToken) return showAuthScreen();
  const amount=getSlAmt();
  if (wallet<amount) return showToast('❌ Insufficient balance','rgba(255,80,80,0.5)');
  const btn=document.getElementById('sl-spin-btn'); btn.disabled=true; btn.textContent='🎰 Spinning...';
  SFX.slotsReel();
  const symbols=['🍋','🍒','🍇','⭐','💎','7️⃣','🔔','🍀'];
  let frames=0;
  const anim=setInterval(()=>{
    [0,1,2].forEach(col=>{const reel=document.getElementById('reel-'+col);if(reel)reel.querySelectorAll('.sl-sym').forEach(cell=>{cell.textContent=symbols[Math.floor(Math.random()*symbols.length)];});});
    frames++; if(frames>15) clearInterval(anim);
  },80);
  const r=await api('POST','/game/slots/spin',{amount});
  clearInterval(anim); btn.disabled=false; btn.textContent='🎰 SPIN';
  if(r.success){
    wallet=r.newBalance; refreshWalletUI();
    [0,1,2].forEach(col=>{const reel=document.getElementById('reel-'+col);if(reel&&r.reels&&r.reels[col]){const cells=reel.querySelectorAll('.sl-sym');r.reels[col].forEach((sym,row)=>{if(cells[row])cells[row].textContent=sym;});}});
    const res=document.getElementById('sl-result-msg');
    if(r.won){
      if(res) res.innerHTML=`🎉 <span style="color:#ffd700">WIN! ${r.multiplier}× = +₹${r.prize.toLocaleString('en-IN')}</span>`;
      r.multiplier >= 5 ? SFX.slotsJackpot() : SFX.slotsWin();
      addActivity('Slots WIN '+r.multiplier+'×',r.prize,'win');
      showWinCelebration(r.prize,r.newBalance);
      showToast('🎰 JACKPOT! Won ₹'+r.prize,'rgba(255,215,0,0.5)');
    } else {
      if(res) res.innerHTML=`<span style="color:#888">No win this time. Try again!</span>`;
      SFX.slotsLoss();
    }
  } else {
    showToast('❌ '+r.message,'rgba(255,80,80,0.5)');
  }
}

function selectSlAmt(el, val) {
  document.querySelectorAll('#slotsOverlay .wm-amt').forEach(a=>a.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('slAmt').value=val;
}

// ═══════════════════════════════════════════════════
//  VORTEX
// ═══════════════════════════════════════════════════
async function vxBet(choice) {
  if (!authToken) return showAuthScreen();
  const amt = getAmt('vx');
  if (!amt || amt < 1) return showToast('❌ Select a bet amount', 'rgba(255,80,80,0.5)');
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  const data = await api('POST', '/game/vortex/bet', { amount: amt, choice });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  SFX.vortexSpin();
  wallet = data.newBalance; refreshWalletUI();
  const balEl = document.getElementById('vx-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  const numEl = document.getElementById('vxNum'); if (numEl) numEl.textContent = data.result;
  const colors = ['#dc2626','#16a34a','#dc2626','#16a34a','#dc2626','#7c3aed','#dc2626','#16a34a','#dc2626','#16a34a'];
  const spinner = document.querySelector('#vortexOverlay .vx-spinner-outer');
  if (spinner) { spinner.style.borderColor = colors[data.result] || '#6366f1'; }
  const statusEl = document.getElementById('vxStatus');
  const resultBig = document.getElementById('vxResultBig');
  const resultSub = document.getElementById('vxResultSub');
  const overlay = document.getElementById('vxResultOverlay');
  if (data.won) {
    SFX.vortexWin();
    if (statusEl) statusEl.textContent = '🎉 You won ₹' + data.prize + '!';
    if (resultBig) resultBig.textContent = '🎉 WIN!';
    if (resultSub) resultSub.textContent = '+₹' + data.prize;
    if (overlay) { overlay.style.color = '#22d67a'; overlay.classList.add('show'); setTimeout(() => overlay.classList.remove('show'), 2000); }
    addActivity('Vortex WIN · ' + choice + ' → ' + data.result, data.prize, 'win');
    showToast('🌀 WIN! ' + choice + ' → ' + data.result + ' · +₹' + data.prize, 'rgba(22,163,74,0.5)');
  } else {
    SFX.vortexLoss();
    if (statusEl) statusEl.textContent = '😞 ' + choice + ' lost. Result: ' + data.result;
    if (resultBig) resultBig.textContent = '💸 LOSS';
    if (resultSub) resultSub.textContent = '-₹' + amt;
    if (overlay) { overlay.style.color = '#ff4d6a'; overlay.classList.add('show'); setTimeout(() => overlay.classList.remove('show'), 2000); }
    addActivity('Vortex LOSS · ' + choice + ' → ' + data.result, -amt, 'loss');
    showToast('🌀 ' + choice + ' → ' + data.result + ' · Lost ₹' + amt, 'rgba(255,80,80,0.5)');
  }
  // Add to history strip
  const hist = document.getElementById('vxHistRow');
  if (hist) {
    const chip = document.createElement('div');
    chip.className = 'vx-hist-item';
    chip.style.background = colors[data.result] || '#6366f1';
    chip.textContent = data.result;
    hist.insertBefore(chip, hist.firstChild);
    if (hist.children.length > 8) hist.lastChild.remove();
  }
  resetAmt('vx');
}
async function loadVortexHistory() {
  const balEl = document.getElementById('vx-bal-display');
  if (balEl) balEl.textContent = '₹' + (wallet||0).toLocaleString('en-IN');
}

// ═══════════════════════════════════════════════════
//  K3 DICE — Bet function
// ═══════════════════════════════════════════════════
async function k3Bet(choice) {
  if (!authToken) return showAuthScreen();
  const amt = getAmt('k3');
  if (!amt || amt < 1) return showToast('❌ Select a bet amount', 'rgba(255,80,80,0.5)');
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  if (!k3State.periodId || !k3State.roundOpen) return showToast('⏳ Round is closed, wait for next round', 'rgba(255,200,0,0.5)');
  const data = await api('POST', '/game/k3/bet', { amount: amt, choice });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  wallet = data.newBalance; refreshWalletUI();
  const balEl = document.getElementById('k3-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  k3State.pendingBets = k3State.pendingBets || [];
  k3State.pendingBets.push({ choice, amt });
  showToast('🎲 Bet ₹' + amt + ' on ' + choice + ' placed!', 'rgba(22,163,74,0.5)');
  resetAmt('k3');
}

// ═══════════════════════════════════════════════════
//  DRAGON TIGER
// ═══════════════════════════════════════════════════
async function dtBet(choice) {
  if (!authToken) return showAuthScreen();
  const amt = getAmt('dt');
  if (!amt || amt < 1) return showToast('❌ Select a bet amount', 'rgba(255,80,80,0.5)');
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  const data = await api('POST', '/game/dragontiger/bet', { amount: amt, choice });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  SFX.cardDeal();
  wallet = data.newBalance; refreshWalletUI();
  const balEl = document.getElementById('dt-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  // Show cards
  const dCard = document.getElementById('dt-dragon-card'); if (dCard) dCard.textContent = data.dragonCard;
  const tCard = document.getElementById('dt-tiger-card');  if (tCard) tCard.textContent = data.tigerCard;
  const msg = document.getElementById('dt-result-msg');
  if (data.won) {
    SFX.cardWin();
    if (msg) { msg.textContent = '🎉 ' + choice + ' wins! +₹' + data.prize; msg.style.color = '#22d67a'; }
    addActivity('Dragon Tiger WIN · ' + choice, data.prize, 'win');
    showToast('🐉 ' + choice + ' wins! +₹' + data.prize, 'rgba(22,163,74,0.5)');
  } else {
    SFX.cardLoss();
    if (msg) { msg.textContent = '💸 ' + data.result + ' wins. Lost ₹' + amt; msg.style.color = '#ff4d6a'; }
    addActivity('Dragon Tiger LOSS · ' + choice + ' → ' + data.result, -amt, 'loss');
    showToast('🐯 ' + data.result + ' wins. Lost ₹' + amt, 'rgba(255,80,80,0.5)');
  }
  // Add to recent results
  const hist = document.getElementById('dt-history');
  if (hist) {
    const chip = document.createElement('span');
    chip.style.cssText = 'padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;color:#fff;background:' + (data.result==='Dragon'?'#7c3aed':data.result==='Tiger'?'#ea580c':'#16a34a');
    chip.textContent = data.result;
    hist.insertBefore(chip, hist.firstChild);
    if (hist.children.length > 10) hist.lastChild.remove();
  }
  resetAmt('dt');
}
async function loadDtHistory() {
  const balEl = document.getElementById('dt-bal-display');
  if (balEl) balEl.textContent = '₹' + (wallet||0).toLocaleString('en-IN');
  const msg = document.getElementById('dt-result-msg');
  if (msg) { msg.textContent = 'Pick your side!'; msg.style.color = ''; }
  const dCard = document.getElementById('dt-dragon-card'); if (dCard) dCard.textContent = '?';
  const tCard = document.getElementById('dt-tiger-card');  if (tCard) tCard.textContent = '?';
}

// ═══════════════════════════════════════════════════
//  ANDAR BAHAR
// ═══════════════════════════════════════════════════
async function abBet(choice) {
  if (!authToken) return showAuthScreen();
  const amt = getAmt('ab');
  if (!amt || amt < 1) return showToast('❌ Select a bet amount', 'rgba(255,80,80,0.5)');
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  const data = await api('POST', '/game/andarbahar/bet', { amount: amt, choice });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  SFX.cardDeal();
  wallet = data.newBalance; refreshWalletUI();
  const balEl = document.getElementById('ab-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  // Show middle card
  const midEl = document.getElementById('ab-middle-card'); if (midEl) midEl.textContent = data.middleCard;
  // Show dealt cards
  const andarEl = document.getElementById('ab-andar-cards');
  const baharEl = document.getElementById('ab-bahar-cards');
  if (andarEl) andarEl.innerHTML = (data.andarCards||[]).map(c=>`<span style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:2px 6px;font-size:12px;font-weight:700;color:#4ade80">${c}</span>`).join('');
  if (baharEl) baharEl.innerHTML = (data.baharCards||[]).map(c=>`<span style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:2px 6px;font-size:12px;font-weight:700;color:#f87171">${c}</span>`).join('');
  const msg = document.getElementById('ab-result-msg');
  if (data.won) {
    SFX.cardWin();
    if (msg) { msg.textContent = '🎉 ' + choice + ' wins! +₹' + data.prize; msg.style.color = '#22d67a'; }
    addActivity('Andar Bahar WIN · ' + choice, data.prize, 'win');
    showToast('🃏 ' + choice + ' wins! +₹' + data.prize, 'rgba(22,163,74,0.5)');
  } else {
    SFX.cardLoss();
    if (msg) { msg.textContent = '💸 ' + data.result + ' wins. Lost ₹' + amt; msg.style.color = '#ff4d6a'; }
    addActivity('Andar Bahar LOSS · ' + choice + ' → ' + data.result, -amt, 'loss');
    showToast('🃏 ' + data.result + ' wins. Lost ₹' + amt, 'rgba(255,80,80,0.5)');
  }
  // History
  const hist = document.getElementById('ab-history');
  if (hist) {
    const chip = document.createElement('span');
    chip.style.cssText = 'padding:3px 10px;border-radius:10px;font-size:12px;font-weight:700;color:#fff;background:' + (data.result==='Andar'?'#16a34a':'#dc2626');
    chip.textContent = data.result;
    hist.insertBefore(chip, hist.firstChild);
    if (hist.children.length > 10) hist.lastChild.remove();
  }
  resetAmt('ab');
}
async function loadAbHistory() {
  const balEl = document.getElementById('ab-bal-display');
  if (balEl) balEl.textContent = '₹' + (wallet||0).toLocaleString('en-IN');
  const msg = document.getElementById('ab-result-msg');
  if (msg) { msg.textContent = 'Pick Andar or Bahar!'; msg.style.color = ''; }
  const midEl = document.getElementById('ab-middle-card'); if (midEl) midEl.textContent = '?';
  const andarEl = document.getElementById('ab-andar-cards'); if (andarEl) andarEl.innerHTML = '';
  const baharEl = document.getElementById('ab-bahar-cards'); if (baharEl) baharEl.innerHTML = '';
}

// ═══════════════════════════════════════════════════
//  MINES
// ═══════════════════════════════════════════════════
let minesState = { gameId: null, minesCount: 3, betAmt: 0, revealed: [], minePositions: [] };

function selectMinesCount(el, count) {
  minesState.minesCount = count;
  document.querySelectorAll('.mines-count-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function minesBuildGrid(disabled, revealedSet, mineSet) {
  const grid = document.getElementById('mines-grid'); if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const cell = document.createElement('div');
    cell.style.cssText = 'aspect-ratio:1;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;cursor:pointer;transition:all 0.15s;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);';
    if (revealedSet && revealedSet.includes(i)) {
      if (mineSet && mineSet.includes(i)) {
        cell.textContent = '💣'; cell.style.background = 'rgba(220,38,38,0.35)'; cell.style.borderColor = '#dc2626';
      } else {
        cell.textContent = '💎'; cell.style.background = 'rgba(34,214,122,0.2)'; cell.style.borderColor = '#22d67a';
      }
    } else if (disabled) {
      cell.textContent = mineSet && mineSet.includes(i) ? '💣' : '💎';
      cell.style.opacity = '0.5';
    } else {
      cell.textContent = '🟦';
      cell.onclick = () => minesReveal(i);
      cell.onmouseover = () => { if (!cell._disabled) cell.style.background = 'rgba(255,255,255,0.12)'; };
      cell.onmouseout  = () => { if (!cell._disabled) cell.style.background = 'rgba(255,255,255,0.06)'; };
    }
    grid.appendChild(cell);
  }
}

async function minesStart() {
  if (!authToken) return showAuthScreen();
  const amt = getAmt('mines');
  if (!amt || amt < 1) return showToast('❌ Select a bet amount', 'rgba(255,80,80,0.5)');
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  const data = await api('POST', '/game/mines/start', { amount: amt, minesCount: minesState.minesCount });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  minesState = { gameId: data.gameId, minesCount: minesState.minesCount, betAmt: amt, revealed: [], minePositions: [] };
  wallet = data.newBalance; refreshWalletUI();
  SFX.minesStart_sfx();
  const balEl = document.getElementById('mines-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  document.getElementById('mines-setup').style.display = 'none';
  document.getElementById('mines-playing').style.display = '';
  document.getElementById('mines-mult').textContent = '1.00×';
  document.getElementById('mines-payout').textContent = '₹' + amt;
  minesBuildGrid(false, [], []);
  showToast('💣 Game started! Find the gems!', 'rgba(22,163,74,0.5)');
}

async function minesReveal(pos) {
  if (!minesState.gameId) return;
  const data = await api('POST', '/game/mines/reveal', { gameId: minesState.gameId, position: pos });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  minesState.revealed.push(pos);
  if (data.isMine) {
    SFX.minesBoom();
    minesState.minePositions = data.minePositions || [];
    minesBuildGrid(true, minesState.revealed, minesState.minePositions);
    document.getElementById('mines-mult').textContent = '💥 BOOM';
    document.getElementById('mines-mult').style.color = '#ff4d6a';
    document.getElementById('mines-payout').textContent = '₹0';
    document.getElementById('mines-setup').style.display = '';
    document.getElementById('mines-playing').style.display = 'none';
    addActivity('Mines LOSS · Hit bomb', -minesState.betAmt, 'loss');
    showToast('💣 BOOM! Hit a mine!', 'rgba(255,80,80,0.5)');
    wallet = data.newBalance; refreshWalletUI();
    minesState.gameId = null;
    resetAmt('mines');
  } else {
    SFX.minesSafe();
    minesBuildGrid(false, minesState.revealed, []);
    document.getElementById('mines-mult').textContent = parseFloat(data.multiplier).toFixed(2) + '×';
    document.getElementById('mines-mult').style.color = '#22d67a';
    document.getElementById('mines-payout').textContent = '₹' + data.potentialPayout;
    const balEl = document.getElementById('mines-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
    if (data.autoWon) {
      wallet = data.newBalance; refreshWalletUI();
      showWinCelebration(data.payout, data.newBalance);
      addActivity('Mines AUTO WIN · ' + parseFloat(data.multiplier).toFixed(2) + '×', data.payout, 'win');
      showToast('🎉 All gems found! Won ₹' + data.payout, 'rgba(22,163,74,0.5)');
      document.getElementById('mines-setup').style.display = '';
      document.getElementById('mines-playing').style.display = 'none';
      minesState.gameId = null;
      resetAmt('mines');
    }
  }
}

async function minesCashout() {
  if (!minesState.gameId || !minesState.revealed.length) return showToast('⚠️ Reveal at least one gem first!', 'rgba(255,200,0,0.5)');
  const data = await api('POST', '/game/mines/cashout', { gameId: minesState.gameId });
  if (!data.success) return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  minesState.minePositions = data.minePositions || [];
  minesBuildGrid(true, minesState.revealed, minesState.minePositions);
  wallet = data.newBalance; refreshWalletUI();
  const balEl = document.getElementById('mines-bal-display'); if (balEl) balEl.textContent = '₹' + wallet.toLocaleString('en-IN');
  document.getElementById('mines-setup').style.display = '';
  document.getElementById('mines-playing').style.display = 'none';
  SFX.minesCashout_sfx();
  showWinCelebration(data.payout, data.newBalance);
  addActivity('Mines WIN · ' + parseFloat(data.multiplier).toFixed(2) + '×', data.payout, 'win');
  showToast('💰 Cashed out ₹' + data.payout + ' at ' + parseFloat(data.multiplier).toFixed(2) + '×!', 'rgba(22,163,74,0.5)');
  minesState.gameId = null;
  resetAmt('mines');
}

async function minesQuit() {
  if (minesState.gameId) {
    const confirmed = confirm('You have an active game. Cashing out now. Proceed?');
    if (!confirmed) return;
    if (minesState.revealed.length > 0) await minesCashout();
    else {
      showToast('⚠️ Game abandoned — no gems revealed, bet lost.', 'rgba(255,80,80,0.5)');
      minesState.gameId = null;
      document.getElementById('mines-setup').style.display = '';
      document.getElementById('mines-playing').style.display = 'none';
      minesBuildGrid(false, [], []);
    }
  }
  closeGame('minesOverlay');
}

async function checkMinesState() {
  if (!authToken) return;
  const balEl = document.getElementById('mines-bal-display');
  if (balEl) balEl.textContent = '₹' + (wallet||0).toLocaleString('en-IN');
  document.getElementById('mines-mult').style.color = '#22d67a';
  const data = await api('GET', '/game/mines/state', null, true);
  if (!data || !data.success || !data.active) {
    minesState.gameId = null;
    document.getElementById('mines-setup').style.display = '';
    document.getElementById('mines-playing').style.display = 'none';
    minesBuildGrid(false, [], []);
    return;
  }
  // Resume active game
  minesState.gameId = data.gameId;
  minesState.betAmt = data.betAmount;
  minesState.minesCount = data.minesCount;
  minesState.revealed = data.revealed || [];
  document.getElementById('mines-setup').style.display = 'none';
  document.getElementById('mines-playing').style.display = '';
  document.getElementById('mines-mult').textContent = parseFloat(data.multiplier).toFixed(2) + '×';
  document.getElementById('mines-payout').textContent = '₹' + data.potentialPayout;
  minesBuildGrid(false, minesState.revealed, []);
  showToast('♻️ Resumed active Mines game!', 'rgba(245,200,66,0.5)');
}

// ── selectMethod for deposit/withdraw ──────────────────
function selectMethod(el) {
  document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}


function openDeposit()  { if(!authToken)return showAuthScreen(); openModal('depositModal'); loadDepositConfig(); }

function openWithdrawWithWagerInfo() {
  if(!authToken) return showAuthScreen();
  openModal('withdrawModal');
  // Show wager warning if user hasn't met requirement yet
  const wagerReq  = parseFloat(localStorage.getItem('legitclub_wagerRequired')  || '0');
  const wagerDone = parseFloat(localStorage.getItem('legitclub_wagerCompleted') || '0');
  const remaining = Math.max(0, wagerReq - wagerDone);
  const warnEl = document.getElementById('witWagerWarn');
  if (warnEl) {
    if (remaining > 0) {
      warnEl.style.display = '';
      warnEl.innerHTML = `⚠️ You need to wager <b>₹${remaining.toFixed(2)}</b> more before withdrawing. Complete bets to unlock.`;
    } else {
      warnEl.style.display = 'none';
    }
  }
}
function openWithdraw() { openWithdrawWithWagerInfo(); }
function openModal(id)  { document.getElementById(id).classList.add('open'); document.body.style.overflow='hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow=''; }

// ═══════════════════════════════════════════════
//  AD POSTER SYSTEM
// ═══════════════════════════════════════════════
let _adCurrentPoster = 1;

function showAdPosters() {
  closeNotifPanel();
  _adCurrentPoster = 1;
  document.getElementById('adPoster1').style.display = 'block';
  document.getElementById('adPoster2').style.display = 'none';
  _updateAdDots(1);
  const overlay = document.getElementById('adPosterOverlay');
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
  // Reset wrap animation
  const wrap = document.getElementById('adPosterWrap');
  wrap.classList.remove('slide-out');
  wrap.style.animation = 'none';
  requestAnimationFrame(() => { wrap.style.animation = ''; });
}

function closeAdPosters() {
  const wrap = document.getElementById('adPosterWrap');
  wrap.classList.add('slide-out');
  setTimeout(() => {
    document.getElementById('adPosterOverlay').classList.remove('show');
    document.body.style.overflow = '';
    wrap.classList.remove('slide-out');
    // Mark as seen so it doesn't auto-show again this session
    sessionStorage.setItem('adSeen', '1');
  }, 380);
}

function goToAdPoster2() {
  const wrap = document.getElementById('adPosterWrap');
  wrap.style.animation = 'adSlideIn 0.4s cubic-bezier(0.34,1.3,0.64,1) both';
  document.getElementById('adPoster1').style.display = 'none';
  document.getElementById('adPoster2').style.display = 'block';
  _adCurrentPoster = 2;
  _updateAdDots(2);
}

function goToAdPoster1() {
  const wrap = document.getElementById('adPosterWrap');
  wrap.style.animation = 'adSlideIn 0.4s cubic-bezier(0.34,1.3,0.64,1) both';
  document.getElementById('adPoster2').style.display = 'none';
  document.getElementById('adPoster1').style.display = 'block';
  _adCurrentPoster = 1;
  _updateAdDots(1);
}

function _updateAdDots(active) {
  const dots = document.querySelectorAll('.ad-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i + 1 === active));
}

// ── Notification Panel (Bell icon) ──
function openNotifPanel() {
  const panel = document.getElementById('notifPanel');
  panel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Clear red dot once opened
  const dot = document.querySelector('#notif-btn .notif-dot');
  if (dot) dot.style.display = 'none';
}
function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  panel.style.display = 'none';
  document.body.style.overflow = '';
}
// Wire up close button and backdrop click via addEventListener (avoids stopPropagation issues)
document.addEventListener('DOMContentLoaded', function() {
  // ── Auto-show ad posters on first page load (once per session) ──
  if (!sessionStorage.getItem('adSeen')) {
    setTimeout(() => showAdPosters(), 800);
  }

  // ── Ad poster overlay backdrop click ──
  const adOverlay = document.getElementById('adPosterOverlay');
  if (adOverlay) adOverlay.addEventListener('click', function(e) {
    if (e.target === adOverlay) closeAdPosters();
  });

  // ── Notif panel close button & backdrop ──
  const closeBtn = document.getElementById('notif-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', function(e) { e.stopPropagation(); closeNotifPanel(); });
  const panel = document.getElementById('notifPanel');
  if (panel) panel.addEventListener('click', function(e) { if (e.target === panel) closeNotifPanel(); });

  // ── Announcement ticker: measure real text width and set correct duration ──
  const ticker = document.querySelector('.announce-text');
  if (ticker) {
    // Wait one frame so browser has rendered the text and we can measure it
    requestAnimationFrame(function() {
      const textWidth = ticker.scrollWidth;
      const viewWidth = window.innerWidth;
      // Speed: 120px per second = comfortable reading pace
      const duration = Math.round((textWidth + viewWidth) / 120);
      ticker.style.animationDuration = duration + 's';
      // Start position: just off the right edge
      ticker.style.animationName = 'none'; // reset
      requestAnimationFrame(function() {
        ticker.style.animationName = 'marquee';
      });
    });
  }
});

function openGame(id) {
  if(!authToken)return showAuthScreen();
  document.getElementById(id).classList.add('open'); document.body.style.overflow='hidden';
  // FIX v23: preload history for every game on open
  if(id==='aviatorOverlay'){setTimeout(()=>av25Init(),100);}
  if(id==='trxWingoOverlay'){loadTrxHistory();switchTrxPanel('history');refreshWalletUI();}
  if(id==='fiveDOverlay'){loadFiveDHistory();switchFdPanel('history');fdSelectPos('A');refreshWalletUI();}
  if(id==='k3Overlay'){setTimeout(()=>{switchK3Panel('history');},100);}
  if(id==='dragonTigerOverlay'){loadDtHistory();}
  if(id==='andarBaharOverlay'){loadAbHistory();}
  if(id==='minesOverlay'){checkMinesState();}
  if(id==='vortexOverlay'){loadVortexHistory();refreshWalletUI();}
  if(id==='slotsOverlay')refreshWalletUI();
}
function closeGame(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow=''; if(id==='aviatorOverlay'){ SFX._avStopEngine(); } }
function switchWingoTab(el,gid){document.querySelectorAll('.wingo-tab').forEach(t=>t.classList.remove('active'));el.classList.add('active');openWingoGame(gid);}

// ─── Per-game running bet totals (additive chips) ───────────────────────────
const _gameBetAmt = {wm:0, av:0, vx:0, k3:0, mines:0, dt:0, ab:0};

// Amount selectors — FIX v23: chips are now ADDITIVE (each click adds to total)
function selectAmt(el, prefix, val) {
  // If val provided (TRX/5D/Slots use explicit value), use it
  if (val !== undefined) {
    if(prefix==='trxAmt'){selectTrxAmt(el,val);return;}
    if(prefix==='fdAmt'){selectFdAmt(el,val);return;}
    if(prefix==='slAmt'){selectSlAmt(el,val);return;}
  }
  // Get chip face value
  const chipVal = parseInt(el.textContent.replace('₹','').replace('K','000').replace(/,/g,''))||10;
  // Accumulate
  _gameBetAmt[prefix] = (_gameBetAmt[prefix]||0) + chipVal;
  // Visual: mark this chip selected, deselect others
  const overlayMap={wm:'wingoOverlay',av:'aviatorOverlay',vx:'vortexOverlay',k3:'k3Overlay',mines:'minesOverlay',dt:'dragonTigerOverlay',ab:'andarBaharOverlay'};
  const container=document.getElementById(overlayMap[prefix])||document;
  container.querySelectorAll('.wm-amt,.av-bet-chip,.vx-amt').forEach(a=>a.classList.remove('selected'));
  el.classList.add('selected');
  // Show running total in a subtle label if it exists
  const totalEl=document.getElementById(prefix+'-bet-total');
  if(totalEl) totalEl.textContent='₹'+_gameBetAmt[prefix].toLocaleString('en-IN');
  // v24: clear custom input when a chip is clicked
  if(prefix==='av'){const inp=document.getElementById('avCustomAmt');if(inp)inp.value='';}
}

function getAmt(prefix) {
  // FIX v23: return accumulated total; fallback to selected chip face value if no accumulation yet
  if (_gameBetAmt[prefix] && _gameBetAmt[prefix]>0) return _gameBetAmt[prefix];
  const overlayMap={wm:'wingoOverlay',av:'aviatorOverlay',vx:'vortexOverlay',k3:'k3Overlay',mines:'minesOverlay',dt:'dragonTigerOverlay',ab:'andarBaharOverlay'};
  const container=document.getElementById(overlayMap[prefix])||document;
  const sel=container.querySelector('.wm-amt.selected,.av-bet-chip.selected,.vx-amt.selected');
  return sel?parseInt(sel.textContent.replace('₹','').replace('K','000').replace(/,/g,''))||10:10;
}

// Reset accumulated bet for a game (call after bet is placed)
function resetAmt(prefix) {
  _gameBetAmt[prefix]=0;
  // Reset visual selection back to first chip
  const overlayMap={wm:'wingoOverlay',av:'aviatorOverlay',vx:'vortexOverlay',k3:'k3Overlay',mines:'minesOverlay',dt:'dragonTigerOverlay',ab:'andarBaharOverlay'};
  const container=document.getElementById(overlayMap[prefix])||document;
  const chips=container.querySelectorAll('.wm-amt,.av-bet-chip,.vx-amt');
  chips.forEach((c,i)=>c.classList.toggle('selected',i===0));
  const totalEl=document.getElementById(prefix+'-bet-total');
  if(totalEl) totalEl.textContent='';
}

function selectChip(el,prefix) {
  el.closest('.modal-sheet').querySelectorAll('.amount-chip').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  const val=parseInt(el.textContent.replace('₹',''));
  const inp=document.getElementById(prefix==='dep'?'depAmount':'witAmount'); if(inp) inp.value=val;
}

// Profile
function showProfileEdit(){document.getElementById('editName').value=document.getElementById('accName').textContent;document.getElementById('editPass').value='';openModal('profileModal');}
async function saveProfile(){
  const name=document.getElementById('editName').value.trim(),pass=document.getElementById('editPass').value.trim();
  if(!name)return showToast('❌ Name cannot be empty','rgba(255,80,80,0.5)');
  const body={name};if(pass){if(pass.length<6)return showToast('❌ Password min 6 chars','rgba(255,80,80,0.5)');body.password=pass;}
  const data=await api('PUT','/auth/update',body);
  if(!data.success)return showToast('❌ '+data.message,'rgba(255,80,80,0.5)');
  document.getElementById('accName').textContent=name;currentUser.name=name;localStorage.setItem('legitclub_user',JSON.stringify(currentUser));
  closeModal('profileModal');showSuccess('✅ Profile Updated','green','✅','Profile saved successfully.',false);
}

// Promo / Referral
function claimPromo(btn,name,reward){if(!authToken)return showAuthScreen();if(claimedPromos.has(name))return showToast('⚠️ Already claimed!','rgba(255,200,0,0.5)');claimedPromos.add(name);btn.textContent='✓ Claimed';btn.disabled=true;btn.style.opacity='0.6';showSuccess('🎁 Promo Activated!','green','🎉',reward+' has been activated for your account!',false);}
function copyReferral(){
  const code = currentUser?.referralCode || '91C-XXXX';
  const msg  = `🎰 Join LEGIT CLUB and get ₹50 FREE bonus!\n👉 Use my referral code: ${code}\n🔗 Sign up now and start winning!`;
  navigator.clipboard.writeText(msg).catch(()=>{});
  showToast('📋 Referral message copied! Share it with friends.','rgba(245,200,66,0.5)');
}

// Toast / Success

// ═══════════════════════════════════════════════════
//  WIN CELEBRATION ANIMATION
// ═══════════════════════════════════════════════════
let winCelebTimeout = null;

function showWinCelebration(prize, newBalance) {
  if (!prize || prize <= 0) return;

  const overlay = document.getElementById('winCelebration');
  if (!overlay) return;

  // Set values
  document.getElementById('winAmount').textContent = '+₹' + prize.toLocaleString('en-IN');
  document.getElementById('winNewBalance').textContent = '₹' + (newBalance || wallet).toLocaleString('en-IN');

  // Animate amount counting up
  const el = document.getElementById('winAmount');
  let count = 0;
  const step = Math.ceil(prize / 40);
  const counter = setInterval(() => {
    count = Math.min(count + step, prize);
    el.textContent = '+₹' + count.toLocaleString('en-IN');
    if (count >= prize) clearInterval(counter);
  }, 30);

  // Spawn coin particles
  overlay.querySelectorAll('.win-coin').forEach(c => c.remove());
  const coinEmojis = ['🪙','💰','⭐','✨','💎','🎊','🎉'];
  for (let i = 0; i < 22; i++) {
    const coin = document.createElement('div');
    coin.className = 'win-coin';
    coin.textContent = coinEmojis[Math.floor(Math.random() * coinEmojis.length)];
    const startX = Math.random() * 100;
    const dy     = 280 + Math.random() * 200;
    const rot    = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720);
    const dur    = 0.9 + Math.random() * 0.8;
    const delay  = Math.random() * 0.4;
    coin.style.cssText = `left:${startX}%;top:${10 + Math.random()*20}%;--dy:${dy}px;--rot:${rot}deg;--dur:${dur}s;--delay:${delay}s`;
    overlay.appendChild(coin);
  }

  // Show
  overlay.classList.add('show');
  if (winCelebTimeout) clearTimeout(winCelebTimeout);
  winCelebTimeout = setTimeout(closeWinCelebration, 3800);
}

function closeWinCelebration() {
  const overlay = document.getElementById('winCelebration');
  if (overlay) overlay.classList.remove('show');
  if (winCelebTimeout) { clearTimeout(winCelebTimeout); winCelebTimeout = null; }
}

function showSuccess(title,color,icon,msg,isError){document.getElementById('successIcon').textContent=icon;document.getElementById('successTitle').textContent=title;document.getElementById('successTitle').className='success-title '+color;document.getElementById('successMsg').textContent=msg;document.getElementById('successCard').className=isError?'success-card error-card':'success-card';document.getElementById('successClose').className=isError?'success-close red-close':'success-close';document.getElementById('successOverlay').classList.add('show');}
function closeSuccess(){document.getElementById('successOverlay').classList.remove('show');}
function showToast(msg,color){const t=document.getElementById('betToast');t.textContent=msg;t.style.borderColor=color||'rgba(255,80,130,0.5)';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id);}));
  document.querySelectorAll('.game-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeGame(o.id);}));
  if(authToken&&currentUser){
    wallet=(currentUser.balance||0)+(currentUser.bonusBalance||0); refreshWalletUI(); updateUserUI();
    fetchBalance(); loadTransactions(); connectSocket(); checkMinesState();
  } else showAuthScreen();
  setInterval(()=>{if(authToken)fetchBalance();},30000);
});

// ═══════════════════════════════════════════════════
//  WINGO — History & My Bets Tab System
// ═══════════════════════════════════════════════════
let wmHistCurrent = 1, wmHistTotal = 1;
let wmMyBetsCurrent = 1, wmMyBetsTotal = 1;
let wmActivePanel = 'history';

function switchWmPanel(panel) {
  wmActivePanel = panel;
  // Tab buttons — only mybets and history
  ['mybets','history'].forEach(p => {
    const el = document.getElementById('wm-btab-'+p);
    if (el) el.classList.toggle('active', p === panel);
  });
  const histEl   = document.getElementById('wm-panel-history');
  const mybetsEl = document.getElementById('wm-panel-mybets');
  if (histEl)   histEl.style.display   = (panel === 'history') ? 'block' : 'none';
  if (mybetsEl) mybetsEl.style.display = (panel === 'mybets')  ? 'block' : 'none';

  if (panel === 'history') { wmHistCurrent = 1; loadWmHistoryFull(); }
  if (panel === 'mybets')  { wmMyBetsCurrent = 1; loadWmMyBets(); }
}

// ── Full paginated history ───────────────────────────────────────────────────
async function loadWmHistoryFull(page) {
  page = page || wmHistCurrent;
  const gid = activeWgGame || 'wingo3m';
  const body = document.getElementById('wm-hist-body-full');
  if (!body) return;
  body.innerHTML = '<div class="wm-loading">Loading...</div>';

  const data = await api('GET', '/game/history?gameId='+gid+'&page='+page+'&limit=20', null, false);
  if (!data.success) { body.innerHTML = '<div class="wm-loading">Failed to load</div>'; return; }

  const pg = data.pagination || {};
  wmHistCurrent = pg.page || page;
  wmHistTotal   = pg.pages || 1;
  document.getElementById('wm-hist-pginfo').textContent = 'Page '+wmHistCurrent+' / '+wmHistTotal;

  // Disable/enable buttons
  const prevBtn = document.querySelector('#wm-panel-history .wm-pgbtn:first-child');
  const nextBtn = document.querySelector('#wm-panel-history .wm-pgbtn:last-child');
  if (prevBtn) prevBtn.disabled = wmHistCurrent <= 1;
  if (nextBtn) nextBtn.disabled = wmHistCurrent >= wmHistTotal;

  if (!data.rounds || !data.rounds.length) {
    body.innerHTML = '<div class="wm-loading">No history yet</div>';
    return;
  }

  body.innerHTML = '';
  data.rounds.forEach(r => {
    const col   = numColors[String(r.result)] || '#888';
    const cname = numColorNames[String(r.result)] || r.resultColor || '—';
    const big   = (r.result >= 5) ? '<span style="color:#f59e0b;font-size:11px">Big</span>' : '<span style="color:#60a5fa;font-size:11px">Small</span>';
    const row   = document.createElement('div');
    row.className = 'wm-history-row';
    row.innerHTML =
      '<span class="wm-hr-period">#'+String(r.periodId).slice(-6)+'</span>' +
      '<span class="wm-hr-num" style="color:'+col+';font-weight:800">'+r.result+'</span>' +
      '<div class="wm-hr-colors"><div class="wm-hdot" style="background:'+col+'">'+cname[0]+'</div></div>' +
      big;
    body.appendChild(row);
  });
}

function wmHistPage(dir) {
  const next = wmHistCurrent + dir;
  if (next < 1 || next > wmHistTotal) return;
  wmHistCurrent = next;
  loadWmHistoryFull(wmHistCurrent);
}

// ── My Bets paginated ───────────────────────────────────────────────────────
async function loadWmMyBets(page) {
  page = page || wmMyBetsCurrent;
  const gid  = activeWgGame || 'wingo3m';
  const body = document.getElementById('wm-mybets-body');
  if (!body) return;

  if (!authToken) {
    body.innerHTML = '<div class="wm-loading">🔒 Login to see your bets</div>';
    return;
  }
  body.innerHTML = '<div class="wm-loading">Loading...</div>';

  const data = await api('GET', '/game/my-bets?gameId='+gid+'&page='+page+'&limit=20');
  if (!data.success) { body.innerHTML = '<div class="wm-loading">Failed to load</div>'; return; }

  const pg = data.pagination || {};
  wmMyBetsCurrent = pg.page || page;
  wmMyBetsTotal   = pg.pages || 1;
  document.getElementById('wm-mybets-pginfo').textContent = 'Page '+wmMyBetsCurrent+' / '+wmMyBetsTotal;

  const prevBtn = document.querySelector('#wm-panel-mybets .wm-pgbtn:first-child');
  const nextBtn = document.querySelector('#wm-panel-mybets .wm-pgbtn:last-child');
  if (prevBtn) prevBtn.disabled = wmMyBetsCurrent <= 1;
  if (nextBtn) nextBtn.disabled = wmMyBetsCurrent >= wmMyBetsTotal;

  if (!data.bets || !data.bets.length) {
    body.innerHTML = '<div class="wm-loading">No bets placed yet</div>';
    return;
  }

  body.innerHTML = '';
  data.bets.forEach(b => {
    const isWon   = b.won === true;
    const pnl     = isWon ? '+₹'+b.payout : '-₹'+b.amount;
    const pnlCls  = isWon ? 'wm-hr-won' : 'wm-hr-lost';
    const col     = numColors[String(b.result)] || '#888';
    const row     = document.createElement('div');
    row.className = 'wm-history-row';
    row.innerHTML =
      '<span class="wm-hr-period">#'+String(b.periodId).slice(-6)+'</span>' +
      '<span style="color:#e0d0ff;font-size:12px">'+b.choice+' · ₹'+b.amount+'</span>' +
      '<div class="wm-hr-colors"><div class="wm-hdot" style="background:'+col+'">'+b.result+'</div></div>' +
      '<span class="'+pnlCls+'">'+pnl+'</span>';
    body.appendChild(row);
  });
}

function wmMyBetsPage(dir) {
  const next = wmMyBetsCurrent + dir;
  if (next < 1 || next > wmMyBetsTotal) return;
  wmMyBetsCurrent = next;
  loadWmMyBets(wmMyBetsCurrent);
}

// Reset tabs when wingo game is switched
const _origSwitchWingo = window.switchWingoTab;
if (typeof switchWingoTab === 'function') {
  const __orig = switchWingoTab;
  window.switchWingoTab = function(el, gid) {
    __orig(el, gid);
    // Reload active panel data for new gameId
    if (wmActivePanel === 'history') loadWmHistoryFull(1);
    if (wmActivePanel === 'mybets')  loadWmMyBets(1);
  };
}

// ═══════════════════════════════════════════════════
//  AVIATOR — History & My Bets Tabs
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  K3 — History & My Bets Tabs
// ═══════════════════════════════════════════════════
let k3HistCur=1, k3HistTot=1, k3MyBetsCur=1, k3MyBetsTot=1;

function switchK3Panel(panel) {
  ['history','mybets'].forEach(p => {
    const el=document.getElementById('k3-btab-'+p); if(el) el.classList.toggle('active', p===panel);
    const pEl=document.getElementById('k3-panel-'+p); if(pEl) pEl.style.display=(p===panel)?'block':'none';
  });
  if(panel==='history') k3LoadHistFull(1);
  if(panel==='mybets')  k3LoadMyBets(1);
}

async function k3LoadHistFull(page) {
  page=page||k3HistCur;
  const body=document.getElementById('k3-hist-body'); if(!body) return;
  body.innerHTML='<div class="wm-loading">Loading...</div>';
  const d=await api('GET','/game/k3/history?page='+page+'&limit=20',null,false);
  if(!d.success){body.innerHTML='<div class="wm-loading">Failed</div>';return;}
  const pg=d.pagination||{}; k3HistCur=pg.page||page; k3HistTot=pg.pages||1;
  document.getElementById('k3-hist-pginfo').textContent='Page '+k3HistCur+' / '+k3HistTot;
  const prev=document.querySelector('#k3-panel-history .wm-pgbtn:first-child');
  const next=document.querySelector('#k3-panel-history .wm-pgbtn:last-child');
  if(prev) prev.disabled=k3HistCur<=1; if(next) next.disabled=k3HistCur>=k3HistTot;
  if(!d.rounds||!d.rounds.length){body.innerHTML='<div class="wm-loading">No history yet</div>';return;}
  body.innerHTML='';
  d.rounds.forEach(r=>{
    const dice=(r.dice||[]).join('-'), sum=r.sum||'—';
    const big=sum>=11?'<span style="color:#f59e0b;font-size:11px">Big</span>':'<span style="color:#60a5fa;font-size:11px">Small</span>';
    const row=document.createElement('div'); row.className='wm-history-row';
    row.innerHTML='<span class="wm-hr-period">#'+String(r.periodId).slice(-6)+'</span>'+
      '<span style="color:#f5c842;font-size:11px">'+dice+'</span>'+
      '<span style="font-weight:700">'+sum+'</span>'+big;
    body.appendChild(row);
  });
}
function k3HistPage(dir){const n=k3HistCur+dir;if(n<1||n>k3HistTot)return;k3HistCur=n;k3LoadHistFull(n);}

async function k3LoadMyBets(page) {
  page=page||k3MyBetsCur;
  const body=document.getElementById('k3-mybets-body'); if(!body) return;
  if(!authToken){body.innerHTML='<div class="wm-loading">🔒 Login to see your bets</div>';return;}
  body.innerHTML='<div class="wm-loading">Loading...</div>';
  const d=await api('GET','/game/k3/history?page='+page+'&limit=20');
  if(!d.success){body.innerHTML='<div class="wm-loading">Failed</div>';return;}
  const pg=d.pagination||{}; k3MyBetsCur=pg.page||page; k3MyBetsTot=pg.pages||1;
  document.getElementById('k3-mybets-pginfo').textContent='Page '+k3MyBetsCur+' / '+k3MyBetsTot;
  if(!d.rounds||!d.rounds.length){body.innerHTML='<div class="wm-loading">No bets yet</div>';return;}
  body.innerHTML='<div class="wm-loading">K3 personal bets — full tracking via transaction log</div>';
}
function k3MyBetsPage(dir){const n=k3MyBetsCur+dir;if(n<1||n>k3MyBetsTot)return;k3MyBetsCur=n;k3LoadMyBets(n);}

// ═══════════════════════════════════════════════════
//  TRX WINGO — History & My Bets Tabs
// ═══════════════════════════════════════════════════
let trxHistCur=1, trxHistTot=1, trxMyBetsCur=1, trxMyBetsTot=1;

function switchTrxPanel(panel) {
  ['history','mybets'].forEach(p => {
    const el=document.getElementById('trx-btab-'+p); if(el) el.classList.toggle('active', p===panel);
    const pEl=document.getElementById('trx-panel-'+p); if(pEl) pEl.style.display=(p===panel)?'block':'none';
  });
  if(panel==='history') trxLoadHistFull(1);
  if(panel==='mybets')  trxLoadMyBets(1);
}

async function trxLoadHistFull(page) {
  page=page||trxHistCur;
  const body=document.getElementById('trx-hist-body'); if(!body) return;
  body.innerHTML='<div class="wm-loading">Loading...</div>';
  const d=await api('GET','/game/trxwingo/history?page='+page+'&limit=20',null,false);
  if(!d.success){body.innerHTML='<div class="wm-loading">Failed</div>';return;}
  const pg=d.pagination||{}; trxHistCur=pg.page||page; trxHistTot=pg.pages||1;
  document.getElementById('trx-hist-pginfo').textContent='Page '+trxHistCur+' / '+trxHistTot;
  const prev=document.querySelector('#trx-panel-history .wm-pgbtn:first-child');
  const next=document.querySelector('#trx-panel-history .wm-pgbtn:last-child');
  if(prev) prev.disabled=trxHistCur<=1; if(next) next.disabled=trxHistCur>=trxHistTot;
  if(!d.rounds||!d.rounds.length){body.innerHTML='<div class="wm-loading">No history yet</div>';return;}
  body.innerHTML='';
  d.rounds.forEach(r=>{
    const col=numColors[String(r.result)]||'#888', cname=numColorNames[String(r.result)]||r.resultColor||'—';
    const hash=r.trxHash?(r.trxHash.slice(0,8)+'...'):'—';
    const row=document.createElement('div'); row.className='wm-history-row';
    row.innerHTML='<span class="wm-hr-period">#'+String(r.periodId).slice(-6)+'</span>'+
      '<span style="color:'+col+';font-weight:800">'+r.result+'</span>'+
      '<div class="wm-hr-colors"><div class="wm-hdot" style="background:'+col+'">'+cname[0]+'</div></div>'+
      '<span style="font-size:10px;color:var(--muted);font-family:monospace">'+hash+'</span>';
    body.appendChild(row);
  });
}
function trxHistPage(dir){const n=trxHistCur+dir;if(n<1||n>trxHistTot)return;trxHistCur=n;trxLoadHistFull(n);}

async function trxLoadMyBets(page) {
  page=page||trxMyBetsCur;
  const body=document.getElementById('trx-mybets-body'); if(!body) return;
  if(!authToken){body.innerHTML='<div class="wm-loading">🔒 Login to see your bets</div>';return;}
  trxMyBetsCur=page; trxMyBetsTot=1;
  document.getElementById('trx-mybets-pginfo').textContent='Page '+trxMyBetsCur+' / '+trxMyBetsTot;
  body.innerHTML='<div class="wm-loading">TRX personal bets — full tracking via transaction log</div>';
}
function trxMyBetsPage(dir){const n=trxMyBetsCur+dir;if(n<1||n>trxMyBetsTot)return;trxMyBetsCur=n;trxLoadMyBets(n);}

// ═══════════════════════════════════════════════════
//  5D LOTTERY — History & My Bets Tabs
// ═══════════════════════════════════════════════════
let fdHistCur=1, fdHistTot=1, fdMyBetsCur=1, fdMyBetsTot=1;

function switchFdPanel(panel) {
  ['history','mybets'].forEach(p => {
    const el=document.getElementById('fd-btab-'+p); if(el) el.classList.toggle('active', p===panel);
    const pEl=document.getElementById('fd-panel-'+p); if(pEl) pEl.style.display=(p===panel)?'block':'none';
  });
  if(panel==='history') fdLoadHistFull(1);
  if(panel==='mybets')  fdLoadMyBets(1);
}

async function fdLoadHistFull(page) {
  page=page||fdHistCur;
  const body=document.getElementById('fd-hist-body'); if(!body) return;
  body.innerHTML='<div class="wm-loading">Loading...</div>';
  const d=await api('GET','/game/fived/history?page='+page+'&limit=20',null,false);
  if(!d.success){body.innerHTML='<div class="wm-loading">Failed</div>';return;}
  const pg=d.pagination||{}; fdHistCur=pg.page||page; fdHistTot=pg.pages||1;
  document.getElementById('fd-hist-pginfo').textContent='Page '+fdHistCur+' / '+fdHistTot;
  const prev=document.querySelector('#fd-panel-history .wm-pgbtn:first-child');
  const next=document.querySelector('#fd-panel-history .wm-pgbtn:last-child');
  if(prev) prev.disabled=fdHistCur<=1; if(next) next.disabled=fdHistCur>=fdHistTot;
  if(!d.rounds||!d.rounds.length){body.innerHTML='<div class="wm-loading">No history yet</div>';return;}
  body.innerHTML='';
  d.rounds.forEach(r=>{
    const nums=(r.result||[]).join(''), sum=(r.result||[]).reduce((a,b)=>a+b,0)||'—';
    const big=sum>=23?'<span style="color:#f59e0b;font-size:11px">Big</span>':'<span style="color:#60a5fa;font-size:11px">Small</span>';
    const row=document.createElement('div'); row.className='wm-history-row';
    row.innerHTML='<span class="wm-hr-period">#'+String(r.periodId).slice(-6)+'</span>'+
      '<span style="color:#ffd700;font-weight:800;font-family:monospace">'+nums+'</span>'+
      '<span style="font-weight:700">'+sum+'</span>'+big;
    body.appendChild(row);
  });
}
function fdHistPage(dir){const n=fdHistCur+dir;if(n<1||n>fdHistTot)return;fdHistCur=n;fdLoadHistFull(n);}

async function fdLoadMyBets(page) {
  page=page||fdMyBetsCur;
  const body=document.getElementById('fd-mybets-body'); if(!body) return;
  if(!authToken){body.innerHTML='<div class="wm-loading">🔒 Login to see your bets</div>';return;}
  body.innerHTML='<div class="wm-loading">5D personal bets — full tracking via transaction log</div>';
}
function fdMyBetsPage(dir){const n=fdMyBetsCur+dir;if(n<1||n>fdMyBetsTot)return;fdMyBetsCur=n;fdLoadMyBets(n);}

// v23: history preload is now handled directly inside openGame() above

// ═══════════════════════════════════════════════════
//  AVIATOR — Post-Crash Betting Window
// ═══════════════════════════════════════════════════


// Particle explosion system


// ═══════════════════════════════════════════════════
//  AVIATOR v25 — Complete rewrite
//  State is fully server-driven. avHasBet is the only
//  local truth — it's only set on successful bet POST
//  and only cleared on crash/cashout resolution.
// ═══════════════════════════════════════════════════

let av25 = {
  phase:      'waiting',   // waiting | flying | crashed
  mult:       1.0,
  betAmt:     0,           // 0 = no active bet
  cashedOut:  false,
  chipAmt:    10,          // currently selected chip amount
  points:     [],          // canvas flight path
  flyStart:   null,        // timestamp when flying started (for canvas)
  histPage:   1,
  histTotal:  0,
  mybetsPage: 1,
  mybetsTotal:0,
};

// ── Helpers ─────────────────────────────────────────
function av25SetMult(m, cls) {
  const el = document.getElementById('av25Mult');
  if (!el) return;
  el.textContent = parseFloat(m).toFixed(2) + '×';
  el.className = 'av25-mult' + (cls ? ' ' + cls : '');
}
function av25SetStatus(txt) {
  const el = document.getElementById('av25Status'); if (el) el.textContent = txt;
}
function av25SetCountdownBar(secs, total) {
  const wrap = document.getElementById('av25CountdownWrap');
  const bar  = document.getElementById('av25CountdownBar');
  const num  = document.getElementById('av25CountdownNum');
  if (!wrap) return;
  if (secs <= 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  if (bar)  bar.style.width  = Math.max(0, (secs / total) * 100) + '%';
  if (bar)  bar.style.background = secs <= 3
    ? 'linear-gradient(90deg,#ff4d4d,#ff9966)'
    : secs <= 6
    ? 'linear-gradient(90deg,#ffa500,#ffd700)'
    : 'linear-gradient(90deg,#22d67a,#80ffcc)';
  if (num)  num.textContent = secs;
}
function av25SetBal(v) {
  const el = document.getElementById('av25Bal'); if (el) el.textContent = v.toLocaleString('en-IN');
}
function av25BetBtn(disabled) {
  const b = document.getElementById('av25BetBtn'); if (b) b.disabled = disabled;
}
function av25CashBtn(disabled) {
  const b = document.getElementById('av25CashBtn'); if (b) b.disabled = disabled;
}
function av25UpdateAmtLabel() {
  const el = document.getElementById('av25AmtRunning');
  if (el) el.textContent = av25.chipAmt > 0 ? '₹' + av25.chipAmt.toLocaleString('en-IN') : '';
}

// ── Canvas drawing ───────────────────────────────────
function av25Resize() {
  const c = document.getElementById('av25Canvas');
  const w = document.getElementById('av25Wrap');
  if (c && w) { c.width = w.offsetWidth; c.height = w.offsetHeight; }
}
function av25DrawIdle() {
  const c = document.getElementById('av25Canvas'); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
  for (let x = 0; x < c.width; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,c.height); ctx.stroke(); }
  for (let y = 0; y < c.height; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(c.width,y); ctx.stroke(); }
}
function av25DrawFlight(mult) {
  const c = document.getElementById('av25Canvas'); if (!c) return;
  const ctx = c.getContext('2d'), w = c.width, h = c.height;
  const prog = Math.min((mult - 1) / 18, 1);
  av25.points.push({ x: w * 0.08 + w * 0.84 * prog, y: h * 0.85 - h * 0.75 * (prog * prog) });
  if (av25.points.length > 220) av25.points.shift();

  ctx.clearRect(0, 0, w, h);
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }

  if (av25.points.length > 1) {
    // fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(34,214,122,0.25)');
    grad.addColorStop(1, 'rgba(34,214,122,0)');
    ctx.beginPath();
    ctx.moveTo(av25.points[0].x, h);
    av25.points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(av25.points[av25.points.length-1].x, h);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    // line
    ctx.beginPath();
    ctx.moveTo(av25.points[0].x, av25.points[0].y);
    av25.points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#22d67a'; ctx.lineWidth = 2.5; ctx.stroke();
    // plane
    const last = av25.points[av25.points.length-1];
    const plane = document.getElementById('av25Plane');
    if (plane) {
      plane.style.left = (last.x / w * 100) + '%';
      plane.style.bottom = ((h - last.y) / h * 100) + '%';
      plane.style.display = 'block';
    }
  }
}

// ── Chip / amount selection ──────────────────────────
function av25ChipClick(el, amt) {
  av25.chipAmt = amt;
  document.querySelectorAll('#aviatorOverlay .av25-chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  const inp = document.getElementById('av25CustomInput'); if (inp) inp.value = '';
  av25UpdateAmtLabel();
}
function av25CustomInput(val) {
  const v = parseInt(val) || 0;
  if (v >= 10) {
    av25.chipAmt = v;
    document.querySelectorAll('#aviatorOverlay .av25-chip').forEach(c => c.classList.remove('sel'));
    av25UpdateAmtLabel();
  }
}
function av25ClearAmt() {
  av25.chipAmt = 10;
  const inp = document.getElementById('av25CustomInput'); if (inp) inp.value = '';
  const chips = document.querySelectorAll('#aviatorOverlay .av25-chip');
  chips.forEach((c, i) => c.classList.toggle('sel', i === 0));
  av25UpdateAmtLabel();
}

// ── Socket handlers ──────────────────────────────────
function av25Sync({ phase, mult, countdown }) {
  av25.phase = phase;
  av25.mult  = mult || 1.0;
  // Refresh balance display
  av25SetBal(wallet);

  if (phase === 'waiting') {
    av25SetMult(1.0);
    av25SetStatus('⏳ Place your bet! ' + countdown + 's to launch...');
    // Only enable BET if player has no pending bet (betAmt could be set from crash window)
    av25BetBtn(av25.betAmt > 0);
    av25CashBtn(true);
  } else if (phase === 'flying') {
    av25SetMult(mult, 'flying');
    av25SetStatus('✈️ Flying! Cash out now!');
    av25BetBtn(true);
    // CRITICAL: only enable cashout if WE have a bet — on fresh page load betAmt=0, so disabled
    av25CashBtn(av25.betAmt <= 0);
  } else if (phase === 'crashed') {
    av25SetMult(mult, 'crashed');
    av25SetStatus('💥 Crashed at ' + parseFloat(mult).toFixed(2) + '×');
    av25BetBtn(true);
    av25CashBtn(true);
  }
}

function av25OnWaiting({ countdown, periodId }) {
  av25.phase = 'waiting';
  av25.points = [];
  av25DrawIdle();
  const plane = document.getElementById('av25Plane');
  if (plane) { plane.style.left = '8%'; plane.style.bottom = '15%'; }
  av25SetMult(1.0);
  // Don't reset betAmt — player may have already placed a bet
  av25.cashedOut = false;
  av25SetCountdownBar(countdown, 10);
  if (av25.betAmt > 0) {
    av25SetStatus('✅ Bet ₹' + av25.betAmt.toLocaleString('en-IN') + ' placed! ' + countdown + 's to launch...');
    av25BetBtn(true);
  } else {
    av25SetStatus('⏳ Place your bet! ' + countdown + 's to launch...');
    av25BetBtn(false);
  }
  av25CashBtn(true);
  av25LoadHistory(1);
}

function av25OnCountdown({ countdown }) {
  av25SetCountdownBar(countdown, 10);
  if (av25.betAmt > 0) {
    av25SetStatus('✅ Bet ₹' + av25.betAmt.toLocaleString('en-IN') + ' placed! ' + (countdown <= 3 ? '🚀 ' : '') + countdown + 's...');
  } else {
    av25SetStatus('⏳ ' + (countdown <= 3 ? '🚀 Last chance! ' : 'Place your bet! ') + countdown + 's to launch...');
  }
}

function av25OnFlyStart() {
  av25.phase = 'flying';
  av25.points = [];
  if (!document.getElementById('aviatorOverlay')?.classList.contains('open')) return;
  SFX.aviatorStart_sfx();
  av25SetMult(1.0, 'flying');
  av25SetStatus('✈️ Flying! Cash out now!');
  av25SetCountdownBar(0, 10); // hide bar
  av25BetBtn(true);
  // Enable cashout ONLY if this player has an active bet
  av25CashBtn(av25.betAmt <= 0);
}

function av25OnTick({ mult }) {
  av25.phase = 'flying';
  av25.mult  = mult;
  av25SetMult(mult, 'flying');
  av25DrawFlight(mult);
  SFX.aviatorTick_sfx(mult); // continuous engine update every tick
}

function av25OnCrash({ mult }) {
  av25.phase = 'crashed';
  SFX._avStopEngine();
  if (document.getElementById('aviatorOverlay')?.classList.contains('open')) SFX.aviatorCrash_sfx();
  av25SetMult(mult, 'crashed');
  av25SetStatus('💥 CRASHED at ' + parseFloat(mult).toFixed(2) + '× — Next round starting...');
  av25BetBtn(true);   // disabled during crash transition — waiting event will re-enable
  av25CashBtn(true);
  // Flash
  const flash = document.getElementById('av25CrashFlash');
  if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 400); }
  // Loss toast if player had uncashed bet
  if (av25.betAmt > 0 && !av25.cashedOut) {
    addActivity('Aviator LOSS · Crashed at ' + parseFloat(mult).toFixed(2) + '×', -av25.betAmt, 'loss');
    showToast('💥 Crashed at ' + parseFloat(mult).toFixed(2) + '× · Lost ₹' + av25.betAmt, 'rgba(255,80,80,0.5)');
    fetchBalance();
  }
  av25.betAmt = 0;
  av25.cashedOut = false;
  // Add to history strip
  av25AddHistChip(mult);
}

// (Post-crash bet window removed in v26 — place bets during normal waiting phase)



function av25OnCashedOut({ userId, mult, prize }) {
  // Another player cashed out — could show live feed in future
}

// ── Place bet ────────────────────────────────────────
async function av25PlaceBet() {
  if (!authToken) return showAuthScreen();
  const amt = av25.chipAmt || 10;
  if (wallet < amt) return showToast('❌ Insufficient balance', 'rgba(255,80,80,0.5)');
  av25BetBtn(true); // prevent double tap
  const data = await api('POST', '/game/aviator/bet', { amount: amt });
  if (!data.success) {
    av25BetBtn(false);
    return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  }
  av25.betAmt = amt;
  av25.cashedOut = false;
  wallet = data.newBalance;
  refreshWalletUI();
  av25SetBal(wallet);
  av25CashBtn(av25.phase !== 'flying'); // enable immediately if already flying
  showToast('✈️ Bet ₹' + amt + ' placed! Cash out before crash!', 'rgba(22,163,74,0.5)');
}

// ── Cash out ─────────────────────────────────────────
async function av25CashOut() {
  if (av25.betAmt <= 0 || av25.cashedOut) return;
  av25CashBtn(true); // prevent double tap
  const data = await api('POST', '/game/aviator/cashout', {});
  if (!data.success) {
    // Re-enable only if still flying and bet still active
    if (av25.phase === 'flying' && av25.betAmt > 0 && !av25.cashedOut) av25CashBtn(false);
    return showToast('❌ ' + data.message, 'rgba(255,80,80,0.5)');
  }
  av25.cashedOut = true;
  wallet = data.newBalance;
  refreshWalletUI();
  av25SetBal(wallet);
  SFX.aviatorCashout_sfx();
  addActivity('Aviator WIN · Cashed out ' + parseFloat(data.mult).toFixed(2) + '×', data.prize, 'win');
  showWinCelebration(data.prize, data.newBalance);
  showToast('💰 Cashed out at ' + parseFloat(data.mult).toFixed(2) + '× · Won ₹' + data.prize + '!', 'rgba(22,163,74,0.5)');
}

// ── Post-crash bet window ────────────────────────────
function av25BwChip(el, amt) {
  av25.bwAmt = amt;
  document.querySelectorAll('.av25-bw-chip').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  const disp = document.getElementById('av25BwDisp');
  if (disp) disp.textContent = amt >= 1000 ? '₹' + (amt/1000) + 'K' : '₹' + amt;
}
async function av25BwPlace() {
  if (!authToken) { return showAuthScreen(); }
  const btn = document.getElementById('av25BwBtn');
  const msg = document.getElementById('av25BwMsg');
  if (btn && btn.disabled) return;
  const amt = av25.bwAmt;
  if (wallet < amt) { if (msg) msg.textContent = '❌ Insufficient balance'; return; }
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = '⏳ Placing bet...';
  const data = await api('POST', '/game/aviator/bet', { amount: amt });
  if (!data.success) {
    if (msg) msg.textContent = '❌ ' + data.message;
    if (btn) btn.disabled = false;
    return;
  }
  av25.betAmt = amt;
  av25.cashedOut = false;
  wallet = data.newBalance;
  refreshWalletUI();
  av25SetBal(wallet);
  if (msg) msg.textContent = '✅ ₹' + amt.toLocaleString('en-IN') + ' bet placed!';
  if (btn) { btn.textContent = '✅ BET PLACED'; }
  showToast('✈️ ₹' + amt + ' bet placed for next round!', 'rgba(22,163,74,0.5)');
  // Auto-close bet window after short delay
  setTimeout(() => {
    const box = document.getElementById('av25BetWindow');
    if (box) box.classList.remove('show');
  }, 1500);
}

// ── History chip strip ───────────────────────────────
function av25AddHistChip(mult) {
  const strip = document.getElementById('av25HistStrip'); if (!strip) return;
  const m = parseFloat(mult);
  const chip = document.createElement('div');
  chip.className = 'av25-hist-chip ' + (m < 2 ? 'low' : m < 6 ? 'mid' : 'high');
  chip.textContent = m.toFixed(2) + '×';
  strip.insertBefore(chip, strip.firstChild);
  if (strip.children.length > 15) strip.lastChild.remove();
}

// ── History / My Bets tabs ───────────────────────────
function av25SwitchTab(tab) {
  document.getElementById('av25PanelHistory').style.display = tab === 'history' ? '' : 'none';
  document.getElementById('av25PanelMybets').style.display  = tab === 'mybets'  ? '' : 'none';
  document.getElementById('av25TabHistory').classList.toggle('active', tab === 'history');
  document.getElementById('av25TabMybets').classList.toggle('active',  tab === 'mybets');
  if (tab === 'history') av25LoadHistory(1);
  if (tab === 'mybets')  av25LoadMybets(1);
}
async function av25LoadHistory(page) {
  av25.histPage = page || 1;
  const body = document.getElementById('av25HistBody'); if (!body) return;
  body.innerHTML = '<div class="wm-loading">Loading...</div>';
  const d = await api('GET', '/game/aviator/history?page=' + av25.histPage + '&limit=20', null, false);
  if (!d || !d.success) { body.innerHTML = '<div class="wm-loading">Failed to load</div>'; return; }
  av25.histTotal = d.pagination?.pages || 1;
  document.getElementById('av25HistPgInfo').textContent = 'Page ' + av25.histPage + ' / ' + av25.histTotal;
  body.innerHTML = '';
  // Also populate history strip from fresh data on first load
  if (page === 1) {
    const strip = document.getElementById('av25HistStrip'); if (strip) strip.innerHTML = '';
    (d.rounds || []).slice(0, 15).forEach(r => av25AddHistChip(r.actualCrash || 0));
  }
  (d.rounds || []).forEach(r => {
    const m = r.actualCrash || 0;
    const row = document.createElement('div'); row.className = 'wm-history-row';
    row.innerHTML = `<span>#${(r.periodId||'').slice(-8)}</span><span style="color:${m<2?'#ff6b80':m<6?'#80c8ff':'#22d67a'};font-weight:700">${m.toFixed(2)}×</span><span>₹${(r.totalBets||0).toLocaleString('en-IN')}</span><span>₹${(r.totalPayout||0).toLocaleString('en-IN')}</span>`;
    body.appendChild(row);
  });
  if (!d.rounds?.length) body.innerHTML = '<div class="wm-loading">No history yet</div>';
}
function av25HistPage(dir) {
  const n = av25.histPage + dir;
  if (n < 1 || n > av25.histTotal) return;
  av25LoadHistory(n);
}
async function av25LoadMybets(page) {
  av25.mybetsPage = page || 1;
  const body = document.getElementById('av25MybetsBody'); if (!body) return;
  if (!authToken) { body.innerHTML = '<div class="wm-loading">🔒 Login to see your bets</div>'; return; }
  body.innerHTML = '<div class="wm-loading">Loading...</div>';
  const d = await api('GET', '/game/aviator/history?page=' + av25.mybetsPage + '&limit=20', null, false);
  if (!d || !d.success) { body.innerHTML = '<div class="wm-loading">Failed to load</div>'; return; }
  av25.mybetsTotal = d.pagination?.pages || 1;
  document.getElementById('av25MybetsPgInfo').textContent = 'Page ' + av25.mybetsPage + ' / ' + av25.mybetsTotal;
  body.innerHTML = '<div class="wm-loading" style="font-size:11px;opacity:0.6;">Bet history via transaction log</div>';
}
function av25MybetsPage(dir) {
  const n = av25.mybetsPage + dir;
  if (n < 1 || n > av25.mybetsTotal) return;
  av25LoadMybets(n);
}

// ── Init when overlay opens ──────────────────────────
// Called from openGame() in existing code
function av25Init() {
  av25Resize();
  av25DrawIdle();
  av25SetBal(wallet);
  av25LoadHistory(1);
  // Re-sync button state with current server phase
  av25Sync({ phase: av25.phase, mult: av25.mult, countdown: 0 });
}


// ═══════════════════════════════════════════════════
//  WAGER PAGE
// ═══════════════════════════════════════════════════
async function loadWagerPage() {
  if (!authToken) return;
  const data = await api('GET', '/wallet/balance', null, false);
  if (!data || !data.success) return;

  // Use wagerRequired from DB (set at signup: 2× bonus = ₹100, + 2× deposit on each deposit)
  const wagerRequired = data.wagerRequired || 0;
  const deposited     = data.totalDeposited || 0;
  const bonusBal      = data.bonusBalance   || 0;
  const wagerDone     = data.wagerCompleted || 0;
  const wagerNeeded   = Math.max(0, wagerRequired - wagerDone);
  const pct           = wagerRequired > 0 ? Math.min(100, Math.round((wagerDone / wagerRequired) * 100)) : 100;
  const isComplete    = wagerRequired === 0 || wagerDone >= wagerRequired;

  // Update progress bar
  const bar = document.getElementById('wg-progress-bar');
  if (bar) bar.style.width = pct + '%';

  // Update text fields
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('wg-completed',  Math.floor(wagerDone));
  set('wg-required',   wagerRequired);
  set('wg-pct-label',  pct + '% complete');
  set('wg-remaining',  wagerNeeded);
  set('wg-total-dep',  '\u20b9' + deposited.toFixed(2));
  set('wg-bonus-bal',  '\u20b9' + bonusBal.toFixed(2));
  set('wg-wagered',    '\u20b9' + wagerDone.toFixed(2));
  set('wg-needed',     '\u20b9' + wagerNeeded.toFixed(2));

  // Status banner
  const banner   = document.getElementById('wg-status-banner');
  const icon     = document.getElementById('wg-status-icon');
  const title    = document.getElementById('wg-status-title');
  const desc     = document.getElementById('wg-status-desc');
  const wdrawBtn = document.getElementById('wg-withdraw-btn');

  if (isComplete) {
    if (banner) { banner.style.background='rgba(34,214,122,0.1)'; banner.style.borderColor='rgba(34,214,122,0.35)'; }
    if (icon)   icon.textContent  = '\u2705';
    if (title)  { title.textContent='Wagering Complete!'; title.style.color='#22d67a'; }
    if (desc)   desc.innerHTML    = 'You have completed the wagering requirement. <b style="color:#22d67a;">Withdrawal is now unlocked!</b>';
    if (wdrawBtn) { wdrawBtn.disabled=false; wdrawBtn.style.opacity='1'; wdrawBtn.style.cursor='pointer'; wdrawBtn.textContent='\ud83c\udfe7 Withdraw Now'; }
  } else if (wagerRequired > 0 && deposited === 0 && bonusBal > 0) {
    // Has bonus, no deposit yet — they can wager the bonus to clear requirement
    if (banner) { banner.style.background='rgba(245,200,66,0.1)'; banner.style.borderColor='rgba(245,200,66,0.3)'; }
    if (icon)   icon.textContent  = '\ud83c\udfb0';
    if (title)  { title.textContent='Wager Your Bonus'; title.style.color='#f5c842'; }
    if (desc)   desc.innerHTML    = 'Use your \u20b9' + bonusBal + ' bonus to play! Bet <b style="color:#fff;">\u20b9' + wagerNeeded + '</b> total to unlock withdrawal. All bets count!';
    if (wdrawBtn) { wdrawBtn.disabled=true; wdrawBtn.style.opacity='0.4'; wdrawBtn.style.cursor='not-allowed'; wdrawBtn.textContent='\ud83c\udfe7 Withdraw (Complete Wager First)'; }
  } else {
    if (banner) { banner.style.background='rgba(245,200,66,0.1)'; banner.style.borderColor='rgba(245,200,66,0.3)'; }
    if (icon)   icon.textContent  = '\u23f3';
    if (title)  { title.textContent='Wagering In Progress'; title.style.color='#f5c842'; }
    if (desc)   desc.innerHTML    = 'Bet <b style="color:#fff;">\u20b9' + wagerNeeded + '</b> more to unlock withdrawal. All game bets count!';
    if (wdrawBtn) { wdrawBtn.disabled=true; wdrawBtn.style.opacity='0.4'; wdrawBtn.style.cursor='not-allowed'; wdrawBtn.textContent='\ud83c\udfe7 Withdraw (Complete Wager First)'; }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SOUND ENGINE
//  SOUND ENGINE — Web Audio API (zero external files, generated purely in JS)
//  All sounds synthesized via AudioContext oscillators & noise buffers
// ═══════════════════════════════════════════════════════════════════════════════

const SFX = (() => {
  let ctx = null;
  let muted = false;
  let bgLoop = null;
  let bgGain = null;
  let currentBg = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Utility: envelope gain ──────────────────────────────────────────────────
  function envGain(vol, attack, decay) {
    const g = getCtx().createGain();
    g.gain.setValueAtTime(0, getCtx().currentTime);
    g.gain.linearRampToValueAtTime(vol, getCtx().currentTime + attack);
    g.gain.linearRampToValueAtTime(0, getCtx().currentTime + attack + decay);
    g.connect(getCtx().destination);
    return g;
  }

  // ── Utility: play tone ──────────────────────────────────────────────────────
  function tone(freq, type, vol, start, dur) {
    const o = getCtx().createOscillator();
    const g = getCtx().createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, getCtx().currentTime + start);
    g.gain.setValueAtTime(0, getCtx().currentTime + start);
    g.gain.linearRampToValueAtTime(vol, getCtx().currentTime + start + 0.01);
    g.gain.linearRampToValueAtTime(0, getCtx().currentTime + start + dur);
    o.connect(g); g.connect(getCtx().destination);
    o.start(getCtx().currentTime + start);
    o.stop(getCtx().currentTime + start + dur + 0.05);
    return o;
  }

  // ── Utility: white noise burst ──────────────────────────────────────────────
  function noise(vol, start, dur, filterFreq) {
    const ac = getCtx();
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 800;
    filter.Q.value = 0.5;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, ac.currentTime + start);
    g.gain.linearRampToValueAtTime(0, ac.currentTime + start + dur);
    src.connect(filter); filter.connect(g); g.connect(ac.destination);
    src.start(ac.currentTime + start);
    src.stop(ac.currentTime + start + dur + 0.05);
  }

  // ── SLOTS: reel spinning mechanical sound ────────────────────────────────────
  function slotsReel() {
    if (muted) return;
    const ac = getCtx();
    // Layered ticking — simulate 3 reels with slight offsets
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 18; i++) {
        const t = i * 0.075 + r * 0.015;
        noise(0.12, t, 0.04, 1200 + r * 300);
        tone(180 + r * 40, 'square', 0.04, t, 0.03);
      }
    }
    // Lever pull thud at start
    noise(0.3, 0, 0.12, 300);
    tone(80, 'sine', 0.2, 0, 0.15);
  }

  // ── SLOTS: win jingle ───────────────────────────────────────────────────────
  function slotsWin() {
    if (muted) return;
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((f, i) => tone(f, 'sine', 0.18, i * 0.1, 0.12));
    // Coin shower noise
    for (let i = 0; i < 12; i++) noise(0.08, 0.05 + i * 0.06, 0.05, 2000 + Math.random() * 1000);
  }

  // ── SLOTS: jackpot (big win) ─────────────────────────────────────────────────
  function slotsJackpot() {
    if (muted) return;
    const melody = [523, 659, 784, 523, 659, 784, 1047, 1047, 1319, 1047, 784, 1047, 1319, 1568];
    melody.forEach((f, i) => tone(f, 'sine', 0.2, i * 0.09, 0.12));
    for (let i = 0; i < 20; i++) noise(0.1, i * 0.04, 0.06, 1500 + Math.random() * 2000);
  }

  // ── SLOTS: loss thud ────────────────────────────────────────────────────────
  function slotsLoss() {
    if (muted) return;
    tone(120, 'sine', 0.25, 0, 0.2);
    tone(80, 'sine', 0.2, 0.05, 0.25);
    noise(0.15, 0, 0.15, 400);
  }

  // ── MINES: tense background tick ────────────────────────────────────────────
  function minesStart_sfx() {
    if (muted) return;
    // Game start blip
    tone(440, 'sine', 0.12, 0, 0.08);
    tone(550, 'sine', 0.12, 0.1, 0.08);
    tone(660, 'sine', 0.15, 0.2, 0.1);
  }

  // ── MINES: safe tile reveal ──────────────────────────────────────────────────
  function minesSafe() {
    if (muted) return;
    const freqs = [880, 1100, 1320];
    const f = freqs[Math.floor(Math.random() * freqs.length)];
    tone(f, 'sine', 0.18, 0, 0.06);
    tone(f * 1.25, 'sine', 0.1, 0.06, 0.08);
    noise(0.06, 0, 0.05, 3000);
  }

  // ── MINES: bomb explosion ────────────────────────────────────────────────────
  function minesBoom() {
    if (muted) return;
    // Deep bass boom
    tone(60, 'sine', 0.5, 0, 0.4);
    tone(40, 'sine', 0.4, 0, 0.6);
    tone(100, 'sawtooth', 0.2, 0, 0.15);
    // Rumble noise
    noise(0.4, 0, 0.5, 200);
    noise(0.3, 0.05, 0.4, 100);
    noise(0.2, 0.1, 0.35, 400);
    // High crack
    noise(0.2, 0, 0.08, 4000);
  }

  // ── MINES: cashout success ───────────────────────────────────────────────────
  function minesCashout_sfx() {
    if (muted) return;
    // Cash register ding
    tone(1047, 'sine', 0.2, 0, 0.08);
    tone(1319, 'sine', 0.2, 0.08, 0.08);
    tone(1568, 'sine', 0.2, 0.16, 0.08);
    tone(2093, 'sine', 0.25, 0.24, 0.2);
    for (let i = 0; i < 8; i++) noise(0.07, 0.02 + i * 0.04, 0.04, 2500);
  }

  // ── AVIATOR: Jet engine system (continuous, synced to multiplier) ────────────
  // Persistent engine nodes so we can update them in real-time
  let avEngineNodes = null; // { osc1, osc2, noiseGain, masterGain, ac }

  function _avStopEngine() {
    if (!avEngineNodes) return;
    try {
      const { osc1, osc2, noiseGainNode, masterGain, ac } = avEngineNodes;
      const t = ac.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(0, t + 0.3);
      setTimeout(() => {
        try { osc1.stop(); } catch(e) {}
        try { osc2.stop(); } catch(e) {}
      }, 400);
    } catch(e) {}
    avEngineNodes = null;
  }

  function _avStartEngine() {
    _avStopEngine();
    const ac = getCtx();
    const t = ac.currentTime;

    // — Oscillator 1: low turbine rumble (sawtooth) —
    const osc1 = ac.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(55, t);

    // — Oscillator 2: mid-frequency engine whine (square) —
    const osc2 = ac.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(110, t);

    // — Noise layer: jet airflow —
    const bufLen = ac.sampleRate * 3; // 3s looping noise
    const noiseBuf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1;
    const noiseSrc = ac.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    // Band-pass filter: shape noise into jet turbine character
    const bpf = ac.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(600, t);
    bpf.Q.value = 0.8;

    // High-pass for air-rushing layer
    const hpf = ac.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(2000, t);

    // Gains for each layer
    const g1 = ac.createGain(); g1.gain.setValueAtTime(0.12, t);
    const g2 = ac.createGain(); g2.gain.setValueAtTime(0.06, t);
    const noiseGainNode = ac.createGain(); noiseGainNode.gain.setValueAtTime(0.14, t);
    const airGain = ac.createGain(); airGain.gain.setValueAtTime(0.05, t);

    // Master gain — starts silent, ramps up during spool
    const masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(0, t);

    // Wire up
    osc1.connect(g1); g1.connect(masterGain);
    osc2.connect(g2); g2.connect(masterGain);
    noiseSrc.connect(bpf); bpf.connect(noiseGainNode); noiseGainNode.connect(masterGain);
    noiseSrc.connect(hpf); hpf.connect(airGain); airGain.connect(masterGain);
    masterGain.connect(ac.destination);

    osc1.start(t); osc2.start(t); noiseSrc.start(t);

    // Spool-up: engine pitch rises from idle (55Hz) → takeoff (140Hz) over 1.4s
    osc1.frequency.setValueAtTime(55, t);
    osc1.frequency.linearRampToValueAtTime(80, t + 0.4);
    osc1.frequency.linearRampToValueAtTime(140, t + 1.4);

    osc2.frequency.setValueAtTime(110, t);
    osc2.frequency.linearRampToValueAtTime(160, t + 0.4);
    osc2.frequency.linearRampToValueAtTime(280, t + 1.4);

    bpf.frequency.setValueAtTime(400, t);
    bpf.frequency.linearRampToValueAtTime(900, t + 1.4);

    // Volume spool-up curve
    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(0.05, t + 0.15);
    masterGain.gain.linearRampToValueAtTime(0.18, t + 0.8);
    masterGain.gain.linearRampToValueAtTime(0.28, t + 1.4);

    // Takeoff burst whoosh
    const whoosh = ac.createOscillator();
    whoosh.type = 'sawtooth';
    whoosh.frequency.setValueAtTime(60, t + 1.2);
    whoosh.frequency.exponentialRampToValueAtTime(380, t + 1.9);
    const wg = ac.createGain();
    wg.gain.setValueAtTime(0, t + 1.2);
    wg.gain.linearRampToValueAtTime(0.22, t + 1.35);
    wg.gain.linearRampToValueAtTime(0, t + 1.9);
    whoosh.connect(wg); wg.connect(ac.destination);
    whoosh.start(t + 1.2); whoosh.stop(t + 1.95);

    // Store nodes so tick can update them
    avEngineNodes = { osc1, osc2, noiseGainNode, masterGain, bpf, ac };
  }

  function aviatorStart_sfx() {
    if (muted) return;
    _avStartEngine();
  }

  // ── AVIATOR: continuous engine update synced to multiplier ───────────────────
  function aviatorTick_sfx(mult) {
    if (muted) return;
    if (!avEngineNodes) return;
    const { osc1, osc2, noiseGainNode, masterGain, bpf, ac } = avEngineNodes;
    const t = ac.currentTime;

    // Map multiplier → engine pitch and intensity
    // At 1× → base (140Hz), at 5× → 280Hz, at 10× → 420Hz, capped at 600Hz
    const baseFreq = Math.min(140 + (mult - 1) * 32, 600);
    const whineFreq = baseFreq * 2;
    const filterFreq = Math.min(900 + (mult - 1) * 120, 3500);
    const vol = Math.min(0.28 + (mult - 1) * 0.018, 0.55);

    osc1.frequency.linearRampToValueAtTime(baseFreq, t + 0.12);
    osc2.frequency.linearRampToValueAtTime(whineFreq, t + 0.12);
    bpf.frequency.linearRampToValueAtTime(filterFreq, t + 0.12);
    masterGain.gain.linearRampToValueAtTime(vol, t + 0.12);

    // High-mult tension tick (subtle ping at very high multipliers)
    if (mult >= 3) {
      const pingFreq = 800 + mult * 40;
      tone(Math.min(pingFreq, 2400), 'sine', 0.03, 0, 0.03);
    }
  }

  // ── AVIATOR: crash ───────────────────────────────────────────────────────────
  function aviatorCrash_sfx() {
    if (muted) return;
    // Stop engine immediately
    _avStopEngine();
    const ac = getCtx();
    const t = ac.currentTime;

    // Impact explosion — layered booms
    // Sub-bass thud
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(20, t + 0.6);
    const subG = ac.createGain();
    subG.gain.setValueAtTime(0.6, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    sub.connect(subG); subG.connect(ac.destination);
    sub.start(t); sub.stop(t + 0.75);

    // Mid crunch
    const crunch = ac.createOscillator();
    crunch.type = 'sawtooth';
    crunch.frequency.setValueAtTime(200, t);
    crunch.frequency.linearRampToValueAtTime(40, t + 0.35);
    const crG = ac.createGain();
    crG.gain.setValueAtTime(0.3, t);
    crG.gain.linearRampToValueAtTime(0, t + 0.4);
    crunch.connect(crG); crG.connect(ac.destination);
    crunch.start(t); crunch.stop(t + 0.45);

    // Debris noise burst
    for (let i = 0; i < 5; i++) {
      noise(0.25 - i * 0.04, i * 0.02, 0.12 + i * 0.04, 200 + i * 300);
    }
    // High-freq shrapnel crackle
    for (let i = 0; i < 8; i++) {
      noise(0.12, i * 0.03, 0.06, 3000 + Math.random() * 3000);
    }
    // Distant echo rumble
    noise(0.15, 0.3, 0.5, 150);
    noise(0.1, 0.45, 0.4, 80);
  }

  // ── AVIATOR: cashout ────────────────────────────────────────────────────────
  function aviatorCashout_sfx() {
    if (muted) return;
    // Cash-out = triumphant ascending chime + coin shower
    const chime = [523, 659, 784, 1047, 1319, 1568];
    chime.forEach((f, i) => tone(f, 'sine', 0.22 + i * 0.01, i * 0.07, 0.13));
    // Sparkle noise
    for (let i = 0; i < 10; i++) noise(0.07, 0.05 + i * 0.05, 0.05, 2500 + Math.random() * 2000);
    // Final big ding
    tone(2093, 'sine', 0.28, 0.42, 0.35);
  }

  // ── CARD GAMES: deal sound (Dragon Tiger / Andar Bahar) ──────────────────────
  function cardDeal() {
    if (muted) return;
    noise(0.12, 0, 0.06, 2500);
    tone(350, 'sine', 0.08, 0, 0.05);
    noise(0.08, 0.05, 0.05, 2000);
  }

  // ── CARD GAMES: win ──────────────────────────────────────────────────────────
  function cardWin() {
    if (muted) return;
    tone(523, 'sine', 0.15, 0, 0.1);
    tone(659, 'sine', 0.15, 0.1, 0.1);
    tone(784, 'sine', 0.18, 0.2, 0.1);
    tone(1047, 'sine', 0.2, 0.3, 0.2);
    for (let i = 0; i < 5; i++) noise(0.06, 0.05 + i * 0.06, 0.04, 1800);
  }

  // ── CARD GAMES: loss ─────────────────────────────────────────────────────────
  function cardLoss() {
    if (muted) return;
    tone(300, 'sine', 0.15, 0, 0.15);
    tone(220, 'sine', 0.15, 0.1, 0.2);
    tone(160, 'sine', 0.12, 0.2, 0.25);
  }

  // ── VORTEX: spin tick ────────────────────────────────────────────────────────
  function vortexSpin() {
    if (muted) return;
    for (let i = 0; i < 8; i++) {
      noise(0.06, i * 0.04, 0.03, 1500 + i * 100);
      tone(300 + i * 30, 'square', 0.04, i * 0.04, 0.03);
    }
  }

  // ── VORTEX: win / loss ───────────────────────────────────────────────────────
  function vortexWin() {
    if (muted) return;
    tone(784, 'sine', 0.18, 0, 0.08);
    tone(988, 'sine', 0.2, 0.08, 0.08);
    tone(1175, 'sine', 0.22, 0.16, 0.15);
    for (let i = 0; i < 4; i++) noise(0.06, i * 0.05, 0.04, 2000);
  }

  function vortexLoss() {
    if (muted) return;
    tone(250, 'sine', 0.15, 0, 0.18);
    tone(180, 'sine', 0.12, 0.1, 0.2);
  }

  // ── GENERIC: button click ────────────────────────────────────────────────────
  function click_sfx() {
    if (muted) return;
    tone(800, 'sine', 0.06, 0, 0.03);
    noise(0.04, 0, 0.02, 3000);
  }

  // ── GENERIC: bet placed ──────────────────────────────────────────────────────
  function betPlace() {
    if (muted) return;
    tone(440, 'sine', 0.1, 0, 0.04);
    tone(550, 'sine', 0.08, 0.04, 0.04);
  }

  // ── MUTE TOGGLE ─────────────────────────────────────────────────────────────
  function toggleMute() {
    muted = !muted;
    const btn = document.getElementById('sfx-mute-btn');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
    if (!muted) click_sfx();
  }

  // ── MUTE BUTTON (floating) ───────────────────────────────────────────────────
  function injectMuteBtn() {
    if (document.getElementById('sfx-mute-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'sfx-mute-btn';
    btn.textContent = '🔊';
    btn.title = 'Toggle sound';
    btn.style.cssText = `
      position: fixed; bottom: 72px; right: 14px; z-index: 999;
      width: 38px; height: 38px; border-radius: 50%;
      background: rgba(30,20,50,0.85); border: 1px solid rgba(255,255,255,0.15);
      color: #fff; font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;
    btn.onclick = () => toggleMute();
    document.body.appendChild(btn);
  }

  return {
    slotsReel, slotsWin, slotsJackpot, slotsLoss,
    minesStart_sfx, minesSafe, minesBoom, minesCashout_sfx,
    aviatorStart_sfx, aviatorTick_sfx, aviatorCrash_sfx, aviatorCashout_sfx, _avStopEngine,
    cardDeal, cardWin, cardLoss,
    vortexSpin, vortexWin, vortexLoss,
    click_sfx, betPlace,
    injectMuteBtn,
    init() { getCtx(); injectMuteBtn(); }
  };
})();

// ── Auto-init sound engine on first user interaction ──────────────────────────
document.addEventListener('click', () => SFX.init(), { once: true });
document.addEventListener('touchstart', () => SFX.init(), { once: true });


// ══════════════════════════════════════════════════
//  CRICKET MODULE  — v2.0  (Bookie Style)
// ══════════════════════════════════════════════════
const CricketUI = (() => {
  let currentFilter = 'all';
  let currentTab    = 'matches';
  let matchData     = null;
  let selectedMarketId  = null;
  let selectedChoice    = null;
  let selectedOdds      = 0;
  let selectedBetType   = 'back'; // 'back' or 'lay'
  let socketInited      = false;

  // ── switch top-level tabs ──
  function switchTab(tab) {
    currentTab = tab;
    document.getElementById('crTabMatches').classList.toggle('active', tab === 'matches');
    document.getElementById('crTabMyBets').classList.toggle('active', tab === 'mybets');
    document.getElementById('crPanelMatches').style.display = tab === 'matches' ? '' : 'none';
    document.getElementById('crPanelMyBets').style.display  = tab === 'mybets'  ? '' : 'none';
    if (tab === 'mybets') loadMyBets();
  }

  // ── filter pills ──
  function applyFilter(status) {
    currentFilter = status;
    document.querySelectorAll('.cr-filter').forEach(f => f.classList.remove('active'));
    const pill = document.getElementById('crF-' + status);
    if (pill) pill.classList.add('active');
    loadMatches(status);
  }

  // ── IPL match loader ──
  async function loadIPLMatches() {
    const list = document.getElementById('crMatchList');
    list.innerHTML = '<div class="cr-loading"><div class="cr-spinner"></div><div>Loading IPL 2026 matches…</div></div>';
    try {
      // Fetch all matches then filter by tournament name
      const res  = await fetch(`${API}/cricket/matches?status=all`);
      const data = await res.json();
      if (!data.success) throw new Error('failed');
      const ipl = (data.matches || []).filter(m =>
        (m.tournament || '').toLowerCase().includes('ipl') ||
        (m.matchId || '').startsWith('ipl26') ||
        (m.matchId || '').startsWith('ipl25')
      );
      if (!ipl.length) {
        // Fall back to showing all upcoming matches
        const allRes  = await fetch(`${API}/cricket/matches?status=upcoming`);
        const allData = await allRes.json();
        if (allData.success && allData.matches && allData.matches.length) {
          renderMatches(allData.matches);
          return;
        }
        list.innerHTML = `<div class="cr-empty">
          <div class="cr-empty-icon">🏆</div>
          <div class="cr-empty-txt">IPL 2026 matches not seeded yet</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px">Run on server: <span style="color:#72b8f5;font-family:monospace">node scripts/seedIPLMatches.js</span></div>
        </div>`;
        return;
      }
      renderMatches(ipl);
    } catch(e) {
      list.innerHTML = `<div class="cr-empty"><div class="cr-empty-icon">⚠️</div><div class="cr-empty-txt">Could not load IPL matches</div></div>`;
    }
  }

  // ── fetch matches ──
  // ── smart init: auto-switch to Live tab if live matches exist ──
  async function smartInit() {
    const list = document.getElementById('crMatchList');
    list.innerHTML = '<div class="cr-loading"><div class="cr-spinner"></div><div>Loading matches…</div></div>';

    // Activate 'All' pill by default
    document.querySelectorAll('.cr-filter').forEach(f => f.classList.remove('active'));
    const allPill = document.getElementById('crF-all');
    if (allPill) allPill.classList.add('active');

    try {
      // First check if there are any live matches
      const liveRes  = await fetch(`${API}/cricket/matches?status=live`);
      const liveData = await liveRes.json();
      const hasLive  = liveData.success && liveData.matches && liveData.matches.length > 0;

      if (hasLive) {
        // Auto-switch to Live tab
        currentFilter = 'live';
        document.querySelectorAll('.cr-filter').forEach(f => f.classList.remove('active'));
        const livePill = document.getElementById('crF-live');
        if (livePill) livePill.classList.add('active');
        renderMatches(liveData.matches);
        const pill = document.getElementById('crLivePill');
        if (pill) pill.style.display = '';
      } else {
        // No live matches — show upcoming
        currentFilter = 'upcoming';
        const upRes  = await fetch(`${API}/cricket/matches?status=upcoming`);
        const upData = await upRes.json();
        if (!upData.success || !upData.matches || !upData.matches.length) {
          // Try fetching all matches as fallback (upcoming + completed)
          try {
            const allRes  = await fetch(`${API}/cricket/matches?status=all`);
            const allData = await allRes.json();
            if (allData.success && allData.matches && allData.matches.length) {
              currentFilter = 'all';
              document.querySelectorAll('.cr-filter').forEach(f => f.classList.remove('active'));
              const ap = document.getElementById('crF-all');
              if (ap) ap.classList.add('active');
              renderMatches(allData.matches);
            } else {
              list.innerHTML = `<div class="cr-empty">
                <div class="cr-empty-icon">🏏</div>
                <div class="cr-empty-txt">No matches yet</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:8px">IPL 2026 matches will load automatically.<br>If you see this, restart your server.</div>
              </div>`;
            }
          } catch(e2) {
            list.innerHTML = `<div class="cr-empty"><div class="cr-empty-icon">🏏</div><div class="cr-empty-txt">No upcoming matches right now</div></div>`;
          }
        } else {
          renderMatches(upData.matches);
        }
        const pill = document.getElementById('crLivePill');
        if (pill) pill.style.display = 'none';
      }
    } catch(e) {
      list.innerHTML = `<div class="cr-empty"><div class="cr-empty-icon">⚠️</div><div class="cr-empty-txt">Could not load matches</div></div>`;
    }
  }

  async function loadMatches(status) {
    if (status === 'ipl') { loadIPLMatches(); return; }
    const list = document.getElementById('crMatchList');
    list.innerHTML = '<div class="cr-loading"><div class="cr-spinner"></div><div>Loading matches…</div></div>';
    try {
      const url = status === 'all'
        ? `${API}/cricket/matches?status=all`
        : `${API}/cricket/matches?status=${status}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (!data.success || !data.matches.length) {
        // If upcoming is empty, check if there are live matches and show a banner
        if (status === 'upcoming') {
          try {
            const liveRes  = await fetch(`${API}/cricket/matches?status=live`);
            const liveData = await liveRes.json();
            if (liveData.success && liveData.matches && liveData.matches.length > 0) {
              list.innerHTML = `
                <div class="cr-live-banner" onclick="crFilter('live')">
                  <div class="cr-live-banner-dot"></div>
                  <div class="cr-live-banner-text">
                    <div class="cr-live-banner-title">${liveData.matches.length} Live Match${liveData.matches.length > 1 ? 'es' : ''} in Progress!</div>
                    <div class="cr-live-banner-sub">Tap to see live betting odds →</div>
                  </div>
                </div>
                <div class="cr-empty" style="padding-top:16px">
                  <div class="cr-empty-icon">📅</div>
                  <div class="cr-empty-txt">No upcoming matches scheduled</div>
                </div>`;
              return;
            }
          } catch(e2) {}
        }
        list.innerHTML = `<div class="cr-empty"><div class="cr-empty-icon">🏏</div><div class="cr-empty-txt">No ${status} matches right now</div></div>`;
        return;
      }
      renderMatches(data.matches);
      const hasLive = data.matches.some(m => m.status === 'live');
      const pill = document.getElementById('crLivePill');
      if (pill) pill.style.display = hasLive ? '' : 'none';
    } catch(e) {
      list.innerHTML = `<div class="cr-empty"><div class="cr-empty-icon">⚠️</div><div class="cr-empty-txt">Could not load matches</div></div>`;
    }
  }

  // ── build match odds row (Back/Lay style) ──
  function buildOddsRow(m) {
    if (!m.isBettingOpen) return '';
    // Find match_winner market first, else first open market
    const mktWinner = (m.markets || []).find(mk => mk.type === 'match_winner' && mk.status === 'open')
                   || (m.markets || []).find(mk => mk.status === 'open');

    // If no market data on card (can happen), show a tap-to-bet button
    if (!mktWinner || !mktWinner.options || !mktWinner.options.length) {
      return `
        <div class="cr-card-odds-section">
          <div style="display:flex;justify-content:center;padding:2px 0">
            <div class="cr-back-btn" style="padding:8px 24px;font-size:13px;font-weight:800;letter-spacing:1px"
              onclick="event.stopPropagation();crOpenMatch('${m.matchId}')">
              🏏 BET NOW
            </div>
          </div>
        </div>
      `;
    }

    const opts = mktWinner.options || [];
    // Build the Back row (single row of Back buttons)
    const btnHTML = opts.slice(0, 3).map((opt, i) => {
      const teamName = opt.label.length > 6 ? opt.label.substring(0,6) : opt.label;
      return `
        <div style="flex:1;text-align:center">
          <div class="cr-odds-team-name">${teamName}</div>
          <div class="cr-back-btn" id="card-odds-${m.matchId}-${opt.key}"
            onclick="event.stopPropagation();crSelectBetFromCard('${m.matchId}','${mktWinner.marketId}','${mktWinner.label}','${opt.key}','${opt.label}',${opt.odds},'back')">
            ${opt.odds.toFixed(2)}
          </div>
        </div>
        ${i < opts.slice(0,3).length - 1 ? '<div class="cr-vs-spacer">|</div>' : ''}
      `;
    }).join('');

    return `
      <div class="cr-card-odds-section">
        <div class="cr-odds-label">${mktWinner.label}</div>
        <div style="display:flex;gap:3px;padding:0 2px">${btnHTML}</div>
      </div>
    `;
  }

  // ── build session strip on card ──
  function buildSessionStrip(m) {
    if (!m.isBettingOpen) return '';
    const sessionMkts = (m.markets || []).filter(mk =>
      mk.status === 'open' &&
      (mk.label.toLowerCase().includes('session') ||
       mk.label.toLowerCase().includes('over') ||
       mk.label.toLowerCase().includes('runs') ||
       mk.label.toLowerCase().includes('wicket'))
    ).slice(0, 2);
    if (!sessionMkts.length) return '';

    const pairs = sessionMkts.map(mk => {
      const yes = mk.options.find(o => o.key === 'yes' || o.key === 'over') || mk.options[0];
      const no  = mk.options.find(o => o.key === 'no'  || o.key === 'under') || mk.options[1];
      if (!yes) return '';
      return `
        <span class="cr-session-label">${mk.label.replace('Session','').replace('session','').trim() || mk.label}:</span>
        <div class="cr-session-pair">
          <span class="cr-session-back"
            onclick="event.stopPropagation();crSelectBetFromCard('${m.matchId}','${mk.marketId}','${mk.label}','${yes.key}','${yes.label}',${yes.odds},'back')">
            ${yes.odds.toFixed(2)}
          </span>
          ${no ? `<span class="cr-session-lay"
            onclick="event.stopPropagation();crSelectBetFromCard('${m.matchId}','${mk.marketId}','${mk.label}','${no.key}','${no.label}',${no.odds},'lay')">
            ${no.odds.toFixed(2)}
          </span>` : ''}
        </div>
      `;
    }).join('');

    return `<div class="cr-session-strip">${pairs}</div>`;
  }

  // ── render match list ──
  function renderMatches(matches) {
    const list = document.getElementById('crMatchList');
    list.innerHTML = matches.map(m => {
      const isLive      = m.status === 'live';
      const isCompleted = m.status === 'completed' || m.status === 'cancelled';
      const bettingOpen = m.isBettingOpen;
      const schedTime   = new Date(m.scheduledAt).toLocaleString('en-IN', {
        month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
      });

      const pill = isLive
        ? '<span class="cr-card-status-pill cr-pill-live">🔴 LIVE</span>'
        : isCompleted
          ? '<span class="cr-card-status-pill cr-pill-completed">DONE</span>'
          : '<span class="cr-card-status-pill cr-pill-upcoming">UPCOMING</span>';

      const scoreA = m.score?.teamAInnings1 || '';
      const scoreB = m.score?.teamBInnings1 || '';

      // Live ticker strip
      let liveTickerHTML = '';
      if (isLive && m.score) {
        const rr = m.score.runRate ? `RR: ${parseFloat(m.score.runRate).toFixed(1)}` : '';
        const req = m.score.requiredRate ? `REQ: ${parseFloat(m.score.requiredRate).toFixed(1)}` : '';
        const target = m.score.target ? `Target: ${m.score.target}` : '';
        if (rr || target) {
          liveTickerHTML = `<div class="cr-live-ticker"><span>${target || ''}</span><span class="cr-rr">${rr}${req ? ' · '+req : ''}</span></div>`;
        }
      }

      const oddsHTML   = buildOddsRow(m);
      const sessionHTML = isLive ? buildSessionStrip(m) : '';

      const footerRight = isCompleted
        ? `<span class="cr-card-closed-txt">Settled</span>`
        : `<span class="cr-card-open-btn" onclick="crOpenMatch('${m.matchId}')">All Markets ›</span>`;

      return `<div class="cr-match-card${isLive ? ' live-card' : ''}" onclick="crOpenMatch('${m.matchId}')">
        <div class="cr-card-top">
          <span class="cr-card-tournament">${m.tournament || 'CRICKET'} · ${m.matchType || 'T20'}</span>
          ${pill}
        </div>
        <div class="cr-card-teams">
          <div class="cr-card-team">
            <div class="cr-card-team-short">${m.teamAShort}</div>
            <div class="cr-card-team-full">${m.teamA}</div>
            ${scoreA ? `<div class="cr-card-team-score">${scoreA}</div>` : ''}
          </div>
          <div class="cr-card-mid">
            <div class="cr-card-vs">VS</div>
            <div class="cr-card-time">${isLive
              ? `${m.score?.currentOver||0}.${m.score?.currentBall||0} ov`
              : schedTime}</div>
          </div>
          <div class="cr-card-team">
            <div class="cr-card-team-short">${m.teamBShort}</div>
            <div class="cr-card-team-full">${m.teamB}</div>
            ${scoreB ? `<div class="cr-card-team-score">${scoreB}</div>` : ''}
          </div>
        </div>
        ${liveTickerHTML}
        ${oddsHTML}
        ${sessionHTML}
        <div class="cr-card-footer">
          <span class="cr-card-venue">📍 ${m.venue || 'TBD'}</span>
          ${footerRight}
        </div>
      </div>`;
    }).join('');
  }

  // ── select bet from match list card (without opening detail) ──
  async function selectBetFromCard(matchId, marketId, marketLabel, choice, choiceLabel, odds, betType) {
    const token = localStorage.getItem('legitclub_token') || sessionStorage.getItem('legitclub_token');
    if (!token) { showToast('Please login to place bets', 'error'); return; }

    // We need matchData for placing bet — fetch if needed
    if (!matchData || matchData.matchId !== matchId) {
      try {
        const res  = await fetch(`${API}/cricket/matches/${matchId}`);
        const data = await res.json();
        if (data.success) matchData = data.match;
      } catch(e) { /* will still show slip */ }
    }

    selectedMarketId  = marketId;
    selectedChoice    = choice;
    selectedOdds      = odds;
    selectedBetType   = betType || 'back';

    document.getElementById('crSlipType').textContent   = betType === 'lay' ? 'LAY' : 'BACK';
    document.getElementById('crSlipType').style.background = betType === 'lay' ? '#3d1a2e' : '#1a3a5c';
    document.getElementById('crSlipType').style.color      = betType === 'lay' ? '#e880b5' : '#72b8f5';
    document.getElementById('crBetSlipMkt').textContent    = marketLabel;
    document.getElementById('crBetSlipChoice').textContent = choiceLabel;
    document.getElementById('crBetSlipOdds').textContent   = odds.toFixed(2) + 'x';
    document.getElementById('crBetAmount').value = '';
    document.getElementById('crPotentialWin').textContent = 'Win: ₹0';
    document.getElementById('crBetSlip').style.display = '';
  }

  // ── open match detail ──
  async function openMatch(matchId) {
    const overlay = document.getElementById('crMatchDetail');
    overlay.style.display = 'flex';
    // Scroll sheet to top immediately so user sees header, not black void
    const sheet = overlay.querySelector('.cr-detail-sheet');
    if (sheet) sheet.scrollTop = 0;

    document.getElementById('crMarketsList').innerHTML =
      '<div class="cr-loading"><div class="cr-spinner"></div><div>Loading markets…</div></div>';

    try {
      const res  = await fetch(`${API}/cricket/matches/${matchId}`);
      const data = await res.json();
      if (!data.success) { closeDetail(); return; }
      matchData = data.match;
      renderDetail(data.match);
      // Scroll to top again after render
      if (sheet) sheet.scrollTop = 0;
    } catch(e) {
      closeDetail();
    }
  }

  function renderDetail(match) {
    // Header
    document.getElementById('crDetailTitle').textContent = match.title;
    const badge = document.getElementById('crDetailBadge');
    badge.textContent = match.status === 'live' ? '🔴 LIVE' : match.status.toUpperCase();
    badge.style.display = match.status === 'completed' ? 'none' : '';

    // Scores
    document.getElementById('crScoreTeamAShort').textContent = match.teamAShort;
    document.getElementById('crScoreTeamBShort').textContent = match.teamBShort;
    document.getElementById('crScoreTeamAScore').textContent =
      match.score?.teamAInnings1 || (match.status === 'upcoming' ? '—' : '0/0');
    document.getElementById('crScoreTeamBScore').textContent =
      match.score?.teamBInnings1 || (match.status === 'upcoming' ? '—' : '0/0');
    document.getElementById('crScoreOver').textContent =
      `Over ${match.score?.currentOver||0}.${match.score?.currentBall||0}`;
    document.getElementById('crScoreBatting').textContent =
      match.score?.batting ? `🏏 ${match.score.batting}` : '';

    // Run rate bar
    const rrBar = document.getElementById('crRRBar');
    if (match.status === 'live' && match.score && (match.score.runRate || match.score.target)) {
      rrBar.style.display = '';
      document.getElementById('crRRText').textContent =
        match.score.runRate ? `CRR: ${parseFloat(match.score.runRate).toFixed(2)}` : '';
      document.getElementById('crTargetText').textContent =
        match.score.target
          ? `Target ${match.score.target}${match.score.requiredRate ? ' · RRR: '+parseFloat(match.score.requiredRate).toFixed(2) : ''}`
          : '';
    } else {
      rrBar.style.display = 'none';
    }

    document.getElementById('crCommentary').textContent = match.score?.commentary || '';
    renderMarkets(match);
  }

  // ── render markets as collapsible groups ──
  function renderMarkets(match) {
    const list = document.getElementById('crMarketsList');
    if (!match.markets || !match.markets.length) {
      list.innerHTML = '<div class="cr-empty"><div class="cr-empty-icon">📋</div><div class="cr-empty-txt">No markets available yet</div></div>';
      return;
    }

    // Group by category
    const groups = {};
    const categoryOrder = ['Match Odds','Session','Top Batsman','Top Bowler','Player Props','Other'];

    match.markets.forEach(market => {
      let cat = 'Other';
      const lbl = market.label.toLowerCase();
      if (lbl.includes('winner') || lbl.includes('match odds') || lbl.includes('toss')) cat = 'Match Odds';
      else if (lbl.includes('session') || lbl.includes('runs in') || lbl.includes('over') || lbl.includes('powerplay')) cat = 'Session';
      else if (lbl.includes('batsman') || lbl.includes('bat')) cat = 'Top Batsman';
      else if (lbl.includes('bowler') || lbl.includes('wicket')) cat = 'Top Bowler';
      else if (lbl.includes('player') || lbl.includes('man of')) cat = 'Player Props';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(market);
    });

    const bettingOpen = match.isBettingOpen;

    list.innerHTML = categoryOrder
      .filter(cat => groups[cat] && groups[cat].length)
      .map((cat, gi) => {
        const mkts = groups[cat];
        const firstOpen = mkts.find(m => m.status === 'open') || mkts[0];
        const catStatus = mkts.some(m => m.status === 'open') ? 'open' : mkts.some(m => m.status === 'locked') ? 'locked' : 'settled';
        const statusLabel = catStatus === 'open' ? 'OPEN' : catStatus === 'locked' ? 'LOCKED' : 'SETTLED';
        const statusClass = `cr-mkt-${catStatus}`;
        const isOpen = gi === 0; // first group expanded by default

        const mktsHTML = mkts.map(market => {
          const n = market.options.length;
          const gridClass = n <= 2 ? 'cr-options-2' : n === 3 ? 'cr-options-3' : n === 4 ? 'cr-options-4' : 'cr-options-many';
          const isSettled = market.status === 'settled';
          const isLocked  = market.status === 'locked';
          const canBet    = bettingOpen && market.status === 'open';

          const opts = market.options.map(opt => {
            const isWinner = isSettled && market.result === opt.key;
            const clickHandler = canBet
              ? `crSelectBet('${market.marketId}','${market.label}','${opt.key}','${opt.label}',${opt.odds})`
              : `showToast('${isLocked ? 'Market is locked' : 'Market is settled'}','error')`;
            return `<div class="cr-option-btn${isWinner ? ' winner-opt' : ''}${!canBet ? ' cr-option-closed' : ''}"
              id="opt-${market.marketId}-${opt.key}"
              onclick="${clickHandler}">
              <div class="cr-option-label">${opt.label}${isWinner ? ' ✓' : ''}</div>
              <div class="cr-option-odds">${opt.odds.toFixed(2)}<span class="cr-option-odds-unit">x</span></div>
            </div>`;
          }).join('');

          const mktStatusBadge = isSettled
            ? '<span class="cr-market-status cr-mkt-settled">SETTLED</span>'
            : isLocked
              ? '<span class="cr-market-status cr-mkt-locked">LOCKED</span>'
              : '';

          return `<div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 2px 4px;">
              <span style="font-size:12px;color:rgba(255,255,255,0.6);font-weight:600">${market.label}</span>
              ${mktStatusBadge}
            </div>
            <div class="cr-options-grid ${gridClass}">${opts}</div>
          </div>`;
        }).join('<div style="height:1px;background:rgba(0,255,100,0.06);margin:4px 0"></div>');

        return `<div class="cr-market-group">
          <div class="cr-market-group-header ${isOpen ? 'open' : ''}" onclick="crToggleGroup(this)">
            <div class="cr-mgh-left">
              <span class="cr-mgh-name">${cat}</span>
              <span class="cr-mgh-count">${mkts.length}</span>
            </div>
            <div class="cr-mgh-right">
              <span class="cr-market-status ${statusClass}">${statusLabel}</span>
              <span class="cr-mgh-arrow ${isOpen ? 'open' : ''}">▾</span>
            </div>
          </div>
          <div class="cr-market-group-body ${isOpen ? 'open' : ''}">${mktsHTML}</div>
        </div>`;
      }).join('');
  }

  function closeDetail() {
    document.getElementById('crMatchDetail').style.display = 'none';
    matchData = null;
    selectedMarketId = null;
    selectedChoice = null;
  }

  // ── toggle collapsible market group ──
  function toggleGroup(header) {
    const body  = header.nextElementSibling;
    const arrow = header.querySelector('.cr-mgh-arrow');
    const isNowOpen = !body.classList.contains('open');
    body.classList.toggle('open', isNowOpen);
    header.classList.toggle('open', isNowOpen);
    arrow.classList.toggle('open', isNowOpen);
  }

  // ── select bet from detail view ──
  function selectBet(marketId, marketLabel, choice, choiceLabel, odds) {
    if (!matchData) return;
    if (!matchData.isBettingOpen) { showToast('Betting is not open for this match yet', 'error'); return; }
    const token = localStorage.getItem('legitclub_token') || sessionStorage.getItem('legitclub_token');
    if (!token) { showToast('Please login to place bets', 'error'); return; }

    selectedMarketId = marketId;
    selectedChoice   = choice;
    selectedOdds     = odds;
    selectedBetType  = 'back';

    document.getElementById('crSlipType').textContent    = 'BACK';
    document.getElementById('crSlipType').style.background = '#1a3a5c';
    document.getElementById('crSlipType').style.color      = '#72b8f5';
    document.getElementById('crBetSlipMkt').textContent    = marketLabel;
    document.getElementById('crBetSlipChoice').textContent = choiceLabel;
    document.getElementById('crBetSlipOdds').textContent   = odds.toFixed(2) + 'x';
    document.getElementById('crBetAmount').value = '';
    document.getElementById('crPotentialWin').textContent = 'Win: ₹0';
    document.getElementById('crBetSlip').style.display = '';
  }

  function setAmt(amt) {
    document.getElementById('crBetAmount').value = amt;
    updatePotential();
  }

  function updatePotential() {
    const amt = parseFloat(document.getElementById('crBetAmount').value) || 0;
    document.getElementById('crPotentialWin').textContent = `Win: ₹${Math.round(amt * selectedOdds)}`;
  }

  // ── place bet ──
  async function placeBet() {
    const amt = parseInt(document.getElementById('crBetAmount').value);
    if (!amt || amt < 1)    { showToast('Minimum bet is ₹1', 'error'); return; }
    if (amt > 50000)          { showToast('Maximum bet is ₹50,000', 'error'); return; }
    if (!selectedMarketId || !selectedChoice) return;

    // If matchData is missing (bet from card) we must have it by now from selectBetFromCard
    const token = localStorage.getItem('legitclub_token') || sessionStorage.getItem('legitclub_token');
    if (!token) { showToast('Please login first', 'error'); return; }

    const btn = document.querySelector('.cr-btn-place');
    btn.disabled = true; btn.textContent = 'Placing…';

    try {
      if (!matchData || !matchData.matchId) {
        showToast('Match data not loaded yet, please try again', 'error');
        btn.disabled = false; btn.textContent = 'Place Bet 🏏';
        return;
      }
      const res = await fetch(`${API}/cricket/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          matchId: matchData.matchId,
          marketId: selectedMarketId,
          choice: selectedChoice,
          amount: amt
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Bet placed! Potential win: ₹${data.bet.potentialWin}`, 'success');
        document.getElementById('crBetSlip').style.display = 'none';
        selectedMarketId = null; selectedChoice = null;
        if (data.newBalance !== undefined) {
          if (currentUser) currentUser.balance = data.realBalance;
          refreshWalletUI();
          fetchBalance();
        }
      } else {
        showToast(data.message || 'Bet failed', 'error');
      }
    } catch(e) {
      showToast('Network error', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Place Bet 🏏';
    }
  }

  function cancelBet() {
    document.getElementById('crBetSlip').style.display = 'none';
    selectedMarketId = null; selectedChoice = null;
  }

  // ── my bets ──
  async function loadMyBets() {
    const token = localStorage.getItem('legitclub_token') || sessionStorage.getItem('legitclub_token');
    const list  = document.getElementById('crMyBetsList');
    if (!token) {
      list.innerHTML = '<div class="cr-empty"><div class="cr-empty-icon">🔒</div><div class="cr-empty-txt">Login to view your bets</div></div>';
      return;
    }
    list.innerHTML = '<div class="cr-loading"><div class="cr-spinner"></div><div>Loading bets…</div></div>';
    try {
      const res  = await fetch(`${API}/cricket/my-bets?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!data.success || !data.bets.length) {
        list.innerHTML = '<div class="cr-empty"><div class="cr-empty-icon">🏏</div><div class="cr-empty-txt">No bets placed yet</div></div>';
        return;
      }
      list.innerHTML = data.bets.map(bet => {
        const statusClass = `cr-bet-${bet.status}`;
        const date = new Date(bet.createdAt).toLocaleDateString('en-IN', {
          month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
        });
        const payout = bet.status === 'won'
          ? `<span class="cr-bet-payout won-payout">+₹${bet.payout?.toFixed(2)||0}</span>` : '';
        return `<div class="cr-bet-card ${statusClass}">
          <div class="cr-bet-match">🏏 ${bet.marketLabel||bet.matchId} · ${date}</div>
          <div class="cr-bet-row">
            <span class="cr-bet-choice">${bet.choiceLabel}</span>
            <span class="cr-bet-status-badge cr-status-${bet.status}">${bet.status.toUpperCase()}</span>
          </div>
          <div class="cr-bet-row">
            <span class="cr-bet-odds">${bet.odds?.toFixed(2)}x odds</span>
            <div style="display:flex;align-items:center;gap:8px">${payout}
              <span class="cr-bet-amount">₹${bet.amount}</span>
            </div>
          </div>
        </div>`;
      }).join('');
    } catch(e) {
      list.innerHTML = '<div class="cr-empty"><div class="cr-empty-icon">⚠️</div><div class="cr-empty-txt">Could not load bets</div></div>';
    }
  }

  // ── odds flash helper (called from socket updates) ──
  function flashOdds(elId, direction) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.classList.remove('flash-up','flash-down');
    void el.offsetWidth; // reflow
    el.classList.add(direction === 'up' ? 'flash-up' : 'flash-down');
  }

  // ── init ──
  function init() {
    smartInit();
    if (window.socket && !socketInited) {
      socketInited = true;

      socket.on('cricket:score_update', d => {
        if (matchData && matchData.matchId === d.matchId) {
          matchData.score = d.score;
          document.getElementById('crScoreTeamAScore').textContent = d.score.teamAInnings1 || '—';
          document.getElementById('crScoreTeamBScore').textContent = d.score.teamBInnings1 || '—';
          document.getElementById('crScoreOver').textContent = `Over ${d.score.currentOver}.${d.score.currentBall}`;
          document.getElementById('crScoreBatting').textContent = d.score.batting ? `🏏 ${d.score.batting}` : '';
          document.getElementById('crCommentary').textContent = d.score.commentary || '';
          // update rr bar
          const rrBar = document.getElementById('crRRBar');
          if (d.score.runRate || d.score.target) {
            rrBar.style.display = '';
            document.getElementById('crRRText').textContent = d.score.runRate ? `CRR: ${parseFloat(d.score.runRate).toFixed(2)}` : '';
            document.getElementById('crTargetText').textContent = d.score.target ? `Target ${d.score.target}` : '';
          }
        }
      });

      socket.on('cricket:odds_update', d => {
        // Flash odds on open match detail
        if (matchData && matchData.matchId === d.matchId) {
          const market = matchData.markets?.find(m => m.marketId === d.marketId);
          if (market) {
            d.options.forEach(newOpt => {
              const oldOpt = market.options.find(o => o.key === newOpt.key);
              const dir = (!oldOpt || newOpt.odds > oldOpt.odds) ? 'up' : 'down';
              flashOdds(`opt-${d.marketId}-${newOpt.key}`, dir);
            });
            market.options = d.options;
            renderMarkets(matchData);
          }
        }
        // Also flash on match list cards
        if (d.options) {
          d.options.forEach(opt => {
            flashOdds(`card-odds-${d.matchId}-${opt.key}`, 'up');
          });
        }
      });

      socket.on('cricket:market_settled', d => {
        if (matchData && matchData.matchId === d.matchId) {
          const market = matchData.markets?.find(m => m.marketId === d.marketId);
          if (market) { market.status = 'settled'; market.result = d.winningKey; renderMarkets(matchData); }
        }
      });

      socket.on('cricket:toss_result', d => {
        showToast(`🪙 Toss: ${d.winner} won the toss! (${d.title})`, 'rgba(250,200,50,0.8)');
        if (matchData && matchData.matchId === d.matchId) {
          const market = matchData.markets?.find(m => m.marketId === 'toss_winner');
          if (market) { market.status = 'settled'; market.result = d.winner; renderMarkets(matchData); }
        }
      });
    }
  }

  return {
    init, switchTab, applyFilter, loadMatches,
    openMatch, closeDetail, toggleGroup,
    selectBet, selectBetFromCard,
    setAmt, updatePotential, placeBet, cancelBet,
    loadMyBets
  };
})();

// ── Global wrappers (called from HTML onclick) ────
function crSwitchTab(t)      { CricketUI.switchTab(t); }
function crFilter(s)          { CricketUI.applyFilter(s); }
function crOpenMatch(id)      { CricketUI.openMatch(id); }
function crCloseDetail()      { CricketUI.closeDetail(); }
function crToggleGroup(el)    { CricketUI.toggleGroup(el); }
function crSelectBet(mId, mLbl, choice, choiceLbl, odds) { CricketUI.selectBet(mId, mLbl, choice, choiceLbl, odds); }
function crSelectBetFromCard(matchId, mId, mLbl, choice, choiceLbl, odds, type) { CricketUI.selectBetFromCard(matchId, mId, mLbl, choice, choiceLbl, odds, type); }
function crSetAmt(a)          { CricketUI.setAmt(a); }
function crUpdatePotential()  { CricketUI.updatePotential(); }
function crPlaceBet()         { CricketUI.placeBet(); }
function crCancelBet()        { CricketUI.cancelBet(); }


// ── Input listener for potential win ─────────────
document.addEventListener('input', e => {
  if (e.target && e.target.id === 'crBetAmount') CricketUI.updatePotential();
});

