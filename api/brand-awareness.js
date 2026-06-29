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
    Vary: "Origin",
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
  return String(value ?? "")
    .trim()
    .slice(0, 120);
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
    rationale:
      "BAUM ZINDECH — российский бренд премиальной бытовой техники и товаров для дома, развивает дистрибуцию в федеральных сетях и на маркетплейсах (Wildberries, Ozon). Активно работает с performance-каналами и контент-маркетингом, благодаря чему имеет устойчивую узнаваемость среди аудитории, выбирающей технику средне-высокого ценового сегмента, и стабильный приток повторных покупателей в своей категории.",
    segments: [
      { name: "18–24 года", percent: 30 },
      { name: "25–34 года", percent: 28 },
      { name: "35+ лет", percent: 18 },
      { name: "Города-миллионники", percent: 38 },
    ],
  },
  petflat: {
    brand: "Pet Flat",
    awareness_percent: 27,
    confidence: "medium",
    rationale:
      "Pet Flat — российский D2C-бренд товаров для домашних животных (корма, лакомства, аксессуары), развивающийся через маркетплейсы и собственный онлайн-канал. Сильное digital-присутствие, работа с инфлюенсерами и зоо-сообществами обеспечивают высокую узнаваемость среди владельцев питомцев в крупных городах, особенно у аудитории 25–44 лет, ориентированной на качественный уход за животными.",
    segments: [
      { name: "18–24 года", percent: 32 },
      { name: "25–34 года", percent: 35 },
      { name: "35+ лет", percent: 20 },
      { name: "Города-миллионники", percent: 40 },
    ],
  },
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const resultCache = new Map();

const REQUIRED_SEGMENT_NAMES = ["18–24 года", "25–34 года", "35+ лет", "Города-миллионники"];

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function getCachedResult(brand) {
  const key = normalizeOverrideKey(brand);
  const cached = resultCache.get(key);

  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return null;
  }

  return cached.result;
}

