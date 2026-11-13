/** Persistance locale IndexedDB : clés applicatives + relevés indexés par horodatage. */
export function createStore({ databaseName, storeName, onError = () => {} }) {
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(databaseName, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        if (!db.objectStoreNames.contains('samples')) {
          const samples = db.createObjectStore('samples', { keyPath: 't' });
          samples.createIndex('by_time', 't', { unique: true });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
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
  async function getSamples() {
    try {
      const database = await db();
      return await new Promise((resolve, reject) => {
        const req = database.transaction('samples', 'readonly').objectStore('samples').index('by_time').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (error) { onError('IndexedDB historique : ' + error.message); return []; }
  }
  async function putSamples(records) {
    try {
      const database = await db();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('samples', 'readwrite');
        const store = tx.objectStore('samples');
        store.clear();
        for (const record of records || []) {
          if (record && Number.isFinite(record.t)) store.put(record);
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) { onError('IndexedDB sauvegarde historique : ' + error.message); }
  }
  async function clearSamples() {
    try {
      const database = await db();
      await new Promise((resolve, reject) => {
        const tx = database.transaction('samples', 'readwrite');
        tx.objectStore('samples').clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (error) { onError('IndexedDB effacement historique : ' + error.message); }
  }
  return { get, set, getSamples, putSamples, clearSamples };
}
