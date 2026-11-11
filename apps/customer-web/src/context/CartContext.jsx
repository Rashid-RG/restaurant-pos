import { apiFetch } from '../utils/api.js';
import {cartStorageKey,parseSavedCart} from '../utils/cart-storage.js';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const CartContext = createContext(null);
// Legacy shared cart is intentionally not imported: its restaurant cannot be verified.

export function CartProvider({ children, tenantId }) {
  const storageKey = cartStorageKey(tenantId);
  const [items, setItems] = useState(() => {
    try {
      return parseSavedCart(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [rates, setRates] = useState({ taxRate: 0, serviceChargeRate: 0, payhereEnabled: false });
  useEffect(() => { apiFetch('/public/menu').then(menu => setRates({ taxRate: Number(menu.taxRate || 0), serviceChargeRate: Number(menu.serviceChargeRate || 0), payhereEnabled: menu.payhereEnabled === true })).catch(() => {}); }, []);

  // Sync cart items to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [items, storageKey]);

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
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const totalItems = items.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);

  return (
    <CartContext.Provider value={{
      items, cartOpen, setCartOpen, rates, setRates,
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
