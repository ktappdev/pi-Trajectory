/**
 * Resolve a tool schema for the inspector's Schema tab.
 *
 * pi's tool definitions are static (registered at startup). For replay,
 * there is no running agent, so we resolve schemas for the known built-in
 * tools by name. Custom/extension tools return `undefined` (empty state).
 *
 * When the trajectory-prompt-log extension is installed, the active tool
 * catalog is logged per-request and takes precedence (handled in the
 * projection via `promptAnatomy.tools`).
 */
import {
  createBashTool,
  createReadTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from '@earendil-works/pi-coding-agent'

/** Built-in tool factories, keyed by tool name. Each takes `(cwd, options?)`. */
const BUILTIN_FACTORIES = new Map<string, (cwd: string) => unknown>([
  ['bash', (cwd) => createBashTool(cwd)],
  ['read', (cwd) => createReadTool(cwd)],
  ['edit', (cwd) => createEditTool(cwd)],
  ['write', (cwd) => createWriteTool(cwd)],
  ['grep', (cwd) => createGrepTool(cwd)],
  ['find', (cwd) => createFindTool(cwd)],
  ['ls', (cwd) => createLsTool(cwd)],
])

const schemaCache = new Map<string, string | undefined>()

/**
 * Resolve a tool's parameter schema as a JSON string, or `undefined`
 * when the tool is not a known built-in.
 * @param toolName - Name of the tool (`bash`, `read`, etc.).
 */
export function resolveToolSchema(toolName: string): string | undefined {
  const cached = schemaCache.get(toolName)
  if (cached !== undefined || schemaCache.has(toolName)) return cached

  let schema: string | undefined
  try {
    const factory = BUILTIN_FACTORIES.get(toolName)
    if (factory !== undefined) {
      const tool = factory(process.cwd()) as { parameters?: unknown }
      schema = tool.parameters !== undefined ? JSON.stringify(tool.parameters, null, 2) : undefined
    }
  } catch {
    schema = undefined
  }
  schemaCache.set(toolName, schema)
  return schema
}
