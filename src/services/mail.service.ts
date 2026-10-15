import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends an email. Without SMTP in development the message is written to the log instead. */
export async function sendMail(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (env.isProd) {
      logger.error({ to: message.to, subject: message.subject }, 'SMTP is not configured - email not sent');
      return;
    }
    logger.warn({ to: message.to, subject: message.subject, text: message.text }, 'SMTP not configured - email logged instead');
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, ...message });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function passwordResetEmail(name: string, link: string, minutes: number): MailMessage & { to: '' } {
  const text = `Hello ${name},\n\nWe received a request to reset your Civil Sansad password.\nOpen this link to choose a new password (valid for ${minutes} minutes):\n\n${link}\n\nIf you did not request this, you can safely ignore this email.\n\n- Team Civil Sansad`;
  const html = `<p>Hello ${escapeHtml(name)},</p><p>We received a request to reset your Civil Sansad password.</p><p><a href="${escapeHtml(link)}">Reset your password</a> (valid for ${minutes} minutes)</p><p>If you did not request this, you can safely ignore this email.</p><p>- Team Civil Sansad</p>`;
  return { to: '', subject: 'Reset your Civil Sansad password', text, html };
}
