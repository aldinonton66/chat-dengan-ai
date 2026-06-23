/**
 * Supabase Edge Function: groq-chat
 * ====================================
 * Proxy aman untuk Groq API.
 * API key Groq disimpan sebagai secret di Supabase (Deno.env.get),
 * TIDAK PERNAH dikirim ke frontend.
 *
 * Cara pakai:
 *   POST https://<project>.supabase.co/functions/v1/groq-chat
 *   Header: Authorization: Bearer <SUPABASE_ANON_KEY>
 *   Body:   { messages: [{role:"user", content:"..."}, ...], model?: "llama-3.3-70b-versatile" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Konfigurasi CORS — perbolehkan frontend domain kalian
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
};

// Endpoint Groq API
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

serve(async (req: Request): Promise<Response> => {
  // ======================================================
  // Tangani preflight CORS (OPTIONS)
  // ======================================================
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // ======================================================
  // Hanya terima POST
  // ======================================================
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    // ======================================================
    // Baca API key Groq dari environment secret Supabase
    // ======================================================
    const groqApiKey = Deno.env.get("GROQ_API_KEY");
    if (!groqApiKey) {
      console.error("GROQ_API_KEY secret tidak ditemukan di Supabase.");
      return new Response(
        JSON.stringify({ error: "Server misconfiguration: API key not set" }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // ======================================================
    // Parse & validasi request body dari frontend
    // ======================================================
    const body = await req.json();

    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Field 'messages' harus berupa array dan tidak boleh kosong" }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    // Validasi setiap message punya role & content
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.role || !msg.content) {
        return new Response(
          JSON.stringify({
            error: `Message index ${i}: field 'role' dan 'content' wajib diisi`,
          }),
          {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          }
        );
      }
    }

    const model = body.model || "llama-3.3-70b-versatile";
    const maxTokens = body.max_tokens || 500;

    // ======================================================
    // Forward request ke Groq API
    // ======================================================
    console.log(`[groq-chat] Forwarding ${messages.length} messages, model: ${model}`);

    const groqResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: maxTokens,
      }),
    });

    // ======================================================
    // Kembalikan response dari Groq ke frontend apa adanya
    // ======================================================
    const responseData = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error(`[groq-chat] Groq API error (${groqResponse.status}):`, responseData);

      return new Response(
        JSON.stringify({
          error: "Groq API error",
          status: groqResponse.status,
          detail: responseData,
        }),
        {
          status: groqResponse.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    // ======================================================
    // Tangani unexpected error
    // ======================================================
    console.error("[groq-chat] Unexpected error:", err);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});
