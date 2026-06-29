const DEFAULT_ALLOWED_ORIGINS = [
  "https://vup-partner.ru",
  "https://www.vup-partner.ru",
  "http://vup-partner.ru",
  "http://www.vup-partner.ru",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getAllowedOrigins() {
  const value = process.env.ALLOWED_ORIGINS;
  const envOrigins = value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]));
}

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function sendJson(res, statusCode, payload, headers) {
  res.writeHead(statusCode, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function buildMessage(data) {
  const channel = data.channel === "telegram" ? "telegram" : "phone";
  const contact = text(data.contact, 200);
  const contactValue = channel === "phone" && data.country
    ? `${text(data.country, 20)} ${contact}`.trim()
    : contact;

  const lines = [];
  lines.push("<b>🔔 Новая заявка с сайта ВУП</b>");
  lines.push(`<b>Источник:</b> ${escapeHtml(text(data.source, 200) || "Сайт")}`);
  if (data.name) lines.push(`<b>Имя:</b> ${escapeHtml(text(data.name, 200))}`);
  if (data.email) lines.push(`<b>Email:</b> ${escapeHtml(text(data.email, 200))}`);
  if (contactValue) {
    lines.push(`<b>${channel === "telegram" ? "Telegram" : "Телефон"}:</b> ${escapeHtml(contactValue)}`);
  }
  if (data.brand) lines.push(`<b>Бренд:</b> ${escapeHtml(text(data.brand, 200))}`);
  lines.push(`<i>${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК</i>`);

  return lines.join("\n");
}

export default async function handler(req, res) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, corsHeaders);
    return;
  }

  try {
    const token = process.env.TELEGRAM_LEADS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_LEADS_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      sendJson(res, 500, { error: "Telegram is not configured" }, corsHeaders);
      return;
    }

    const body = await readJsonBody(req);
    const message = buildMessage(body);

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!telegramResponse.ok) {
      const details = await telegramResponse.text().catch(() => "");
      sendJson(res, 502, {
        error: `Telegram error ${telegramResponse.status}`,
        details: details.slice(0, 300),
      }, corsHeaders);
      return;
    }

    sendJson(res, 200, { ok: true }, corsHeaders);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Unknown error" }, corsHeaders);
  }
}
