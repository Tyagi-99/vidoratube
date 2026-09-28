// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceLanguageSection } from "./VoiceLanguageSection";
import { VoiceSettingsControls } from "./VoiceSettingsControls";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice-intel/models";
import { VOICE_MODELS } from "@/lib/voice-intel/catalog";
import type { VoiceModel, VoiceSelection } from "@/lib/voice-intel/types";

/* ── module mocks ─────────────────────────────────────────────────── */

vi.mock("@/lib/voice-intel/voice-intel.functions", () => ({
  previewVoice: vi.fn(),
  compareVoices: vi.fn(),
  getVoiceFavorites: vi.fn(),
  toggleVoiceFavorite: vi.fn(),
  getChannelVoiceDefault: vi.fn(),
  saveChannelVoiceDefault: vi.fn(),
  listVoiceProfiles: vi.fn(),
  saveVoiceProfile: vi.fn(),
  deleteVoiceProfile: vi.fn(),
  getProjectVoiceConfig: vi.fn(),
  saveProjectVoiceConfig: vi.fn(),
}));

// The "My Voices" link needs no router in tests.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn(() => undefined);
  constructor(src?: string) {
    this.src = src ?? "";
  }
}
vi.stubGlobal("Audio", MockAudio);

/* ── helpers ──────────────────────────────────────────────────────── */

async function mockedFns() {
  return await import("@/lib/voice-intel/voice-intel.functions");
}

const adamSelection = (): VoiceSelection => ({
  languageCode: "en",
  categoryId: null,
  characterId: "adam",
  modelId: "auto",
  settings: { ...DEFAULT_VOICE_SETTINGS },
  customised: false,
});

async function mockDefaults() {
  const fns = await mockedFns();
  vi.mocked(fns.getVoiceFavorites).mockResolvedValue({ characterIds: [] });
  vi.mocked(fns.getChannelVoiceDefault).mockResolvedValue({ selection: null });
  vi.mocked(fns.listVoiceProfiles).mockResolvedValue({ profiles: [] });
  vi.mocked(fns.toggleVoiceFavorite).mockResolvedValue({ favorited: true });
  vi.mocked(fns.previewVoice).mockResolvedValue({
    ok: true,
    audioUrl: "blob:mock-audio",
    cached: false,
    characterId: "adam",
    viaFallback: false,
    fallbackNote: null,
  });
  vi.mocked(fns.compareVoices).mockResolvedValue({ results: [] });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await mockDefaults();
});

afterEach(() => {
  cleanup();
});

const smartDefault = () => screen.getByTestId("smart-default");
const summary = () => screen.getByTestId("voice-summary");

async function goAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /advanced/i }));
  // Cards render once the mount hydration completes.
  await screen.findByRole("heading", { name: "Sawyer" });
}

/* ── tests ────────────────────────────────────────────────────────── */

