const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_SALT = 'ros-integration-token-vault-v1';

function getVaultKey() {
  const fromEnv = process.env.INTEGRATION_TOKEN_VAULT_KEY;
  if (fromEnv && String(fromEnv).trim().length >= 16) {
    return crypto.createHash('sha256').update(String(fromEnv).trim()).digest();
  }
  const fallback = process.env.ADMIN_KEY || process.env.NEON_DATABASE_URL;
  if (fallback) {
    return crypto.scryptSync(String(fallback), SCRYPT_SALT, 32);
  }
  return null;
}

function canStoreIntegrationTokens() {
  return getVaultKey() != null;
}

function encryptIntegrationToken(plain) {
  const key = getVaultKey();
  if (!key) {
    throw new Error(
      'Set INTEGRATION_TOKEN_VAULT_KEY on Railway (or ADMIN_KEY / NEON_DATABASE_URL) to store retrievable tokens.'
    );
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptIntegrationToken(ciphertext) {
  if (!ciphertext || !getVaultKey()) return null;
  try {
    const buf = Buffer.from(String(ciphertext), 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, getVaultKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = {
  canStoreIntegrationTokens,
  encryptIntegrationToken,
  decryptIntegrationToken,
};
