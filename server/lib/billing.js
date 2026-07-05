'use strict';

/**
 * billing.js — plan upgrades, with an optional Stripe Checkout path.
 *
 * Modes (LIVEARCH_BILLING):
 *   - unset / anything else → "direct": upgrades apply immediately (no payment).
 *     The honest stand-in for billing in self-host / dev.
 *   - "stripe" → create a Stripe Checkout Session; the plan is applied by the
 *     webhook (checkout.session.completed) after the customer pays.
 *
 * The Stripe SDK is an optional dependency, required lazily only in stripe mode.
 * `planChangeForEvent` is pure so the webhook → setPlan mapping is unit-tested
 * without contacting Stripe.
 */

const { createRequire } = require('module');
const { isPlan } = require('./plans');

// Resolve `stripe` through Node's real require at runtime, bypassing the
// bundler — otherwise webpack tries to resolve the (optional, maybe-absent)
// package at build time and fails even in the default no-Stripe mode.
const nodeRequire = createRequire(__filename);

function mode() {
  return process.env.LIVEARCH_BILLING === 'stripe' ? 'stripe' : 'direct';
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { const e = new Error('STRIPE_SECRET_KEY is not set'); e.code = 'BILLING_MISCONFIG'; throw e; }
  let Stripe;
  try { Stripe = nodeRequire('stripe'); }
  catch { const e = new Error('the `stripe` package is not installed (npm i stripe)'); e.code = 'BILLING_MISCONFIG'; throw e; }
  return new Stripe(key);
}

/** The configured Stripe Price id for a plan, or null. */
function priceFor(plan) {
  const map = { pro: process.env.STRIPE_PRICE_PRO, team: process.env.STRIPE_PRICE_TEAM };
  return map[plan] || null;
}

/**
 * Start a Stripe Checkout for `account` to move to `plan`. Returns the hosted
 * checkout URL for the CLI to open. Throws Error{code:'BILLING_MISCONFIG'} if
 * Stripe isn't fully configured.
 */
async function createCheckout({ account, plan, origin }) {
  const price = priceFor(plan);
  if (!price) {
    const e = new Error(`no Stripe price configured for "${plan}" (set STRIPE_PRICE_${plan.toUpperCase()})`);
    e.code = 'BILLING_MISCONFIG'; throw e;
  }
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: account.id,
    metadata: { accountId: account.id, plan },
    subscription_data: { metadata: { accountId: account.id, plan } },
    success_url: `${origin}/billing/success?plan=${plan}`,
    cancel_url: `${origin}/billing/cancel`,
  });
  return session.url;
}

/**
 * Verify a Stripe webhook payload and return the parsed event. When
 * STRIPE_WEBHOOK_SECRET is set the signature is checked; otherwise (dev) the
 * body is parsed as-is.
 */
function verifyWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    return stripeClient().webhooks.constructEvent(rawBody, signature, secret);
  }
  return JSON.parse(rawBody);
}

/**
 * Pure mapping: a Stripe event → the plan change to apply, or null.
 *  - checkout.session.completed        → the purchased plan
 *  - customer.subscription.deleted     → downgrade to Free
 */
function planChangeForEvent(event) {
  if (!event || !event.type) return null;
  const obj = (event.data && event.data.object) || {};
  if (event.type === 'checkout.session.completed') {
    const accountId = (obj.metadata && obj.metadata.accountId) || obj.client_reference_id;
    const plan = obj.metadata && obj.metadata.plan;
    if (accountId && isPlan(plan)) return { accountId, plan };
  }
  if (event.type === 'customer.subscription.deleted') {
    const accountId = obj.metadata && obj.metadata.accountId;
    if (accountId) return { accountId, plan: 'free' };
  }
  return null;
}

module.exports = { mode, priceFor, createCheckout, verifyWebhook, planChangeForEvent };
