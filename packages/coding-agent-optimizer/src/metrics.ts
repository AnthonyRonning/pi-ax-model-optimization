import type { AxMetricFn, AxMultiMetricFn } from "@ax-llm/ax";
import type {
	TextActFormatOptimizationExample,
	TextActFormatOptimizationPrediction,
	TextActFormatScalarizationWeights,
	TextActFormatScoreVector,
} from "./types.js";

const DEFAULT_SCALARIZATION_WEIGHTS: Required<TextActFormatScalarizationWeights> = {
	actParsing: 0.3,
	toolSelection: 0.35,
	completion: 0.2,
	toolGrounding: 0.1,
	failureAvoidance: 0.05,
};

function clampScore(score: number): number {
	if (Number.isNaN(score) || !Number.isFinite(score)) {
		return 0;
	}

	return Math.min(1, Math.max(0, score));
}

function ratio(numerator: number, denominator: number): number {
	if (denominator <= 0) {
		return 1;
	}

	return clampScore(numerator / denominator);
}

function scoreActParsing(prediction: TextActFormatOptimizationPrediction): number {
	if (prediction.parsedActs.length === 0) {
		return 0;
	}

	if (prediction.usedPlainTextFallback) {
		return 0;
	}

	return prediction.toolCalls.some((toolCall) => toolCall.recovered) ? 0.75 : 1;
}

function scoreExpectedActs(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): number {
	if (!example.expectedActs || example.expectedActs.length === 0) {
		return prediction.parsedActs.length > 0 ? 1 : 0;
	}

	const actualTypes = new Set(prediction.parsedActs.map((act) => act.type));
	const matches = example.expectedActs.filter((type) => actualTypes.has(type)).length;
	return ratio(matches, example.expectedActs.length);
}

function scoreRequiredTools(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): number {
	const actualTools = new Set(prediction.toolCalls.map((toolCall) => toolCall.name));

	const requiredToolsScore =
		example.requiredTools && example.requiredTools.length > 0
			? ratio(
					example.requiredTools.filter((toolName) => actualTools.has(toolName)).length,
					example.requiredTools.length,
				)
			: example.expectedActs?.includes("tool_call")
				? prediction.toolCalls.length > 0
					? 1
					: 0
				: 1;

	const forbiddenToolsPenalty =
		example.forbiddenTools && example.forbiddenTools.length > 0
			? ratio(
					example.forbiddenTools.filter((toolName) => !actualTools.has(toolName)).length,
					example.forbiddenTools.length,
				)
			: 1;

	return clampScore((requiredToolsScore + forbiddenToolsPenalty) / 2);
}

function scoreCompletion(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): number {
	if (!example.expectedCompletion) {
		return prediction.completion === "empty" ? 0 : 1;
	}

	return prediction.completion === example.expectedCompletion ? 1 : 0;
}

function scoreToolGrounding(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): number {
	if (example.requiresToolResultGrounding) {
		return prediction.usedToolResultGrounding ? 1 : 0;
	}

	return prediction.failureTags?.includes("misread_tool_output") ? 0 : 1;
}

function scoreFailureAvoidance(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): number {
	if (!example.penalizedFailureTags || example.penalizedFailureTags.length === 0) {
		return prediction.failureTags && prediction.failureTags.length > 0 ? 0.75 : 1;
	}

	const actualFailures = new Set(prediction.failureTags ?? []);
	const avoidedFailures = example.penalizedFailureTags.filter((tag) => !actualFailures.has(tag)).length;
	return ratio(avoidedFailures, example.penalizedFailureTags.length);
}

export function scoreTextActFormatPrediction(
	example: TextActFormatOptimizationExample,
	prediction: TextActFormatOptimizationPrediction,
): TextActFormatScoreVector {
	return {
		actParsing: clampScore((scoreActParsing(prediction) + scoreExpectedActs(example, prediction)) / 2),
		toolSelection: scoreRequiredTools(example, prediction),
		completion: scoreCompletion(example, prediction),
		toolGrounding: scoreToolGrounding(example, prediction),
		failureAvoidance: scoreFailureAvoidance(example, prediction),
	};
}

export function scalarizeTextActFormatScores(
	scores: TextActFormatScoreVector,
	weights: TextActFormatScalarizationWeights = {},
): number {
	const normalizedWeights: Required<TextActFormatScalarizationWeights> = {
		...DEFAULT_SCALARIZATION_WEIGHTS,
		...weights,
	};

	const totalWeight =
		normalizedWeights.actParsing +
		normalizedWeights.toolSelection +
		normalizedWeights.completion +
		normalizedWeights.toolGrounding +
		normalizedWeights.failureAvoidance;

	if (totalWeight <= 0) {
		return 0;
	}

	return clampScore(
		(scores.actParsing * normalizedWeights.actParsing +
			scores.toolSelection * normalizedWeights.toolSelection +
			scores.completion * normalizedWeights.completion +
			scores.toolGrounding * normalizedWeights.toolGrounding +
			scores.failureAvoidance * normalizedWeights.failureAvoidance) /
			totalWeight,
	);
}

export function createTextActFormatMultiMetric(_weights: TextActFormatScalarizationWeights = {}): AxMultiMetricFn {
	const metric: AxMultiMetricFn = async ({ prediction, example }) =>
		scoreTextActFormatPrediction(
			example as TextActFormatOptimizationExample,
			prediction as TextActFormatOptimizationPrediction,
		);

	return metric;
}

export function createTextActFormatMetric(weights: TextActFormatScalarizationWeights = {}): AxMetricFn {
	const metric: AxMetricFn = async ({ prediction, example }) =>
		scalarizeTextActFormatScores(
			scoreTextActFormatPrediction(
				example as TextActFormatOptimizationExample,
				prediction as TextActFormatOptimizationPrediction,
			),
			weights,
		);

	return metric;
}
