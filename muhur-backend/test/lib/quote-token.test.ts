import { describe, it, expect } from "vitest";
import { signQuoteToken, verifyQuoteToken } from "../../src/lib/quote-token";

describe("quote-token", () => {
  it("produces a token that verifies successfully for the same orderId, action, and secret", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "accept", token, "test-secret")).toBe(true);
  });

  it("fails verification when the action does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "reject", token, "test-secret")).toBe(false);
  });

  it("fails verification when the orderId does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-456", "accept", token, "test-secret")).toBe(false);
  });

  it("fails verification when the secret does not match", () => {
    const token = signQuoteToken("order-123", "accept", "test-secret");
    expect(verifyQuoteToken("order-123", "accept", token, "different-secret")).toBe(false);
  });

  it("fails verification for a malformed token instead of throwing", () => {
    expect(() =>
      verifyQuoteToken("order-123", "accept", "not-a-valid-hex-token!!", "test-secret")
    ).not.toThrow();
    expect(verifyQuoteToken("order-123", "accept", "not-a-valid-hex-token!!", "test-secret")).toBe(false);
  });
});
