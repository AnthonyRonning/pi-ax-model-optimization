import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Context, Model, Tool } from "@mariozechner/pi-ai";
import { CONFIG_DIR_NAME } from "../../config.js";
import { parseTextActFormat } from "./parser.js";
import type { TextActFormatAct } from "./types.js";

export type TextActFormatFailureTag =
	| "missing_tool_attempt"
	| "premature_stop"
	| "misread_tool_output"
	| "failed_to_ask_user"
	| "unparseable_act"
	| "other";

export interface TextActFormatFeedbackRecord {
	schemaVersion: 1;
	createdAt: string;
	model: {
		provider: string;
		id: string;
	};
	failureTag: TextActFormatFailureTag;
	canonicalIntent?: string;
	tools: Array<{
		name: string;
		description: string;
		parameters: Tool["parameters"];
	}>;
	transcript: Context["messages"];
	rawAssistantOutput: string;
	parsedActs: TextActFormatAct[];
	hadExplicitToolAttempt: boolean;
	usedPlainTextFallback: boolean;
	note?: string;
	artifactPath?: string;
}

export interface CreateTextActFormatFeedbackRecordOptions {
	model: Pick<Model<any>, "provider" | "id">;
	context: Context;
	rawAssistantOutput: string;
	failureTag: TextActFormatFailureTag;
	note?: string;
	artifactPath?: string;
	createdAt?: string;
}

export interface AppendTextActFormatFeedbackRecordOptions extends CreateTextActFormatFeedbackRecordOptions {
	cwd: string;
	agentDir: string;
	outputPath?: string;
}

function serializeTools(tools: Tool[] | undefined): TextActFormatFeedbackRecord["tools"] {
	if (!tools || tools.length === 0) {
		return [];
	}

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

export function createTextActFormatFeedbackRecord(
	options: CreateTextActFormatFeedbackRecordOptions,
): TextActFormatFeedbackRecord {
	const parsed = parseTextActFormat(options.rawAssistantOutput);

	return {
		schemaVersion: 1,
		createdAt: options.createdAt ?? new Date().toISOString(),
		model: {
			provider: options.model.provider,
			id: options.model.id,
		},
		failureTag: options.failureTag,
		canonicalIntent: options.context.systemPrompt,
		tools: serializeTools(options.context.tools),
		transcript: structuredClone(options.context.messages),
		rawAssistantOutput: options.rawAssistantOutput,
		parsedActs: parsed.acts,
		hadExplicitToolAttempt: parsed.hadExplicitToolAttempt,
		usedPlainTextFallback: parsed.usedPlainTextFallback,
		note: options.note?.trim() || undefined,
		artifactPath: options.artifactPath,
	};
}

export function getDefaultTextActFormatFeedbackPath(cwd: string, agentDir: string): string {
	if (cwd.trim().length > 0) {
		return join(cwd, CONFIG_DIR_NAME, "promptforge", "feedback", "text-act-format.jsonl");
	}

	return join(agentDir, "promptforge", "feedback", "text-act-format.jsonl");
}

export function appendTextActFormatFeedbackRecord(options: AppendTextActFormatFeedbackRecordOptions): {
	path: string;
	record: TextActFormatFeedbackRecord;
} {
	const path = options.outputPath ?? getDefaultTextActFormatFeedbackPath(options.cwd, options.agentDir);
	const record = createTextActFormatFeedbackRecord(options);

	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(record)}\n`, "utf-8");

	return { path, record };
}
