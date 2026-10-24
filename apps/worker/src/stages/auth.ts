import type { StageFn } from "./types.ts";
import { pretend } from "./stub.ts";

// auth: sign in once / vault (PRD §8.2). Owner: Sunjeet. Stub for now.
export const auth: StageFn = async (ctx) => {
  if (ctx.config.auth.mode === "public") return { skipped: true, message: "Public site: no sign-in needed" };
  await pretend(ctx);
  ctx.log(`Stub: pretended to sign in (${ctx.config.auth.mode})`, "warn");
};
