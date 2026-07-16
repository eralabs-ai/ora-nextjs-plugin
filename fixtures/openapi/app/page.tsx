export default function Home() {
  return (
    <main>
      <h1>OpenAPI fixture</h1>
      <p>
        This app serves /openapi.json. The plugin should detect it and reference it as a single
        application/vnd.oai.openapi+json entry (the Telnyx shape) — not per-route entries.
      </p>
    </main>
  );
}
