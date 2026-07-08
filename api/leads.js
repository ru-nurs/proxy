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

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "0 ₽";
  return `${Math.round(number).toLocaleString("ru-RU")} ₽`;
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number)}%`;
}

function paymentTypeLabel(value) {
  if (value === "annuity") return "аннуитетный";
  if (value === "diff") return "дифференцированный";
  if (value === "manual") return "введён вручную";
  return text(value, 80) || "—";
}

function zoneLabel(value) {
  if (value === "safe") return "запас прочности";
  if (value === "edge") return "на пределе";
  if (value === "danger") return "кассовый риск";
  if (value === "impossible") return "кредит невозможен";
  return text(value, 80) || "—";
}

function buildCalculatorLines(calculator) {
  if (!calculator || typeof calculator !== "object") return [];

  const inputs = calculator.inputs || {};
  const result = calculator.result || {};
  const lines = [];

  lines.push("");
  lines.push("<b>Калькулятор:</b>");
  if (calculator.event) lines.push(`<b>Событие:</b> ${escapeHtml(text(calculator.event, 120))}`);
  lines.push(`<b>Выручка:</b> ${escapeHtml(money(inputs.revenue))}`);
  lines.push(`<b>Опер. рентабельность:</b> ${escapeHtml(percent(inputs.opMargin))}`);
  lines.push(`<b>Опер. прибыль:</b> ${escapeHtml(money(result.profit))}`);
  lines.push(`<b>Текущий платёж по кредитам:</b> ${escapeHtml(money(inputs.currentLoanPayment))}`);
  lines.push(`<b>Основной долг:</b> ${escapeHtml(money(inputs.currentLoanBalance))}`);
  lines.push(`<b>Проценты в ближайшем платеже:</b> ${escapeHtml(money(inputs.currentLoanInterest))}`);

  if (inputs.spikeSoon) {
    lines.push(`<b>Платёж выше графика:</b> ${escapeHtml(money(inputs.spikeAmount))} через ${escapeHtml(text(inputs.spikeInMonths, 20))} мес.`);
  }

  lines.push(`<b>Товарные остатки:</b> ${escapeHtml(money(inputs.stockCost))}`);
  lines.push(`<b>Реализация по себестоимости/мес:</b> ${escapeHtml(money(inputs.monthlyCogs))}`);
  if (Number(result.inventoryDays) > 0) {
    lines.push(`<b>Запас товара:</b> ≈${escapeHtml(text(result.inventoryDays, 20))} дн.`);
  }
  if (Number(inputs.staleStock) > 0) {
    lines.push(`<b>Неликвид:</b> ${escapeHtml(money(inputs.staleStock))}`);
  }

  lines.push(`<b>Новый кредит:</b> ${calculator.wantNew ? "да" : "нет"}`);
  if (calculator.wantNew) {
    lines.push(`<b>Сумма нового кредита:</b> ${escapeHtml(money(inputs.newLoanAmount))}`);
    lines.push(`<b>Ставка:</b> ${escapeHtml(percent(inputs.newLoanRate))} годовых`);
    lines.push(`<b>Срок:</b> ${escapeHtml(text(inputs.newLoanMonths, 20))} мес.`);
    lines.push(`<b>Тип платежа:</b> ${escapeHtml(paymentTypeLabel(inputs.paymentType))}`);
    lines.push(`<b>Платёж по новому кредиту:</b> ${escapeHtml(money(result.newPayment))}`);
    lines.push(`<b>Первый платёж через:</b> ${escapeHtml(text(result.firstPaymentDays, 20))} дн.`);
  }

  lines.push(`<b>Нагрузка сейчас:</b> ${escapeHtml(percent(result.shareNow))}`);
  lines.push(`<b>Нагрузка после:</b> ${escapeHtml(percent(result.shareAfter))}`);
  lines.push(`<b>Зона:</b> ${escapeHtml(zoneLabel(result.zone))}`);
  lines.push(`<b>Безопасный платёж:</b> ${escapeHtml(money(result.safeNewPayment))}`);
  lines.push(`<b>Остаток прибыли после платежей:</b> ${escapeHtml(money(result.headroomProfit))}`);

  if (calculator.page) lines.push(`<b>Страница:</b> ${escapeHtml(text(calculator.page, 300))}`);

  return lines;
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
  lines.push(...buildCalculatorLines(data.calculator));
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
    const body = await readJsonBody(req);
    const isCalculatorLead = Boolean(body.calculator);
    const token = isCalculatorLead
      ? process.env.TELEGRAM_CALCULATOR_BOT_TOKEN || process.env.TELEGRAM_LEADS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
      : process.env.TELEGRAM_LEADS_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = isCalculatorLead
      ? process.env.TELEGRAM_CALCULATOR_CHAT_ID || process.env.TELEGRAM_LEADS_CHAT_ID || process.env.TELEGRAM_CHAT_ID
      : process.env.TELEGRAM_LEADS_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      sendJson(res, 500, { error: "Telegram is not configured" }, corsHeaders);
      return;
    }

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
