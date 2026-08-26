'use client';

import { useEffect, useState } from 'react';

// Renders nothing until mounted — the pre-hydration HTML is an honest empty shell, exactly the
// shape the metadata rung exists for.
export function LiveBoard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <p>Departures load here.</p>;
}
