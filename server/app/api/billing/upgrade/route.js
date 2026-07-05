import { account } from '../../../../lib/auth';
import { setPlan } from '../../../../lib/accounts';
import { PLANS, isPlan, planFor } from '../../../../lib/plans';
import { mode, createCheckout } from '../../../../lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/billing/upgrade  { plan }   (Authorization: Bearer <token>)
//
// direct mode (default): applies the plan immediately (no payment).
// stripe mode (LIVEARCH_BILLING=stripe): returns a Stripe Checkout URL; the
// plan is applied by /api/billing/webhook once the customer pays.
export async function POST(req) {
  const acc = await account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch { /* plan required below */ }
  const plan = body && body.plan;
  if (!isPlan(plan)) {
    return Response.json({ error: 'unknown plan; choose one of: ' + Object.keys(PLANS).join(', '), code: 'BAD_PLAN' }, { status: 400 });
  }

  if (mode() === 'stripe') {
    try {
      const origin = new URL(req.url).origin;
      const checkoutUrl = await createCheckout({ account: acc, plan, origin });
      return Response.json({ ok: true, checkout: true, checkoutUrl, plan });
    } catch (e) {
      const status = e.code === 'BILLING_MISCONFIG' ? 501 : 502;
      return Response.json({ error: e.message, code: e.code || 'BILLING_ERROR' }, { status });
    }
  }

  // direct mode
  const updated = await setPlan(acc.id, plan);
  if (!updated) return Response.json({ error: 'account not found' }, { status: 404 });
  const limits = planFor(updated);
  return Response.json({ ok: true, handle: updated.handle, plan: updated.plan, price: limits.price, limits });
}
