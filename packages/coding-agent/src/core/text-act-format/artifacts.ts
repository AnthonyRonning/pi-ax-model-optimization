import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import { CONFIG_DIR_NAME } from "../../config.js";

export interface TextActFormatArtifactExample {
	input: string;
	output: string;
}

export interface TextActFormatArtifact {
	schemaVersion: 1;
	description?: string;
	instructions?: string[];
	examples?: TextActFormatArtifactExample[];
}

export interface LoadedTextActFormatArtifact {
	path: string;
	artifact: TextActFormatArtifact;
}

export interface LoadTextActFormatArtifactOptions {
	cwd: string;
	agentDir: string;
	model: Pick<Model<any>, "provider" | "id">;
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const items = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);

	return items.length > 0 ? items : undefined;
}

function normalizeExamples(value: unknown): TextActFormatArtifactExample[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const examples = value
		.flatMap((item) => {
			if (!item || typeof item !== "object") {
				return [];
			}

			const input = typeof item.input === "string" ? item.input.trim() : "";
			const output = typeof item.output === "string" ? item.output.trim() : "";
			if (!input || !output) {
				return [];
			}

			return [{ input, output }];
		})
		.filter((item) => item.input.length > 0 && item.output.length > 0);

	return examples.length > 0 ? examples : undefined;
}

function parseArtifact(rawText: string, path: string): TextActFormatArtifact {
	const parsed = JSON.parse(rawText) as {
		schemaVersion?: unknown;
		description?: unknown;
		instructions?: unknown;
		examples?: unknown;
	};

	const schemaVersion = parsed.schemaVersion ?? 1;
	if (schemaVersion !== 1) {
		throw new Error(`Unsupported Text Act Format artifact schemaVersion in ${path}: ${String(schemaVersion)}`);
	}

	const description = typeof parsed.description === "string" ? parsed.description.trim() : undefined;

	return {
		schemaVersion: 1,
		description: description && description.length > 0 ? description : undefined,
		instructions: normalizeStringArray(parsed.instructions),
		examples: normalizeExamples(parsed.examples),
	};
}

function dedupePaths(paths: string[]): string[] {
	return [...new Set(paths)];
}

export function getTextActFormatArtifactPaths(options: LoadTextActFormatArtifactOptions): string[] {
	const { cwd, agentDir, model } = options;
	const baseDirs = [
		join(cwd, CONFIG_DIR_NAME, "promptforge", "text-act-format"),
		join(cwd, CONFIG_DIR_NAME, "text-act-format"),
		join(agentDir, "promptforge", "text-act-format"),
		join(agentDir, "text-act-format"),
	];

	const candidatePaths: string[] = [];

	for (const baseDir of baseDirs) {
		candidatePaths.push(join(baseDir, model.provider, `${model.id}.json`));
		candidatePaths.push(join(baseDir, model.provider, "default.json"));
		candidatePaths.push(join(baseDir, "default.json"));
	}

	return dedupePaths(candidatePaths);
}

export function loadTextActFormatArtifact(
	options: LoadTextActFormatArtifactOptions,
): LoadedTextActFormatArtifact | undefined {
	for (const path of getTextActFormatArtifactPaths(options)) {
		if (!existsSync(path)) {
			continue;
		}

		return {
			path,
			artifact: parseArtifact(readFileSync(path, "utf-8"), path),
		};
	}

	return undefined;
}
