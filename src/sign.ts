// The enforcing layer. Wrap the function that actually signs the payment (e.g. a viem account's
// signTypedData call). signFn runs ONLY when the verdict is "allow", so an agent that has been
// tricked cannot reach the signature by skipping a check: there is no other path to the signer.
import { checkAndSave, type Paths } from "./guard.ts";
import type { Decision, PaymentRequest } from "./policy.ts";

export type Guarded<T> = { decision: Decision & { id: string }; signed: boolean; result?: T };

export async function guardedSign<T>(req: PaymentRequest, signFn: () => Promise<T>, paths: Paths): Promise<Guarded<T>> {
  const decision = checkAndSave(req, paths); // recorded and saved BEFORE signing; a failed sign still counts toward caps
  if (decision.verdict !== "allow") return { decision, signed: false };
  return { decision, signed: true, result: await signFn() };
}
