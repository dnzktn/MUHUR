import { describe, it, expect, beforeAll } from "vitest";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("jwt", () => {
  it("round-trips a valid payload", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    const payload = verifyAuthToken(token);
    expect(payload.professionalId).toBe("abc-123");
    expect(payload.email).toBe("yagmur@muhur.com");
  });

  it("throws on a tampered token", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@muhur.com" });
    expect(() => verifyAuthToken(token + "tamper")).toThrow();
  });
});
