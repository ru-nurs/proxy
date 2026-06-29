# VUP LLM Proxy

Small Vercel proxy for the brand awareness form.

## Vercel environment variables

Add these in Vercel project settings:

- `OPENAI_API_KEY` - OpenAI API key.
- `ALLOWED_ORIGINS` - allowed site origins, for example `https://vup-partner.ru,https://www.vup-partner.ru`.
- `OPENAI_MODEL` - optional, default is `gpt-4o-mini`.
- `OPENAI_BASE_URL` - optional, default is `https://api.openai.com/v1`.
- `BRAND_AWARENESS_WEB_SEARCH` - optional, set to `true` to enable web search for brand checks. Disabled by default for faster responses.
- `TELEGRAM_LEADS_BOT_TOKEN` - Telegram bot token for site leads.
- `TELEGRAM_LEADS_CHAT_ID` - Telegram chat ID for site leads.
- `TELEGRAM_BRAND_BOT_TOKEN` - optional Telegram bot token for brand checks.
- `TELEGRAM_BRAND_CHAT_ID` - optional Telegram chat ID for brand checks.

## Brand endpoint

`POST /api/brand-awareness`

Request:

```json
{ "brand": "SPLAT" }
```

Response:

```json
{
  "brand": "SPLAT",
  "awareness_percent": 70,
  "confidence": "high",
  "rationale": "...",
  "segments": [{ "name": "Москва и СПб", "percent": 80 }]
}
```

## Leads endpoint

`POST /api/leads`

Request:

```json
{
  "source": "FeedbackForm",
  "name": "Name",
  "email": "name@example.com",
  "channel": "telegram",
  "contact": "@username"
}
```
