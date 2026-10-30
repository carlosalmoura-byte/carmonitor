// Persistência no próprio aparelho (IndexedDB). Cópia de segurança por exportação/importação de JSON.
import { newState, upgradeState } from "./engine.js";

const DB = "carmonitor", STORE = "kv", KEY = "state";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function loadState() {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => {
      const t = db.transaction(STORE).objectStore(STORE).get(KEY);
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    });
    return v ? upgradeState(v) : newState();
  } catch (e) {
    console.warn("IndexedDB indisponível; usando memória.", e);
    return newState();
  }
}

export async function saveState(state) {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(JSON.parse(JSON.stringify(state)), KEY);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}

/** Pede ao navegador para não apagar os dados em caso de pouco espaço. */
export async function requestPersistence() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
