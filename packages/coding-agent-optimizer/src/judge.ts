import { type AxAIService, type AxMultiMetricFn, ax } from "@ax-llm/ax";
import { scoreTextActFormatPrediction } from "./metrics.js";
import type {
	TextActFormatOptimizationExample,
	TextActFormatOptimizationPrediction,
	TextActFormatScoreVector,
} from "./types.js";

export interface TextActFormatJudgeMetricOptions {
	heuristicWeight?: number;
	llmWeight?: number;
}

function clampScore(score: number): number {
	if (Number.isNaN(score) || !Number.isFinite(score)) {
		return 0;
	}

	return Math.max(0, Math.min(1, score));
}

function normalizeScoreVector(scores: Partial<TextActFormatScoreVector>): TextActFormatScoreVector {
	return {
		actParsing: clampScore(scores.actParsing ?? 0),
		toolSelection: clampScore(scores.toolSelection ?? 0),
		completion: clampScore(scores.completion ?? 0),
		toolGrounding: clampScore(scores.toolGrounding ?? 0),
		failureAvoidance: clampScore(scores.failureAvoidance ?? 0),
	};
}

function blendScores(
	first: TextActFormatScoreVector,
	second: TextActFormatScoreVector,
	firstWeight: number,
	secondWeight: number,
): TextActFormatScoreVector {
	const totalWeight = firstWeight + secondWeight;
	if (totalWeight <= 0) {
		return first;
	}

	return {
		actParsing: clampScore((first.actParsing * firstWeight + second.actParsing * secondWeight) / totalWeight),
		toolSelection: clampScore(
			(first.toolSelection * firstWeight + second.toolSelection * secondWeight) / totalWeight,
		),
		completion: clampScore((first.completion * firstWeight + second.completion * secondWeight) / totalWeight),
		toolGrounding: clampScore(
			(first.toolGrounding * firstWeight + second.toolGrounding * secondWeight) / totalWeight,
		),
		failureAvoidance: clampScore(
			(first.failureAvoidance * firstWeight + second.failureAvoidance * secondWeight) / totalWeight,
		),
	};
}

export function createTextActFormatJudgeMetric(
	judgeAI: AxAIService,
	options: TextActFormatJudgeMetricOptions = {},
): AxMultiMetricFn {
	const judge = ax(
		[
			"criteria:string,",
			"inputContext:json,",
			"rawAssistantOutput:string,",
			"parsedActs:json,",
			"toolCalls:json,",
			"completionState:string,",
			"hadExplicitToolAttempt:boolean,",
			"usedPlainTextFallback:boolean,",
			"expectedActs?:json,",
			"requiredTools?:json,",
			"forbiddenTools?:json,",
			"expectedCompletion?:string,",
			"penalizedFailureTags?:json,",
			"requiresToolResultGrounding?:boolean",
			'-> actParsing:number "0..1 score for parseable explicit acts",',
			'toolSelection:number "0..1 score for tool choice and explicit tool use",',
			'completion:number "0..1 score for stop/ask/block/message behavior",',
			'toolGrounding:number "0..1 score for using tool results as ground truth",',
			'failureAvoidance:number "0..1 score for avoiding listed failure modes",',
			'rationale?:string "Short justification"',
		].join(" "),
	);

	return async ({ prediction, example }) => {
		const typedPrediction = prediction as TextActFormatOptimizationPrediction;
		const typedExample = example as TextActFormatOptimizationExample;
		const heuristicScores = scoreTextActFormatPrediction(typedExample, typedPrediction);

		try {
			const judged = (await judge.forward(judgeAI, {
				criteria: typedExample.criteria,
				inputContext: typedExample.input,
				rawAssistantOutput: typedPrediction.rawAssistantOutput,
				parsedActs: typedPrediction.parsedActs,
				toolCalls: typedPrediction.toolCalls,
				completionState: typedPrediction.completion,
				hadExplicitToolAttempt: typedPrediction.hadExplicitToolAttempt,
				usedPlainTextFallback: typedPrediction.usedPlainTextFallback,
				expectedActs: typedExample.expectedActs,
				requiredTools: typedExample.requiredTools,
				forbiddenTools: typedExample.forbiddenTools,
				expectedCompletion: typedExample.expectedCompletion,
				penalizedFailureTags: typedExample.penalizedFailureTags,
				requiresToolResultGrounding: typedExample.requiresToolResultGrounding ?? false,
			})) as Partial<TextActFormatScoreVector>;

			return blendScores(
				heuristicScores,
				normalizeScoreVector(judged),
				options.heuristicWeight ?? 0.35,
				options.llmWeight ?? 0.65,
			);
		} catch {
			return heuristicScores;
		}
	};
}
