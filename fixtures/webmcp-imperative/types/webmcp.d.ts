// Minimal ambient types for the WebMCP draft API (behind a flag in Chrome, W3C Community Group
// draft). Just enough for the fixture to type-check; the plugin detects the *call*, not these types.

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

interface Navigator {
  readonly modelContext: ModelContext;
}
