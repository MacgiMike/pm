import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  /** Plain text body. Paragraphs separated by blank lines. */
  text: string;
  /** Optional call-to-action button */
  action?: { label: string; url: string };
}

@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: Transporter | null = null;

  constructor() {
    if (config.smtp.host) {
      this.transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
    }
  }

  /** Never throws: a failed email must not break the request that caused it. */
  async send(mail: Mail): Promise<void> {
    const text = mail.action ? `${mail.text}\n\n${mail.action.label}: ${mail.action.url}` : mail.text;
    if (!this.transport) {
      this.log.log(`(SMTP not configured) To: ${mail.to} | ${mail.subject}\n${text}`);
      return;
    }
    try {
      await this.transport.sendMail({
        from: config.smtp.from,
        to: mail.to,
        subject: mail.subject,
        text,
        html: renderHtml(mail),
      });
    } catch (e) {
      this.log.error(`Failed to send "${mail.subject}" to ${mail.to}: ${(e as Error).message}`);
    }
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderHtml(mail: Mail): string {
  const paras = mail.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = mail.action
    ? `<p style="margin:22px 0"><a href="${esc(mail.action.url)}" style="display:inline-block;background:#16171B;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(mail.action.label)}</a></p><p style="font-size:12px;color:#5C5F67;word-break:break-all">${esc(mail.action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F6F5F2;font-family:Helvetica,Arial,sans-serif;color:#16171B">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<div style="font-weight:700;font-size:18px;margin-bottom:24px"><span style="display:inline-block;width:22px;height:22px;background:#A3201C;border-radius:6px;vertical-align:-5px;margin-right:8px"></span>Lockred</div>
<div style="background:#ffffff;border:1px solid #E4E2DC;border-radius:12px;padding:24px;font-size:15px">${paras}${button}</div>
<p style="font-size:12px;color:#5C5F67;margin-top:18px">Sent by Lockred Projects</p>
</div></body></html>`;
}
