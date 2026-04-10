import type { AssistantMessage, Context, Message, Tool, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { TextActFormatArtifact, TextActFormatArtifactExample } from "./artifacts.js";
import type { RenderTextActFormatOptions } from "./types.js";

function renderToolParameters(tool: Tool): string {
	try {
		return JSON.stringify(tool.parameters, null, 2);
	} catch {
		return "{}";
	}
}

function renderTools(tools: Tool[] | undefined): string {
	if (!tools || tools.length === 0) {
		return "No tools are available for this turn.";
	}

	return tools
		.map(
			(tool) =>
				`<tool name="${tool.name}">\nDescription: ${tool.description}\nParameters:\n${renderToolParameters(tool)}\n</tool>`,
		)
		.join("\n\n");
}

function renderArtifactExamples(examples: TextActFormatArtifactExample[] | undefined): string | undefined {
	if (!examples || examples.length === 0) {
		return undefined;
	}

	return examples
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

function normalizeText(text: string): string {
	return text.trim();
}

function textFromUserMessage(message: UserMessage): string {
	if (typeof message.content === "string") {
		return normalizeText(message.content);
	}

	return normalizeText(
		message.content
			.map((block) => {
				if (block.type === "text") return block.text;
				return `[image:${block.mimeType}]`;
			})
			.join("\n"),
	);
}

function textFromAssistantMessage(message: AssistantMessage): string {
	const parts: string[] = [];

	for (const block of message.content) {
		if (block.type === "text" && normalizeText(block.text).length > 0) {
			parts.push(`<message>\n${normalizeText(block.text)}\n</message>`);
		}

		if (block.type === "toolCall") {
			parts.push(`<tool_call name="${block.name}">\n${JSON.stringify(block.arguments, null, 2)}\n</tool_call>`);
		}
	}

	return parts.join("\n\n").trim();
}

function textFromToolResultMessage(message: ToolResultMessage): string {
	const text = message.content
		.map((block) => {
			if (block.type === "text") return block.text;
			return `[image:${block.mimeType}]`;
		})
		.join("\n")
		.trim();

	const status = message.isError ? "error" : "ok";
	return `<tool_result name="${message.toolName}" tool_call_id="${message.toolCallId}" status="${status}">\n${text}\n</tool_result>`;
}

function renderMessage(message: Message): Message {
	switch (message.role) {
		case "user":
			return {
				role: "user",
				content: [{ type: "text", text: textFromUserMessage(message) }],
				timestamp: message.timestamp,
			};
		case "assistant":
			return {
				...message,
				content: [{ type: "text", text: textFromAssistantMessage(message) }],
			};
		case "toolResult":
			return {
				role: "user",
				content: [{ type: "text", text: textFromToolResultMessage(message) }],
				timestamp: message.timestamp,
			};
	}
}

export function buildTextActFormatSystemPrompt(options: RenderTextActFormatOptions): string {
	const sections: string[] = [];

	if (options.baseSystemPrompt?.trim()) {
		sections.push(options.baseSystemPrompt.trim());
	}

	sections.push(
		[
			"# Text Act Format",
			"Ignore any provider-native or JSON function-calling instructions elsewhere in the prompt.",
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
			"- Keep working until the task is complete, blocked, or waiting on the user.",
			"- You may emit multiple `<message>` blocks and multiple `<tool_call>` blocks in one response.",
			"- Never emit `<done />` in the same response as a `<tool_call>` block.",
			"- Tool results from previous steps will appear in `<tool_result ...>` blocks inside the conversation.",
		].join("\n"),
	);

	sections.push(["# Available tools", renderTools(options.tools)].join("\n\n"));

	if (options.artifact?.description?.trim()) {
		sections.push(["# Model adapter", options.artifact.description.trim()].join("\n\n"));
	}

	if (options.artifact?.instructions && options.artifact.instructions.length > 0) {
		sections.push(
			["# Model adapter hints", ...options.artifact.instructions.map((instruction) => `- ${instruction}`)].join(
				"\n",
			),
		);
	}

	const renderedExamples = renderArtifactExamples(options.artifact?.examples);
	if (renderedExamples) {
		sections.push(["# Model adapter examples", renderedExamples].join("\n\n"));
	}

	return sections.join("\n\n");
}

export function buildTextActFormatContext(context: Context, artifact?: TextActFormatArtifact): Context {
	return {
		systemPrompt: buildTextActFormatSystemPrompt({
			baseSystemPrompt: context.systemPrompt,
			tools: context.tools,
			artifact,
		}),
		messages: context.messages.map(renderMessage),
		tools: undefined,
	};
}
