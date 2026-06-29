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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function notifyBrandCheck(result) {
  const token = process.env.TELEGRAM_BRAND_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_BRAND_CHAT_ID;
  if (!token || !chatId) return;

  const lines = [
    "<b>🔎 Проверка бренда на сайте</b>",
    `<b>Бренд:</b> ${escapeHtml(result.brand)}`,
    `<b>Узнаваемость:</b> ${Math.round(result.awareness_percent)}%`,
    `<b>Уверенность:</b> ${escapeHtml(result.confidence)}`,
  ];

  if (result.rationale) lines.push(`<b>Комментарий:</b> ${escapeHtml(result.rationale)}`);
  lines.push(`<i>${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК</i>`);

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
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

function normalizeBrand(value) {
  return String(value ?? "").trim().slice(0, 120);
}

function normalizeOverrideKey(value) {
  return normalizeBrand(value)
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "");
}

const BRAND_OVERRIDES = {
  baumzindech: {
    brand: "BAUM ZINDECH",
    awareness_percent: 25,
    confidence: "medium",
    rationale: "Бренд активно развивается в категории и имеет устойчивую узнаваемость в ключевых сегментах аудитории.",
    segments: [
      { name: "Москва/СПб", percent: 38 },
      { name: "Города 100k+", percent: 27 },
      { name: "18-34", percent: 30 },
      { name: "Активные покупатели категории", percent: 42 },
    ],
  },
  petflat: {
    brand: "Pet Flat",
    awareness_percent: 27,
    confidence: "medium",
    rationale: "Бренд уверенно представлен в своей нише и узнаваем среди целевой аудитории владельцев домашних животных.",
    segments: [
      { name: "Москва/СПб", percent: 40 },
      { name: "Города 100k+", percent: 28 },
      { name: "18-44", percent: 32 },
      { name: "Владельцы животных", percent: 55 },
    ],
  },
};

function validateResult(value, fallbackBrand) {
  const result = value && typeof value === "object" ? value : {};
  const awareness = Number(result.awareness_percent);
  const confidence = ["low", "medium", "high"].includes(result.confidence)
    ? result.confidence
    : "medium";

  const segments = Array.isArray(result.segments)
    ? result.segments
        .map((segment) => ({
          name: String(segment?.name ?? "").trim(),
          percent: Math.max(0, Math.min(100, Number(segment?.percent) || 0)),
        }))
        .filter((segment) => segment.name)
        .slice(0, 4)
    : [];

  return {
    brand: String(result.brand || fallbackBrand),
    awareness_percent: Math.max(0, Math.min(100, Number.isFinite(awareness) ? awareness : 0)),
    confidence,
    rationale: String(result.rationale || ""),
    segments,
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const chunks = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
      if (typeof content?.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n").trim();
}

function parseJsonObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Invalid JSON from OpenAI");
  }
}

const BRAND_AWARENESS_PROMPT = `Ты — аналитик по узнаваемости брендов в России.
На вход дают название бренда. Оцени, какой процент взрослого населения России (18+) знает этот бренд хотя бы на уровне «слышал название».
Используй здравый смысл, открытые маркетинговые данные и опыт. Будь последовательным: одинаковый бренд должен давать одинаковую оценку.
Верни СТРОГО валидный JSON-объект без пояснений в формате:
{"brand":"...", "awareness_percent": <число 0..100>, "confidence":"low"|"medium"|"high", "rationale":"1-2 коротких предложения на русском", "segments":[{"name":"<строка>", "percent": <число 0..100>}, ...]}
Поле segments — массив из 2-4 объектов, КАЖДЫЙ строго вида {"name": "...", "percent": число}.
Примеры сегментов: "Москва и СПб", "Города 100k+", "18–34 года", "Активные покупатели категории".
Если бренд неизвестен/выдуман — поставь низкий процент и confidence:"low".`;

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
    const brand = normalizeBrand(body.brand);

    if (!brand) {
      sendJson(res, 400, { error: "Brand is required" }, corsHeaders);
      return;
    }

    const override = BRAND_OVERRIDES[normalizeOverrideKey(brand)];
    if (override) {
      await notifyBrandCheck(override);
      sendJson(res, 200, override, corsHeaders);
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" }, corsHeaders);
      return;
    }

    const systemPrompt = `Ты аналитик по узнаваемости брендов в России.
На вход дают название бренда. Оцени, какой процент взрослого населения России 18+ знает этот бренд хотя бы на уровне "слышал название".
Используй здравый смысл, открытые маркетинговые данные и опыт. Будь последовательным: один и тот же бренд должен давать близкую оценку.
Верни строго валидный JSON без пояснений в формате:
{"brand":"...", "awareness_percent": число 0..100, "confidence":"low"|"medium"|"high", "rationale":"1-2 коротких предложения на русском", "segments":[{"name":"строка", "percent": число 0..100}]}
Поле segments - массив из 2-4 объектов.
Если бренд неизвестен или выдуман, поставь низкий процент и confidence:"low".`;

    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    const openaiResponse = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.5",
        instructions: BRAND_AWARENESS_PROMPT,
        tools: [{
          type: "web_search",
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            country: "RU",
          },
        }],
        input: `Бренд: ${brand}. Перед оценкой проверь актуальные данные и упоминания бренда в интернете. Ответь только JSON.`,
        max_output_tokens: 1200,
      }),
    }).finally(() => clearTimeout(timeout));

    if (!openaiResponse.ok) {
      const text = await openaiResponse.text().catch(() => "");
      sendJson(
        res,
        502,
        {
          error: `OpenAI error ${openaiResponse.status}`,
          details: text.slice(0, 300),
        },
        corsHeaders,
      );
      return;
    }

    const json = await openaiResponse.json();
    const content = extractResponseText(json) || "{}";
    const parsed = parseJsonObject(content);

    const result = validateResult(parsed, brand);
    await notifyBrandCheck(result);

    sendJson(res, 200, result, corsHeaders);
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "LLM request timeout"
      : error?.message || "Unknown error";
    sendJson(res, 500, { error: message }, corsHeaders);
  }
}
