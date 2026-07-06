// Canonical conversation schema — every adapter normalizes into this shape,
// and every renderer consumes only this shape. Adding a tool = one adapter;
// adding an output format = one renderer. Nothing else needs to change.

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: Role;
  /** Flattened, human-readable text (may contain Markdown). */
  text: string;
  /** ISO-8601 timestamp if the source recorded one. */
  timestamp?: string;
}

export interface Conversation {
  /** Stable id within a source (session id, uuid, or derived). */
  id: string;
  /** Adapter id, e.g. "claude-code". */
  source: string;
  /** Human label, e.g. "Claude Code". */
  sourceLabel: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Working directory / project the conversation belonged to, if known. */
  projectPath?: string;
  model?: string;
  messages: Message[];
  /** Absolute path of the file/db this came from (for provenance). */
  sourceFile?: string;
}

export interface DiscoverOptions {
  /** Include model reasoning / thinking blocks. */
  includeThinking: boolean;
  home: string;
}

export interface Adapter {
  id: string;
  label: string;
  /** Returns every conversation this adapter can find. Must never throw for a
   *  single bad file — collect what it can and move on. */
  discover(opts: DiscoverOptions): Promise<Conversation[]>;
}
