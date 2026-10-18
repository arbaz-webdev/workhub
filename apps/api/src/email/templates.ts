import type { EmailMessage } from './email.service';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A plain, single-button email that renders well in every client. */
function layout(opts: { to: string; subject: string; greeting: string; lines: string[]; button?: { label: string; url: string }; footer: string }): EmailMessage {
  const text = [
    opts.greeting,
    '',
    ...opts.lines,
    ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []),
    '',
    opts.footer,
    '',
    '— WorkHub',
  ].join('\n');

  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#0e8673;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(opts.button.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px"><tr><td style="padding:28px">
<p style="margin:0 0 16px;font-weight:700;font-size:18px">WorkHub</p>
<p style="margin:0 0 12px">${escapeHtml(opts.greeting)}</p>
${opts.lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(l)}</p>`).join('')}
${button}
<p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.5">${escapeHtml(opts.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;

  return { to: opts.to, subject: opts.subject, text, html };
}

export function verifyEmailMessage(to: string, name: string, url: string): EmailMessage {
  return layout({
    to,
    subject: 'Confirm your email for WorkHub',
    greeting: `Hi ${name},`,
    lines: ['Please confirm your email address so we can keep your workspace secure.'],
    button: { label: 'Confirm email', url },
    footer: "This link expires in 24 hours. If you didn't create a WorkHub account, you can ignore this email.",
  });
}

export function resetPasswordMessage(to: string, name: string, url: string): EmailMessage {
  return layout({
    to,
    subject: 'Reset your WorkHub password',
    greeting: `Hi ${name},`,
    lines: ['Someone asked to reset the password for your WorkHub account. Choose a new password with the button below.'],
    button: { label: 'Choose a new password', url },
    footer: "This link expires in 30 minutes and works once. If you didn't ask for this, ignore this email; your password stays the same.",
  });
}

export function waitlistWelcomeMessage(to: string, name: string): EmailMessage {
  return layout({
    to,
    subject: "You're on the WorkHub beta list",
    greeting: `Hi ${name},`,
    lines: [
      "Thanks for joining the WorkHub free beta. We'll email you as soon as your workspace is ready.",
      'Beta members get WorkHub free until launch and 40% off for life afterwards.',
    ],
    footer: 'Reply to this email any time to tell us what your team struggles with most. We read every reply.',
  });
}
