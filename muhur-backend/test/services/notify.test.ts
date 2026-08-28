import { describe, it, expect, vi } from "vitest";
import { notifyProfessional } from "../../src/services/notify.service";
import type { EmailProvider } from "../../src/services/email.service";
import type { WhatsAppProvider } from "../../src/services/whatsapp.service";

describe("notifyProfessional", () => {
  it("sends both an email and a WhatsApp message with the same body", async () => {
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = { send: vi.fn().mockResolvedValue(undefined) };

    const results = await notifyProfessional(
      emailService,
      whatsappService,
      "yagmur@muhur.com",
      "+905551234567",
      { subject: "Yeni Sipariş", body: "Yeni sipariş: Ahmet Yılmaz — TR→EN." }
    );

    expect(emailService.send).toHaveBeenCalledWith({
      to: "yagmur@muhur.com",
      subject: "Yeni Sipariş",
      text: "Yeni sipariş: Ahmet Yılmaz — TR→EN.",
    });
    expect(whatsappService.send).toHaveBeenCalledWith({
      to: "+905551234567",
      text: "Yeni sipariş: Ahmet Yılmaz — TR→EN.",
    });
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("reports a rejected result for the channel that fails, without throwing", async () => {
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = {
      send: vi.fn().mockRejectedValue(new Error("Twilio error")),
    };

    const results = await notifyProfessional(
      emailService,
      whatsappService,
      "yagmur@muhur.com",
      "+905551234567",
      { subject: "Test", body: "Test body" }
    );

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
  });

  it("times out a channel that never resolves, rather than hanging forever", async () => {
    vi.useFakeTimers();
    const emailService: EmailProvider = { send: vi.fn().mockResolvedValue(undefined) };
    const whatsappService: WhatsAppProvider = { send: vi.fn(() => new Promise<void>(() => {})) };

    const resultsPromise = notifyProfessional(
      emailService,
      whatsappService,
      "yagmur@muhur.com",
      "+905551234567",
      { subject: "Test", body: "Test body" }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const results = await resultsPromise;

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");

    vi.useRealTimers();
  });
});
