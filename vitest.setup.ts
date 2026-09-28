import "@testing-library/jest-dom/vitest";

/** jsdom lacks ResizeObserver (used by Radix Slider); stub it. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
