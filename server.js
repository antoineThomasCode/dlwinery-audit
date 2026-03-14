const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ============================================================================
// TOKENS — one per person × channel
// ============================================================================
const TOKENS = {
  // Céline
  "celine-email-8kQ2vR7pXm": { name: "Celine", channel: "email", role: "co-owner", emoji: "\u{1F4CA}", notify: true },
  "celine-wa-Tn4bJ9sLwZ":    { name: "Celine", channel: "whatsapp", role: "co-owner", emoji: "\u{1F4CA}", notify: true },
  // Sébastien
  "seb-tg-Fh6cP3qYdN":      { name: "Sebastien", channel: "telegram", role: "co-owner", emoji: "\u{1F3AF}", notify: true },
  "seb-wa-Kx8mW5rBvE":      { name: "Sebastien", channel: "whatsapp", role: "co-owner", emoji: "\u{1F3AF}", notify: true },
  // Antoine (test — no alerts)
  "antoine-test-Zq1":        { name: "Antoine", channel: "test", role: "test", emoji: "\u{1F9EA}", notify: false },
  // Legacy tokens (keep working)
  "H9B7BHXro6R6YscvL4mpdDl9sUoBvE8z": { name: "Sebastien", channel: "legacy", role: "co-owner", emoji: "\u{1F3AF}", notify: true },
  "tfzQUQKFOl6QHNGefleGy5aksjPVGjYO": { name: "Celine", channel: "legacy", role: "co-owner", emoji: "\u{1F4CA}", notify: true },
  "XpcyoBPbVbe7bSjDDzDF3d9j-n5DQaeN": { name: "Antoine", channel: "legacy", role: "test", emoji: "\u{1F9EA}", notify: false },
  "4-k17JqiWWU7Wx9ArOkV-Py-D-Q5Del0": { name: "Preview", channel: "legacy", role: "preview", emoji: "\u{1F440}", notify: false },
};

const auditHtml = fs.readFileSync(path.join(__dirname, "audit.html"), "utf-8");

const notFoundHtml = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Lien invalide</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#666;}</style>
</head><body><p>Ce lien n\u2019est pas valide ou a expir\u00e9. Contactez Antoine.</p></body></html>`;

// ============================================================================
// IN-MEMORY ANALYTICS STORE
// ============================================================================
const sessions = []; // { token, name, channel, device, startedAt, lastActiveAt, events[], sections{}, accordions{}, faqOpens{}, readingMode, scrollMax, proposalSent }

function getOrCreateSession(token) {
  const viewer = TOKENS[token];
  if (!viewer) return null;
  // Find active session (same token, started < 2h ago)
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  let session = sessions.find(s => s.token === token && s.startedAt > twoHoursAgo);
  if (!session) {
    session = {
      token,
      name: viewer.name,
      channel: viewer.channel,
      device: null,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      events: [],
      sections: {},   // sectionId -> { enterTime, totalMs, visits }
      accordions: {}, // trackId -> openCount
      faqOpens: {},   // trackId -> openCount
      readingMode: "Skim", // Skim | Detail | Deep dive
      scrollMax: 0,
      proposalSent: false,
    };
    sessions.push(session);
  }
  return session;
}

// ============================================================================
// TELEGRAM HELPER
// ============================================================================
async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) console.error("Telegram failed:", await res.text());
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

// ============================================================================
// DAILY REPORT GENERATOR
// ============================================================================
let proposalReceived = false;
let reportInterval = null;

function generateReport() {
  const now = new Date();
  const nowParis = now.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "medium" });

  if (sessions.length === 0) {
    return `\u{1F4CB} *Rapport audit DL Winery*\n\n*Date :* ${nowParis}\n\nAucune visite enregistr\u00e9e.`;
  }

  // Group sessions by person
  const byPerson = {};
  for (const s of sessions) {
    if (s.name === "Antoine" || s.name === "Preview") continue;
    if (!byPerson[s.name]) byPerson[s.name] = [];
    byPerson[s.name].push(s);
  }

  let text = `\u{1F4CB} *Rapport audit DL Winery*\n*Date :* ${nowParis}\n`;

  if (Object.keys(byPerson).length === 0) {
    text += "\nAucune visite de S\u00e9bastien ou C\u00e9line.";
    return text;
  }

  for (const [name, personSessions] of Object.entries(byPerson)) {
    text += `\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;
    text += `\u{1F464} *${name}*\n`;
    text += `*Visites :* ${personSessions.length}\n`;

    for (const s of personSessions) {
      const start = new Date(s.startedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", timeStyle: "medium" });
      const durationMin = Math.round((s.lastActiveAt - s.startedAt) / 60000);
      const channel = s.channel !== "legacy" ? ` (via ${s.channel})` : "";
      const device = s.device || "?";

      text += `\n\u{23F0} *${start}*${channel} \u2014 ${device}`;
      text += `\n  Dur\u00e9e : ~${durationMin} min`;
      text += `\n  Scroll max : ${s.scrollMax}%`;

      // Top sections by time
      const sectionEntries = Object.entries(s.sections)
        .filter(([, v]) => v.totalMs > 0)
        .sort((a, b) => b[1].totalMs - a[1].totalMs);

      if (sectionEntries.length > 0) {
        text += `\n  *Sections vues :*`;
        for (const [sectionId, data] of sectionEntries.slice(0, 8)) {
          const secMin = Math.round(data.totalMs / 1000);
          text += `\n    \u2022 ${sectionId} : ${secMin}s (${data.visits}x)`;
        }
      }

      // Reading mode
      text += `\n  *Mode lecture :* ${s.readingMode}`;

      // Top accordions opened
      const accEntries = Object.entries(s.accordions)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      if (accEntries.length > 0) {
        text += `\n  *Accordions ouverts (${accEntries.length}) :*`;
        for (const [accId, count] of accEntries.slice(0, 3)) {
          text += `\n    \u2022 ${accId} : ${count}x`;
        }
        if (accEntries.length > 3) {
          text += `\n    + ${accEntries.length - 3} autres`;
        }
      }

      // FAQ questions opened
      const faqEntries = Object.entries(s.faqOpens)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      if (faqEntries.length > 0) {
        text += `\n  *FAQ consult\u00e9es (${faqEntries.length}/8) :*`;
        for (const [faqId, count] of faqEntries.slice(0, 5)) {
          text += `\n    \u2022 ${faqId} : ${count}x`;
        }
      }

      // Sticky CTA clicks
      const ctaClicks = s.events.filter(e => e.type === "sticky_cta_click").length;
      if (ctaClicks > 0) {
        text += `\n  *CTA flottant cliqu\u00e9 :* ${ctaClicks}x`;
      }

      if (s.proposalSent) {
        text += `\n  \u{2705} *PROPOSITION ENVOY\u00c9E*`;
      }
    }
  }

  if (proposalReceived) {
    text += `\n\n\u{1F389} *Proposition re\u00e7ue \u2014 notifications arr\u00eat\u00e9es.*`;
  }

  return text;
}

