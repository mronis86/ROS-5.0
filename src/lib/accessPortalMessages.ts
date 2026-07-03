export interface AccessEmailDraft {
  subject: string;
  body: string;
}

export function buildApprovalEmailDraft(options: {
  fullName?: string;
  portalUrl: string;
  isAdmin?: boolean;
}): AccessEmailDraft {
  const name = String(options.fullName || '').trim() || 'there';
  const subject = 'Run of Show — your access has been approved';
  const lines = [
    `Hi ${name},`,
    '',
    'Your access request for Run of Show has been approved.',
  ];
  if (options.isAdmin) {
    lines.push('You were approved as an administrator.');
  }
  lines.push(
    '',
    'Use the link below to set your password and sign in:',
    options.portalUrl,
    '',
    'Please save this link — you will need it to finish setting up your account.',
    '',
    'Thank you,',
    'Run of Show'
  );
  return { subject, body: lines.join('\n') };
}

export function buildAccessRequestReceivedDraft(options: {
  fullName?: string;
  portalUrl: string;
}): AccessEmailDraft {
  const name = String(options.fullName || '').trim() || 'there';
  const subject = 'Run of Show — access request received';
  const body = [
    `Hi ${name},`,
    '',
    'We received your request for access to Run of Show.',
    '',
    'Save the link below — you will need it to check your approval status and set your password after an administrator approves you:',
    options.portalUrl,
    '',
    'Thank you,',
    'Run of Show',
  ].join('\n');

  return { subject, body };
}

export function buildApprovalMailtoUrl(email: string, draft: AccessEmailDraft): string {
  const to = encodeURIComponent(email.trim());
  const subject = encodeURIComponent(draft.subject);
  const body = encodeURIComponent(draft.body);
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
