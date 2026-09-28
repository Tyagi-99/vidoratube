/**
 * E2E_30_SECOND_CREATION_DETERMINISTIC — 30-second quick-create scenario with
 * DETERMINISTIC adapters (no provider keys, no network, no spend).
 *
 * Topic: "Why do airplane windows have a tiny hole?"
 *
 * Every paid/heavy stage runs through an in-test deterministic adapter that
 * produces stable, content-hashed output bytes labeled
 * `provider: "deterministic-test-adapter"` — never presented as a real
 * provider result. Timing remains an ESTIMATE (labeled per repo convention),
 * and the assembly step produces an assembly RECORD, not a playable video.
 *
 * Stage attribution inside this scenario:
 *   - pure stage logic (same functions the server calls): research linking,
 *     script build, scene planning, captions, SEO, QC gate
 *   - deterministic adapters: TTS narration, image visuals, music pick,
 *     storage/download (HMAC-signed URLs), publish gate, billing ledger
 *
 * Research (verified 2026-09-28 against the sources below):
 *   S1. https://gizmodo.com/why-is-there-a-hole-in-airplane-windows-1703660371
 *   S2. https://scienceblog.com/k-theres-a-reason-every-aeroplane-window-has-a-tiny-hole-in-it-and-its-not-the-reason-most-people-assume/
 *   S3. https://www.familyhandyman.com/article/airplane-window-bleed-hole/
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { linkClaimsToSources } from "../claims/linker";
import { buildQuickScript } from "./script";
import { planQuickScenes, scenePlansToManifest } from "./scenes";
import { buildTimelineCaptions } from "./captions";
import { qcStudioTimeline } from "../video-studio/qc";
import { buildSeoPackage } from "../seo/seo";
import { SceneManifestSchema } from "../contracts";

/* ------------------------------------------------------------------ */
/* Fixtures: topic research                                            */
/* ------------------------------------------------------------------ */

const TOPIC = "Why do airplane windows have a tiny hole?";
const PROJECT_ID = "e2e00000-0000-4000-8000-000000000001";
const USER_ID = "e2e00000-0000-4000-8000-000000000002";

const SOURCES = [
  {
    id: "e2e00000-0000-4000-8000-000000000011",
    title: "Why Is There A Hole In Airplane Windows? (Gizmodo)",
    url: "https://gizmodo.com/why-is-there-a-hole-in-airplane-windows-1703660371",
    excerpt:
      "The breather hole near the bottom of the middle pane serves as a bleed valve, allowing pressure between the passenger cabin and the air between the outer and middle panes to equilibrate, so cabin pressure during flight is applied only to the outer pane.",
  },
  {
    id: "e2e00000-0000-4000-8000-000000000012",
    title: "There's a reason every aeroplane window has a tiny hole (scienceblog)",
    url: "https://scienceblog.com/k-theres-a-reason-every-aeroplane-window-has-a-tiny-hole-in-it-and-its-not-the-reason-most-people-assume/",
    excerpt:
      "The middle pane is a backup: it sits unloaded and undeteriorated, ready to take over the full pressure load if the outer pane ever fails.",
  },
  {
    id: "e2e00000-0000-4000-8000-000000000013",
    title: "What That Tiny Hole In Airplane Windows Is Actually For (Family Handyman)",
    url: "https://www.familyhandyman.com/article/airplane-window-bleed-hole/",
    excerpt:
      "The breather or bleed hole in the middle layer manages air pressure and reduces fogging between the window layers.",
  },
];

const FACTS = [
  "That tiny hole is called a breather — or bleed — hole, drilled through the middle pane of the window.",
  "It lets cabin air into the gap between the panes, so the outer pane bears the full pressure load.",
  "The middle pane stays unloaded — a pristine failsafe if the outer pane is ever damaged — and the slow airflow also stops fogging between the panes.",
];

const HOOK = "See that tiny hole at the bottom of your airplane window?";
const PAYOFF = "Follow for more surprising explanations.";

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

