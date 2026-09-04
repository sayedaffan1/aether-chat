export const runtime = "nodejs";

function provider() {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.AETHER_API_KEY?.trim() ||
    "";
  const baseURL = (
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
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
          "Image generation needs an API key that supports /images/generations (OpenAI or a compatible host).",
      },
      { status: 401 },
    );
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body.prompt || "").trim();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!prompt) {
    return Response.json({ error: "Describe the image you want." }, { status: 400 });
  }

  const upstream = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return Response.json(
      {
        error:
          payload?.error?.message ||
          `Image provider returned ${upstream.status}.`,
      },
      { status: 502 },
    );
  }

  const image = payload?.data?.[0];
  const url: string | undefined = image?.url;
  const b64: string | undefined = image?.b64_json;
  const src = url || (b64 ? `data:image/png;base64,${b64}` : null);

  if (!src) {
    return Response.json(
      { error: "The provider did not return an image." },
      { status: 502 },
    );
  }

  return Response.json({ src, revisedPrompt: image?.revised_prompt || prompt });
}
