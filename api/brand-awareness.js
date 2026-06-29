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

function normalizeBrand(value) {
  return String(value ?? "").trim().slice(0, 120);
}

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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      sendJson(res, 500, { error: "OPENAI_API_KEY is not configured" }, corsHeaders);
      return;
    }

    const body = await readJsonBody(req);
    const brand = normalizeBrand(body.brand);

    if (!brand) {
      sendJson(res, 400, { error: "Brand is required" }, corsHeaders);
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

    const openaiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Бренд: ${brand}` },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
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
    const content = json?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    sendJson(res, 200, validateResult(parsed, brand), corsHeaders);
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "LLM request timeout"
      : error?.message || "Unknown error";
    sendJson(res, 500, { error: message }, corsHeaders);
  }
}
