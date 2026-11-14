// The Google and Apple marks for the sign-in buttons, inline SVG (CSP: no external images).
// Google's mark keeps its own four colours, as its sign-in branding asks: this file is the
// one exception to "no hand-written colours" (test/styles.test.ts). Nothing else goes here.

export function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function AppleLogo() {
  return (
    <svg width="16" height="18" viewBox="0 0 14 17" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M11.62 9.02c-.02-1.9 1.55-2.82 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.88.69-.6 0-1.51-.67-2.48-.65-1.28.02-2.46.74-3.11 1.88-1.33 2.3-.34 5.71.95 7.58.63.91 1.38 1.94 2.37 1.9.95-.04 1.31-.61 2.46-.61 1.15 0 1.47.61 2.48.59 1.02-.02 1.67-.93 2.3-1.85.72-1.06 1.02-2.08 1.04-2.13-.02-.01-2-.77-2-3.05zM9.73 3.43c.52-.64.88-1.52.78-2.4-.75.03-1.67.5-2.21 1.14-.48.56-.91 1.46-.8 2.32.84.07 1.7-.43 2.23-1.06z"
      />
    </svg>
  );
}
