import { parseTextActFormat } from "./parser.js";
import type {
	TextActCompletionState,
	TextActFormatFailureTag,
	TextActFormatOptimizationPrediction,
	TextActFormatOptimizationToolCall,
} from "./types.js";

export interface CreateTextActFormatPredictionOptions {
	failureTags?: TextActFormatFailureTag[];
	usedToolResultGrounding?: boolean;
	metadata?: TextActFormatOptimizationPrediction["metadata"];
}

export function inferTextActCompletionState(
	prediction: Pick<TextActFormatOptimizationPrediction, "parsedActs" | "toolCalls">,
): TextActCompletionState {
	if (prediction.toolCalls.length > 0) {
		return "tool_call";
	}

	for (let index = prediction.parsedActs.length - 1; index >= 0; index--) {
		const act = prediction.parsedActs[index];
		switch (act.type) {
			case "ask_user":
				return "ask_user";
			case "blocked":
				return "blocked";
			case "done":
				return "done";
			case "message":
				return "message";
			default:
				break;
		}
	}

	return "empty";
}

export function extractToolCalls(
	prediction: Pick<TextActFormatOptimizationPrediction, "parsedActs">,
): TextActFormatOptimizationToolCall[] {
	return prediction.parsedActs.flatMap((act) => {
		if (act.type !== "tool_call") {
			return [];
		}

		return [
			{
				name: act.name,
				arguments: act.arguments,
				recovered: act.recovered,
			},
		];
	});
}

export function createTextActFormatPrediction(
	rawAssistantOutput: string,
	options: CreateTextActFormatPredictionOptions = {},
): TextActFormatOptimizationPrediction {
	const parsed = parseTextActFormat(rawAssistantOutput);
	const toolCalls = extractToolCalls({ parsedActs: parsed.acts });

	return {
		rawAssistantOutput,
		parsedActs: parsed.acts,
		toolCalls,
		completion: inferTextActCompletionState({ parsedActs: parsed.acts, toolCalls }),
		hadExplicitToolAttempt: parsed.hadExplicitToolAttempt,
		usedPlainTextFallback: parsed.usedPlainTextFallback,
		failureTags: options.failureTags,
		usedToolResultGrounding: options.usedToolResultGrounding,
		metadata: options.metadata,
	};
}
