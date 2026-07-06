import { Adapter } from "../types.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { opencode } from "./opencode.js";
import { gemini, qwen } from "./gemini-family.js";

export const adapters: Adapter[] = [claudeCode, codex, opencode, gemini, qwen];

export function adapterById(id: string): Adapter | undefined {
  return adapters.find((a) => a.id === id);
}
