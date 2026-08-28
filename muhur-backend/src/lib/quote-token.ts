import crypto from "node:crypto";

export type QuoteAction = "accept" | "reject";

export function signQuoteToken(orderId: string, action: QuoteAction, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}:${action}`).digest("hex");
}

export function verifyQuoteToken(
  orderId: string,
  action: QuoteAction,
  token: string,
  secret: string
): boolean {
  const expected = signQuoteToken(orderId, action, secret);
  const expectedBuf = Buffer.from(expected, "hex");
  const tokenBuf = Buffer.from(token, "hex");

  if (expectedBuf.length !== tokenBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, tokenBuf);
}
