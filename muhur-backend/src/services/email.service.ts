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
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(input: SendEmailInput): Promise<void> {
    const result = await this.client.emails.send({
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
