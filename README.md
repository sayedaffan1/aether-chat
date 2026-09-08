![Status](https://img.shields.io/badge/status-work--in--progress-yellow)

> This project is actively under development. Features may be incomplete or change without notice.
![Status](https://img.shields.io/badge/status-work--in--progress-yellow)

> This project is actively under development. Features may be incomplete or change without notice.
# Aether

Aether is a local AI studio: chat, write code, generate images, and build full websites with a live preview.

![Aether](public/aether-logo.png)

## Run it while you work

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Connect a model

Set these in `.env.local`, or paste a key in **Settings**:

```
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_IMAGE_MODEL=dall-e-3
```

Compatible hosts work too (Groq, OpenRouter) if you point `OPENAI_BASE_URL` at their OpenAI-style API.

## Modes

- **Chat** â€” planning, explanations, product thinking
- **Code** â€” implementations, reviews, debugging
- **Website** â€” one complete HTML file + live iframe + download
- **Image** â€” `/images/generations` (OpenAI-compatible)

Keep developing in this folder; push to GitHub as you go so the remote stays a side-by-side copy of the working tree.


