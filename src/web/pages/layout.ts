/** The server's few web pages share this: plain, readable, no assets. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function layout(title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - cchess</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; line-height: 1.25; } h2 { font-size: 20px; margin-top: 32px; }
  .muted { opacity: .7; font-size: 14px; }
  form { display: grid; gap: 12px; max-width: 360px; }
  input { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #888; }
  button { font: inherit; font-weight: 600; padding: 12px 16px; border-radius: 8px; border: 0; background: #769656; color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; }
  #result { font-weight: 600; }
</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}
