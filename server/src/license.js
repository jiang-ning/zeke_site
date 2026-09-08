'use strict';

const crypto = require('crypto');

/**
 * Build a license key in the same format the desktop app verifies in
 * zeke/src/index.js verifyLicense(): base64(JSON payload) + '.' + base(signature),
 * where the signature is computed over the raw (decodeed) JSON string.
 */
function generateLicenseKey(privateKeyPem, name, email) {
  if (!privateKeyPem) {
    throw new Error('LICENSE_PRIVATE_KEY is not configured.');
  }

  const payload = JSON.stringify({ name, email });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64');

  const signer = crypto.createSign('SHA256');
  signer.update(payload);
  signer.end();
  const signatureB64 = signer.sign(privateKeyPem).toString('base64');

  return `${payloadB64}.${signatureB64}`;
}

module.exports = { generateLicenseKey };
