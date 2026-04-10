import type { Tool } from "@mariozechner/pi-ai";
import type { TextActFormatArtifact } from "./artifacts.js";

export const TEXT_ACT_FORMAT_ENV_VAR = "PI_CODING_AGENT_TEXT_ACT_FORMAT";

export type TextActFormatAct =
	| { type: "message"; text: string }
	| { type: "tool_call"; name: string; arguments: Record<string, unknown>; rawArguments: string; recovered: boolean }
	| { type: "ask_user"; text: string }
	| { type: "blocked"; text: string }
	| { type: "done" };

export interface TextActFormatParseResult {
	acts: TextActFormatAct[];
	hadExplicitToolAttempt: boolean;
	usedPlainTextFallback: boolean;
}

export interface RenderedTextActFormatContext {
	systemPrompt: string;
}

export interface RenderTextActFormatOptions {
	baseSystemPrompt?: string;
	tools?: Tool[];
	artifact?: TextActFormatArtifact;
}