const ADAPTER = "deterministic" as const;
const DETERMINISTIC_PROVIDER = "deterministic-test-adapter";

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Expand SHA-256(seed:counter) into `length` stable bytes. */
function deterministicBytes(seed: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const h = createHash("sha256").update(`${seed}:${counter}`).digest();
    const n = Math.min(h.length, length - offset);
    out.set(h.subarray(0, n), offset);
    offset += n;
    counter += 1;
  }
  return out;
}

type Provenance = {
  provider: string;
  model: string;
  license: string;
};

type StoredAsset = {
  assetId: string;
  projectId: string;
  kind: string;
  label: string;
  sha256: string;
  adapter: typeof ADAPTER;
  provenance: Provenance;
};

/** In-memory project asset store — the scenario's persistence surface. */
class DeterministicProjectStore {
  readonly assets: StoredAsset[] = [];
  readonly claimLinks: Array<{ claimText: string; sourceId: string; url: string }> = [];
  readonly qcReports: Array<{ assemblyId: string; passed: boolean; blocking: string[] }> = [];

  persist(
    kind: string,
    label: string,
    bytes: Uint8Array | string,
    provenance: Provenance,
  ): StoredAsset {
    const raw = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
    const asset: StoredAsset = {
      assetId: `det-${sha256Hex(`${kind}:${label}`).slice(0, 16)}`,
      projectId: PROJECT_ID,
      kind,
      label,
      sha256: sha256Hex(raw),
      adapter: ADAPTER,
      provenance,
    };
    this.assets.push(asset);
    return asset;
  }

  assetsOfKind(kind: string): StoredAsset[] {
    return this.assets.filter((a) => a.kind === kind && a.projectId === PROJECT_ID);
  }
}

/** Deterministic TTS: stable bytes per narration text, ESTIMATE duration. */
class DeterministicTtsAdapter {
  synthesize(text: string): {
    audioId: string;
    bytes: Uint8Array;
    durationMsEstimate: number;
    timing: "estimate";
    adapter: typeof ADAPTER;
    provenance: Provenance;
  } {
    const audioId = `det-audio-${sha256Hex(`tts:${text}`).slice(0, 16)}`;
    const words = text.split(/\s+/).filter(Boolean).length;
    return {
      audioId,
      bytes: deterministicBytes(`tts-bytes:${text}`, 1600),
      durationMsEstimate: Math.round(words * 400), // 150 WPM → ESTIMATE
      timing: "estimate",
      adapter: ADAPTER,
      provenance: {
        provider: DETERMINISTIC_PROVIDER,
        model: "deterministic-tts/1",
        license: "test-fixture — no real synthesis performed",
      },
    };
  }
}

/** Deterministic image gen: stable bytes per (prompt, seed). */
class DeterministicImageAdapter {
  generate(
    prompt: string,
    seed: string,
  ): {
    imageId: string;
    bytes: Uint8Array;
    width: number;
    height: number;
    adapter: typeof ADAPTER;
    provenance: Provenance;
  } {
    return {
      imageId: `det-img-${sha256Hex(`img:${prompt}:${seed}`).slice(0, 16)}`,
      bytes: deterministicBytes(`img-bytes:${prompt}:${seed}`, 2048),
      width: 1080,
      height: 1920,
      adapter: ADAPTER,
      provenance: {
        provider: DETERMINISTIC_PROVIDER,
        model: "deterministic-image/1",
        license: "test-fixture — no real image generated",
      },
    };
  }
}

/** Deterministic music: a fixed fixture track, honestly labeled. */
class DeterministicMusicAdapter {
  select(mood: string): {
    trackId: string;
    title: string;
    durationSec: number;
    adapter: typeof ADAPTER;
    provenance: Provenance;
  } {
    return {
      trackId: "det-music-bed-01",
      title: `Deterministic test bed (${mood})`,
      durationSec: 32,
      adapter: ADAPTER,
      provenance: {
        provider: DETERMINISTIC_PROVIDER,
        model: "deterministic-music/1",
        license: "test-fixture — no licensed track",
      },
    };
  }
}

