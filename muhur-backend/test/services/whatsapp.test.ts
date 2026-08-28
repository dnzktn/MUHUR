import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: createMock } })),
}));

import { TwilioWhatsAppService } from "../../src/services/whatsapp.service";

describe("TwilioWhatsAppService", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("sends a WhatsApp message with the whatsapp: prefix on the recipient", async () => {
    createMock.mockResolvedValue({ sid: "SM123" });

    const service = new TwilioWhatsAppService("fake-sid", "fake-token", "whatsapp:+14155238886");
    await service.send({ to: "+905551234567", text: "Yeni sipariş geldi." });

    expect(createMock).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+905551234567",
      body: "Yeni sipariş geldi.",
    });
  });

  it("propagates an error when the Twilio API call fails", async () => {
    createMock.mockRejectedValue(new Error("Invalid phone number"));

    const service = new TwilioWhatsAppService("fake-sid", "fake-token", "whatsapp:+14155238886");
    await expect(
      service.send({ to: "+905551234567", text: "Test" })
    ).rejects.toThrow("Invalid phone number");
  });
});
