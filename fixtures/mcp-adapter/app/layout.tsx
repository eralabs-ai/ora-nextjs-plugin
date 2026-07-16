import type { ReactNode } from 'react';

export const metadata = {
  title: 'MCP Adapter Fixture',
  description: 'A Next.js app that already hosts an MCP server via @vercel/mcp-adapter.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
