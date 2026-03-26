import fs from 'fs';
import nodemailer from 'nodemailer';

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
};

let cachedTransporter: nodemailer.Transporter | null = null;

function readEnvOrFile(name: string): string {
  const direct = String(process.env[name] || '').trim();
  if (direct) {
    return direct;
  }

  const filePath = String(process.env[`${name}_FILE`] || '').trim();
  if (!filePath) {
    return '';
  }

  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function asBoolean(value: string, fallback = false): boolean {
  if (!value) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getSmtpConfig() {
  const host = readEnvOrFile('SMTP_HOST') || 'orgas-mailpit';
  const port = Number(readEnvOrFile('SMTP_PORT') || '1025');
  const secure = asBoolean(readEnvOrFile('SMTP_SECURE'), false);
  const user = readEnvOrFile('SMTP_USER');
  const pass = readEnvOrFile('SMTP_PASS');

  return {
    host,
    port,
    secure,
    user,
    pass,
    from: readEnvOrFile('SMTP_FROM') || 'ORGAS <no-reply@app.orgahold.com>',
    replyTo: readEnvOrFile('SMTP_REPLY_TO') || '',
  };
}

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getSmtpConfig();
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
  });

  return cachedTransporter;
}

export function getSmtpSummary() {
  const config = getSmtpConfig();
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    replyTo: config.replyTo || null,
  };
}

export async function sendEmail(input: SendEmailInput) {
  const config = getSmtpConfig();
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo || config.replyTo || undefined,
  });

  return {
    messageId: info.messageId || null,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    response: info.response || '',
    envelope: info.envelope || null,
  };
}
