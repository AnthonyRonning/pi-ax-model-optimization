import { join } from "node:path";

export const DEFAULT_LIVE_STUDENT_PROVIDER = "openrouter";
export const DEFAULT_LIVE_STUDENT_MODEL = "moonshotai/kimi-k2.5";

export interface LiveTextActFormatTarget {
	provider: typeof DEFAULT_LIVE_STUDENT_PROVIDER;
	model: string;
	outputPath: string;
}

export interface CreateLiveTextActFormatTargetsOptions {
	cwd?: string;
	studentModel?: string;
	studentModels?: string;
	artifactPath?: string;
}

function normalizeModelList(rawValue: string | undefined): string[] {
	if (!rawValue) {
		return [];
	}

	return [
		...new Set(
			rawValue
				.split(/[,\n]/)
				.map((value) => value.trim())
				.filter((value) => value.length > 0),
		),
	];
}

function buildDefaultOutputPath(cwd: string, model: string): string {
	return join(cwd, ".pi", "promptforge", "text-act-format", DEFAULT_LIVE_STUDENT_PROVIDER, `${model}.json`);
}

export function createLiveTextActFormatTargets(
	options: CreateLiveTextActFormatTargetsOptions = {},
): LiveTextActFormatTarget[] {
	const cwd = options.cwd ?? process.cwd();
	const configuredModels = normalizeModelList(options.studentModels);
	const models =
		configuredModels.length > 0
			? configuredModels
			: normalizeModelList(options.studentModel).length > 0
				? normalizeModelList(options.studentModel)
				: [DEFAULT_LIVE_STUDENT_MODEL];

	if (options.artifactPath && models.length > 1) {
		throw new Error("PROMPTFORGE_ARTIFACT_PATH can only be used with a single student model.");
	}

	return models.map((model) => ({
		provider: DEFAULT_LIVE_STUDENT_PROVIDER,
		model,
		outputPath: options.artifactPath ?? buildDefaultOutputPath(cwd, model),
	}));
}
