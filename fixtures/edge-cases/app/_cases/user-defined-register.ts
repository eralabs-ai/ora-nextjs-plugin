// DECOY: a user-defined function that happens to be named `registerTool`, unrelated to WebMCP.
// The detector must NOT treat this as a WebMCP tool — it keys on
// `navigator.modelContext.registerTool(...)`, not on the bare identifier `registerTool`.

interface InternalTool {
  id: string;
  run: () => void;
}

const internalRegistry: InternalTool[] = [];

export function registerTool(tool: InternalTool): void {
  internalRegistry.push(tool);
}

// A plain call to the local function — still must not be detected.
registerTool({ id: 'internal-metrics', run: () => {} });
