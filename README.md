# VUP LLM Proxy

Small Vercel proxy for the brand awareness form.

## Vercel environment variables

Add these in Vercel project settings:

- `OPENAI_API_KEY` - OpenAI API key.
- `ALLOWED_ORIGINS` - allowed site origins, for example `https://vup-partner.ru,https://www.vup-partner.ru`.
- `OPENAI_MODEL` - optional, default is `gpt-4o-mini`.
- `OPENAI_BASE_URL` - optional, default is `https://api.openai.com/v1`.

## Endpoint

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
  "segments": [
    { "name": "Москва и СПб", "percent": 80 }
  ]
}
```
