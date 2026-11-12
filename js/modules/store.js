/** Persistance locale IndexedDB. Le schéma et les clés restent identiques à la v13. */
export function createStore({ databaseName, storeName, onError = () => {} }) {
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(databaseName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  let dbPromise = null;
  async function db() {
    if (!dbPromise) dbPromise = openDB().catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function get(key) {
    try {
      const database = await db();
      return await new Promise((resolve, reject) => {
        const req = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (error) { onError('IndexedDB lecture : ' + error.message); return null; }
  }
  async function set(key, value) {
    try {
      const database = await db();
      await new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) { onError('IndexedDB écriture : ' + error.message); }
  }
  return { get, set };
}
