import { AETHER_SYSTEM, modeInstruction, type Mode } from "@/lib/prompt";

export const runtime = "nodejs";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

function provider() {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.AETHER_API_KEY?.trim() ||
    "";
  const baseURL = (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  return { apiKey, baseURL, model };
}

export async function POST(req: Request) {
  const headerKey = req.headers.get("x-api-key")?.trim();
  const { apiKey: envKey, baseURL, model } = provider();
  const apiKey = headerKey || envKey;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "Aether needs an API key. Add OPENAI_API_KEY in .env.local, or paste a key in Settings. OpenAI, Groq, and OpenRouter all work if you set OPENAI_BASE_URL.",
      },
      { status: 401 },
    );
  }

  let body: { messages?: IncomingMessage[]; mode?: Mode };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const mode: Mode = body.mode ?? "chat";

  const upstream = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: mode === "code" || mode === "website" ? 0.3 : 0.7,
      messages: [
        { role: "system", content: AETHER_SYSTEM },
        { role: "system", content: modeInstruction(mode) },
        ...messages.filter((m) => m.role === "user" || m.role === "assistant"),
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      {
        error: `The model provider returned ${upstream.status}. ${detail.slice(0, 400)}`,
      },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const token = json.choices?.[0]?.delta?.content;
              if (typeof token === "string" && token) {
                controller.enqueue(encoder.encode(token));
              }
            } catch {
              // ignore keep-alives and partial JSON
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
