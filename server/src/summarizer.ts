// Optional session summarizer backed by any OpenAI-compatible chat endpoint
// (Ollama, LM Studio, llama.cpp, vLLM, …). Disabled unless a URL is configured.

export interface SummaryConfig {
  url: string; // full chat/completions endpoint
  model: string;
  apiKey: string; // optional
  timeoutMs: number;
}

const SYSTEM_PROMPT =
  "Sos un asistente que resume sesiones de coding con agentes de IA. " +
  "En 1-2 frases en español, decí qué se está haciendo en la sesión y su estado actual. " +
  "Sin preámbulos, sin markdown, máximo 240 caracteres.";

// Returns the summary text, or null on any error (endpoint down, timeout, bad response).
export async function summarize(
  cfg: SummaryConfig,
  messages: { role: string; text: string }[]
): Promise<string | null> {
  if (messages.length === 0) return null;
  const transcript = messages.map((m) => `[${m.role}] ${m.text}`).join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey === "" ? {} : { Authorization: `Bearer ${cfg.apiKey}` }),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 160,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() !== "" ? text.trim() : null;
  } catch {
    return null; // network error / timeout / abort — skip this cycle
  } finally {
    clearTimeout(timer);
  }
}
