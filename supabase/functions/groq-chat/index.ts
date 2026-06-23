/**
 * Supabase Edge Function: groq-chat
 * ====================================
 * Proxy multi-provider dengan FALLBACK SEQUENTIAL.
 * Loop satu per satu (for + await), sukses → STOP.
 * 
 * Features:
 *   - Auto-skip providers yang ditandai limit (via skip_providers)
 *   - Parse Retry-After header saat 429
 *   - Kembalikan info rate limit tiap provider
 *
 * Prioritas: groq → xai → openrouter → cerebras → gemini
 *
 * POST body:
 *   { messages: [{role, content}], max_tokens?:500, skip_providers?:["groq"] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

interface ProviderDef {
  name: string;
  secretKey: string;
  defaultModel: string;
  buildRequest: (apiKey: string, messages: Record<string, unknown>[], maxTokens: number) => {
    url: string; headers: Record<string, string>; body: unknown;
  };
  extractReply: (data: Record<string, unknown>) => string | null;
}

const PROVIDERS: ProviderDef[] = [
  {
    name: "groq", secretKey: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "llama-3.3-70b-versatile", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (d) => d?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "xai", secretKey: "XAI_API_KEY", defaultModel: "grok-2-latest",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.x.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "grok-2-latest", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (d) => d?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "openrouter", secretKey: "OPENROUTER_API_KEY", defaultModel: "openai/gpt-4o-mini",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "openai/gpt-4o-mini", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (d) => d?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "cerebras", secretKey: "CEREBRAS_API_KEY", defaultModel: "gpt-oss-120b",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.cerebras.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "gpt-oss-120b", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (d) => d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.message?.reasoning ?? null,
  },
  {
    name: "gemini", secretKey: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash",
    buildRequest: (apiKey, msgs, _max) => {
      const contents = msgs.map((m) => ({
        role: (m.role === "system" || m.role === "user") ? "user" : "model",
        parts: [{ text: m.content }],
      }));
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { "Content-Type": "application/json" },
        body: { contents },
      };
    },
    extractReply: (d) => d?.candidates?.[0]?.content?.parts?.[0]?.text ?? null,
  },
];

/** Parse Retry-After (bisa detik absolute atau relative) */
function parseRetryAfter(val: string | null): number | null {
  if (!val) return null;
  const num = parseInt(val, 10);
  if (!isNaN(num)) return Date.now() + num * 1000; // detik relatif
  const date = Date.parse(val);
  return isNaN(date) ? null : date;
}

/** Ekstrak info rate limit dari response headers */
function extractRateInfo(headers: Headers, providerName: string): Record<string, unknown> {
  const info: Record<string, unknown> = { provider: providerName };
  for (const [key, val] of headers.entries()) {
    const kl = key.toLowerCase();
    if (kl.includes("ratelimit") || kl.includes("retry-after") || kl.includes("x-ratelimit")) {
      info[key] = val;
    }
  }
  info.has_headers = Object.keys(info).length > 1;
  return info;
}

