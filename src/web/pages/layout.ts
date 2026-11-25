/** The server's few web pages share this: plain, readable, no assets -
 * drawn in the app's default colors (Paper & Vermilion), light or dark as
 * the device is. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface LayoutOptions {
  /** 'card' centres a short page - a form behind an email link - in a
   * card; 'document' sets a long one - a legal page - as text. */
  kind?: 'card' | 'document';
  script?: string;
  /** A line under the card or document, such as where to get help. */
  footer?: string;
}

/** The app's mark: a board's corner, two squares of each color. */
const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
<rect width="24" height="24" rx="6" fill="#c2411a"/>
<rect x="4" y="4" width="8" height="8" fill="#faf7f0"/>
<rect x="12" y="12" width="8" height="8" fill="#faf7f0"/>
</svg>`;

const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #faf7f0; --surface: #fff; --text: #1f1a17; --muted: #685f57;
    --separator: #e6dfd2; --field: #fff; --accent: #c2411a; --on-accent: #fff;
    --accent-text: #b03a16; --accent-subtle: #f6e6de; --danger: #b3261e;
    --danger-subtle: #fbe9e7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #191613; --surface: #24201c; --text: #f1ebe2; --muted: #a89f94;
      --separator: #39332d; --field: #1d1a17; --accent: #e8673f;
      --on-accent: #1a0e08; --accent-text: #f08a66; --accent-subtle: #3a2a22;
      --danger: #f07167; --danger-subtle: #3a1f1e;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column;
    background: var(--bg); color: var(--text);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent-text); }
  .brand {
    display: flex; align-items: center; gap: 10px; justify-content: center;
    padding: 28px 20px 0; font-weight: 700; font-size: 20px; letter-spacing: -.01em;
    color: var(--text); text-decoration: none;
  }
  .mark { width: 28px; height: 28px; }
  main { flex: 1; width: 100%; margin: 0 auto; padding: 24px 20px 32px; }
  footer { text-align: center; color: var(--muted); font-size: 14px; padding: 0 20px 32px; }

  /* A short page, centred in a card. */
  .card-page main { display: flex; align-items: center; justify-content: center; }
  .card {
    width: 100%; max-width: 420px; background: var(--surface);
    border: 1px solid var(--separator); border-radius: 16px;
    padding: 32px 28px; box-shadow: 0 8px 30px rgba(0, 0, 0, .06);
  }
  .card h1 { font-size: 24px; line-height: 1.25; margin: 0 0 8px; text-align: center; }
  .card .lead { color: var(--muted); margin: 0 0 24px; text-align: center; }
  .icon {
    width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent-subtle); color: var(--accent-text);
  }
  .icon svg { width: 28px; height: 28px; }
  .icon.danger { background: var(--danger-subtle); color: var(--danger); }
  form { display: grid; gap: 16px; }
  label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
  input {
    font: inherit; font-weight: 400; width: 100%; padding: 12px 14px;
    border-radius: 10px; border: 1px solid var(--separator);
    background: var(--field); color: var(--text);
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  .hint { font-size: 13px; font-weight: 400; color: var(--muted); }
  button {
    font: inherit; font-weight: 600; width: 100%; padding: 13px 16px; margin-top: 4px;
    border-radius: 10px; border: 0; background: var(--accent); color: var(--on-accent); cursor: pointer;
  }
  button:hover { filter: brightness(1.05); }
  button:disabled { opacity: .6; cursor: default; }
  .result:empty { display: none; }
  .result {
    margin: 16px 0 0; padding: 12px 14px; border-radius: 10px; font-size: 15px;
    text-align: center;
  }
  .result.error { background: var(--danger-subtle); color: var(--danger); }
  .result.done { background: var(--accent-subtle); color: var(--accent-text); font-weight: 600; }
  .note { margin: 20px 0 0; font-size: 14px; color: var(--muted); text-align: center; }

  /* A long page, set as text. */
  .document {
    max-width: 720px; margin: 0 auto; background: var(--surface);
    border: 1px solid var(--separator);
    border-radius: 16px; padding: 40px 44px;
  }
  .document h1 { font-size: 30px; line-height: 1.2; margin: 0 0 4px; letter-spacing: -.01em; }
  .document h2 {
    font-size: 19px; margin: 36px 0 8px; padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
  .document ul { padding-left: 22px; } .document li { margin: 6px 0; }
  .muted { color: var(--muted); font-size: 14px; }
  @media (max-width: 560px) {
    .card { padding: 28px 20px; }
    .document { padding: 28px 20px; border-radius: 12px; }
    .document h1 { font-size: 26px; }
  }
`;

export function layout(
  title: string,
  body: string,
  { kind = 'document', script = '', footer = '' }: LayoutOptions = {},
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${kind === 'card' ? 'noindex' : 'index'}">
<title>${escapeHtml(title)} - cchess</title>
<style>${STYLE}</style>
</head>
<body class="${kind}-page">
<div class="brand">${MARK}<span>cchess</span></div>
<main>
<div class="${kind}">
${body}
</div>
</main>
${footer ? `<footer>${footer}</footer>` : ''}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}
