/**
 * Tiny IndexedDB blob store used to park rendered scene segments outside of
 * JS heap memory while a long video is being assembled.
 */

const DB_NAME = "vidora-render";
const STORE = "segments";

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

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed"));
        t.oncomplete = () => db.close();
      }),
  );
}

export const segmentStore = {
  put: (key: string, blob: Blob) => tx("readwrite", (s) => s.put(blob, key) as IDBRequest<IDBValidKey>),
  get: (key: string) => tx<Blob | undefined>("readonly", (s) => s.get(key) as IDBRequest<Blob | undefined>),
  delete: (key: string) => tx("readwrite", (s) => s.delete(key) as IDBRequest<undefined>),
  async clearPrefix(prefix: string) {
    const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    await Promise.all(
      keys.filter((k) => typeof k === "string" && k.startsWith(prefix)).map((k) => segmentStore.delete(String(k))),
    );
  },
};
