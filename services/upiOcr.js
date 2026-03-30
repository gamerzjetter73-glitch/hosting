const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');

function normalizeText(t) {
  return String(t || '')
    .replace(/\u20B9/g, '₹')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

function compact(t) {
  return normalizeText(t).toUpperCase().replace(/\s+/g, '');
}

function extractAmountCandidates(text) {
  // Captures 100, 100.00, ₹100, INR 100 etc.
  const raw = String(text || '');
  const matches = raw.match(/(?:₹|INR|RS\.?|AMOUNT[:\s]*)\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/gi) || [];
  const nums = [];
  for (const m of matches) {
    const n = m.replace(/[^0-9.]/g, '');
    const v = parseFloat(n);
    if (!isNaN(v)) nums.push(v);
  }
  return nums;
}

async function runOcrOnImage(absPath) {
  const buf = fs.readFileSync(absPath);
  const res = await Tesseract.recognize(buf, 'eng', {
    logger: () => {},
  });
  return normalizeText(res?.data?.text || '');
}

function verifyOcr({ ocrText, utr, vpa, amount }) {
  const c = compact(ocrText);
  const utrC = compact(utr);
  const vpaC = compact(vpa);

  const hasUtr = utrC && c.includes(utrC);
  const hasVpa = vpaC && c.includes(vpaC);

  // Amount: accept exact integer or 2-decimal formats found in OCR
  const candidates = extractAmountCandidates(ocrText);
  const target = parseFloat(amount);
  const hasAmount = candidates.some(v => Math.abs(v - target) < 0.01);

  // Strong match requires UTR + VPA + amount.
  // Some screenshots may not include VPA; we allow a weaker match and keep pending.
  if (hasUtr && hasVpa && hasAmount) return { verdict: 'match', confidence: 'high' };
  if (hasUtr && hasAmount) return { verdict: 'match', confidence: 'medium' };
  if (hasUtr) return { verdict: 'match', confidence: 'low' };
  return { verdict: 'no_match', confidence: 'none' };
}

module.exports = {
  runOcrOnImage,
  verifyOcr,
  normalizeText,
  compact,
};

