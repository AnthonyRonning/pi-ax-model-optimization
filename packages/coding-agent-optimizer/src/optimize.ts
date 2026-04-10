import { AxGEPA } from "@ax-llm/ax";
import { buildTextActFormatOptimizerArtifact } from "./artifact.js";
import { createTextActFormatMultiMetric } from "./metrics.js";
import { TextActFormatOptimizationProgram } from "./program.js";
import type {
	OptimizeTextActFormatOptions,
	OptimizeTextActFormatResult,
	TextActFormatOptimizationDataset,
	TextActFormatOptimizationExample,
	TextActFormatOptimizationPrediction,
} from "./types.js";

function normalizeDataset<Example extends TextActFormatOptimizationExample>(
	dataset: TextActFormatOptimizationDataset<Example>,
): {
	train: readonly Example[];
	validation?: readonly Example[];
} {
	if (Array.isArray(dataset)) {
		return { train: dataset, validation: undefined };
	}

	const splitDataset = dataset as {
		train: readonly Example[];
		validation?: readonly Example[];
	};

	return {
		train: splitDataset.train,
		validation: splitDataset.validation,
	};
}

export async function optimizeTextActFormat<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
>(
	options: OptimizeTextActFormatOptions<Example, Prediction>,
): Promise<OptimizeTextActFormatResult<Example, Prediction>> {
	const dataset = normalizeDataset(options.dataset);
	const program = new TextActFormatOptimizationProgram<Example, Prediction>({
		baseArtifact: options.baseArtifact,
		programId: options.programId,
		programDescription: options.programDescription,
		targetId: options.targetId,
		runner: options.runner,
	});

	const optimizer = new AxGEPA({
		studentAI: options.studentAI,
		teacherAI: options.teacherAI ?? options.studentAI,
		numTrials: options.numTrials,
		minibatch: options.minibatch,
		minibatchSize: options.minibatchSize,
		earlyStoppingTrials: options.earlyStoppingTrials,
		minImprovementThreshold: options.minImprovementThreshold,
		sampleCount: options.sampleCount,
		seed: options.seed,
		verbose: options.verbose,
		debugOptimizer: options.debugOptimizer,
		optimizerLogger: options.optimizerLogger,
		onProgress: options.onProgress,
		onEarlyStop: options.onEarlyStop,
	});

	const metric = options.metric ?? createTextActFormatMultiMetric();
	const axResult = await optimizer.compile(program, dataset.train, metric, {
		validationExamples: dataset.validation,
		maxMetricCalls: options.maxMetricCalls,
	});

	if (options.apply !== false && axResult.optimizedProgram) {
		program.applyOptimization(axResult.optimizedProgram);
	}

	return {
		artifact: buildTextActFormatOptimizerArtifact(options.baseArtifact, axResult, program.getTargetId()),
		axResult,
		optimizedProgram: axResult.optimizedProgram,
		program,
	};
}
