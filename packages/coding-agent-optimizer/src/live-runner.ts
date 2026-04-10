import type { AxAIService, AxChatResponse } from "@ax-llm/ax";
import {
	buildLiveTextActFormatSystemPrompt,
	buildLiveTextActFormatUserPrompt,
	type LiveTextActFormatInput,
} from "./live-prompt.js";
import { createTextActFormatPrediction } from "./prediction.js";
import type {
	TextActFormatOptimizationExample,
	TextActFormatOptimizationPrediction,
	TextActFormatOptimizationRunner,
} from "./types.js";

export interface LiveTextActFormatRunnerOptions {
	studentAI: AxAIService;
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

function extractResponseText(response: AxChatResponse): string {
	const content = response.results?.[0]?.content as unknown;
	if (typeof content === "string") {
		return content.trim();
	}

	if (Array.isArray(content)) {
		return content
			.map((item: unknown) => {
				if (typeof item === "string") {
					return item;
				}

				if (
					typeof item === "object" &&
					item !== null &&
					"type" in item &&
					item.type === "text" &&
					"text" in item &&
					typeof item.text === "string"
				) {
					return item.text;
				}

				return JSON.stringify(item);
			})
			.join("\n")
			.trim();
	}

	return "";
}

export function createLiveTextActFormatRunner(
	options: LiveTextActFormatRunnerOptions,
): TextActFormatOptimizationRunner<
	TextActFormatOptimizationExample<LiveTextActFormatInput>,
	TextActFormatOptimizationPrediction
> {
	return async ({ example, artifact }) => {
		const systemPrompt = buildLiveTextActFormatSystemPrompt(example.input, artifact);
		const userPrompt = buildLiveTextActFormatUserPrompt(example.input);
		const response = (await options.studentAI.chat({
			chatPrompt: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			model: options.model,
			modelConfig: {
				stream: false,
				temperature: options.temperature ?? 0,
				maxTokens: options.maxTokens,
			},
		})) as AxChatResponse;

		return createTextActFormatPrediction(extractResponseText(response), {
			metadata: {
				task: example.input.task,
				transcriptBlocks: example.input.transcript?.length ?? 0,
			},
		});
	};
}
