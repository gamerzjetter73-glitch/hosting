// ── services/emailService.js ──
// Uses Resend HTTP API directly — no SMTP, no timeouts, works on Render free tier.

const https  = require('https');
const { logger } = require('../middleware/logger');

function buildOtpEmailHtml(otp, expiryMinutes = 5) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your OTP - LEGIT CLUB</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#12122a;border-radius:16px;border:1px solid rgba(124,111,255,0.2);overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a3a,#0d0d20);padding:32px 40px;text-align:center;border-bottom:1px solid rgba(124,111,255,0.15);">
              <div style="font-size:28px;font-weight:900;letter-spacing:2px;color:#7c6fff;">LEGIT CLUB</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;letter-spacing:1px;">SECURE VERIFICATION</div>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="color:rgba(255,255,255,0.8);font-size:15px;margin:0 0 24px;line-height:1.6;">Your one-time verification code is:</p>
              <div style="background:rgba(124,111,255,0.1);border:2px solid rgba(124,111,255,0.4);border-radius:12px;padding:24px;text-align:center;margin:0 0 28px;">
                <div style="font-size:48px;font-weight:900;letter-spacing:12px;color:#7c6fff;font-family:'Courier New',monospace;">${otp}</div>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:rgba(245,200,66,0.08);border:1px solid rgba(245,200,66,0.2);border-radius:8px;padding:14px 16px;">
                    <p style="color:#f5c842;font-size:13px;margin:0;line-height:1.5;">
                      ⏱ This code expires in <strong>${expiryMinutes} minutes</strong>.<br>
                      🔒 Never share this code with anyone, including LEGIT CLUB staff.
                    </p>
                  </td>
                </tr>
              </table>
              <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;line-height:1.6;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#0d0d20;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="color:rgba(255,255,255,0.25);font-size:11px;margin:0;">
                © ${new Date().getFullYear()} LEGIT CLUB · This is an automated message, do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function sendOtpEmail(toEmail, otp, expiryMinutes = 5) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY must be set in environment variables');
  }

  const payload = JSON.stringify({
    from:    'LEGIT CLUB <noreply@legitclub.xyz>',
    to:      [toEmail],
    subject: `${otp} — Your LEGIT CLUB verification code`,
    text:    `Your LEGIT CLUB verification code is: ${otp}\n\nExpires in ${expiryMinutes} minutes. Do not share this code.`,
    html:    buildOtpEmailHtml(otp, expiryMinutes),
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data);
          logger.info(`[emailService] OTP sent to ${toEmail} — id: ${parsed.id}`);
          resolve({ success: true, id: parsed.id });
        } else {
          logger.error(`[emailService] Resend API error ${res.statusCode}: ${data}`);
          reject(new Error(`Resend API error: ${res.statusCode} — ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      logger.error(`[emailService] Request failed: ${err.message}`);
      reject(err);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Resend API request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

async function verifyEmailService() {
  if (!process.env.RESEND_API_KEY) {
    logger.info('[emailService] RESEND_API_KEY not set — email OTP disabled');
    return false;
  }
  logger.info('[emailService] ✅ Resend HTTP API ready');
  return true;
}

module.exports = { sendOtpEmail, verifyEmailService };