function scheduleReports() {
  // Check every minute if it's time to send a report
  reportInterval = setInterval(() => {
    if (proposalReceived) {
      clearInterval(reportInterval);
      return;
    }

    const now = new Date();
    const paris = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
    const h = paris.getHours();
    const m = paris.getMinutes();

    // 18:00 today (March 13) or 08:00 every morning
    if ((h === 18 && m === 0) || (h === 8 && m === 0)) {
      const report = generateReport();
      sendTelegram(report);
    }
  }, 60000); // check every minute
}

// Start the report scheduler
scheduleReports();

// ============================================================================
// HTTP SERVER
// ============================================================================
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // ---- Behavioral tracking endpoint ----
  if (url.pathname === "/event" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const session = getOrCreateSession(data.token);
        if (session) {
          session.lastActiveAt = Date.now();
          if (data.device) session.device = data.device;
          if (data.scrollMax) session.scrollMax = Math.max(session.scrollMax, data.scrollMax);

          // Section visibility tracking
          if (data.sections) {
            for (const [id, ms] of Object.entries(data.sections)) {
              if (!session.sections[id]) session.sections[id] = { totalMs: 0, visits: 0 };
              session.sections[id].totalMs += ms;
              session.sections[id].visits += 1;
            }
          }

          // Accordion open tracking
          if (data.accordions) {
            for (const [id, count] of Object.entries(data.accordions)) {
              session.accordions[id] = (session.accordions[id] || 0) + count;
            }
          }

          // FAQ open tracking
          if (data.faqOpens) {
            for (const [id, count] of Object.entries(data.faqOpens)) {
              session.faqOpens[id] = (session.faqOpens[id] || 0) + count;
            }
          }

          // Reading mode (latest value wins)
          if (data.readingMode) {
            session.readingMode = data.readingMode;
          }

          if (data.event) {
            session.events.push({ type: data.event, time: Date.now(), detail: data.detail || null });
          }
        }
      } catch (err) {
        console.error("Event error:", err);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    return;
  }

  // ---- Simulator tracking endpoint ----
  if (url.pathname === "/track" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { text, token: viewerToken, isProposal } = JSON.parse(body);
        const trackViewer = viewerToken && TOKENS[viewerToken];
        const shouldSend = isProposal || (trackViewer && trackViewer.notify);
        if (text && BOT_TOKEN && CHAT_ID && shouldSend) {
          await sendTelegram(text);
        }

        // Mark proposal in session
        if (isProposal && viewerToken) {
          const session = getOrCreateSession(viewerToken);
          if (session) session.proposalSent = true;

          // Stop daily reports, send final report
          proposalReceived = true;
          const finalReport = generateReport();
          await sendTelegram(finalReport);
        }
      } catch (err) {
        console.error("Track error:", err);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    return;
  }

  // ---- Force report (for testing) ----
  if (url.pathname === "/report") {
    const report = generateReport();
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(report);
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

  // Create/update session
  const session = getOrCreateSession(token);
  if (session) {
    session.device = /mobile|android|iphone/i.test(req.headers["user-agent"] || "") ? "Mobile" : "Desktop";
    session.events.push({ type: "page_open", time: Date.now() });
  }

  // Send open alert only for notifiable viewers
  if (viewer.notify) {
    const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "medium" });
    const device = session ? session.device : "?";
    const channel = viewer.channel !== "legacy" ? ` via ${viewer.channel}` : "";
    const text = [
      `${viewer.emoji} *Audit DL Winery ouvert*`,
      "",
      `*Qui :* ${viewer.name} (${viewer.role}${channel})`,
      `*Quand :* ${now}`,
      `*Device :* ${device}`,
    ].join("\n");
    sendTelegram(text);
  }

  // Inject viewer token into HTML
  const html = auditHtml.replace("</head>", `<script>window.__VIEWER_TOKEN__="${token}";window.__VIEWER_NOTIFY__=${viewer.notify};</script></head>`);

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(html);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Audit server running on port ${PORT}`);
  console.log("Report scheduler active — 18h today + 8h daily until proposal received.");
});
