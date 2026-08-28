import type { EmailProvider } from "./email.service";
import type { WhatsAppProvider } from "./whatsapp.service";

export interface NotifyMessage {
  subject: string;
  body: string;
}

export async function notifyProfessional(
  emailService: EmailProvider,
  whatsappService: WhatsAppProvider,
  notifyEmail: string,
  notifyWhatsappNumber: string,
  message: NotifyMessage
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([
    emailService.send({ to: notifyEmail, subject: message.subject, text: message.body }),
    whatsappService.send({ to: notifyWhatsappNumber, text: message.body }),
  ]);
}
