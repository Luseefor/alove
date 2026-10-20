import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const CLERK_ID_MAX = 200;

async function readBoundedRawBody(req: Request): Promise<string | null> {
  const body = req.body;
  if (body === null) {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > MAX_WEBHOOK_BYTES) {
      return null;
    }
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

const http = httpRouter();

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      return new Response("Missing webhook secret", { status: 503 });
    }

    const raw = await readBoundedRawBody(req);
    if (raw === null) {
      return new Response("Payload too large", { status: 413 });
    }

    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("Missing signature", { status: 400 });
    }

    try {
      new Webhook(secret).verify(raw, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch {
      return new Response("Invalid signature", { status: 401 });
    }

    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      return new Response("Bad payload", { status: 400 });
    }
    if (typeof event !== "object" || event === null) {
      return new Response("Bad payload", { status: 400 });
    }
    const type = (event as { type?: unknown }).type;
    if (type !== "user.deleted") {
      return new Response(null, { status: 200 });
    }
    const data = (event as { data?: unknown }).data;
    const clerkId =
      typeof data === "object" && data !== null
        ? (data as { id?: unknown }).id
        : undefined;
    if (
      typeof clerkId !== "string" ||
      clerkId.length === 0 ||
      clerkId.length > CLERK_ID_MAX
    ) {
      return new Response("Bad user id", { status: 400 });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.accountLifecycle.startUserCleanup,
      { clerkId },
    );
    return new Response(null, { status: 200 });
  }),
});

export default http;
