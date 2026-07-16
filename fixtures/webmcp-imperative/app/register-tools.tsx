'use client';

import { useEffect } from 'react';

// Imperative WebMCP registration in a client component. The Phase 4 detector finds the
// `navigator.modelContext.registerTool(...)` call expression in a 'use client' module.
export function RegisterTools() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('modelContext' in navigator)) return;

    navigator.modelContext.registerTool({
      name: 'add_to_cart',
      description: 'Add a product to the shopping cart by SKU.',
      inputSchema: {
        type: 'object',
        properties: { sku: { type: 'string', description: 'Product SKU' } },
        required: ['sku'],
      },
      async execute(args) {
        const sku = String(args.sku ?? '');
        return { content: [{ type: 'text', text: `Added ${sku} to cart.` }] };
      },
    });
  }, []);

  return null;
}