function setCachedResult(brand, result) {
  resultCache.set(normalizeOverrideKey(brand), {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function notifyBrandCheckSoon(result) {
  void notifyBrandCheck(result);
}

function normalizeSegments(segments, awareness) {
  const base = clampPercent(awareness);
  const fallback = [
    Math.min(100, Math.round(base * 1.6)),
    Math.min(100, Math.round(base * 1.15)),
    Math.max(0, Math.round(base * 0.55)),
    Math.min(100, Math.round(base * 1.25)),
  ];

  const normalized = Array.isArray(segments)
    ? segments.map((segment) => ({
        name: String(segment?.name ?? "").toLowerCase(),
        percent: clampPercent(segment?.percent),
      }))
    : [];

  const pick = (index, patterns) => {
    const found = normalized.find((segment) =>
      patterns.some((pattern) => pattern.test(segment.name)),
    );
    return found ? found.percent : fallback[index];
  };

  return [
    { name: REQUIRED_SEGMENT_NAMES[0], percent: pick(0, [/18.*24/, /молод/]) },
    { name: REQUIRED_SEGMENT_NAMES[1], percent: pick(1, [/25.*34/]) },
    { name: REQUIRED_SEGMENT_NAMES[2], percent: pick(2, [/35/, /45/, /взросл/]) },
    {
      name: REQUIRED_SEGMENT_NAMES[3],
      percent: pick(3, [/миллион/, /москва/, /спб/, /100k/, /100к/]),
    },
  ];
}

function validateResult(value, fallbackBrand) {
  const result = value && typeof value === "object" ? value : {};
  const awareness = Number(result.awareness_percent);
  const confidence = ["low", "medium", "high"].includes(result.confidence)
    ? result.confidence
    : "medium";
  const normalizedAwareness = Math.max(
    0,
    Math.min(100, Number.isFinite(awareness) ? awareness : 0),
  );

  return {
    brand: String(result.brand || fallbackBrand),
    awareness_percent: normalizedAwareness,
    confidence,
    rationale: String(result.rationale || ""),
    segments: normalizeSegments(result.segments, normalizedAwareness),
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
На вход дают название бренда. Оцени aided awareness — какой процент взрослого населения России (18+) узнает этот бренд при упоминании в его категории, то есть хотя бы на уровне «слышал название».
Используй здравый смысл, открытые маркетинговые данные, интернет-упоминания и опыт. Будь последовательным: одинаковый бренд должен давать близкую оценку.

Калибровка, ориентиры, шкала непрерывная:
- мировые мега-бренды вроде Coca-Cola, Nike, Apple, Samsung, IKEA, McDonald's, Google: 92-98%;
- крупные федеральные и сильные мировые бренды в РФ вроде Sber, Yandex, Wildberries, Ozon, Pepsi, L'Oreal, Nivea, Adidas, Bosch: 75-92%;
- известные российские бренды среднего масштаба, заметные в ритейле и медиа вроде Splat, Natura Siberica, Черная Карта, Лента, Магнит Косметик: 55-75%;
- растущие D2C/категорийные бренды с активным digital-присутствием и дистрибуцией на WB/Ozon вроде Revyline, Levrana, Mixit, Don't Touch My Skin: 20-45%;
- нишевые бренды с устойчивой аудиторией в своей категории: 18-35%;
- малые, региональные или молодые бренды с заметным маркетингом: 8-18%;
- совсем новые или малоизвестные бренды: 2-7%;
- выдуманный/незнакомый бренд: 0-3%, confidence:"low".

Не занижай оценки для брендов с активным digital-присутствием, инфлюенсерской поддержкой и широкой дистрибуцией: целевая аудитория их хорошо знает, и aided awareness обычно выше, чем кажется на первый взгляд.
Для инфлюенсерских брендов учитывай перенос узнаваемости от основателя, но не приравнивай бренд к известности человека полностью.
Будь последовательным: одинаковый бренд должен давать близкую оценку.
Верни СТРОГО валидный JSON-объект без пояснений в формате:
{"brand":"...", "awareness_percent": <число 0..100>, "confidence":"low"|"medium"|"high", "rationale":"1-2 коротких предложения на русском", "segments":[{"name":"<строка>", "percent": <число 0..100>}, ...]}
Поле segments — массив строго из 4 объектов, КАЖДЫЙ строго вида {"name": "...", "percent": число}.
Всегда возвращай segments именно в такой структуре и порядке:
1. "18–24 года"
2. "25–34 года"
3. "35+ лет"
4. "Города-миллионники"
Для молодежных, digital-first и инфлюенсерских брендов обычно делай 18–24 заметно выше общей оценки, 25–34 умеренно выше или около общей оценки, 35+ ниже общей оценки, города-миллионники выше средней по стране.
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
      setCachedResult(brand, override);
      sendJson(res, 200, override, corsHeaders);
      notifyBrandCheckSoon(override);
      return;
    }

    const cached = getCachedResult(brand);
    if (cached) {
      sendJson(res, 200, cached, corsHeaders);
      notifyBrandCheckSoon(cached);
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" }, corsHeaders);
      return;
    }

    const useWebSearch = process.env.BRAND_AWARENESS_WEB_SEARCH === "true";
    const model = process.env.OPENAI_MODEL || (useWebSearch ? "gpt-5.5" : "gpt-4o-mini");
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), useWebSearch ? 45_000 : 15_000);

    const requestBody = {
      model,
      instructions: BRAND_AWARENESS_PROMPT,
      input: useWebSearch
        ? `Бренд: ${brand}. Перед оценкой проверь актуальные данные и упоминания бренда в интернете. Ответь только JSON.`
        : `Бренд: ${brand}. Дай быструю оценку по калибровке и ответь только JSON.`,
      max_output_tokens: useWebSearch ? 1200 : 700,
    };

    if (useWebSearch) {
      requestBody.tools = [
        {
          type: "web_search",
          search_context_size: "low",
          user_location: {
            type: "approximate",
            country: "RU",
          },
        },
      ];
    }

    const openaiResponse = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
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
    setCachedResult(brand, result);

    sendJson(res, 200, result, corsHeaders);
    notifyBrandCheckSoon(result);
  } catch (error) {
    const message =
      error?.name === "AbortError" ? "LLM request timeout" : error?.message || "Unknown error";
    sendJson(res, 500, { error: message }, corsHeaders);
  }
}
