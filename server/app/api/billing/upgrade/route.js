import { account } from '../../../../lib/auth';
import { setPlan } from '../../../../lib/accounts';
import { PLANS, isPlan, planFor } from '../../../../lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/billing/upgrade  { plan }   (Authorization: Bearer <token>)
//
// Changes the caller's plan. In this self-host / dev build the switch is
// immediate (no payment) — the honest stand-in for billing, like the
// filesystem-vs-Postgres storage. In production this endpoint would create a
// Stripe Checkout session and the plan would be set by the Stripe webhook
// instead; gate that with a LIVEARCH_BILLING=stripe flag.
export async function POST(req) {
  const acc = await account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch { /* plan required below */ }
  const plan = body && body.plan;
  if (!isPlan(plan)) {
    return Response.json({ error: 'unknown plan; choose one of: ' + Object.keys(PLANS).join(', '), code: 'BAD_PLAN' }, { status: 400 });
  }

  if (process.env.LIVEARCH_BILLING === 'stripe') {
    // Where a real integration would return a Checkout URL for `plan`.
    return Response.json({ error: 'Stripe checkout is not wired up on this server', code: 'BILLING_UNAVAILABLE' }, { status: 501 });
  }

  const updated = await setPlan(acc.id, plan);
  if (!updated) return Response.json({ error: 'account not found' }, { status: 404 });
  const limits = planFor(updated);
  return Response.json({ ok: true, handle: updated.handle, plan: updated.plan, price: limits.price, limits });
}
