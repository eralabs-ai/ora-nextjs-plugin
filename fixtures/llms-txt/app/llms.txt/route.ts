// llms.txt served the recommended Next.js way: a route handler at app/llms.txt/route.ts. With
// `dynamic = 'force-static'` Next prerenders it at build, so /llms.txt is served as a static asset.
// `dynamic` is a standard route-segment export, so this passes Next 15's route-export check.
export const dynamic = 'force-static';

export function GET(): Response {
  const body = `# Example

> A minimal agent-oriented documentation index, served at /llms.txt.

## Docs

- [Quickstart](https://example.com/docs/quickstart): Get started in five minutes.
- [API reference](https://example.com/docs/api): REST endpoints and schemas.
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
