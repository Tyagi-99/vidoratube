import { useRef, type ChangeEvent, type DragEvent } from "react";
import "@/styles/auto-edit-studio.css";

function Dropzone({
  accept,
  icon,
  title,
  hint,
  filled,
  filledLabel,
  onFile,
}: {
  accept: string;
  icon: string;
  title: string;
  hint: string;
  filled: boolean;
  filledLabel: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const take = (list: FileList | null) => {
    if (!list?.length) return;
    onFile(list[0]!);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    take(e.dataTransfer.files);
  };

  const cls = ["dz", filled ? "is-filled" : ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <span className="dz__icon" aria-hidden="true">
        {filled ? "✓" : icon}
      </span>
      <span className="dz__body">
        <span className="dz__title">{filled ? filledLabel : title}</span>
        <span className="dz__hint">{hint}</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

export function AutoEditStudio({
  file,
  audioName,
  busy,
  onClose,
  onReset,
  onPickFile,
  onPickAudio,
  onGenerate,
}: {
  file: File | null;
  audioName: string | null;
  busy: boolean;
  onClose: () => void;
  onReset: () => void;
  onPickFile: (file: File) => void;
  onPickAudio: (file: File) => void;
  onGenerate: () => void;
}) {
  const ready = Boolean(file);

  return (
    <main className="app ae-app">
      <div className="projbar projbar--onboard">
        <div className="projbar__id">
          <button type="button" className="brand__back" onClick={onClose} title="Back to studio">
            ←
          </button>
          <button type="button" className="brand__proj" title="Project">
            {file ? file.name.replace(/\.[^.]+$/, "") : "Untitled project"}
          </button>
          <button type="button" className="ext-link" onClick={onReset}>
            New project
          </button>
        </div>
      </div>

      <div className="content">
      <section className="onboard">
        <h1 className="onboard__h">Sync your images to a voiceover, automatically.</h1>
        <p className="onboard__p">
          Name each image or video clip with the second it appears — <code>0-03.png</code> or
          <code>0-03.mp4</code> cuts in at 0:03 — then import them with your voiceover. Video clips
          can be trimmed, zoomed, and their sound mixed under the narration. Review everything below,
          then build the timeline.
        </p>

        <div className="onboard__zones">
          <Dropzone
            accept="audio/*"
            icon="♪"
            title="Voiceover audio"
            hint="One MP3 or WAV — sets the total length"
            filled={Boolean(audioName)}
            filledLabel={audioName || ""}
            onFile={onPickAudio}
          />
          <Dropzone
            accept="video/*,image/*"
            icon="▦"
            title={file ? "Add more media" : "Storyboard images & video"}
            hint="Images or video clips, named by timestamp (0-00, 0-06…). Drop files or whole folders — even several at once."
            filled={Boolean(file)}
            filledLabel={file ? file.name : ""}
            onFile={onPickFile}
          />
        </div>

        <div className="build-row">
          <button
            type="button"
            className="render build"
            disabled={!ready || busy}
            onClick={onGenerate}
          >
            {busy ? "Working…" : "Build timeline →"}
          </button>
          <p className="build-hint">
            {ready ? "Ready to generate." : "Import your storyboard images to begin."}
          </p>
        </div>
      </section>
      </div>
    </main>
  );
}
