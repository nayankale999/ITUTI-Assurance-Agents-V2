import nodemailer from 'nodemailer';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function transport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
}

/** Sends a branded email with one call-to-action button. Without SMTP settings, prints the link to the server log. */
export async function sendActionEmail(opts: { to: string; subject: string; heading: string; body: string; action: string; url: string }) {
  const t = transport();
  if (!t) {
    console.log(`[mail] To: ${opts.to} | ${opts.subject} | ${opts.url}`);
    return;
  }
  const html = `<!doctype html><html><body style="margin:0;background:#F8FAFC;font-family:Inter,Arial,Helvetica,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
  <tr><td style="background:#0B1F4D;background-image:linear-gradient(135deg,#0B1F4D,#13286B 55%,#6C5CE7);padding:18px 28px;font-size:18px;font-weight:800;color:#ffffff">ITUTI<span style="color:#00D4FF">.</span> <span style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#00D4FF">AI Assurance</span></td></tr>
  <tr><td style="height:20px"></td></tr>
  <tr><td style="padding:0 28px;font-size:20px;font-weight:bold;color:#0B1F4D">${esc(opts.heading)}</td></tr>
  <tr><td style="padding:12px 28px 20px;font-size:15px;line-height:1.5">${esc(opts.body)}</td></tr>
  <tr><td style="padding:0 28px 24px"><a href="${esc(opts.url)}" style="display:inline-block;background:#0B1F4D;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">${esc(opts.action)}</a></td></tr>
  <tr><td style="padding:0 28px 24px;font-size:12px;color:#64748B">If the button does not work, paste this link into your browser:<br>${esc(opts.url)}</td></tr>
  </table></td></tr></table></body></html>`;
  await t.sendMail({ to: opts.to, from: process.env.EMAIL_FROM, subject: opts.subject, html, text: `${opts.heading}\n\n${opts.body}\n\n${opts.action}: ${opts.url}` });
}
