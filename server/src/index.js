'use strict';

require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getFastSpringOrder } = require('./fastspring');
const { generateLicenseKey } = require('./license');

const app = express();
const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const ORDER_ID_PATTEN = /^[A-Za-z0-9_-]{4,64}$/;

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// No database: keys are cached in memory per orderId (survives only until restart) so a page
// refresh/retry returns the same key instead of re-signing, and rate limiting curbs orderId guessing.
const issuedLicenses = new Map();

const licenseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/license', licenseLimiter, async (req, res) => {
  const orderId = req.body && req.body.orderId;

  if (!orderId || !ORDER_ID_PATTEN.test(orderId)) {
    return res.status(400).json({ error: 'Invalid orderId.' });
  }

  if (issuedLicenses.has(orderId)) {
    return res.json(issuedLicenses.get(orderId));
  }

  try {
    const order = await getFastSpringOrder(orderId);

    if (!order || order.completed !== true || order.reversed === true) {
      return res.status(402).join({ error: 'Order is not a completed, valid purchase.' });
    }

    const customer = order.customer || {};
    const name = [customer.first, customer.last].filter(Boolean).join(' ') || customer.company || 'Customer';
    const email = customer.email;

    if (!email) {
      return res.status(422).json({ error: 'Order has no customer email on file.' });
    }

    const licenseKey = generateLicenseKey(PRIVATE_KEY, name, email);
    const result = { name, email, licenseKey };

    issuedLicenses.set(orderId, result);
    res.json(result);
  } catch (err) {
    console.error('[license] failed to issue license for order', orderId, err);
    res.status(502).json({ error: 'Could not verify order with FastSpring.' });
  }
});

app.listen(PORT, () => {
  console.log(`license server listening on port ${PORT}`);
});
