/**
 * Tiny IndexedDB blob store used to park rendered scene segments outside of
 * JS heap memory while a long video is being assembled.
 */

const DB_NAME = "vidora-render";
const STORE = "segments";
/** Segments whose run prefix is older than this are garbage (crashed tab). */
const STALE_PREFIX_MS = 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const close = () => {
          try {
            db.close();
          } catch {
            /* already closed */
          }
        };
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          close();
          reject(error);
        };
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => {
          if (settled) return;
          settled = true;
          resolve(req.result);
        };
        req.onerror = () =>
          fail(
            isQuotaError(req.error)
              ? new Error(
                  "Browser storage is full — free up disk space, then retry the render.",
                )
              : (req.error ?? new Error("IndexedDB write failed")),
          );
        t.oncomplete = close;
        t.onabort = () => fail(t.error ?? new Error("IndexedDB transaction aborted"));
        t.onerror = () => fail(t.error ?? new Error("IndexedDB transaction failed"));
      }),
  );
}

async function allKeys(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
  return keys.filter((k): k is string => typeof k === "string");
}

export const segmentStore = {
  put: (key: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, key) as IDBRequest<IDBValidKey>),
  get: (key: string) => tx<Blob | undefined>("readonly", (s) => s.get(key) as IDBRequest<Blob | undefined>),
  delete: (key: string) => tx("readwrite", (s) => s.delete(key) as IDBRequest<undefined>),
  async clearPrefix(prefix: string) {
    const keys = await allKeys();
    await Promise.all(
      keys.filter((k) => k.startsWith(prefix)).map((k) => segmentStore.delete(k)),
    );
  },
  /**
   * Deletes segment prefixes orphaned by crashed tabs: legacy `r<timestamp>/`
   * prefixes older than 24h, and any prefix whose resume manifest is older
   * than 24h. Safe to call at startup.
   */
  async sweepStaleSegments(now = Date.now()) {
    const keys = await allKeys();
    const prefixes = new Set(keys.map((k) => k.split("/")[0] ?? ""));
    for (const prefix of prefixes) {
      if (!prefix) continue;
      let stale = false;
      const legacy = /^r(\d+)$/.exec(prefix);
      if (legacy) {
        stale = now - Number(legacy[1]) > STALE_PREFIX_MS;
      } else {
        try {
          const manifest = await segmentStore.get(`${prefix}/manifest`);
          if (manifest) {
            const parsed = JSON.parse(await manifest.text()) as { updatedAt?: number };
            stale =
              typeof parsed.updatedAt === "number" && now - parsed.updatedAt > STALE_PREFIX_MS;
          }
        } catch {
          /* unreadable manifest — leave the data alone */
        }
      }
      if (stale) {
        await segmentStore.clearPrefix(prefix).catch(() => undefined);
      }
    }
  },
};
