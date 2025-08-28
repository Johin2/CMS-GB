// resend-email.ts
import { Resend } from 'resend';

type SendParams = { to: string; subject: string; html: string };

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;

// Create the client once (reuse between calls)
const resend = new Resend(RESEND_API_KEY);

export async function sendEmailViaResend({ to, subject, html }: SendParams) {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    throw new Error('Missing RESEND_API_KEY or RESEND_FROM');
  }

  const { data, error } = await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    // error can be an object; surface a readable message
    const msg = typeof error === 'string' ? error : (error?.message ?? JSON.stringify(error));
    throw new Error(`Resend error: ${msg}`);
  }

  return data;
}
