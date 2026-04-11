import { AxAIAnthropicModel, ai } from "@ax-llm/ax";
import { writeTextActFormatOptimizerArtifact } from "./artifact.js";
import { createTextActFormatJudgeMetric } from "./judge.js";
import { createDefaultLiveTextActFormatDataset } from "./live-dataset.js";
import { resolveLiveStudentApiKey, resolveLiveStudentApiURL } from "./live-env.js";
import { createLiveTextActFormatRunner } from "./live-runner.js";
import { createLiveTextActFormatTargets } from "./live-targets.js";
import { optimizeTextActFormat } from "./optimize.js";
import type { TextActFormatArtifact } from "./types.js";

function requiredEnv(name: string, fallbackName?: string): string {
	const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
	if (!value || value.trim().length === 0) {
		throw new Error(`Missing required environment variable: ${fallbackName ? `${name} (or ${fallbackName})` : name}`);
	}

	return value;
}

function numberFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) {
		return fallback;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

const JUDGE_MODEL =
	(process.env.PROMPTFORGE_JUDGE_MODEL as AxAIAnthropicModel | undefined) ?? AxAIAnthropicModel.Claude46Sonnet;

const baseArtifact: TextActFormatArtifact = {
	schemaVersion: 1,
	description: "PromptForge Text Act Format adapter for coding-agent turns.",
	instructions: [
		"Emit explicit Text Act Format blocks instead of describing intended actions in prose.",
		"Use <tool_call> whenever the task requires inspecting or mutating repo state.",
		"Use <ask_user> when required information is missing and <blocked> when the tool surface cannot satisfy the task.",
	],
};

async function main(): Promise<void> {
	const openRouterApiKey = resolveLiveStudentApiKey();
	const openRouterApiURL = resolveLiveStudentApiURL();
	const anthropicApiKey = requiredEnv("ANTHROPIC_APIKEY", "ANTHROPIC_API_KEY");
	const studentTargets = createLiveTextActFormatTargets({
		cwd: process.cwd(),
		studentModel: process.env.PROMPTFORGE_STUDENT_MODEL,
		studentModels: process.env.PROMPTFORGE_STUDENT_MODELS,
		artifactPath: process.env.PROMPTFORGE_ARTIFACT_PATH,
	});

	const judgeAI = ai({
		name: "anthropic",
		apiKey: anthropicApiKey,
		config: {
			model: JUDGE_MODEL,
			stream: false,
			temperature: 0,
		},
	});

	const dataset = createDefaultLiveTextActFormatDataset();
	const summaries: Array<{
		studentProvider: string;
		studentModel: string;
		judgeModel: string;
		outputPath: string;
		bestScore?: number | null;
		optimizerType?: string | null;
		totalRounds?: number | null;
		converged?: boolean | null;
		instructions?: string[];
		error?: string;
	}> = [];
	let hadFailure = false;

	for (const target of studentTargets) {
		try {
			const studentAI = ai({
				name: target.provider,
				apiKey: openRouterApiKey,
				apiURL: openRouterApiURL,
				config: {
					model: target.model,
					stream: false,
					temperature: 0,
				},
			});

			const result = await optimizeTextActFormat({
				studentAI,
				teacherAI: judgeAI,
				dataset,
				baseArtifact,
				runner: createLiveTextActFormatRunner({
					studentAI,
					model: target.model,
					temperature: 0,
					maxTokens: 1024,
				}),
				metric: createTextActFormatJudgeMetric(judgeAI),
				maxMetricCalls: numberFromEnv("PROMPTFORGE_MAX_METRIC_CALLS", 24),
				numTrials: numberFromEnv("PROMPTFORGE_NUM_TRIALS", 4),
				minibatch: true,
				minibatchSize: numberFromEnv("PROMPTFORGE_MINIBATCH_SIZE", 3),
				earlyStoppingTrials: numberFromEnv("PROMPTFORGE_EARLY_STOPPING_TRIALS", 2),
				minImprovementThreshold: 0.01,
				sampleCount: 1,
				apply: true,
				programDescription: "Optimize Text Act Format instructions for explicit coding-agent actions.",
			});

			if (!result.artifact) {
				throw new Error("GEPA completed without producing an optimized artifact.");
			}

			writeTextActFormatOptimizerArtifact(target.outputPath, result.artifact);
			summaries.push({
				studentProvider: target.provider,
				studentModel: target.model,
				judgeModel: JUDGE_MODEL,
				outputPath: target.outputPath,
				bestScore: result.artifact.optimizer?.bestScore ?? null,
				optimizerType: result.artifact.optimizer?.optimizerType ?? null,
				totalRounds: result.artifact.optimizer?.totalRounds ?? null,
				converged: result.artifact.optimizer?.converged ?? null,
				instructions: result.artifact.instructions ?? [],
			});
		} catch (error) {
			hadFailure = true;
			summaries.push({
				studentProvider: target.provider,
				studentModel: target.model,
				judgeModel: JUDGE_MODEL,
				outputPath: target.outputPath,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.log(
		JSON.stringify(summaries.length === 1 ? summaries[0] : { judgeModel: JUDGE_MODEL, runs: summaries }, null, 2),
	);

	if (hadFailure) {
		process.exitCode = 1;
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
