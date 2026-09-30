import { useMemo } from "react";
import { calculateLocalCartTotals, useCartStore } from "../store/cartStore";

export const useCartOrchestrator = (freeShippingThreshold = 70) => {
  const cart = useCartStore();
  const totals = useMemo(
    () => calculateLocalCartTotals(cart.items, freeShippingThreshold),
    [cart.items, freeShippingThreshold]
  );
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  return { ...cart, totals, itemCount };
};
