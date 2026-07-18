import type { Context, Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k] = v;
  }

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  const sigHeader = req.headers.get("stripe-signature");
  const payload = await req.text();

  if (!webhookSecret || !sigHeader || !verifyStripeSignature(payload, sigHeader, webhookSecret)) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const quantity = parseInt(session.metadata?.quantity || "1", 10);

    const store = getStore("dxtransit-tickets");
    const current = (await store.get("sold", { type: "json" })) || 0;
    await store.setJSON("sold", current + quantity);
  }

  return new Response("ok", { status: 200 });
};

export const config: Config = {
  path: "/api/stripe-webhook",
};
