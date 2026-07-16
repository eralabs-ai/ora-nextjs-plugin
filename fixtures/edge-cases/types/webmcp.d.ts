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

interface Navigator {
  readonly modelContext: ModelContext;
}
