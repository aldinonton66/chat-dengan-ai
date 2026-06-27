/**
 * Supabase Database Webhook: ai-webhook
 * ========================================
 * Dipanggil setiap ada INSERT di tabel messages.
 * Hanya proses pesan dari manusia (partner1/partner2), bukan dari AI.
 * Panggil Groq API, insert balasan sebagai 'assistant'.
 *
 * Setup di Supabase Dashboard:
 *   Database → Webhooks → Create
 *   - Table: messages
 *   - Events: INSERT
 *   - URL: https://[project].supabase.co/functions/v1/ai-webhook
 *   - Headers: Authorization: Bearer [anon key]
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

interface WebhookPayload {
  type: "INSERT";
  table: string;
  record: {
    id: number;
    room_id: string;
    sender_id: string;
    sender_role: string;
    content: string;
    msg_type: string;
    created_at: string;
  };
  schema: "public";
}

serve(async (req: Request): Promise<Response> => {
  try {
    const payload: WebhookPayload = await req.json();

    // Only respond to human messages, not assistant (avoid loop)
    if (payload.record.sender_role === "assistant") {
      return new Response("ok (ai skip)", { status: 200 });
    }

    const { room_id, content, sender_role, id } = payload.record;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const groqKey = Deno.env.get("GROQ_API_KEY") || "";

    if (!groqKey) {
      console.error("GROQ_API_KEY not set");
      return new Response("missing GROQ_API_KEY", { status: 500 });
    }

    // 1. Fetch last 20 messages in this room for context
    const historyRes = await fetch(
      `${supabaseUrl}/rest/v1/messages?room_id=eq.${room_id}&order=created_at.asc&limit=20`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    const historyRows = await historyRes.json();
    const messages = (Array.isArray(historyRows) ? historyRows : []).map((r: Record<string, unknown>) => ({
      role: r.sender_role === "assistant" ? "assistant" : "user",
      content: r.content
    }));

    // 2. Build system prompt from user's AI settings (stored in user_data)
    //    For simplicity, use a generic system prompt
    const systemMsg = {
      role: "system",
      content: "Kamu adalah Teman AI, teman bicara yang hangat dan setia. Gunakan bahasa Indonesia yang natural. Jawab langsung tanpa markdown."
    };

    // 3. Call Groq
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [systemMsg, ...messages],
        max_tokens: 300
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", errText);
      return new Response("groq error", { status: 502 });
    }

    const groqData = await groqRes.json();
    const reply = groqData?.choices?.[0]?.message?.content;
    if (!reply) {
      return new Response("empty reply", { status: 502 });
    }

    // 4. Insert AI response back to messages table
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        room_id,
        sender_id: "00000000-0000-0000-0000-000000000000", // AI system user
        sender_role: "assistant",
        content: reply,
        msg_type: "text"
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("Insert error:", errText);
      return new Response("insert error", { status: 502 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("ai-webhook error:", err);
    return new Response("internal error", { status: 500 });
  }
});
