'use strict';

const FASTSPRING_API_BASE = 'https://api.fastspring.com';

/**
 * Looks up an order server-side using FastSpring's Orders API so we never trust
 * order/customer details supplied directly by the browser.
 * 
 * NOTE: field names below (completed, reversed, customer.first/last/email) follow
 * FastSpring's documented Orders API shape. Verify against a real sandbox order
 * (Store > Orders > open an order > view raw data) before going live.
 */
async function getFastSpringOrder(orderId) {
  const username = process.env.FASTSPRING_API_USERNAME;
  const password = process.env.FASTSPRING_API_PASSWORD;

  if (!username || !password) {
    throw new Error('FastSpring API credentials are not configured.');
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  const response = await fetch(`${FASTSPRING_API_BASE}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    throw new Error(`FastSpring API returned ${response.status}`);
  }

  return response.json();
}

module.exports = { getFastSpringOrder };
