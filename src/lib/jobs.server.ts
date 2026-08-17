const MODEL = "google/gemini-3.5-flash";

export type GeneratedPlan = {
  title: string;
  narration: string;
  scenes: { time: string; visual: string; caption: string }[];
  durationSeconds: number;
};

function fallbackPlan(script: string, format: string): GeneratedPlan {
  const words = script.trim().split(/\s+/);
  const duration = Math.max(30, Math.round((words.length / 150) * 60));
  return {
    title: words.slice(0, 7).join(" ") || "Untitled video",
    narration: script.trim(),
    scenes: [
      { time: "00:00", visual: `${format} establishing shot`, caption: words.slice(0, 12).join(" ") },
      { time: "00:20", visual: "B-roll montage", caption: words.slice(12, 24).join(" ") },
      { time: "00:45", visual: "Closing shot", caption: words.slice(-12).join(" ") },
    ],
    durationSeconds: duration,
  };
}

/** Uses Lovable AI to turn a raw script into narration + a scene breakdown. */
export async function generateVideoPlan(
  script: string,
  format: string,
  voice: string,
): Promise<GeneratedPlan> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return fallbackPlan(script, format);

  const system = `You are the pre-production crew of an AI video studio. Given a raw script you produce:
- a short punchy video title (max 70 chars)
- polished narration copy in a ${format} style, suited to the "${voice}" voice
- a scene-by-scene breakdown (4-8 scenes) with timestamps, a visual description and an on-screen caption
- an estimated duration in seconds
Respond with JSON only.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: script.slice(0, 8000) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "deliver_plan",
              description: "Return the finished pre-production plan",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  narration: { type: "string" },
                  durationSeconds: { type: "number" },
                  scenes: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        time: { type: "string" },
                        visual: { type: "string" },
                        caption: { type: "string" },
                      },
                      required: ["time", "visual", "caption"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["title", "narration", "durationSeconds", "scenes"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "deliver_plan" } },
      }),
    });

    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("NO_CREDITS");
    if (!res.ok) throw new Error(`AI gateway error ${res.status}`);

    const payload = (await res.json()) as {
      choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    };
    const args = payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return fallbackPlan(script, format);

    const parsed = JSON.parse(args) as GeneratedPlan;
    return {
      title: (parsed.title || "Untitled video").slice(0, 90),
      narration: parsed.narration || script,
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes.slice(0, 12) : [],
      durationSeconds: Math.max(15, Math.round(parsed.durationSeconds || 60)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "RATE_LIMIT" || message === "NO_CREDITS") throw error;
    console.error("[vidora] plan generation failed", error);
    return fallbackPlan(script, format);
  }
}

/** Placeholder render output until a render provider is connected. */
export function renderPlaceholders(seed: string) {
  const palettes = ["0f766e", "115e59", "0e7490", "047857", "134e4a"];
  const color = palettes[Math.abs(hash(seed)) % palettes.length];
  return {
    result_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    thumbnail_url: `https://placehold.co/1280x720/${color}/e6fff8/png?text=Vidora`,
  };
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h << 5) - h + value.charCodeAt(i);
  return h;
}
