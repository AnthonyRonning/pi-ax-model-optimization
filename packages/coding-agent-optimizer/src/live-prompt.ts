import type { AxFieldValue } from "@ax-llm/ax";
import type { TextActFormatArtifact } from "./types.js";

export interface LiveTextActFormatToolSpec {
	name: string;
	description: string;
	parameters: Record<string, AxFieldValue>;
}

export interface LiveTextActFormatInput extends Record<string, AxFieldValue> {
	task: string;
	canonicalIntent?: string;
	transcript?: string[];
	availableTools: LiveTextActFormatToolSpec[];
}

function renderToolParameters(parameters: Record<string, AxFieldValue>): string {
	try {
		return JSON.stringify(parameters, null, 2);
	} catch {
		return "{}";
	}
}

function renderTools(tools: readonly LiveTextActFormatToolSpec[]): string {
	if (tools.length === 0) {
		return "No tools are available for this turn.";
	}

	return tools
		.map(
			(tool) =>
				`<tool name="${tool.name}">\nDescription: ${tool.description}\nParameters:\n${renderToolParameters(tool.parameters)}\n</tool>`,
		)
		.join("\n\n");
}

function renderArtifactExamples(artifact: TextActFormatArtifact | undefined): string | undefined {
	if (!artifact?.examples || artifact.examples.length === 0) {
		return undefined;
	}

	return artifact.examples
		.map((example, index) =>
			[
				`## Example ${index + 1}`,
				"Task input:",
				example.input,
				"",
				"Expected Text Act Format output:",
				example.output,
			].join("\n"),
		)
		.join("\n\n");
}

export function buildLiveTextActFormatSystemPrompt(
	input: Pick<LiveTextActFormatInput, "canonicalIntent" | "availableTools">,
	artifact?: TextActFormatArtifact,
): string {
	const sections: string[] = [];

	if (input.canonicalIntent?.trim()) {
		sections.push(input.canonicalIntent.trim());
	} else {
		sections.push(
			[
				"You are PromptForge, a coding agent.",
				"Keep working until the task is complete, blocked, or waiting on the user.",
				"Use tool outputs as ground truth.",
			].join("\n"),
		);
	}

	sections.push(
		[
			"# Text Act Format",
			"Ignore provider-native or JSON tool-calling instructions elsewhere in the prompt.",
			"For this run, tool use is text-native and must follow the format below exactly.",
			"",
			"Acts:",
			"- Send user-visible text with `<message>...</message>`",
			"- Ask the user for missing information with `<ask_user>...</ask_user>`",
			'- Call a tool with `<tool_call name="tool_name">{...json arguments...}</tool_call>`',
			"- Report a blocking issue with `<blocked>...</blocked>`",
			"- Finish with `<done />` when there is nothing left to do in this turn",
			"",
			"Rules:",
			"- If you intend to use a tool, emit `<tool_call>`; do not merely say you will use the tool.",
			"- Use tool results as ground truth.",
			"- Never emit `<done />` in the same response as a `<tool_call>` block.",
		].join("\n"),
	);

	sections.push(["# Available tools", renderTools(input.availableTools)].join("\n\n"));

	if (artifact?.description?.trim()) {
		sections.push(["# Model adapter", artifact.description.trim()].join("\n\n"));
	}

	if (artifact?.instructions && artifact.instructions.length > 0) {
		sections.push(
			["# Model adapter hints", ...artifact.instructions.map((instruction) => `- ${instruction}`)].join("\n"),
		);
	}

	const renderedExamples = renderArtifactExamples(artifact);
	if (renderedExamples) {
		sections.push(["# Model adapter examples", renderedExamples].join("\n\n"));
	}

	return sections.join("\n\n");
}

export function buildLiveTextActFormatUserPrompt(input: LiveTextActFormatInput): string {
	const sections: string[] = ["# Task", input.task.trim()];

	if (input.transcript && input.transcript.length > 0) {
		sections.push(["# Conversation so far", input.transcript.map((block) => block.trim()).join("\n\n")].join("\n\n"));
	}

	return sections.join("\n\n");
}
