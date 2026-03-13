const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TOKENS = {
  H9B7BHXro6R6YscvL4mpdDl9sUoBvE8z: { name: "Sebastien", role: "co-owner", emoji: "\u{1F3AF}", notify: true },
  tfzQUQKFOl6QHNGefleGy5aksjPVGjYO: { name: "Celine", role: "co-owner", emoji: "\u{1F4CA}", notify: true },
  "XpcyoBPbVbe7bSjDDzDF3d9j-n5DQaeN": { name: "Antoine", role: "test", emoji: "\u{1F9EA}", notify: false },
  "4-k17JqiWWU7Wx9ArOkV-Py-D-Q5Del0": { name: "Preview", role: "preview", emoji: "\u{1F440}", notify: false },
};

const auditHtml = fs.readFileSync(path.join(__dirname, "audit.html"), "utf-8");

const notFoundHtml = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Lien invalide</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#666;}</style>
</head><body><p>Ce lien n\u2019est pas valide ou a expir\u00e9. Contactez Antoine.</p></body></html>`;

async function sendAlert(viewer, userAgent) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const now = new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "medium",
  });

  const device = /mobile|android|iphone/i.test(userAgent || "") ? "Mobile" : "Desktop";

  const text = [
    `${viewer.emoji} *Audit DL Winery ouvert*`,
    "",
    `*Qui :* ${viewer.name} (${viewer.role})`,
    `*Quand :* ${now}`,
    `*Device :* ${device}`,
  ].join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) console.error("Telegram alert failed:", await res.text());
  } catch (err) {
    console.error("Telegram alert error:", err);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // Simulator tracking endpoint
  if (url.pathname === "/track" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { text, token: viewerToken, isProposal } = JSON.parse(body);
        const trackViewer = viewerToken && TOKENS[viewerToken];
        // Always send proposals, only send tracking if viewer has notify: true
        const shouldSend = isProposal || (trackViewer && trackViewer.notify);
        if (text && BOT_TOKEN && CHAT_ID && shouldSend) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
          });
        }
      } catch (err) {
        console.error("Track error:", err);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    return;
  }

  // Only serve root path
  if (url.pathname !== "/" && url.pathname !== "") {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(notFoundHtml);
    return;
  }

  const token = url.searchParams.get("t");
  if (!token || !TOKENS[token]) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end(notFoundHtml);
    return;
  }

  const viewer = TOKENS[token];

  // Send alert only for notifiable viewers
  if (viewer.notify) {
    sendAlert(viewer, req.headers["user-agent"]);
  }

  // Inject viewer token into HTML so client-side tracking can send it back
  const html = auditHtml.replace("</head>", `<script>window.__VIEWER_TOKEN__="${token}";window.__VIEWER_NOTIFY__=${viewer.notify};</script></head>`);

  // Serve the audit HTML
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(html);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Audit server running on port ${PORT}`);
});
