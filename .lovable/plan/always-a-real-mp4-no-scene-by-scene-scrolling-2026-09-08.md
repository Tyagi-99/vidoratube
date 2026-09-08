# Always a real MP4 — no scene-by-scene scrolling

## What you'll get

Pressing **Play** on any video always opens a single finished video with the
pictures and voiceover in sync — never the click-through scene viewer you saw.

## How it works

1. If the finished video file already exists, it plays straight away.
2. If it doesn't exist yet, the dialog automatically starts building it
   (the same "Finish video" step you have today, just triggered for you),
   shows a progress line while it works, then plays the finished video with a
   Download and CapCut button underneath.
3. The manual "Finish video" button stays for the list view, but is no longer
   something you must find and press before you can watch anything.
4. The old scene-carousel and standalone voiceover player are removed from the
   preview dialog.

The finished file is saved to your library, so the next Play is instant.

## Technical notes

- `src/components/vidora/JobPreviewDialog.tsx`: drop the stills carousel branch.
  On open, if `result_url` is null but `audio_url` + `assets` exist, call the
  existing `composeQuickJobMp4` pipeline (shared with `ResumeComposeButton`),
  upload to `generated-videos/{userId}/{jobId}/video.mp4`, call
  `finalizeVideoJob`, invalidate the jobs query, and play the returned URL.
- Extract the compose+upload+finalize logic from `ResumeComposeButton.tsx` into
  a shared hook (e.g. `src/lib/render/useComposeJobMp4.ts`) so both the button
  and the dialog use one code path — no duplicated logic, no pipeline change.
- Show `onProgress` labels and an error state with a Retry action; keep the
  render/ffmpeg, audio-ducking and caption-burn behaviour exactly as-is.
- Playback uses `FinalVideoPreview` so Download/CapCut stay consistent.
- Compose runs in the browser, so the tab must stay open while it builds
  (~1-2 minutes); this is unchanged from today.
