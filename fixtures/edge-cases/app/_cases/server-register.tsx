// A server component (note: NO 'use client') that attempts WebMCP registration. This is a mistake:
// navigator.modelContext only exists in the browser. The Phase 4 detector must WARN about this and
// must NOT emit a tool entry. The typeof guard keeps the build from crashing during prerender.
//
// (Under app/_cases, an underscore-prefixed private folder, so it's scanned but not routed.)
export default function ServerRegister() {
  if (typeof navigator !== 'undefined') {
    navigator.modelContext.registerTool({
      name: 'server_side_tool',
      description: 'Should never be published — registered from a server component.',
      async execute() {
        return { content: [{ type: 'text', text: 'unreachable' }] };
      },
    });
  }
  return <div>server register</div>;
}
