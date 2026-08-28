import twilio from "twilio";

export interface SendWhatsAppInput {
  to: string;
  text: string;
}

export interface WhatsAppProvider {
  send(input: SendWhatsAppInput): Promise<void>;
}

export class TwilioWhatsAppService implements WhatsAppProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;
  private client: ReturnType<typeof twilio> | null = null;

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  private getClient(): ReturnType<typeof twilio> {
    if (!this.client) {
      this.client = twilio(this.accountSid, this.authToken);
    }
    return this.client;
  }

  async send(input: SendWhatsAppInput): Promise<void> {
    await this.getClient().messages.create({
      from: this.fromNumber,
      to: `whatsapp:${input.to}`,
      body: input.text,
    });
  }
}
