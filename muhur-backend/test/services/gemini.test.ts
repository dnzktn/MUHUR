import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () {
    return { getGenerativeModel: getGenerativeModelMock };
  }),
}));

import { GeminiService } from "../../src/services/gemini.service";

describe("GeminiService", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("translates plain text and returns the response text", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => "Translated text" },
    });

    const service = new GeminiService("fake-key");
    const result = await service.translate({
      text: "Merhaba dünya",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toBe("Translated text");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("translates a file buffer via inlineData", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => "Translated from image" },
    });

    const service = new GeminiService("fake-key");
    const result = await service.translate({
      fileBuffer: Buffer.from("fake-pdf-bytes"),
      mimeType: "application/pdf",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toBe("Translated from image");
    const callArgs = generateContentMock.mock.calls[0][0];
    expect(callArgs.some((part: any) => part.inlineData)).toBe(true);
  });

  it("throws when neither text nor fileBuffer is given", async () => {
    const service = new GeminiService("fake-key");
    await expect(
      service.translate({ sourceLang: "TR", targetLang: "EN" } as any)
    ).rejects.toThrow();
  });

  it("returns parsed suggestions", async () => {
    generateContentMock.mockResolvedValue({
      response: { text: () => '["Hello", "Hi", "Greetings"]' },
    });

    const service = new GeminiService("fake-key");
    const result = await service.suggest({
      text: "Merhaba",
      context: "Merhaba dünya",
      sourceLang: "TR",
      targetLang: "EN",
    });

    expect(result).toEqual(["Hello", "Hi", "Greetings"]);
  });
});
