import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<void>;
}

const FROM_ADDRESS = "onboarding@resend.dev";

export class ResendEmailService implements EmailProvider {
  private apiKey: string;
  private client: Resend | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private getClient(): Resend {
    if (!this.client) {
      this.client = new Resend(this.apiKey);
    }
    return this.client;
  }

  async send(input: SendEmailInput): Promise<void> {
    const result = await this.getClient().emails.send({
      from: FROM_ADDRESS,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    if (result.error) {
      throw new Error(result.error.message);
    }
  }
}
