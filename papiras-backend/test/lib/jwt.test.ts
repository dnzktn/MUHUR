import { describe, it, expect, beforeAll } from "vitest";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
});

describe("jwt", () => {
  it("round-trips a valid payload", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@papiras.com", tenantId: "tenant-1" });
    const payload = verifyAuthToken(token);
    expect(payload.professionalId).toBe("abc-123");
    expect(payload.email).toBe("yagmur@papiras.com");
    expect(payload.tenantId).toBe("tenant-1");
  });

  it("throws on a tampered token", () => {
    const token = signAuthToken({ professionalId: "abc-123", email: "yagmur@papiras.com", tenantId: "tenant-1" });
    expect(() => verifyAuthToken(token + "tamper")).toThrow();
  });
});
