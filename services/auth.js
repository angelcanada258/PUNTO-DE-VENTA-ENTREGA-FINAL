const crypto = require('node:crypto');

const KEY_LENGTH = 32;
const ITERATIONS = 100_000;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, ITERATIONS, KEY_LENGTH, 'sha256');
  return `${salt}:${hash.toString('hex')}`;
}

function verifyPin(pin, stored) {
  const [salt, hashHex] = String(stored || '').split(':');
  if (!salt || !hashHex) return false;
  const hash = crypto.pbkdf2Sync(String(pin), salt, ITERATIONS, KEY_LENGTH, 'sha256');
  const stored_ = Buffer.from(hashHex, 'hex');
  if (stored_.length !== hash.length) return false;
  return crypto.timingSafeEqual(stored_, hash);
}

module.exports = { hashPin, verifyPin };
