export const metadata = {
  title: 'Bare JS Fixture',
  description: 'A JavaScript Next.js app (no TypeScript) — the JS baseline.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
