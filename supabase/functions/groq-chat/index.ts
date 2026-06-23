/**
 * Supabase Edge Function: groq-chat
 * ====================================
 * Proxy aman multi-provider dengan FALLBACK otomatis.
 * Semua API key disimpan sebagai secret di Supabase.
 * Frontend cukup kirim 1 request — function ini yang
 * mencoba provider satu per satu sampai berhasil.
 *
 * Prioritas fallback: groq → xai → openrouter → cerebras → gemini
 *
 * Cara pakai:
 *   POST https://<project>.supabase.co/functions/v1/groq-chat
 *   Header: Authorization: Bearer <SUPABASE_ANON_KEY>
 *   Body:   { messages: [{role:"user", content:"..."}], model?:"...", max_tokens?:500 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── CORS ────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

// ── PROVIDER CONFIG (urutan = prioritas fallback) ────────────
interface ProviderConfig {
  name: string;
  secretKey: string;
  url: string;
  buildRequest: (messages: Record<string, unknown>[], model: string, maxTokens: number) => { url: string; headers: Record<string, string>; body: unknown };
  extractReply: (data: Record<string, unknown>) => string | null;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: "groq",
    secretKey: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    buildRequest: (msgs, model, maxTokens) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")}` },
      body: { model: model || "llama-3.3-70b-versatile", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "xai",
    secretKey: "XAI_API_KEY",
    url: "https://api.x.ai/v1/chat/completions",
    buildRequest: (msgs, model, maxTokens) => ({
      url: "https://api.x.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("XAI_API_KEY")}` },
      body: { model: model || "grok-2-1212", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "openrouter",
    secretKey: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    buildRequest: (msgs, model, maxTokens) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}` },
      body: { model: model || "google/gemini-2.0-flash-001", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "cerebras",
    secretKey: "CEREBRAS_API_KEY",
    url: "https://api.cerebras.ai/v1/chat/completions",
    buildRequest: (msgs, model, maxTokens) => ({
      url: "https://api.cerebras.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("CEREBRAS_API_KEY")}` },
      body: { model: model || "llama3.1-8b", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "gemini",
    secretKey: "GEMINI_API_KEY",
    url: "", // dibangun dinamis
    buildRequest: (msgs, _model, _maxTokens) => {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      const contents = msgs.map((m) => ({
        role: (m.role === "system" || m.role === "user") ? "user" : "model",
        parts: [{ text: m.content }],
      }));
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey || "")}`,
        headers: { "Content-Type": "application/json" },
        body: { contents },
      };
    },
    extractReply: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null,
  },
];

// ── SERVE ────────────────────────────────────────────────────
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
    const messages: Record<string, unknown>[] = body.messages;
    const model: string = body.model || "";
    const maxTokens: number = body.max_tokens || 500;

    // ── Validasi messages ─────────────────────────────────
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Field 'messages' harus berupa array dan tidak boleh kosong" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ── FALLBACK LOOP: coba provider satu per satu ────────
    const errors: string[] = [];

    for (const provider of PROVIDERS) {
      const apiKey = Deno.env.get(provider.secretKey);
      if (!apiKey) {
        console.log(`[fallback] Skip ${provider.name}: secret ${provider.secretKey} tidak ditemukan`);
        errors.push(`${provider.name}: secret not set`);
        continue;
      }

      console.log(`[fallback] Mencoba ${provider.name}...`);

      try {
        const req = provider.buildRequest(messages, model, maxTokens);
        const upstream = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(req.body),
        });

        const upstreamData = await upstream.json();

        if (!upstream.ok) {
          const errMsg = upstreamData?.error?.message || JSON.stringify(upstreamData).substring(0, 120);
          console.log(`[fallback] ${provider.name} GAGAL (HTTP ${upstream.status}): ${errMsg}`);
          errors.push(`${provider.name}: HTTP ${upstream.status} — ${errMsg}`);
          continue; // → coba provider berikutnya
        }

        const replyText = provider.extractReply(upstreamData);
        if (!replyText) {
          console.log(`[fallback] ${provider.name} GAGAL: response tidak mengandung teks`);
          errors.push(`${provider.name}: empty reply`);
          continue;
        }

        // SUKSES!
        console.log(`[fallback] ${provider.name} SUKSES ✅ — ${replyText.length} karakter`);
        return new Response(
          JSON.stringify({
            success: true,
            provider: provider.name,
            id: upstreamData.id || "",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: replyText }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );

      } catch (fetchErr) {
        console.log(`[fallback] ${provider.name} GAGAL (network): ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
        errors.push(`${provider.name}: network error`);
        // Lanjut ke provider berikutnya
      }
    }

    // ── Semua provider gagal ──────────────────────────────
    console.error(`[fallback] SEMUA PROVIDER GAGAL:`, errors);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Semua provider AI gagal — coba lagi nanti.",
        details: errors,
      }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[groq-chat] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", message: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
