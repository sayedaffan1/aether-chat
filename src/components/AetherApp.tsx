"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Mode } from "@/lib/prompt";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageSrc?: string;
  htmlPreview?: string;
};

type Thread = {
  id: string;
  title: string;
  mode: Mode;
  messages: ChatMessage[];
};

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "chat", label: "Chat", hint: "Think with Aether" },
  { id: "code", label: "Code", hint: "Build and debug" },
  { id: "website", label: "Website", hint: "Design in HTML" },
  { id: "image", label: "Image", hint: "Generate visuals" },
];

const STARTERS: Record<Mode, string[]> = {
  chat: [
    "Help me plan a weekend product I can ship in 48 hours",
    "Explain how RAG actually works, with a small architecture",
  ],
  code: [
    "Write a TypeScript REST API with auth, validation, and tests",
    "Review this approach for a Next.js chat app and improve it",
  ],
  website: [
    "Build a striking landing page for a boutique coffee brand",
    "Create a personal portfolio site with projects and contact",
  ],
  image: [
    "A glass constellation mark on deep navy, studio lighting",
    "A cinematic still of a quiet library at dusk, rain on windows",
  ],
};

function uid() {
  return crypto.randomUUID();
}

function extractHtml(text: string): string | undefined {
  const match = text.match(/```html\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function renderMarkdown(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    const fence = part.match(/^```(\w+)?\n?([\s\S]*?)```$/);
    if (fence) {
      return (
        <pre key={i} className="code-block">
          <span className="code-lang">{fence[1] || "text"}</span>
          <code>{fence[2]}</code>
        </pre>
      );
    }
    return (
      <p key={i} className="prose-chunk">
        {part}
      </p>
    );
  });
}

export default function AetherApp() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("chat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    const storedKey = localStorage.getItem("aether-api-key") || "";
    setApiKey(storedKey);
    try {
      const raw = localStorage.getItem("aether-threads");
      if (raw) {
        const parsed = JSON.parse(raw) as Thread[];
        setThreads(parsed);
        if (parsed[0]) setActiveId(parsed[0].id);
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("aether-threads", JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages, busy]);

  const title = useMemo(() => active?.title || "New conversation", [active]);

  function persistKey(value: string) {
    setApiKey(value);
    if (value) localStorage.setItem("aether-api-key", value);
    else localStorage.removeItem("aether-api-key");
  }

  function newThread(nextMode: Mode = mode) {
    const thread: Thread = {
      id: uid(),
      title: "New conversation",
      mode: nextMode,
      messages: [],
    };
    setThreads((prev) => [thread, ...prev]);
    setActiveId(thread.id);
    setMode(nextMode);
    setPreviewHtml(null);
    setError(null);
  }

  function patchThread(id: string, updater: (t: Thread) => Thread) {
    setThreads((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  }

  async function send(text = input) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setInput("");
    setError(null);

    const threadId = activeId ?? uid();
    const userMsg: ChatMessage = { id: uid(), role: "user", content: prompt };
    const existing = threads.find((t) => t.id === threadId);
    const prior = existing?.messages ?? [];

    setThreads((prev) => {
      const found = prev.find((t) => t.id === threadId);
      if (!found) {
        return [
          {
            id: threadId,
            title: prompt.slice(0, 42),
            mode,
            messages: [userMsg],
          },
          ...prev,
        ];
      }
      return prev.map((t) =>
        t.id === threadId
          ? {
              ...t,
              title: t.messages.length === 0 ? prompt.slice(0, 42) : t.title,
              mode,
              messages: [...t.messages, userMsg],
            }
          : t,
      );
    });
    if (!activeId) setActiveId(threadId);

    setBusy(true);
    try {
      if (mode === "image") {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify({ prompt }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Image generation failed");
        const assistant: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: data.revisedPrompt || prompt,
          imageSrc: data.src,
        };
        patchThread(threadId, (t) => ({ ...t, messages: [...t.messages, assistant] }));
        return;
      }

      const history = [...prior, userMsg];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          mode,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Chat failed (${res.status})`);
      }

      const assistantId = uid();
      patchThread(threadId, (t) => ({
        ...t,
        messages: [
          ...t.messages,
          { id: assistantId, role: "assistant", content: "" },
        ],
      }));

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          const snapshot = full;
          patchThread(threadId, (t) => ({
            ...t,
            messages: t.messages.map((m) =>
              m.id === assistantId ? { ...m, content: snapshot } : m,
            ),
          }));
        }
      }

      const html = mode === "website" ? extractHtml(full) : undefined;
      if (html) {
        setPreviewHtml(html);
        patchThread(threadId, (t) => ({
          ...t,
          messages: t.messages.map((m) =>
            m.id === assistantId ? { ...m, htmlPreview: html } : m,
          ),
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function downloadSite(html: string) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aether-site.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/aether-logo.png" alt="Aether" width={40} height={40} />
          <div>
            <strong>Aether</strong>
            <span>Think. Build. Create.</span>
          </div>
        </div>
        <button className="new-chat" onClick={() => newThread(mode)} type="button">
          New conversation
        </button>
        <nav className="thread-list">
          {threads.length === 0 && <p className="empty">No threads yet</p>}
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === activeId ? "thread active" : "thread"}
              onClick={() => {
                setActiveId(t.id);
                setMode(t.mode);
                const lastHtml = [...t.messages].reverse().find((m) => m.htmlPreview);
                setPreviewHtml(lastHtml?.htmlPreview ?? null);
              }}
            >
              {t.title}
            </button>
          ))}
        </nav>
        <button className="settings" type="button" onClick={() => setSettingsOpen(true)}>
          Settings & API key
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Aether · {mode}</p>
            <h1>{title}</h1>
          </div>
          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={mode === m.id ? "mode on" : "mode"}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </header>

        <div className="workspace">
          <section className="chat" ref={scroller}>
            {!active?.messages.length && (
              <div className="welcome">
                <img src="/aether-logo.png" alt="" width={88} height={88} />
                <h2>Aether is ready when you are.</h2>
                <p>
                  Chat, write code, generate images, or ship a full website in one
                  HTML file. Add an API key in Settings to unlock the model.
                </p>
                <div className="starters">
                  {STARTERS[mode].map((s) => (
                    <button key={s} type="button" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {active?.messages.map((m) => (
              <article key={m.id} className={`bubble ${m.role}`}>
                <span className="who">{m.role === "user" ? "You" : "Aether"}</span>
                {m.imageSrc && (
                  <img className="gen" src={m.imageSrc} alt={m.content} />
                )}
                <div className="md">{renderMarkdown(m.content)}</div>
                {m.htmlPreview && (
                  <button
                    type="button"
                    className="preview-btn"
                    onClick={() => setPreviewHtml(m.htmlPreview!)}
                  >
                    Open live preview
                  </button>
                )}
              </article>
            ))}
            {busy && <p className="thinking">Aether is working…</p>}
            {error && <p className="error">{error}</p>}
          </section>

          {previewHtml && (
            <section className="preview">
              <div className="preview-bar">
                <span>Live website</span>
                <div>
                  <button type="button" onClick={() => downloadSite(previewHtml)}>
                    Download HTML
                  </button>
                  <button type="button" onClick={() => setPreviewHtml(null)}>
                    Close
                  </button>
                </div>
              </div>
              <iframe title="Aether website preview" srcDoc={previewHtml} />
            </section>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              MODES.find((m) => m.id === mode)?.hint + " — Enter to send"
            }
            rows={2}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </main>

      {settingsOpen && (
        <div className="modal" onClick={() => setSettingsOpen(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h3>Connect a model</h3>
            <p>
              Paste an OpenAI-compatible key, or put it in{" "}
              <code>.env.local</code> as <code>OPENAI_API_KEY</code>. For Groq
              or OpenRouter, also set <code>OPENAI_BASE_URL</code>.
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => persistKey(e.target.value)}
              placeholder="sk-..."
            />
            <button type="button" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