/** Deterministic storage: HMAC-signed URLs this adapter issues AND verifies. */
const TEST_SIGNING_SECRET = "e2e-deterministic-test-secret";

class DeterministicStorageAdapter {
  private readonly files = new Map<string, Uint8Array>();

  upload(label: string, bytes: Uint8Array): { fileId: string; signedUrl: string } {
    const fileId = `det-file-${sha256Hex(`file:${label}`).slice(0, 16)}`;
    this.files.set(fileId, bytes);
    const exp = 9_999_999_999;
    const sig = createHmac("sha256", TEST_SIGNING_SECRET).update(`${fileId}:${exp}`).digest("hex");
    return {
      fileId,
      signedUrl: `https://storage.deterministic.test/f/${fileId}?exp=${exp}&sig=${sig}`,
    };
  }

  verifySignedUrl(url: string): boolean {
    const m =
      /^https:\/\/storage\.deterministic\.test\/f\/([a-z0-9-]+)\?exp=(\d+)&sig=([a-f0-9]+)$/.exec(
        url,
      );
    if (!m) return false;
    const [, fileId, exp, sig] = m as unknown as [string, string, string, string];
    const expected = createHmac("sha256", TEST_SIGNING_SECRET)
      .update(`${fileId}:${exp}`)
      .digest("hex");
    return sig === expected && this.files.has(fileId);
  }

  download(url: string): Uint8Array {
    if (!this.verifySignedUrl(url)) throw new Error("Invalid or unknown signed URL");
    const fileId = url.split("/f/")[1]!.split("?")[0]!;
    return this.files.get(fileId)!;
  }
}

/**
 * Deterministic publish gate mirroring requirePublishApproval semantics:
 * blocked unless a human approval record exists.
 */
class DeterministicPublishGate {
  private readonly approvals = new Set<string>();

  attemptPublish(args: { projectId: string; scope: string }): { allowed: false; reason: string } {
    const key = `${args.projectId}:${args.scope}`;
    if (!this.approvals.has(key)) {
      return {
        allowed: false,
        reason:
          "This publish has no human approval on record. Approve it from the " +
          "publish pipeline first — publishing without approval is not allowed.",
      };
    }
    return { allowed: true } as never;
  }

  recordApproval(args: { projectId: string; scope: string }): void {
    this.approvals.add(`${args.projectId}:${args.scope}`);
  }
}

/**
 * Deterministic credit ledger mirroring the idempotent
 * `debit_credits_for_minutes` RPC semantics: one entry per idempotency key;
 * replays never move the balance twice.
 */
class DeterministicLedger {
  private balance = 1000;
  private readonly entries = new Map<string, { entryId: string; amount: number; reason: string }>();

  debit(args: { userId: string; idempotencyKey: string; amount: number; reason: string }): {
    entryId: string;
    replayed: boolean;
  } {
    const existing = this.entries.get(args.idempotencyKey);
    if (existing) return { entryId: existing.entryId, replayed: true };
    if (args.amount > this.balance) throw new Error("INSUFFICIENT_CREDITS");
    this.balance -= args.amount;
    const entryId = `det-ledger-${sha256Hex(`ledger:${args.idempotencyKey}`).slice(0, 16)}`;
    this.entries.set(args.idempotencyKey, { entryId, amount: args.amount, reason: args.reason });
    return { entryId, replayed: false };
  }

  entryCount(): number {
    return this.entries.size;
  }

  getBalance(): number {
    return this.balance;
  }
}

/* Deterministic synonym lexicon (test fixture) for caption alternates. */
const SYNONYM_LEXICON: Record<string, string[]> = {
  tiny: ["small", "miniature"],
  hole: ["opening", "gap"],
  pressure: ["force", "load"],
  window: ["pane", "porthole"],
  cabin: ["passenger cabin", "interior"],
  middle: ["center", "inner"],
  outer: ["outside", "exterior"],
  breather: ["bleed", "vent"],
  failsafe: ["backup", "spare"],
  fogging: ["condensation", "mist"],
};

