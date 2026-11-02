// Builds a raw email (RFC 2822 / MIME) the Gmail API accepts: plain-text body
// plus an optional PDF attachment, returned base64url-encoded.
import crypto from 'node:crypto';

const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);
const oneLine = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const encodeWord = (s) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

export function formatAddress(name, email) {
  const cleanName = oneLine(name);
  if (!cleanName) return oneLine(email);
  const display = isAscii(cleanName) ? `"${cleanName.replace(/["\\]/g, '\\$&')}"` : encodeWord(cleanName);
  return `${display} <${oneLine(email)}>`;
}

export function buildMessage({ from, to, subject, text, attachment }) {
  const subjectLine = oneLine(subject);
  const headers = [
    from && `From: ${oneLine(from)}`,
    `To: ${oneLine(to)}`,
    `Subject: ${isAscii(subjectLine) ? subjectLine : encodeWord(subjectLine)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const bodyB64 = wrap76(Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'));

  let message;
  if (!attachment) {
    message = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
    ].join('\r\n');
  } else {
    const boundary = `coldmail_${crypto.randomBytes(12).toString('hex')}`;
    const filename = oneLine(attachment.filename).replace(/"/g, '');
    message = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
      `--${boundary}`,
      `Content-Type: ${attachment.contentType || 'application/pdf'}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(attachment.data.toString('base64')),
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }
  return Buffer.from(message, 'utf8').toString('base64url');
}

// The email body Claude writes never includes a signature; it is added here so
// links and contact details are identical in every email.
export function composeBody(body, signature) {
  const main = String(body || '').trimEnd();
  return signature?.trim() ? `${main}\n\n${signature.trim()}\n` : `${main}\n`;
}
