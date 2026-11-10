// Team subscriptions with Stripe Checkout. A team upgrades to Pro from the
// app; Stripe tells us the outcome with a signed webhook, which is the only
// thing that changes a team's plan.
//
// Configuration:
//   STRIPE_SECRET_KEY       sk_live_… / sk_test_…
//   STRIPE_WEBHOOK_SECRET   whsec_… for the /api/billing/webhook endpoint
//   STRIPE_PRO_PRICE_ID     the recurring price for the Pro plan
//   PUBLIC_URL              where to send people back after checkout
import express from "express";
import Stripe from "stripe";
import { requireUser } from "./accounts.js";

export function isBillingEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PRO_PRICE_ID);
}

/** Plans and what each allows per user per day. */
export const plans = {
  free: { messagesPerDay: 50, tools: false },
  pro: { messagesPerDay: 2000, tools: true },
};

export function createBilling({ db, logger }) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:3001";

  // Mounted before the JSON body parser: the signature is over the raw body.
  const webhook = express.Router();
  webhook.post("/api/billing/webhook", express.raw({ type: "application/json" }), (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn("Stripe webhook rejected", { error: err.message });
      return res.status(400).send("Invalid signature");
    }
    const object = event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        const teamId = Number(object.client_reference_id);
        db.prepare("UPDATE teams SET plan = 'pro', stripe_customer_id = ? WHERE id = ?").run(object.customer, teamId);
        logger.info("Team upgraded to Pro", { teamId });
        break;
      }
      case "customer.subscription.deleted": {
        db.prepare("UPDATE teams SET plan = 'free' WHERE stripe_customer_id = ?").run(object.customer);
        logger.info("Subscription ended", { customer: object.customer });
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  });

  const router = express.Router();

  router.post("/api/billing/checkout", requireUser, async (req, res) => {
    const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.user.team_id);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      client_reference_id: String(team.id),
      ...(team.stripe_customer_id ? { customer: team.stripe_customer_id } : { customer_email: req.user.email || undefined }),
      success_url: `${publicUrl}/?billing=success`,
      cancel_url: `${publicUrl}/?billing=cancelled`,
    });
    res.json({ url: checkout.url });
  });

  router.post("/api/billing/portal", requireUser, async (req, res) => {
    const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.user.team_id);
    if (!team?.stripe_customer_id) return res.status(400).json({ error: "No subscription to manage" });
    const portal = await stripe.billingPortal.sessions.create({ customer: team.stripe_customer_id, return_url: publicUrl });
    res.json({ url: portal.url });
  });

  /** How many messages a user has sent today, against their team's plan. */
  function allowance(user) {
    const team = db.prepare("SELECT plan FROM teams WHERE id = ?").get(user.team_id);
    const plan = plans[team?.plan] ?? plans.free;
    const { used } = db.prepare("SELECT COUNT(*) AS used FROM usage WHERE user_id = ? AND created_at >= date('now')").get(user.id);
    return { plan: team?.plan ?? "free", used, limit: plan.messagesPerDay, tools: plan.tools };
  }

  return { webhook, router, allowance };
}
