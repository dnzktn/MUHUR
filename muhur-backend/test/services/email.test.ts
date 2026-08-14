import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

import { ResendEmailService } from "../../src/services/email.service";

describe("ResendEmailService", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends an email with the fixed sender address", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-123" }, error: null });

    const service = new ResendEmailService("fake-key");
    await service.send({
      to: "musteri@example.com",
      subject: "Çeviri Belgeniz Hazır",
      text: "Merhaba, çeviriniz hazır.",
    });

    expect(sendMock).toHaveBeenCalledWith({
      from: "onboarding@resend.dev",
      to: "musteri@example.com",
      subject: "Çeviri Belgeniz Hazır",
      text: "Merhaba, çeviriniz hazır.",
    });
  });

  it("throws with the Resend error message when the API returns an error", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "domain is not verified" },
    });

    const service = new ResendEmailService("fake-key");
    await expect(
      service.send({
        to: "musteri@example.com",
        subject: "Test",
        text: "Test",
      })
    ).rejects.toThrow("domain is not verified");
  });
});
