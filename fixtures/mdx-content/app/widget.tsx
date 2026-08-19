import type { ReactNode } from 'react';

export function Widget({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h2>{label}</h2>
      {children}
    </section>
  );
}
