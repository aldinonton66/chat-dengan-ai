/**
 * Supabase Edge Function: api-proxy
 * ====================================
 * Proxy aman untuk SEMUA AI provider.
 * Semua API key disimpan sebagai secret di Supabase,
 * TIDAK PERNAH dikirim ke frontend.
 *
 * Cara pakai:
 *   POST https://<project>.supabase.co/functions/v1/groq-chat
 *   Header: Authorization: Bearer <SUPABASE_ANON_KEY>
 *   Body: {
 *     provider: "groq" | "xai" | "openrouter" | "cerebras" | "gemini",
 *     messages: [{role:"user", content:"..."}, ...],
 *     model?: "...",
 *     max_tokens?: 500
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── CORS ────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

// ── Provider Config ─────────────────────────────────────────
const PROVIDER_CONFIG: Record<string, {
  url: string;
  authHeader: (key: string) => Record<string, string>;
  buildBody: (messages: Record<string, unknown>[], model: string, maxTokens: number) => unknown;
  extractReply: (data: Record<string, unknown>) => string | null;
}> = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (msgs, model, maxTokens) => ({ model, messages: msgs, max_tokens: maxTokens }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  xai: {
    url: "https://api.x.ai/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (msgs, model, maxTokens) => ({ model, messages: msgs, max_tokens: maxTokens }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (msgs, model, maxTokens) => ({ model, messages: msgs, max_tokens: maxTokens }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    buildBody: (msgs, model, maxTokens) => ({ model, messages: msgs, max_tokens: maxTokens }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  gemini: {
    url: "", // dibangun dinamis dengan API key
    authHeader: (_key) => ({}), // Gemini pakai query param, bukan header
    buildBody: (msgs, _model, _maxTokens) => {
      const contents = msgs.map((m) => ({
        role: (m.role === "system" || m.role === "user") ? "user" : "model",
        parts: [{ text: m.content }],
      }));
      return { contents };
    },
    extractReply: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null,
  },
};

// ── API Key Mapping ke Environment Variable ──────────────────
const KEY_ENV_MAP: Record<string, string> = {
  groq:       "GROQ_API_KEY",
  xai:        "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras:   "CEREBRAS_API_KEY",
  gemini:     "GEMINI_API_KEY",
};

// ── Serve ────────────────────────────────────────────────────
serve(async (req: Request): Promise<Response> => {
  // ── OPTIONS preflight ──────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const provider: string = body.provider || "";
    const messages: Record<string, unknown>[] = body.messages;
    const model: string = body.model || getDefaultModel(provider);
    const maxTokens: number = body.max_tokens || 500;

    // ── Validasi ─────────────────────────────────────────
    if (!provider || !PROVIDER_CONFIG[provider]) {
      return new Response(
        JSON.stringify({ error: `Provider '${provider}' tidak didukung. Pilih: ${Object.keys(PROVIDER_CONFIG).join(", ")}` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Field 'messages' harus berupa array dan tidak boleh kosong" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Ambil API key dari secret ────────────────────────
    const envKey = KEY_ENV_MAP[provider];
    const apiKey = Deno.env.get(envKey);
    if (!apiKey) {
      console.error(`Secret ${envKey} tidak ditemukan.`);
      return new Response(
        JSON.stringify({ error: `Server misconfiguration: '${envKey}' secret tidak ditemukan` }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Build provider-specific request ──────────────────
    const cfg = PROVIDER_CONFIG[provider];
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...cfg.authHeader(apiKey),
    };

    const requestBody = cfg.buildBody(messages, model, maxTokens);

    // Gemini: API key sebagai query param di URL
    let url = cfg.url;
    if (provider === "gemini") {
      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    }

    // ── Forward ke provider ──────────────────────────────
    console.log(`[api-proxy] ${provider} | ${messages.length} msg | model: ${model}`);

    const upstream = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    const upstreamData = await upstream.json();

    if (!upstream.ok) {
      console.error(`[api-proxy] ${provider} error (${upstream.status}):`, upstreamData);
      return new Response(
        JSON.stringify({ error: `${provider} API error`, status: upstream.status, detail: upstreamData }),
        { status: upstream.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Ekstrak balasan ──────────────────────────────────
    const replyText = cfg.extractReply(upstreamData);
    if (!replyText) {
      return new Response(
        JSON.stringify({ error: `${provider} response tidak mengandung teks`, detail: upstreamData }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── Kembalikan dalam format OpenAI-compatible ────────
    return new Response(
      JSON.stringify({
        id: upstreamData.id || "",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: replyText }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[api-proxy] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});

/** Default model per provider */
function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    groq:       "llama-3.3-70b-versatile",
    xai:        "grok-2-1212",
    openrouter: "google/gemini-2.0-flash-001",
    cerebras:   "llama3.1-8b",
    gemini:     "gemini-2.0-flash",
  };
  return defaults[provider] || "gpt-3.5-turbo";
}
