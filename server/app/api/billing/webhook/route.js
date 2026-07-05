import { setPlan } from '../../../../lib/accounts';
import { verifyWebhook, planChangeForEvent } from '../../../../lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/billing/webhook — Stripe events.
// On checkout.session.completed the purchased plan is applied to the account;
// on customer.subscription.deleted the account is downgraded to Free.
// Configure this URL in the Stripe dashboard and set STRIPE_WEBHOOK_SECRET.
export async function POST(req) {
  const raw = await req.text();
  const signature = req.headers.get('stripe-signature') || '';

  let event;
  try {
    event = verifyWebhook(raw, signature);
  } catch (e) {
    return Response.json({ error: 'invalid webhook: ' + e.message }, { status: 400 });
  }

  const change = planChangeForEvent(event);
  if (change) {
    try { await setPlan(change.accountId, change.plan); }
    catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  }
  // Always 200 so Stripe doesn't retry events we intentionally ignore.
  return Response.json({ received: true, applied: !!change });
}
