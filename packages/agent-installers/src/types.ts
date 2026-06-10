export type AgentKind = "codex" | "claude-code" | "cursor";

export const AGENT_KINDS: readonly AgentKind[] = [
  "codex",
  "claude-code",
  "cursor",
];

export interface McpServerEntry {
  command: string;
  args: string[];
}

export interface ChangeResult {
  configPath: string;
  changed: boolean;
  backupPath?: string;
  instructions?: string;
}

export interface AgentStatus {
  name: string;
  kind: AgentKind | "custom";
  configPath: string;
  configExists: boolean;
  registered: boolean;
}
