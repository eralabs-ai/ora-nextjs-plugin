import type { ReactNode } from 'react';

// The metadata description mentions the API by name on purpose: a string that *talks about*
// registerTool() must never be detected as a registration (the false-positive regression the old
// webmcp-imperative fixture pinned).
export const metadata = {
  title: 'WebMCP Fixture',
  description:
    'Registers an in-page WebMCP tool via navigator.modelContext.registerTool(), next to a declarative <form toolname>.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