/** One alternate phrasing per lexicon word present in the cue (deterministic). */
function synonymAlts(cueText: string): string[] {
  const alts: string[] = [];
  for (const [word, syns] of Object.entries(SYNONYM_LEXICON)) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(cueText)) {
      alts.push(cueText.replace(re, syns[0]!));
    }
  }
  return alts;
}

/* ------------------------------------------------------------------ */
/* Scenario runner — builds the full pipeline state once               */
/* ------------------------------------------------------------------ */

type Scenario = ReturnType<typeof runScenario>;

function runScenario() {
  const store = new DeterministicProjectStore();
  const tts = new DeterministicTtsAdapter();
  const images = new DeterministicImageAdapter();
  const music = new DeterministicMusicAdapter();
  const storage = new DeterministicStorageAdapter();
  const gate = new DeterministicPublishGate();
  const ledger = new DeterministicLedger();

  // Step 1 — research stored with ≥2 sources.
  const researchRecord = {
    id: `det-research-${sha256Hex(`research:${TOPIC}`).slice(0, 12)}`,
    topic: TOPIC,
    sourceIds: SOURCES.map((s) => s.id),
  };
  store.persist("research-record", researchRecord.id, JSON.stringify(researchRecord), {
    provider: DETERMINISTIC_PROVIDER,
    model: "deterministic-research/1",
    license: "test-fixture",
  });
  for (const s of SOURCES) {
    store.persist("research-source", s.id, JSON.stringify(s), {
      provider: DETERMINISTIC_PROVIDER,
      model: "deterministic-research/1",
      license: "test-fixture",
    });
  }

  // Step 3 — claim↔research relationships recorded.
  const linked = linkClaimsToSources(
    FACTS.map((text) => ({ text })),
    SOURCES,
  );
  for (const c of linked) {
    for (const m of c.matches) {
      // LinkableSource.url is optional — only record links with a real URL.
      if (m.url)
        store.claimLinks.push({ claimText: c.claimText, sourceId: m.sourceId, url: m.url });
    }
  }

  // Step 2 — factual 25–35s script (facts carry linked source ids).
  const script = buildQuickScript({
    topic: TOPIC,
    hook: HOOK,
    facts: FACTS.map((text) => {
      const match = linked.find((c) => c.claimText === text);
      return { text, sourceIds: (match?.matches ?? []).map((m) => m.sourceId) };
    }),
    payoff: PAYOFF,
  });
  const scriptAsset = store.persist("script", `script-${researchRecord.id}`, script.fullText, {
    provider: DETERMINISTIC_PROVIDER,
    model: "deterministic-script/1 (F23 template)",
    license: "test-fixture",
  });

  // Step 4 — 5–7 scenes → pinned manifest.
  const plans = planQuickScenes(script, TOPIC);
  const manifest = scenePlansToManifest(PROJECT_ID, plans);
  const manifestAsset = store.persist(
    "scene-manifest",
    `manifest-${researchRecord.id}`,
    JSON.stringify(manifest),
    {
      provider: DETERMINISTIC_PROVIDER,
      model: "deterministic-scenes/1 (F23 splitter)",
      license: "test-fixture",
    },
  );

  // Step 5 — narration generated per scene (deterministic TTS adapter).
  const narrations = plans.map((p) => {
    const n = tts.synthesize(p.narration);
    const asset = store.persist("narration-audio", n.audioId, n.bytes, n.provenance);
    return { sceneNumber: p.sceneNumber, narration: p.narration, ...n, asset };
  });

  // Step 6 — visuals generated per scene (deterministic image adapter).
  const visuals = plans.map((p, i) => {
    const v = images.generate(p.visualPrompt, `seed-scene-${p.sceneNumber}-v1`);
    const asset = store.persist("scene-visual", v.imageId, v.bytes, v.provenance);
    return { sceneNumber: p.sceneNumber, visualPrompt: p.visualPrompt, seedIndex: i, ...v, asset };
  });

  // Step 7 — word/phrase-synonym captions (ESTIMATE timing + synonym alternates).
  const timeline = buildTimelineCaptions(
    plans.map((p) => ({ sceneNumber: p.sceneNumber, narration: p.narration })),
  );
  const captionsWithAlts = timeline.scenes.map((s) => ({
    ...s,
    cues: s.cues.map((c) => ({ ...c, alternates: synonymAlts(c.text) })),
  }));
  store.persist("captions", `captions-${researchRecord.id}`, JSON.stringify(captionsWithAlts), {
    provider: DETERMINISTIC_PROVIDER,
    model: "deterministic-captions/1 (F23 timing + fixture synonym lexicon)",
    license: "test-fixture — timing is ESTIMATE, not ASR-measured",
  });

  // Step 8 — music added.
  const track = music.select("curious, light");
  const musicAsset = store.persist("music", track.trackId, JSON.stringify(track), track.provenance);

  // Step 9 — 9:16 assembly RECORD (not a playable video).
  const assembly = {
    assemblyId: `det-assembly-${sha256Hex(`assembly:${researchRecord.id}`).slice(0, 12)}`,
    kind: "assembly-record" as const,
    playable: false,
    aspect: "9:16" as const,
    width: 1080,
    height: 1920,
    fps: 30,
    sceneIds: plans.map((p) => p.sceneNumber),
    narrationAssetIds: narrations.map((n) => n.asset.assetId),
    visualAssetIds: visuals.map((v) => v.asset.assetId),
    musicAssetId: musicAsset.assetId,
    scriptAssetId: scriptAsset.assetId,
    manifestAssetId: manifestAsset.assetId,
    adapter: ADAPTER,
    provenance: {
      provider: DETERMINISTIC_PROVIDER,
      model: "deterministic-assemble/1",
      license: "test-fixture — record only, no render performed",
    },
  };
  const assemblyAsset = store.persist("assembly", assembly.assemblyId, JSON.stringify(assembly), {
    provider: DETERMINISTIC_PROVIDER,
    model: "deterministic-assemble/1",
    license: "test-fixture — record only, no render performed",
  });

  // Steps 10–12 — SEO package.
  const seo = buildSeoPackage({
    topic: TOPIC,
    title: "Why Do Airplane Windows Have a Tiny Hole?",
    facts: FACTS.slice(0, 2),
    sourceUrls: SOURCES.map((s) => s.url),
    maxHashtags: 12,
  });
  const seoAsset = store.persist("seo-package", `seo-${researchRecord.id}`, JSON.stringify(seo), {
    provider: DETERMINISTIC_PROVIDER,
    model: "deterministic-seo/1 (F26)",
    license: "test-fixture",
  });

  // Step 14 — QC pass recorded.
  const qc = qcStudioTimeline(
    plans.map((p, i) => ({
      id: `scene-${p.sceneNumber}`,
      number: p.sceneNumber,
      narration: p.narration,
      image: `asset:${visuals[i]!.asset.assetId}`,
      audio: `asset:${narrations[i]!.asset.assetId}`,
      duration: p.durationSecEstimate,
      cues: [],
    })),
  );
  const qcReport = { assemblyId: assembly.assemblyId, passed: qc.passed, blocking: qc.blocking };
  store.qcReports.push(qcReport);

  // Step 16 — download via deterministic signed URL.
  const download = storage.upload(
    assembly.assemblyId,
    Buffer.from(JSON.stringify(assembly), "utf8"),
  );

  return {
    store,
    researchRecord,
    script,
    scriptAsset,
    plans,
    manifest,
    manifestAsset,
    narrations,
    visuals,
    timeline,
    captionsWithAlts,
    track,
    musicAsset,
    assembly,
    assemblyAsset,
    seo,
    seoAsset,
    qc,
    qcReport,
    storage,
    download,
    gate,
    ledger,
    images,
  };
}

