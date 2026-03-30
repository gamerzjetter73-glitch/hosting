// ── scripts/backup.js  v14 ──
// Backs up MongoDB to local disk, then optionally uploads to S3-compatible storage.
//
// Local only (default):   node scripts/backup.js
// With S3 upload:         Set S3_BUCKET + S3_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in .env
//
// S3-compatible services that work: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { execSync, spawnSync } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const https    = require('https');
const crypto   = require('crypto');

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://127.0.0.1:27017/club91';
const KEEP_LAST  = 10;

// S3 config (all optional — local backup works without these)
const S3_BUCKET    = process.env.S3_BUCKET    || '';
const S3_REGION    = process.env.S3_REGION    || 'ap-south-1';
const AWS_KEY      = process.env.AWS_ACCESS_KEY_ID     || '';
const AWS_SECRET   = process.env.AWS_SECRET_ACCESS_KEY || '';
const S3_ENDPOINT  = process.env.S3_ENDPOINT  || `https://s3.${S3_REGION}.amazonaws.com`; // override for R2/B2/Spaces

function log(msg)  { console.log(`[Backup] ${msg}`); }
function warn(msg) { console.warn(`[Backup] ⚠ ${msg}`); }
function err(msg)  { console.error(`[Backup] ❌ ${msg}`); }

// ── Local backup ─────────────────────────────────────────────────────────────
function runBackup() {
  const absDir = path.resolve(__dirname, '..', BACKUP_DIR);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(absDir, `backup_${ts}`);

  // Try mongodump first, fall back to JSON export
  const hasMongodum = spawnSync('mongodump', ['--version'], { stdio: 'ignore' }).status === 0;

  if (hasMongodum) {
    try {
      execSync(`mongodump --uri="${MONGO_URI}" --out="${dest}" --quiet`);
      log(`✅ mongodump → ${dest}`);
    } catch (e) {
      warn('mongodump failed — trying JSON fallback');
      return jsonBackup(dest).then(() => pruneOld(absDir));
    }
  } else {
    warn('mongodump not installed — using JSON export');
    return jsonBackup(dest).then(() => pruneOld(absDir)).then(() => maybeUploadToS3(dest, ts));
  }

  pruneOld(absDir);
  maybeUploadToS3(dest, ts);
}

// ── JSON fallback export ──────────────────────────────────────────────────────
async function jsonBackup(dest) {
  const mongoose = require('mongoose');
  try {
    await mongoose.connect(MONGO_URI);
    fs.mkdirSync(dest, { recursive: true });
    const cols = await mongoose.connection.db.listCollections().toArray();
    for (const col of cols) {
      const docs = await mongoose.connection.db.collection(col.name).find({}).toArray();
      fs.writeFileSync(path.join(dest, col.name + '.json'), JSON.stringify(docs, null, 2));
      log(`  Exported ${col.name} (${docs.length} docs)`);
    }
    log(`✅ JSON export → ${dest}`);
    await mongoose.disconnect();
  } catch (e) {
    err('JSON export failed: ' + e.message);
  }
}

// ── Prune old backups ────────────────────────────────────────────────────────
function pruneOld(absDir) {
  const all = fs.readdirSync(absDir)
    .filter(f => f.startsWith('backup_'))
    .sort().reverse();
  if (all.length > KEEP_LAST) {
    all.slice(KEEP_LAST).forEach(old => {
      fs.rmSync(path.join(absDir, old), { recursive: true, force: true });
      log(`🗑 Deleted old backup: ${old}`);
    });
  }
}

// ── S3 upload (AWS Signature V4, no SDK needed) ───────────────────────────────
async function maybeUploadToS3(localPath, ts) {
  if (!S3_BUCKET || !AWS_KEY || !AWS_SECRET) {
    log('S3 not configured — skipping offsite upload (set S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env)');
    return;
  }

  // Zip the backup folder first
  const zipPath = localPath + '.zip';
  try {
    execSync(`cd "${path.dirname(localPath)}" && zip -rq "${zipPath}" "${path.basename(localPath)}"`);
    log(`Zipped → ${zipPath}`);
  } catch (e) {
    warn('zip failed — uploading unzipped folder is not supported. Install zip.');
    return;
  }

  const fileContent = fs.readFileSync(zipPath);
  const key         = `backups/backup_${ts}.zip`;
  const host        = `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
  const endpoint    = S3_ENDPOINT.includes('amazonaws') ? null : S3_ENDPOINT; // custom endpoint for R2/B2

  try {
    await s3Put(host, key, fileContent, endpoint);
    log(`☁️  Uploaded to S3: s3://${S3_BUCKET}/${key}`);
  } catch (e) {
    err('S3 upload failed: ' + e.message);
  }
}

// Minimal AWS S3 PutObject — Signature V4
function s3Put(host, key, body, endpoint) {
  return new Promise((resolve, reject) => {
    const method  = 'PUT';
    const service = 's3';
    const now     = new Date();
    const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // 20240101T120000Z
    const dateKey = dateStr.slice(0, 8); // 20240101

    const contentHash = crypto.createHash('sha256').update(body).digest('hex');
    const target      = endpoint ? new URL(`${endpoint}/${S3_BUCKET}/${key}`) : null;
    const reqHost     = target ? target.hostname : host;
    const reqPath     = target ? `/${key}` : `/${key}`;

    const headers = {
      'Host':                reqHost,
      'Content-Type':        'application/zip',
      'Content-Length':      String(body.length),
      'x-amz-content-sha256': contentHash,
      'x-amz-date':          dateStr,
    };

    // Canonical request
    const signedHeaders = Object.keys(headers).map(h => h.toLowerCase()).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(h => `${h.toLowerCase()}:${headers[h]}`).join('\n') + '\n';
    const canonicalReq = [method, reqPath, '', canonicalHeaders, signedHeaders, contentHash].join('\n');

    // String to sign
    const scope = `${dateKey}/${S3_REGION}/${service}/aws4_request`;
    const strToSign = ['AWS4-HMAC-SHA256', dateStr, scope,
      crypto.createHash('sha256').update(canonicalReq).digest('hex')].join('\n');

    // Signing key
    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
    const sigKey = hmac(hmac(hmac(hmac('AWS4' + AWS_SECRET, dateKey), S3_REGION), service), 'aws4_request');
    const sig = crypto.createHmac('sha256', sigKey).update(strToSign).digest('hex');

    headers['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${AWS_KEY}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

    const opts = { hostname: reqHost, path: reqPath, method, headers };
    const req  = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error(`S3 ${res.statusCode}: ${raw}`)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

if (require.main === module) runBackup();
module.exports = { runBackup };