describe("VoiceLanguageSection", () => {
  it("shows the default narrator on mount and auto-selects on language change", async () => {
    const user = userEvent.setup();
    render(<VoiceLanguageSection />);

    // English default: Adam with the Recommended badge.
    expect(within(smartDefault()).getByText("Adam")).toBeInTheDocument();
    expect(within(smartDefault()).getByText("Recommended")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hindi/i }));
    await waitFor(() => {
      expect(within(smartDefault()).getByText("Niraj")).toBeInTheDocument();
    });
    // Unmapped voice: honest badge.
    expect(within(smartDefault()).getByText("Not connected yet")).toBeInTheDocument();
  });

  it("re-ranks the library when a category is selected (real recommend engine)", async () => {
    const user = userEvent.setup();
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    await user.click(screen.getByTestId("category-horror"));
    const panel = await screen.findByRole("tabpanel");
    const headings = within(panel).getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Sawyer");
  });

  it("compare tray: add up to 3, remove, and the 4th is blocked", async () => {
    const user = userEvent.setup();
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    const addBtn = (name: string) =>
      screen.getByRole("button", { name: `Add ${name} to comparison` });

    await user.click(addBtn("Sawyer"));
    await user.click(screen.getByRole("button", { name: "Add Adam to comparison" }));
    await user.click(addBtn("Florence"));

    const bar = await screen.findByTestId("compare-bar");
    expect(bar.textContent).toMatch(/3 voices selected/);

    // Fourth voice is blocked at 3.
    expect(addBtn("Darian")).toBeDisabled();

    // Remove one → back to 2.
    await user.click(screen.getByRole("button", { name: "Remove Sawyer from comparison" }));
    expect(bar.textContent).toMatch(/2 voices selected/);

    // Compare opens the dialog.
    await user.click(within(bar).getByRole("button", { name: /compare/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Compare voices")).toBeInTheDocument();
  });

  it("favorites toggle calls the server function", async () => {
    const user = userEvent.setup();
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    await user.click(screen.getByRole("button", { name: "Add Sawyer to favorites" }));
    const fns = await mockedFns();
    await waitFor(() => {
      expect(vi.mocked(fns.toggleVoiceFavorite)).toHaveBeenCalledWith({
        data: { characterId: "sawyer" },
      });
    });
    expect(
      await screen.findByRole("button", { name: "Remove Sawyer from favorites" }),
    ).toBeInTheDocument();
  });

  it("shows a friendly error and an explicit fallback for unmapped preview", async () => {
    const user = userEvent.setup();
    const fns = await mockedFns();
    vi.mocked(fns.previewVoice).mockResolvedValue({
      ok: false,
      code: "UNMAPPED_VOICE",
      message: "not mapped",
      fallbackCharacterId: "adam",
    });
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    // Pick Sawyer first so "Use Adam instead" visibly changes the selection.
    const sawyerCard = screen.getByTestId("voice-card-sawyer");
    await user.click(within(sawyerCard).getByRole("button", { name: "Use this voice" }));
    expect(within(smartDefault()).getByText("Sawyer")).toBeInTheDocument();

    await user.click(within(sawyerCard).getByRole("button", { name: "Preview Sawyer" }));
    await waitFor(() => {
      expect(vi.mocked(fns.previewVoice)).toHaveBeenCalledWith({
        data: { characterId: "sawyer", text: expect.stringContaining("Some stories") },
      });
    });
    const useInstead = await within(sawyerCard).findByRole("button", {
      name: "Use Adam instead",
    });
    expect(
      within(sawyerCard).getByText(/isn't connected to a narration provider yet/),
    ).toBeInTheDocument();

    await user.click(useInstead);
    await waitFor(() => {
      expect(within(smartDefault()).getByText("Adam")).toBeInTheDocument();
    });
  });

  it("summary panel shows est. duration and cost for the narration text", async () => {
    render(<VoiceLanguageSection narrationText={"a".repeat(1600)} />);
    // 1600 chars @ 800/min → 2.0 min → 2 credits, ≈ 2:00.
    expect(within(summary()).getByText(/2 credits/)).toBeInTheDocument();
    expect(within(summary()).getByText("≈ 2:00")).toBeInTheDocument();
    expect(within(summary()).getByText("Adam")).toBeInTheDocument();
  });

  it("summary panel is honest about an unmapped selection", async () => {
    const user = userEvent.setup();
    render(<VoiceLanguageSection />);
    await user.click(screen.getByRole("button", { name: /hindi/i }));
    await waitFor(() => {
      expect(within(smartDefault()).getByText("Niraj")).toBeInTheDocument();
    });
    expect(
      within(summary()).getByText(/isn't connected to a narration provider yet/),
    ).toBeInTheDocument();
  });

  it("warns when picking a voice that differs from the channel default", async () => {
    const user = userEvent.setup();
    const fns = await mockedFns();
    vi.mocked(fns.getChannelVoiceDefault).mockResolvedValue({
      selection: adamSelection(),
    });
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    const sawyerCard = screen.getByTestId("voice-card-sawyer");
    await user.click(within(sawyerCard).getByRole("button", { name: "Use this voice" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Changing the narrator…")).toBeInTheDocument();
    expect(within(dialog).getByText(/Your channel default is Adam/)).toBeInTheDocument();

    // Keep → stays Adam.
    await user.click(within(dialog).getByRole("button", { name: "Keep Adam" }));
    expect(within(smartDefault()).getByText("Adam")).toBeInTheDocument();
  });

  it("change in the consistency dialog switches the narrator", async () => {
    const user = userEvent.setup();
    const fns = await mockedFns();
    vi.mocked(fns.getChannelVoiceDefault).mockResolvedValue({
      selection: adamSelection(),
    });
    render(<VoiceLanguageSection />);
    await goAdvanced(user);

    const sawyerCard = screen.getByTestId("voice-card-sawyer");
    await user.click(within(sawyerCard).getByRole("button", { name: "Use this voice" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Use Sawyer" }));
    await waitFor(() => {
      expect(within(smartDefault()).getByText("Sawyer")).toBeInTheDocument();
    });
  });

  it("reports the selection through onSelectionChange", async () => {
    const onSelectionChange = vi.fn();
    render(<VoiceLanguageSection onSelectionChange={onSelectionChange} />);
    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.objectContaining({ characterId: "adam", languageCode: "en" }),
      );
    });
  });
});

describe("VoiceSettingsControls", () => {
  const speedOnly: VoiceModel = {
    id: "openai_tts_1",
    provider: "openai",
    label: "OpenAI TTS-1",
    quality: 3,
    speed: "very_fast",
    expressiveness: "low",
    multilingual: true,
    supportedLanguages: ["en"],
    bestFor: "Fallback provider",
    costMultiplier: 1,
    supportedParams: ["speed"],
    maturity: "stable",
    isActive: true,
  };

  it("renders only the model's supported params", () => {
    render(
      <VoiceSettingsControls
        model={speedOnly}
        settings={{ ...DEFAULT_VOICE_SETTINGS }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stability")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Similarity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Style")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Speaker boost")).not.toBeInTheDocument();
  });

  it("renders all controls for a full elevenlabs model", () => {
    const full = VOICE_MODELS[0]!;
    expect(full.supportedParams).toHaveLength(5);
    render(
      <VoiceSettingsControls
        model={full}
        settings={{ ...DEFAULT_VOICE_SETTINGS }}
        onChange={() => {}}
      />,
    );
    for (const label of ["Stability", "Similarity", "Style", "Speed", "Speaker boost"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
