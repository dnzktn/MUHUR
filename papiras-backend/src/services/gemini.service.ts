import { GoogleGenerativeAI } from "@google/generative-ai";

export interface TranslateInput {
  text?: string;
  fileBuffer?: Buffer;
  mimeType?: string;
  sourceLang: string;
  targetLang: string;
}

export interface SuggestInput {
  text: string;
  context: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslationProvider {
  translate(input: TranslateInput): Promise<string>;
  suggest(input: SuggestInput): Promise<string[]>;
}

const MODEL_NAME = "gemini-flash-latest";

export class GeminiService implements TranslationProvider {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async translate(input: TranslateInput): Promise<string> {
    if (!input.text && !input.fileBuffer) {
      throw new Error("translate requires either text or fileBuffer");
    }

    const model = this.client.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `Translate the following official document from ${input.sourceLang} to ${input.targetLang}. Return only the translated text, no commentary or notes.`;

    const parts: unknown[] = [{ text: prompt }];
    if (input.fileBuffer) {
      parts.push({
        inlineData: {
          data: input.fileBuffer.toString("base64"),
          mimeType: input.mimeType ?? "application/octet-stream",
        },
      });
    } else {
      parts.push({ text: input.text });
    }

    const result = await model.generateContent(parts as never);
    return result.response.text();
  }

  async suggest(input: SuggestInput): Promise<string[]> {
    const model = this.client.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `Given this sentence in ${input.sourceLang}: "${input.context}"\n\nProvide 3 alternative ${input.targetLang} translations for this specific phrase: "${input.text}"\n\nReturn only a JSON array of 3 strings, no other text.`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  }
}
