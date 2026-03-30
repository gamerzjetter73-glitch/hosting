const axios = require('axios');
const { logger } = require('../middleware/logger');

/**
 * Send OTP via Fast2SMS using the dedicated OTP route (DLT-compliant, cheapest route).
 * 
 * Fast2SMS OTP route docs:
 *   POST https://www.fast2sms.com/dev/bulkV2
 *   route: "otp"   ← this IS the OTP route (not quick/promotional)
 *   variables_values: the OTP digits (numeric only)
 *   numbers: comma-separated 10-digit mobile numbers
 *
 * The API key is read from FAST2SMS_API_KEY in .env
 */
async function sendOTP(phone, otp) {
  try {
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[sms] DEV mode — OTP for ${phone}: ${otp} (not sent)`);
      return true;
    }

    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) {
      logger.warn('[sms] FAST2SMS_API_KEY not set — OTP SMS skipped');
      return false;
    }

    // Clean the phone number — only last 10 digits
    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

    const { data } = await axios.get('https://www.fast2sms.com/dev/bulkV2', {
      params: {
        authorization: apiKey,
        route: 'otp',               // OTP route (not quick/promotional)
        variables_values: String(otp),
        flash: 0,
        numbers: cleanPhone,
      },
      timeout: 10000,
    });

    if (data && data.return === true) {
      logger.info(`[sms] OTP sent to ${cleanPhone} via Fast2SMS OTP route`);
      return true;
    } else {
      logger.error(`[sms] Fast2SMS error for ${cleanPhone}: ${JSON.stringify(data)}`);
      return false;
    }
  } catch (err) {
    logger.error(`[sms] Failed to send OTP to ${phone}: ${err.message}`);
    return false;
  }
}

/**
 * Legacy wrapper — kept so existing calls to sendSMS() still work.
 * Extracts the numeric OTP from the message and calls sendOTP().
 */
async function sendSMS(phone, message) {
  // Extract 6-digit OTP from message like "Your OTP is 123456. Valid for 10 minutes."
  const match = message.match(/\b(\d{4,8})\b/);
  const otp = match ? match[1] : null;

  if (!otp) {
    // Fallback: try to send as plain message via quick route (dev only)
    logger.warn(`[sms] sendSMS called with no extractable OTP — message: "${message}"`);
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[sms] DEV fallback — would send to ${phone}: ${message}`);
    }
    return;
  }

  await sendOTP(phone, otp);
}

module.exports = { sendSMS, sendOTP };
