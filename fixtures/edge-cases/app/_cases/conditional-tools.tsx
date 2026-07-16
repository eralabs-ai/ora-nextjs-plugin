'use client';

import { useEffect } from 'react';

// Conditional registration: the registerTool call is gated behind a runtime flag. Discovery finds
// the call site; the plugin should surface it (with the metadata evaluated where possible) rather
// than trying to prove the branch is reachable.
const NEWSLETTER_ENABLED = process.env.NEXT_PUBLIC_NEWSLETTER === '1';

export function ConditionalTools() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('modelContext' in navigator)) return;
    if (!NEWSLETTER_ENABLED) return;

    navigator.modelContext.registerTool({
      name: 'join_newsletter',
      description: 'Join the newsletter (only registered when the feature flag is on).',
      async execute() {
        return { content: [{ type: 'text', text: 'joined' }] };
      },
    });
  }, []);

  return null;
}