// ── SERVE ────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const messages: Record<string, unknown>[] = body.messages;
    const maxTokens: number = body.max_tokens || 500;
    const skipProviders: string[] = body.skip_providers || [];

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages harus array dan tidak boleh kosong" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const errors: string[] = [];
    const rateLimits: Record<string, unknown>[] = [];
    let limitedProviders: Record<string, number> = {}; // provider → reset_at timestamp

    for (let i = 0; i < PROVIDERS.length; i++) {
      const prov = PROVIDERS[i];
      const attempt = i + 1;

      // ══ AUTO-SKIP: provider ditandai limit oleh frontend ══
      if (skipProviders.includes(prov.name)) {
        console.log(`[fallback] #${attempt} SKIP ${prov.name}: ditandai limit oleh frontend`);
        errors.push(`${prov.name}: skipped (frontend-marked limited)`);
        rateLimits.push({ provider: prov.name, status: "skipped", reason: "frontend limit flag" });
        continue;
      }

      const apiKey = Deno.env.get(prov.secretKey);
      if (!apiKey) {
        console.log(`[fallback] #${attempt} SKIP ${prov.name}: secret tidak ditemukan`);
        errors.push(`${prov.name}: secret not set`);
        rateLimits.push({ provider: prov.name, status: "not_configured" });
        continue;
      }

      console.log(`[fallback] #${attempt} MENCOBA ${prov.name} (model: ${prov.defaultModel})...`);

      try {
        const { url, headers: reqHeaders, body: reqBody } = prov.buildRequest(apiKey, messages, maxTokens);
        const upstream = await fetch(url, { method: "POST", headers: reqHeaders, body: JSON.stringify(reqBody) });
        const upstreamData = await upstream.json();

        // ══ Kumpulkan rate limit headers (untuk sukses maupun gagal) ══
        const rateInfo = extractRateInfo(upstream.headers, prov.name);

        if (!upstream.ok) {
          const status = upstream.status;
          const errMsg = upstreamData?.error?.message || JSON.stringify(upstreamData).substring(0, 150);

          // ══ 429 Rate Limit → baca Retry-After ══
          if (status === 429) {
            const retryAfter = upstream.headers.get("retry-after") || upstream.headers.get("x-ratelimit-reset");
            const resetAt = parseRetryAfter(retryAfter);
            rateInfo.status = "limited";
            rateInfo.reset_at = resetAt ? new Date(resetAt).toISOString() : null;
            rateInfo.retry_after_raw = retryAfter;
            rateInfo.http_status = 429;
            limitedProviders[prov.name] = resetAt || (Date.now() + 60_000); // fallback 60 detik

            console.log(`[fallback] #${attempt} ${prov.name} RATE LIMITED (429) — Retry-After: ${retryAfter || "tidak ada"} → reset: ${resetAt ? new Date(resetAt).toISOString() : "?"}`);
          } else {
            rateInfo.status = "error";
            rateInfo.http_status = status;
            console.log(`[fallback] #${attempt} ${prov.name} GAGAL (HTTP ${status}): ${errMsg}`);
          }

          rateLimits.push(rateInfo);
          errors.push(`${prov.name}: HTTP ${status}`);
          continue; // ⟶ next provider
        }

        const replyText = prov.extractReply(upstreamData);
        if (!replyText) {
          rateInfo.status = "empty_response";
          rateLimits.push(rateInfo);
          console.log(`[fallback] #${attempt} ${prov.name} GAGAL: response kosong`);
          errors.push(`${prov.name}: empty reply`);
          continue;
        }

        // ══ SUKSES ══
        rateInfo.status = "ok";
        rateInfo.reply_length = replyText.length;
        rateLimits.push(rateInfo);

        // Pasang rate limit dari response sukses juga
        const remainingKey = [
          "x-ratelimit-remaining-requests", "x-ratelimit-remaining-requests-minute",
          "x-ratelimit-remaining-requests-hour", "x-ratelimit-remaining-requests-day",
        ].find((k) => upstream.headers.has(k));
        if (remainingKey) {
          const remaining = parseInt(upstream.headers.get(remainingKey) || "-1", 10);
          if (remaining <= 1) { // hampir habis
            const resetVal = upstream.headers.get(
              [ "x-ratelimit-reset-requests", "x-ratelimit-reset-requests-minute" ].find((k) => upstream.headers.has(k)) || ""
            );
            const resetAt = parseRetryAfter(resetVal) || (Date.now() + 60_000);
            limitedProviders[prov.name] = resetAt;
          }
        }

        console.log(`[fallback] #${attempt} ${prov.name} SUKSES ✅ (${replyText.length} char) → STOP`);
        return new Response(
          JSON.stringify({
            success: true,
            provider: prov.name,
            id: upstreamData.id || "",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: replyText }, finish_reason: "stop" }],
            rate_limits: rateLimits,
            limited_providers: limitedProviders,
          }),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );

      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.log(`[fallback] #${attempt} ${prov.name} GAGAL (network): ${msg}`);
        errors.push(`${prov.name}: network error`);
        rateLimits.push({ provider: prov.name, status: "network_error", message: msg });
      }
    }

    console.error(`[fallback] SEMUA ${PROVIDERS.length} PROVIDER GAGAL:`, errors);
    return new Response(
      JSON.stringify({
        success: false, error: "Semua provider AI gagal.",
        details: errors, rate_limits: rateLimits, limited_providers: limitedProviders,
      }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[groq-chat] Unexpected:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
