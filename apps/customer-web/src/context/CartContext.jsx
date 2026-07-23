import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CartContext = createContext(null);
const CART_STORAGE_KEY = 'gastroflow_cart_items';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);

  // Sync cart items to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [items]);

  const addItem = useCallback((menuItem, qty = 1, selectedModifiers = [], notes = '') => {
    setItems(prev => {
      const sortedMods = [...(selectedModifiers || [])].sort((a, b) => a.id.localeCompare(b.id));
      const uniqueId = `${menuItem.id}_${sortedMods.map(m => m.id).join('_')}_${(notes || '').trim()}`;
      const existing = prev.find(i => i.cartId === uniqueId);
      const modifiersPrice = (selectedModifiers || []).reduce((acc, m) => acc + m.priceDelta, 0);
      const itemPrice = menuItem.price + modifiersPrice;

      if (existing) {
        return prev.map(i => i.cartId === uniqueId ? { ...i, qty: i.qty + qty } : i);
      }
      return [...prev, {
        ...menuItem,
        cartId: uniqueId,
        qty,
        selectedModifiers: sortedMods,
        notes: notes.trim(),
        unitPrice: itemPrice
      }];
    });
  }, []);

  const removeItem = useCallback((cartId) => {
    setItems(prev => {
      const existing = prev.find(i => i.cartId === cartId);
      if (existing && existing.qty > 1) {
        return prev.map(i => i.cartId === cartId ? { ...i, qty: i.qty - 1 } : i);
      }
      return prev.filter(i => i.cartId !== cartId);
    });
  }, []);

  const deleteItem = useCallback((cartId) => {
    setItems(prev => prev.filter(i => i.cartId !== cartId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(CART_STORAGE_KEY);
  }, []);

  const totalItems = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

  return (
    <CartContext.Provider value={{
      items, cartOpen, setCartOpen,
      addItem, removeItem, deleteItem, clearCart,
      totalItems, subtotal
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
