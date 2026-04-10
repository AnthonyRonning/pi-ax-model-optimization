import { readFileSync } from "node:fs";
import type {
	TextActFormatFailureTag,
	TextActFormatFeedbackOptimizationInput,
	TextActFormatFeedbackRecord,
	TextActFormatOptimizationExample,
} from "./types.js";

function textFromMessage(message: TextActFormatFeedbackRecord["transcript"][number]): string {
	if (message.role === "user") {
		if (typeof message.content === "string") {
			return message.content.trim();
		}

		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text.trim())
			.filter((text) => text.length > 0)
			.join("\n");
	}

	if (message.role === "assistant") {
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text.trim())
			.filter((text) => text.length > 0)
			.join("\n");
	}

	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text.trim())
		.filter((text) => text.length > 0)
		.join("\n");
}

function latestUserRequest(transcript: TextActFormatFeedbackRecord["transcript"]): string | undefined {
	for (let index = transcript.length - 1; index >= 0; index--) {
		const message = transcript[index];
		if (message.role !== "user") {
			continue;
		}

		const text = textFromMessage(message);
		if (text.length > 0) {
			return text;
		}
	}

	return undefined;
}

function criteriaForFailureTag(tag: TextActFormatFailureTag): string {
	switch (tag) {
		case "missing_tool_attempt":
			return "Emit an explicit <tool_call> act whenever the task requires a tool instead of describing the action in plain text.";
		case "premature_stop":
			return "Do not stop early; continue until the task is complete, blocked, or waiting on the user.";
		case "misread_tool_output":
			return "Use tool results as ground truth and base the next act on the observed output.";
		case "failed_to_ask_user":
			return "Emit <ask_user> when required information is missing instead of guessing.";
		case "unparseable_act":
			return "Emit stable, parseable Text Act Format blocks without malformed tags or invalid arguments.";
		default:
			return "Improve Text Act Format reliability for this failure case.";
	}
}

export function parseTextActFormatFeedbackJsonl(jsonlText: string): TextActFormatFeedbackRecord[] {
	return jsonlText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as TextActFormatFeedbackRecord);
}

export function loadTextActFormatFeedbackJsonl(filePath: string): TextActFormatFeedbackRecord[] {
	return parseTextActFormatFeedbackJsonl(readFileSync(filePath, "utf-8"));
}

export function feedbackRecordToOptimizationExample(
	record: TextActFormatFeedbackRecord,
): TextActFormatOptimizationExample<TextActFormatFeedbackOptimizationInput> {
	const availableToolNames = record.tools.map((tool) => tool.name);
	const expectedActs =
		record.failureTag === "missing_tool_attempt"
			? (["tool_call"] as const)
			: record.failureTag === "failed_to_ask_user"
				? (["ask_user"] as const)
				: record.failureTag === "unparseable_act"
					? (["tool_call"] as const)
					: undefined;

	const requiredTools =
		record.failureTag === "missing_tool_attempt" && availableToolNames.length === 1
			? [availableToolNames[0]]
			: undefined;

	return {
		input: {
			canonicalIntent: record.canonicalIntent,
			transcript: record.transcript,
			availableTools: record.tools,
			rawAssistantOutput: record.rawAssistantOutput,
		},
		criteria: record.note
			? `${criteriaForFailureTag(record.failureTag)}\n\nOperator note: ${record.note}`
			: criteriaForFailureTag(record.failureTag),
		expectedActs: expectedActs ? [...expectedActs] : undefined,
		requiredTools,
		expectedCompletion: record.failureTag === "failed_to_ask_user" ? "ask_user" : undefined,
		penalizedFailureTags: [record.failureTag],
		requiresToolResultGrounding: record.failureTag === "misread_tool_output",
		metadata: {
			failureTag: record.failureTag,
			availableToolCount: record.tools.length,
			latestUserRequest: latestUserRequest(record.transcript) ?? "",
		},
	};
}

export function createOptimizationExamplesFromFeedback(
	records: readonly TextActFormatFeedbackRecord[],
): Array<TextActFormatOptimizationExample<TextActFormatFeedbackOptimizationInput>> {
	return records.map(feedbackRecordToOptimizationExample);
}
