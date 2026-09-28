// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceLibraryPage } from "./VoiceLibraryPage";
import {
  getVoiceFavorites,
  listVoiceProfiles,
  saveVoiceProfile,
  toggleVoiceFavorite,
} from "@/lib/voice-intel/voice-intel.functions";

/* ── module mocks ─────────────────────────────────────────────────── */

vi.mock("@/lib/voice-intel/voice-intel.functions", () => ({
  previewVoice: vi.fn(),
  compareVoices: vi.fn(),
  getVoiceFavorites: vi.fn(),
  toggleVoiceFavorite: vi.fn(),
  listVoiceProfiles: vi.fn(),
  saveVoiceProfile: vi.fn(),
  deleteVoiceProfile: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockServer() {
  vi.mocked(getVoiceFavorites).mockResolvedValue({ characterIds: ["adam"] });
  vi.mocked(listVoiceProfiles).mockResolvedValue({ profiles: [] });
}

describe("VoiceLibraryPage", () => {
  it("renders the library heading, language tabs, and English characters", async () => {
    mockServer();
    render(<VoiceLibraryPage />);

    expect(await screen.findByRole("heading", { name: /voice library/i })).toBeInTheDocument();
    // Active language tabs
    expect(screen.getByRole("tab", { name: /english/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /hindi/i })).toBeInTheDocument();
    // Future language is present but disabled
    expect(screen.getByRole("tab", { name: /french/i })).toBeDisabled();
    // English characters render (spotlight default Adam)
    expect(await screen.findByTestId("voice-card-adam")).toBeInTheDocument();
  });

  it("switching to Hindi shows Hindi characters with Niraj default", async () => {
    mockServer();
    const user = userEvent.setup();
    render(<VoiceLibraryPage />);
    await screen.findByTestId("voice-card-adam");

    await user.click(screen.getByRole("tab", { name: /hindi/i }));
    expect(await screen.findByTestId("voice-card-niraj")).toBeInTheDocument();
    expect(screen.queryByTestId("voice-card-adam")).not.toBeInTheDocument();
  });

  it("toggles a favorite through the server function", async () => {
    mockServer();
    vi.mocked(toggleVoiceFavorite).mockResolvedValue({ favorited: true });
    const user = userEvent.setup();
    render(<VoiceLibraryPage />);
    await screen.findByTestId("voice-card-adam");

    const card = screen.getByTestId("voice-card-adam");
    await user.click(within(card).getByRole("button", { name: /favorites/i }));
    await waitFor(() => {
      expect(toggleVoiceFavorite).toHaveBeenCalledWith({ data: { characterId: "adam" } });
    });
  });

  it("saves the spotlighted voice as a profile", async () => {
    mockServer();
    vi.mocked(saveVoiceProfile).mockResolvedValue({
      profile: {
        id: "p1",
        name: "Doc narrator",
        selection: {
          languageCode: "en",
          categoryId: null,
          characterId: "adam",
          modelId: "auto",
          settings: {
            stability: 0.5,
            similarityBoost: 0.75,
            style: 0,
            speed: 1,
            speakerBoost: true,
          },
          customised: false,
        },
        createdAt: new Date().toISOString(),
      },
    });
    const user = userEvent.setup();
    render(<VoiceLibraryPage />);
    await screen.findByTestId("voice-card-adam");

    await user.type(screen.getByLabelText(/profile name/i), "Doc narrator");
    await user.click(screen.getByRole("button", { name: /save current voice/i }));
    await waitFor(() => {
      expect(saveVoiceProfile).toHaveBeenCalledWith({
        data: { name: "Doc narrator", selection: expect.objectContaining({ characterId: "adam" }) },
      });
    });
    expect(await screen.findByText("Doc narrator")).toBeInTheDocument();
  });

  it("links to the legacy TTS lab", async () => {
    mockServer();
    render(<VoiceLibraryPage />);
    await screen.findByTestId("voice-card-adam");
    const labLink = screen.getByRole("link", { name: /tts lab/i });
    expect(labLink).toHaveAttribute("href", "/voices/lab");
  });
});
