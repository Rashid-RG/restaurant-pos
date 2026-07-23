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
        localStorage.removeItem('gastroflow_token');
        window.location.reload();
        throw new Error('Unauthorized');
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error querying GET /api/${tableName}:`, err);
      return [];
    }
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
        localStorage.removeItem('gastroflow_token');
        window.location.reload();
        throw new Error('Unauthorized');
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
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
        localStorage.removeItem('gastroflow_token');
        window.location.reload();
        throw new Error('Unauthorized');
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error querying DELETE /api/${tableName}/${key}:`, err);
      throw err;
    }
  },

  // Clear table / Reset database
  clear: async (tableName) => {
    try {
      const response = await fetch('/api/database/reset', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('gastroflow_token');
        window.location.reload();
        throw new Error('Unauthorized');
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error('Error resetting database:', err);
      throw err;
    }
  },
};
