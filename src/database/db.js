// GastroFlow POS - REST API Client Wrapper
// Replaces IndexedDB client queries with Node/Express/SQLite3 server requests.

const getAuthHeaders = () => {
  const token = localStorage.getItem('gastroflow_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const initDB = () => {
  return Promise.resolve(true); // Handled automatically by server-side SQL startup
};

export const seedDatabase = () => {
  return Promise.resolve(true); // Handled automatically by server-side SQLite seeders
};

export const db = {
  // Get all rows in a database table
  getAll: async (tableName) => {
    try {
      const response = await fetch(`/api/${tableName}`, {
        headers: getAuthHeaders()
      });
      if (response.status === 401 || response.status === 403) {
        const errJson = await response.clone().json().catch(() => ({}));
        window.dispatchEvent(new CustomEvent('gastroflow_auth_error', { detail: { status: response.status, data: errJson } }));
        return [];
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      // Always return an array — guard against server error objects
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error(`Error querying GET /api/${tableName}:`, err);
      return [];
    }
  },

  // Bulk insert/update rows (no-op here — server handles persistence)
  bulkPut: async (_tableName, _items) => {
    // Data is already persisted on the server; this is a no-op on the client side
    return Promise.resolve();
  },

  // Save/Update row in database table
  put: async (tableName, value) => {
    try {
      const response = await fetch(`/api/${tableName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(value),
      });
      if (response.status === 401 || response.status === 403) {
        const errJson = await response.clone().json().catch(() => ({}));
        window.dispatchEvent(new CustomEvent('gastroflow_auth_error', { detail: { status: response.status, data: errJson } }));
        throw new Error(errJson.error || 'Unauthorized');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP error! status: ${response.status}`);
      return data;
    } catch (err) {
      console.error(`Error querying POST /api/${tableName}:`, err);
      throw err;
    }
  },

  // Delete row by ID
  delete: async (tableName, key) => {
    try {
      const response = await fetch(`/api/${tableName}/${key}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (response.status === 401 || response.status === 403) {
        const errJson = await response.clone().json().catch(() => ({}));
        window.dispatchEvent(new CustomEvent('gastroflow_auth_error', { detail: { status: response.status, data: errJson } }));
        throw new Error(errJson.error || 'Unauthorized');
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error querying DELETE /api/${tableName}/${key}:`, err);
      throw err;
    }
  },

  // Clear table — individual table clears are handled as a single authoritative
  // /api/database/reset call inside importDatabase(). This is a deliberate no-op
  // to prevent the previous bug where 6 parallel calls each wiped the entire DB.
  clear: async (_tableName) => {
    return Promise.resolve();
  },
};
