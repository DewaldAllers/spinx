import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export async function sendEmail(options: { to: string; subject: string; text: string }) {
  if (!env.SMTP_HOST) {
    console.info(`[email disabled] ${options.to}: ${options.subject}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASSWORD,
        }
      : undefined,
  });

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: options.to,
    subject: options.subject,
    text: options.text,
  });
}
