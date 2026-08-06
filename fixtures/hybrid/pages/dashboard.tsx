// `/dashboard` is ALSO defined by the App Router (app/dashboard/page.tsx). The plugin dedupes the
// two into a single route (App Router precedence). In a real migration Next.js would warn about the
// conflict; here it exists purely to exercise the dedupe.
export default function DashboardPages() {
  return <main>Dashboard (Pages Router duplicate).</main>;
}
