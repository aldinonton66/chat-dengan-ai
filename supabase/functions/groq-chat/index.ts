/**
 * Supabase Edge Function: groq-chat
 * ====================================
 * Proxy multi-provider dengan FALLBACK SEQUENTIAL.
 * Loop provider satu per satu (for + await), begitu sukses STOP.
 * TIDAK pakai Promise.all — ini penting buat hemat quota!
 *
 * Prioritas: groq → xai → openrouter → cerebras → gemini
 *
 * Cara pakai:
 *   POST https://<project>.supabase.co/functions/v1/groq-chat
 *   Header: Authorization: Bearer <SUPABASE_ANON_KEY>
 *   Body: { messages: [{role:"user", content:"..."}], max_tokens?:500 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

// ── Provider config (tanpa API key — key diambil di runtime) ─
interface ProviderDef {
  name: string;
  secretKey: string;
  defaultModel: string;
  /** Build fetch options — apiKey di-inject dari luar */
  buildRequest: (apiKey: string, messages: Record<string, unknown>[], maxTokens: number) => {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
  extractReply: (data: Record<string, unknown>) => string | null;
}

const PROVIDERS: ProviderDef[] = [
  {
    name: "groq",
    secretKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "llama-3.3-70b-versatile", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "xai",
    secretKey: "XAI_API_KEY",
    defaultModel: "grok-beta",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.x.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "grok-beta", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "openrouter",
    secretKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "openai/gpt-4o-mini", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "cerebras",
    secretKey: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    buildRequest: (apiKey, msgs, maxTokens) => ({
      url: "https://api.cerebras.ai/v1/chat/completions",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: { model: "llama-3.3-70b", messages: msgs, max_tokens: maxTokens },
    }),
    extractReply: (data) => data?.choices?.[0]?.message?.content ?? null,
  },
  {
    name: "gemini",
    secretKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    buildRequest: (apiKey, msgs, _maxTokens) => {
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
    extractReply: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null,
  },
];

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

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Field 'messages' harus array dan tidak boleh kosong" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // FALLBACK LOOP SEQUENTIAL — coba 1 per 1, sukses → STOP
    // ═══════════════════════════════════════════════════════
    const errors: string[] = [];

    for (let i = 0; i < PROVIDERS.length; i++) {
      const prov = PROVIDERS[i];
      const attempt = i + 1;

      // Ambil API key DARI SECRET (di dalam loop, bukan dari closure)
      const apiKey = Deno.env.get(prov.secretKey);
      if (!apiKey) {
        console.log(`[fallback] #${attempt} SKIP ${prov.name}: secret tidak ditemukan`);
        errors.push(`${prov.name}: secret not set`);
        continue;
      }

      console.log(`[fallback] #${attempt} MENCOBA ${prov.name} (model: ${prov.defaultModel})...`);

      try {
        const { url, headers, body: reqBody } = prov.buildRequest(apiKey, messages, maxTokens);

        const upstream = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(reqBody),
        });

        const upstreamData = await upstream.json();

        if (!upstream.ok) {
          const errMsg = upstreamData?.error?.message || JSON.stringify(upstreamData).substring(0, 150);
          console.log(`[fallback] #${attempt} ${prov.name} GAGAL (HTTP ${upstream.status}): ${errMsg}`);
          errors.push(`${prov.name}: HTTP ${upstream.status}`);
          continue; // ⟶ coba provider berikutnya
        }

        const replyText = prov.extractReply(upstreamData);
        if (!replyText) {
          console.log(`[fallback] #${attempt} ${prov.name} GAGAL: response kosong`);
          errors.push(`${prov.name}: empty reply`);
          continue; // ⟶ coba provider berikutnya
        }

        // ── SUKSES! Langsung return, STOP loop ──────────
        console.log(`[fallback] #${attempt} ${prov.name} SUKSES ✅ (${replyText.length} karakter) → STOP`);
        return new Response(
          JSON.stringify({
            success: true,
            provider: prov.name,
            id: upstreamData.id || "",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: replyText }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );

      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.log(`[fallback] #${attempt} ${prov.name} GAGAL (network): ${msg}`);
        errors.push(`${prov.name}: network error`);
        // ⟶ lanjut ke provider berikutnya
      }
    }

    // Semua gagal
    console.error(`[fallback] SEMUA ${PROVIDERS.length} PROVIDER GAGAL:`, errors);
    return new Response(
      JSON.stringify({ success: false, error: "Semua provider AI gagal.", details: errors }),
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