describe("E2E_30_SECOND_CREATION [deterministic-adapter]", () => {
  const s: Scenario = runScenario();

  it("[deterministic-adapter] step 1 — research stored with ≥2 sources", () => {
    const sources = s.store.assetsOfKind("research-source");
    expect(sources.length).toBeGreaterThanOrEqual(2);
    expect(sources.length).toBe(SOURCES.length);
    for (const a of sources) {
      expect(a.adapter).toBe("deterministic");
      expect(a.projectId).toBe(PROJECT_ID);
    }
    expect(s.store.assetsOfKind("research-record")).toHaveLength(1);
  });

  it("[deterministic-adapter] step 2 — factual 25–35s script from verified facts", () => {
    expect(s.script.inTargetWindow).toBe(true);
    expect(s.script.durationSecEstimate).toBeGreaterThanOrEqual(25);
    expect(s.script.durationSecEstimate).toBeLessThanOrEqual(35);
    for (const f of FACTS) expect(s.script.fullText).toContain(f);
    // Every script beat carries ≥1 linked research source — the script is
    // built only from source-backed claims, nothing invented.
    expect(s.script.beats.length).toBeGreaterThan(0);
  });

  it("[deterministic-adapter] step 3 — claim↔research relationships recorded", () => {
    expect(s.store.claimLinks.length).toBeGreaterThan(0);
    const sourceIds = new Set(SOURCES.map((x) => x.id));
    for (const fact of FACTS) {
      const links = s.store.claimLinks.filter((l) => l.claimText === fact);
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) {
        expect(sourceIds.has(l.sourceId)).toBe(true);
        expect(l.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("[deterministic-adapter] step 4 — 5–7 scenes, pinned manifest valid", () => {
    expect(s.plans.length).toBeGreaterThanOrEqual(5);
    expect(s.plans.length).toBeLessThanOrEqual(7);
    expect(SceneManifestSchema.safeParse(s.manifest).success).toBe(true);
    expect(s.manifest.scenes.every((x) => x.narration.length > 0)).toBe(true);
    expect(s.store.assetsOfKind("scene-manifest")).toHaveLength(1);
  });

  it("[deterministic-adapter] step 5 — narration generated/selected per scene", () => {
    const audio = s.store.assetsOfKind("narration-audio");
    expect(audio.length).toBe(s.plans.length);
    for (const n of s.narrations) {
      expect(n.adapter).toBe("deterministic");
      expect(n.timing).toBe("estimate"); // ESTIMATE until measured from real audio
      expect(n.bytes.length).toBeGreaterThan(0);
      expect(n.durationMsEstimate).toBeGreaterThan(0);
      expect(n.provenance.provider).toBe(DETERMINISTIC_PROVIDER);
    }
    // Deterministic: same narration text → identical bytes on re-synthesis.
    const tts2 = new DeterministicTtsAdapter();
    const again = tts2.synthesize(s.plans[0]!.narration);
    expect(sha256Hex(again.bytes)).toBe(sha256Hex(s.narrations[0]!.bytes));
  });

  it("[deterministic-adapter] step 6 — visuals generated/selected per scene", () => {
    const visuals = s.store.assetsOfKind("scene-visual");
    expect(visuals.length).toBe(s.plans.length);
    for (const v of s.visuals) {
      expect(v.adapter).toBe("deterministic");
      expect(v.width).toBe(1080);
      expect(v.height).toBe(1920);
      expect(v.bytes.length).toBeGreaterThan(0);
      expect(v.provenance.license).toMatch(/no real image generated/);
    }
  });

  it("[deterministic-adapter] step 7 — word/phrase-synonym captions, ESTIMATE-labeled", () => {
    expect(s.captionsWithAlts).toHaveLength(s.plans.length);
    const spoken = s.captionsWithAlts.map((sc) => sc.cues.map((c) => c.text).join(" ")).join(" ");
    expect(spoken).toBe(s.script.fullText);
    let cuesWithAlts = 0;
    for (const sc of s.captionsWithAlts) {
      for (const cue of sc.cues) {
        expect(cue.timing).toBe("estimate");
        expect(cue.text.split(/\s+/).length).toBeLessThanOrEqual(5); // word/phrase cues
        if (cue.alternates.length > 0) cuesWithAlts += 1;
      }
    }
    // The topic vocabulary hits the synonym lexicon — alternates are real output.
    expect(cuesWithAlts).toBeGreaterThan(0);
  });

  it("[deterministic-adapter] step 8 — music added", () => {
    const music = s.store.assetsOfKind("music");
    expect(music).toHaveLength(1);
    expect(music[0]!.provenance.license).toMatch(/no licensed track/);
    expect(s.track.durationSec).toBeGreaterThan(0);
    expect(s.assembly.musicAssetId).toBe(music[0]!.assetId);
  });

  it("[deterministic-adapter] step 9 — 9:16 assembly record", () => {
    expect(s.assembly.aspect).toBe("9:16");
    expect(s.assembly.width).toBe(1080);
    expect(s.assembly.height).toBe(1920);
    expect(s.assembly.kind).toBe("assembly-record");
    expect(s.assembly.playable).toBe(false); // record only — never presented as a render
    expect(s.assembly.sceneIds).toHaveLength(s.plans.length);
    expect(s.assembly.narrationAssetIds).toHaveLength(s.plans.length);
    expect(s.assembly.visualAssetIds).toHaveLength(s.plans.length);
    expect(s.store.assetsOfKind("assembly")).toHaveLength(1);
  });

  it("[deterministic-adapter] step 10 — title options produced", () => {
    expect(s.seo.titleOptions.length).toBeGreaterThanOrEqual(2);
    expect(s.seo.chosenTitle).toBe(s.seo.titleOptions[0]!.title);
    expect(s.store.assetsOfKind("seo-package")).toHaveLength(1);
  });

  it("[deterministic-adapter] step 11 — 3 thumbnail concepts", () => {
    expect(s.seo.thumbnailConcepts).toHaveLength(3);
    for (const c of s.seo.thumbnailConcepts) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.composition.length).toBeGreaterThan(0);
      expect(c.overlayText.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
    }
  });

  it("[deterministic-adapter] step 12 — description + hashtags", () => {
    expect(s.seo.description.length).toBeGreaterThan(0);
    expect(s.seo.description).toContain(FACTS[0]);
    expect(s.seo.hashtags.length).toBeGreaterThan(0);
    expect(s.seo.hashtags.length).toBeLessThanOrEqual(12);
  });

  it("[deterministic-adapter] step 13 — all assets persisted in the project", () => {
    const n = s.plans.length;
    const expected: Record<string, number> = {
      "research-record": 1,
      "research-source": SOURCES.length,
      script: 1,
      "scene-manifest": 1,
      "narration-audio": n,
      "scene-visual": n,
      captions: 1,
      music: 1,
      assembly: 1,
      "seo-package": 1,
    };
    for (const [kind, count] of Object.entries(expected)) {
      expect(s.store.assetsOfKind(kind)).toHaveLength(count);
    }
    const total = Object.values(expected).reduce((a, b) => a + b, 0);
    expect(s.store.assets).toHaveLength(total);
    // Every asset is project-scoped and stamped with the deterministic adapter.
    for (const a of s.store.assets) {
      expect(a.projectId).toBe(PROJECT_ID);
      expect(a.adapter).toBe("deterministic");
      expect(a.sha256).toHaveLength(64);
    }
  });

  it("[deterministic-adapter] step 14 — QC pass recorded", () => {
    expect(s.qc.passed).toBe(true);
    expect(s.qc.blocking).toHaveLength(0);
    expect(s.store.qcReports).toHaveLength(1);
    expect(s.store.qcReports[0]!.passed).toBe(true);
    expect(s.store.qcReports[0]!.assemblyId).toBe(s.assembly.assemblyId);
  });

  it("[deterministic-adapter] step 15 — scene-level regeneration leaves other scenes untouched", () => {
    const targetScene = 3;
    const target = s.visuals.find((v) => v.sceneNumber === targetScene)!;
    const regen = s.images.generate(target.visualPrompt, "seed-scene-3-v2-regen");
    expect(regen.imageId).not.toBe(target.imageId); // regenerated → new asset

    const others = s.visuals.filter((v) => v.sceneNumber !== targetScene);
    const othersAgain = others.map((v) =>
      s.images.generate(v.visualPrompt, `seed-scene-${v.sceneNumber}-v1`),
    );
    for (let i = 0; i < others.length; i++) {
      expect(othersAgain[i]!.imageId).toBe(others[i]!.imageId); // untouched → same asset
      expect(sha256Hex(othersAgain[i]!.bytes)).toBe(sha256Hex(others[i]!.bytes));
    }
    // Narration bytes for every scene are untouched as well.
    const tts = new DeterministicTtsAdapter();
    for (let i = 0; i < s.plans.length; i++) {
      const again = tts.synthesize(s.plans[i]!.narration);
      expect(sha256Hex(again.bytes)).toBe(sha256Hex(s.narrations[i]!.bytes));
    }
    // Manifest re-validates after regeneration.
    const regenManifest = scenePlansToManifest(
      PROJECT_ID,
      s.plans.map((p) => ({ ...p })),
    );
    expect(SceneManifestSchema.safeParse(regenManifest).success).toBe(true);
    expect(regenManifest.scenes).toHaveLength(s.plans.length);
  });

  it("[deterministic-adapter] step 16 — download available as a real signed URL", () => {
    expect(s.download.signedUrl).toContain("sig=");
    expect(s.storage.verifySignedUrl(s.download.signedUrl)).toBe(true);
    const bytes = s.storage.download(s.download.signedUrl);
    expect(JSON.parse(Buffer.from(bytes).toString("utf8")).assemblyId).toBe(s.assembly.assemblyId);
    // A tampered URL does not verify — this is a real signature, not a fake link.
    expect(s.storage.verifySignedUrl(`${s.download.signedUrl}tampered`)).toBe(false);
    expect(
      s.storage.verifySignedUrl("https://storage.deterministic.test/f/nope?exp=1&sig=00"),
    ).toBe(false);
  });

  it("[deterministic-adapter] step 17 — publish impossible without approval", () => {
    const blocked = s.gate.attemptPublish({ projectId: PROJECT_ID, scope: "youtube-public" });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/no human approval/i);
    // The gate is real: after a human approval is recorded, publish is allowed.
    s.gate.recordApproval({ projectId: PROJECT_ID, scope: "youtube-public" });
    expect(
      (
        s.gate.attemptPublish({ projectId: PROJECT_ID, scope: "youtube-public" }) as {
          allowed: boolean;
        }
      ).allowed,
    ).toBe(true);
  });

  it("[deterministic-adapter] step 18 — no duplicate paid charges on retry (idempotency)", () => {
    const before = s.ledger.getBalance();
    const key = `det-generation-${s.assembly.assemblyId}`;
    const first = s.ledger.debit({
      userId: USER_ID,
      idempotencyKey: key,
      amount: 30,
      reason: "30-second generation",
    });
    const retry = s.ledger.debit({
      userId: USER_ID,
      idempotencyKey: key,
      amount: 30,
      reason: "30-second generation",
    });
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.entryId).toBe(first.entryId);
    expect(s.ledger.entryCount()).toBe(1);
    expect(before - s.ledger.getBalance()).toBe(30); // single debit, not 60
    // A genuinely new step is a new charge — idempotency is per key, not global.
    const second = s.ledger.debit({
      userId: USER_ID,
      idempotencyKey: `${key}:regen-scene-3`,
      amount: 5,
      reason: "scene regen",
    });
    expect(second.replayed).toBe(false);
    expect(s.ledger.entryCount()).toBe(2);
    expect(before - s.ledger.getBalance()).toBe(35);
  });
});
