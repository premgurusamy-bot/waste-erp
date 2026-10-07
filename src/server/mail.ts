import nodemailer from "nodemailer";

export function emailConfigured() {
  return !!process.env.SMTP_HOST;
}

export async function sendMail(opts: { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!emailConfigured()) throw new Error("Email is not configured (set SMTP_HOST etc.)");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...opts });
}
