// Ambient WebMCP draft types (see webmcp-imperative fixture for the annotated copy).
interface ModelContextToolResult {
  content: Array<{ type: string; text: string }>;
}

interface ModelContextToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  execute: (args: Record<string, unknown>) => Promise<ModelContextToolResult>;
}

interface ModelContext {
  registerTool(tool: ModelContextToolDescriptor): void;
}

// Current entry point (May 2026 draft): document.modelContext.
interface Document {
  readonly modelContext: ModelContext;
}

// Deprecated alias (pre-May-2026 draft; Chrome 150+ deprecates it) — the server-register and
// conditional-tools cases deliberately keep using it to exercise the deprecation warning.
interface Navigator {
  readonly modelContext: ModelContext;
}
