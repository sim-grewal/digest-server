const TYPE_CONFIG = {
  morning:  { color: '#F59E0B', emoji: '☀️',  label: 'Morning Digest' },
  coaching: { color: '#3B82F6', emoji: '📚', label: 'Coaching Digest' },
  afternoon:{ color: '#10B981', emoji: '☕', label: 'Afternoon Digest' },
  default:  { color: '#6B7280', emoji: '📬', label: 'Digest' },
};

function buildEmailHtml(subject, body, type) {
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.default;
  const timestamp = new Date().toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header banner -->
          <tr>
            <td style="background:${cfg.color};padding:28px 32px;">
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">${cfg.emoji} ${cfg.label}</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">${escapeHtml(subject)}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;color:#1F2937;font-size:15px;line-height:1.7;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                Sent by your Cowork digest server &nbsp;·&nbsp; ${escapeHtml(timestamp)}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildEmailHtml };
