import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { TextActFormatArtifact } from "./artifacts.js";
import { parseTextActFormat } from "./parser.js";
import { buildTextActFormatContext } from "./render.js";

type StreamProvider = (
	model: Model<any>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

function createOutputMessage(rawMessage: AssistantMessage): AssistantMessage {
	return {
		...rawMessage,
		content: rawMessage.content.filter((block) => block.type === "thinking"),
		stopReason: rawMessage.stopReason === "toolUse" ? "stop" : rawMessage.stopReason,
	};
}

function extractTextActFormat(rawMessage: AssistantMessage): string {
	return rawMessage.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n\n")
		.trim();
}

function emitParsedActs(
	stream: AssistantMessageEventStream,
	output: AssistantMessage,
	rawText: string,
): AssistantMessage {
	const parsed = parseTextActFormat(rawText);
	let toolCallCount = 0;

	for (const act of parsed.acts) {
		if (act.type === "done") {
			continue;
		}

		if (act.type === "message" || act.type === "ask_user" || act.type === "blocked") {
			const contentIndex = output.content.length;
			output.content.push({ type: "text", text: "" });
			stream.push({ type: "text_start", contentIndex, partial: output });

			const textBlock = output.content[contentIndex];
			if (textBlock.type === "text") {
				textBlock.text = act.text;
				stream.push({ type: "text_delta", contentIndex, delta: act.text, partial: output });
				stream.push({ type: "text_end", contentIndex, content: act.text, partial: output });
			}
			continue;
		}

		const contentIndex = output.content.length;
		const toolCall = {
			type: "toolCall" as const,
			id: `text_act_format_${toolCallCount++}`,
			name: act.name,
			arguments: act.arguments,
		};
		output.content.push(toolCall);
		stream.push({ type: "toolcall_start", contentIndex, partial: output });
		stream.push({
			type: "toolcall_delta",
			contentIndex,
			delta: act.rawArguments || JSON.stringify(act.arguments),
			partial: output,
		});
		stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
	}

	output.stopReason = output.content.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
	return output;
}

export async function streamTextActFormat(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	streamProvider: StreamProvider,
	artifact?: TextActFormatArtifact,
): Promise<AssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		const formatContext = buildTextActFormatContext(context, artifact);
		const providerStream = await streamProvider(model, formatContext, {
			...options,
		});
		let started = false;

		try {
			for await (const event of providerStream) {
				if (event.type === "start" && !started) {
					stream.push({ type: "start", partial: createOutputMessage(event.partial) });
					started = true;
				}
			}

			const rawMessage = await providerStream.result();
			const output = createOutputMessage(rawMessage);
			if (!started) {
				stream.push({ type: "start", partial: output });
			}

			if (rawMessage.stopReason === "error" || rawMessage.stopReason === "aborted") {
				output.errorMessage = rawMessage.errorMessage;
				stream.push({ type: "error", reason: rawMessage.stopReason, error: output });
				stream.end();
				return;
			}

			const finalMessage = emitParsedActs(stream, output, extractTextActFormat(rawMessage));
			stream.push({
				type: "done",
				reason: finalMessage.stopReason === "toolUse" ? "toolUse" : "stop",
				message: finalMessage,
			});
			stream.end();
		} catch (error) {
			const fallback: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: options?.signal?.aborted ? "aborted" : "error",
				errorMessage: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			};
			if (!started) {
				stream.push({ type: "start", partial: fallback });
			}
			stream.push({
				type: "error",
				reason: fallback.stopReason === "aborted" ? "aborted" : "error",
				error: fallback,
			});
			stream.end();
		}
	})();

	return stream;
}
