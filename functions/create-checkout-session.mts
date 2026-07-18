import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const TICKET_PRICE_CENTS = 3000; // €30.00
const CAPACITY = 51;
const MAX_PER_ORDER = 4;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let quantity = 1;
  try {
    const body = await req.json();
    if (body && body.quantity) {
      quantity = Math.max(1, Math.min(MAX_PER_ORDER, parseInt(body.quantity, 10) || 1));
    }
  } catch {
    // no JSON body sent, default to 1 ticket
  }

  const store = getStore("dxtransit-tickets");
  const sold = (await store.get("sold", { type: "json" })) || 0;
  const remaining = CAPACITY - sold;

  if (remaining <= 0) {
    return new Response(JSON.stringify({ error: "sold_out" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (quantity > remaining) {
    quantity = remaining;
  }

  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return new Response(JSON.stringify({ error: "Payments are not configured yet." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = new URL(req.url).origin;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("ui_mode", "embedded");
  params.set("return_url", `${origin}/?session_id={CHECKOUT_SESSION_ID}`);
  params.set("line_items[0][quantity]", String(quantity));
  params.set("line_items[0][price_data][currency]", "eur");
  params.set("line_items[0][price_data][unit_amount]", String(TICKET_PRICE_CENTS));
  params.set(
    "line_items[0][price_data][product_data][name]",
    "DXTransit Bus Ticket for District X, 12 Sept 2026"
  );
  params.set("metadata[quantity]", String(quantity));

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    return new Response(
      JSON.stringify({ error: session?.error?.message || "Stripe error creating checkout session." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/create-checkout-session",
};
