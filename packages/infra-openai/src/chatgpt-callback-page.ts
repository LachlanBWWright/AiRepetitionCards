export type CallbackState = "received" | "cancelled" | "invalid";

const copy = {
  received: {
    title: "Continue in Recall",
    message: "Your browser has handed the sign-in back to Recall.",
    detail: "Check the app to confirm your ChatGPT connection. You can close this tab.",
    symbol: "✓",
  },
  cancelled: {
    title: "Sign-in cancelled",
    message: "Your ChatGPT connection has not been changed.",
    detail: "Return to Recall whenever you’re ready to try again. You can close this tab.",
    symbol: "–",
  },
  invalid: {
    title: "This sign-in link isn’t valid",
    message: "Recall couldn’t accept this browser callback.",
    detail: "Return to Recall and start a new ChatGPT sign-in. You can close this tab.",
    symbol: "!",
  },
} as const;

export const chatGptCallbackStyle = `
  :root { color-scheme: dark; font-family: Arial, Helvetica, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a1020; color: #e6edf8; }
  main { max-width: 600px; margin: 12% auto; padding: 32px 28px; }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
  .mark { width: 27px; height: 30px; position: relative; }
  .mark::before, .mark::after { content: ''; position: absolute; width: 20px; height: 25px;
    border: 2px solid #93c5fd; border-radius: 4px; }
  .mark::before { transform: rotate(-12deg); opacity: .5; }
  .mark::after { left: 6px; top: 2px; background: #0a1020; }
  section { margin-top: 64px; }
  .symbol { display: grid; place-items: center; width: 48px; height: 48px;
    border-radius: 50%; background: #1b2c49; color: #93c5fd; font-size: 25px; }
  h1 { margin: 24px 0 16px; font-size: clamp(28px, 5vw, 38px); letter-spacing: -.035em;
    line-height: 1.15; font-weight: 600; }
  p { max-width: 440px; margin: 0 0 12px; font-size: 17px; line-height: 1.65; }
  .detail { color: #98a8c0; font-size: 15px; }
  footer { margin-top: 48px; border-top: 1px solid #293950; padding-top: 20px;
    color: #98a8c0; font-size: 13px; }
  @media (max-width: 480px) { main { margin: 24px auto; padding: 28px 24px; } section { margin-top: 48px; } }
`;

// Only remove the browser URL; the application confirms connection completion.
export const chatGptCallbackScript = `history.replaceState(null, '', location.pathname);`;
export function chatGptCallbackPage(state: CallbackState): string {
  const content = copy[state];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>${content.title} · Recall</title>
  <script>${chatGptCallbackScript}</script>
  <style>${chatGptCallbackStyle}</style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark" aria-hidden="true"></span>Recall</div>
    <section aria-labelledby="heading">
      <div class="symbol" aria-hidden="true">${content.symbol}</div>
      <h1 id="heading">${content.title}</h1>
      <p>${content.message}</p>
      <p class="detail">${content.detail}</p>
    </section>
    <footer>ChatGPT connection</footer>
  </main>
</body>
</html>`;
}

export function chatGptCallbackPages(scriptHash: string, styleHash: string) {
  return {
    received: chatGptCallbackPage("received"),
    cancelled: chatGptCallbackPage("cancelled"),
    invalid: chatGptCallbackPage("invalid"),
    policy: `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } as const;
}
