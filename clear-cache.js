import './styles.css';

function showStatus(message, type = 'success') {
  const status = document.getElementById('status');
  if (!status) return;
  const baseClasses = 'mt-4 text-sm rounded border p-4 shadow';
  const typeClasses = type === 'error'
    ? 'bg-red-100 text-red-800'
    : 'bg-green-100 text-green-800';
  status.textContent = message;
  status.className = `${baseClasses} ${typeClasses}`;
}

export async function clearServiceWorkerCache() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }

      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));

      showStatus('Service worker cache cleared successfully!');
    } else {
      showStatus('Service worker not supported', 'error');
    }
  } catch (error) {
    showStatus(`Error clearing service worker cache: ${error.message}`, 'error');
  }
}

export function clearBrowserCache() {
  try {
    localStorage.clear();
    sessionStorage.clear();

    if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
      indexedDB.databases().then(databases => {
        databases.forEach(db => {
          if (db && db.name) {
            indexedDB.deleteDatabase(db.name);
          }
        });
      });
    }

    showStatus('Browser cache cleared successfully!');
  } catch (error) {
    showStatus(`Error clearing browser cache: ${error.message}`, 'error');
  }
}

export function reloadApp() {
  window.location.href = '/';
}

globalThis.clearServiceWorkerCache = clearServiceWorkerCache;
globalThis.clearBrowserCache = clearBrowserCache;
globalThis.reloadApp = reloadApp;

window.addEventListener('load', () => {
  setTimeout(() => {
    clearServiceWorkerCache();
  }, 1000);
});
