/**
 * Module worker for @ffmpeg/ffmpeg v0.12.
 *
 * The package ships an ESM worker at dist/esm/worker.js, but its package.json
 * "exports" map blocks importing that subpath, so this is a self-contained
 * TypeScript port of that file (same message protocol). FFmpeg.load() spawns
 * the worker with `type: "module"`, which is why a classic/UMD worker script
 * cannot be used.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const FFMessageType = {
  LOAD: "LOAD",
  EXEC: "EXEC",
  FFPROBE: "FFPROBE",
  WRITE_FILE: "WRITE_FILE",
  READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE",
  RENAME: "RENAME",
  CREATE_DIR: "CREATE_DIR",
  LIST_DIR: "LIST_DIR",
  DELETE_DIR: "DELETE_DIR",
  ERROR: "ERROR",
  PROGRESS: "PROGRESS",
  LOG: "LOG",
  MOUNT: "MOUNT",
  UNMOUNT: "UNMOUNT",
} as const;

const ERROR_UNKNOWN_MESSAGE_TYPE = new Error("unknown message type");
const ERROR_NOT_LOADED = new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
const ERROR_IMPORT_FAILURE = new Error("failed to import ffmpeg-core.js");

let ffmpeg: any = null;

type LoadArgs = { coreURL?: string; wasmURL?: string; workerURL?: string };

const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }: LoadArgs) => {
  const first = !ffmpeg;
  const coreURL = _coreURL ?? "/wasm/ffmpeg-core-esm.js";
  try {
    (self as any).createFFmpegCore = (
      await import(/* @vite-ignore */ coreURL)
    ).default;
    if (!(self as any).createFFmpegCore) throw ERROR_IMPORT_FAILURE;
  } catch {
    throw ERROR_IMPORT_FAILURE;
  }
  const wasmURL = _wasmURL ?? coreURL.replace(/.js$/g, ".wasm");
  const workerURL = _workerURL ?? coreURL.replace(/.js$/g, ".worker.js");
  ffmpeg = await (self as any).createFFmpegCore({
    // Encoded wasmURL and workerURL in the URL as a hack to fix locateFile issue.
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger((data: unknown) => (self as any).postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data: unknown) =>
    (self as any).postMessage({ type: FFMessageType.PROGRESS, data }),
  );
  return first;
};

const exec = ({ args, timeout = -1 }: { args: string[]; timeout?: number }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }: { args: string[]; timeout?: number }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }: { path: string; data: Uint8Array }) => {
  ffmpeg.FS.writeFile(path, data);
  return true;
};

const readFile = ({ path, encoding }: { path: string; encoding: string }) =>
  ffmpeg.FS.readFile(path, { encoding });

const deleteFile = ({ path }: { path: string }) => {
  ffmpeg.FS.unlink(path);
  return true;
};

const rename = ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
  ffmpeg.FS.rename(oldPath, newPath);
  return true;
};

const createDir = ({ path }: { path: string }) => {
  ffmpeg.FS.mkdir(path);
  return true;
};

const listDir = ({ path }: { path: string }) => {
  const names = ffmpeg.FS.readdir(path);
  const nodes: { name: string; isDir: boolean }[] = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    nodes.push({ name, isDir: ffmpeg.FS.isDir(stat.mode) });
  }
  return nodes;
};

const deleteDir = ({ path }: { path: string }) => {
  ffmpeg.FS.rmdir(path);
  return true;
};

const mount = ({ fsType, options, mountPoint }: { fsType: string; options: unknown; mountPoint: string }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};

const unmount = ({ mountPoint }: { mountPoint: string }) => {
  ffmpeg.FS.unmount(mountPoint);
  return true;
};

(self as any).onmessage = async ({
  data: { id, type, data: _data },
}: MessageEvent<{ id: number; type: keyof typeof FFMessageType; data: any }>) => {
  const trans: Transferable[] = [];
  let data: any;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;
    switch (type) {
      case FFMessageType.LOAD:
        data = await load(_data);
        break;
      case FFMessageType.EXEC:
        data = exec(_data);
        break;
      case FFMessageType.FFPROBE:
        data = ffprobe(_data);
        break;
      case FFMessageType.WRITE_FILE:
        data = writeFile(_data);
        break;
      case FFMessageType.READ_FILE:
        data = readFile(_data);
        break;
      case FFMessageType.DELETE_FILE:
        data = deleteFile(_data);
        break;
      case FFMessageType.RENAME:
        data = rename(_data);
        break;
      case FFMessageType.CREATE_DIR:
        data = createDir(_data);
        break;
      case FFMessageType.LIST_DIR:
        data = listDir(_data);
        break;
      case FFMessageType.DELETE_DIR:
        data = deleteDir(_data);
        break;
      case FFMessageType.MOUNT:
        data = mount(_data);
        break;
      case FFMessageType.UNMOUNT:
        data = unmount(_data);
        break;
      default:
        throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (e) {
    (self as any).postMessage({ id, type: FFMessageType.ERROR, data: (e as Error).toString() });
    return;
  }
  if (data instanceof Uint8Array) trans.push(data.buffer);
  (self as any).postMessage({ id, type, data }, trans);
};
