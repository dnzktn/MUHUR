import type { EmailProvider } from "./email.service";
import type { WhatsAppProvider } from "./whatsapp.service";

export interface NotifyMessage {
  subject: string;
  body: string;
}

const NOTIFICATION_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Notification timed out after ${ms}ms`)), ms);
    }),
  ]);
}

export async function notifyProfessional(
  emailService: EmailProvider,
  whatsappService: WhatsAppProvider,
  notifyEmail: string,
  notifyWhatsappNumber: string,
  message: NotifyMessage
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled([
    withTimeout(
      emailService.send({ to: notifyEmail, subject: message.subject, text: message.body }),
      NOTIFICATION_TIMEOUT_MS
    ),
    withTimeout(
      whatsappService.send({ to: notifyWhatsappNumber, text: message.body }),
      NOTIFICATION_TIMEOUT_MS
    ),
  ]);
}
