function firstDefinedEnv(env: Record<string, string | undefined>, names: readonly string[]): string | undefined {
	for (const name of names) {
		const value = env[name]?.trim();
		if (value) {
			return value;
		}
	}

	return undefined;
}

function ensureV1Path(urlOrHost: string): string {
	const trimmed = urlOrHost.trim().replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function resolveLiveStudentApiKey(env: Record<string, string | undefined> = process.env): string {
	const apiURL = resolveLiveStudentApiURL(env);
	const value = shouldUseOpenAICompatibleProxy(apiURL)
		? firstDefinedEnv(env, ["LITELLM_API_KEY", "OPENROUTER_API_KEY"])
		: firstDefinedEnv(env, ["OPENROUTER_API_KEY", "LITELLM_API_KEY"]);
	if (!value) {
		throw new Error("Missing required environment variable: OPENROUTER_API_KEY (or LITELLM_API_KEY)");
	}

	return value;
}

export function resolveLiveStudentApiURL(env: Record<string, string | undefined> = process.env): string | undefined {
	const explicitUrl = firstDefinedEnv(env, ["OPENROUTER_API_URL", "LITELLM_API_URL"]);
	if (explicitUrl) {
		return explicitUrl;
	}

	const liteLlmHost = firstDefinedEnv(env, ["LITELLM_API_HOST"]);
	return liteLlmHost ? ensureV1Path(liteLlmHost) : undefined;
}

export function shouldUseOpenAICompatibleProxy(apiURL: string | undefined): boolean {
	return apiURL !== undefined && !apiURL.includes("openrouter.ai");
}

export function buildLiveStudentRequestModel(model: string, useOpenAICompatibleProxy: boolean): string {
	if (!useOpenAICompatibleProxy || model.startsWith("openrouter/")) {
		return model;
	}

	return `openrouter/${model}`;
}
