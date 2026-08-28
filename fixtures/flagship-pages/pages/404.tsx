// The Pages Router custom 404. An error page, not addressable content — must be excluded from the
// route list (the App Router equivalent is `app/not-found.tsx`).
export default function NotFound() {
  return (
    <main>
      <h1>404 — page not found</h1>
      <p>
        Try the <a href="/destinations">route network</a> or search fares from the{' '}
        <a href="/">homepage</a>.
      </p>
    </main>
  );
}
