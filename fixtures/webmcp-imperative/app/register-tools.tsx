'use client';

import { useEffect } from 'react';

// Imperative WebMCP registration in a client component. The Phase 4 detector finds the
// `document.modelContext.registerTool(...)` call expression in a 'use client' module.
// (`document.modelContext` is the current entry point — the May 2026 draft moved it off
// `navigator`, which Chrome 150+ deprecates; the edge-cases fixture covers the deprecated alias.)
export function RegisterTools() {
  useEffect(() => {
    if (typeof document === 'undefined' || !('modelContext' in document)) return;

    document.modelContext.registerTool({
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
