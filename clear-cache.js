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

export function deleteComplianceIndexedDB() {
  if (!('indexedDB' in window)) {
    showStatus('IndexedDB is not supported in this browser.', 'error');
    return;
  }

  const confirmed = window.confirm('Are you sure you want to delete the ComplianceMatrixDB IndexedDB database?');
  if (!confirmed) {
    showStatus('Deletion cancelled. ComplianceMatrixDB was not removed.');
    return;
  }

  try {
    const request = indexedDB.deleteDatabase('ComplianceMatrixDB');

    request.onsuccess = () => {
      showStatus('ComplianceMatrixDB IndexedDB deleted successfully.');
    };

    request.onerror = () => {
      const message = request.error?.message || 'Unknown error';
      showStatus(`Error deleting ComplianceMatrixDB IndexedDB: ${message}`, 'error');
    };

    request.onblocked = () => {
      showStatus('Deletion blocked. Please close other tabs using the app and try again.', 'error');
    };
  } catch (error) {
    showStatus(`Error deleting ComplianceMatrixDB IndexedDB: ${error.message}`, 'error');
  }
}

const bindings = [
  ['clear-service-worker', clearServiceWorkerCache],
  ['clear-browser', clearBrowserCache],
  ['delete-indexeddb', deleteComplianceIndexedDB],
  ['reload-app', reloadApp],
];

for (const [id, handler] of bindings) {
  const button = document.getElementById(id);
  if (button) {
    button.addEventListener('click', handler);
  }
}

window.addEventListener('load', () => {
  setTimeout(() => {
    clearServiceWorkerCache();
  }, 1000);
});
