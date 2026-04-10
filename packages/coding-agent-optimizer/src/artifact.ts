import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AxOptimizedProgram, AxParetoResult } from "@ax-llm/ax";
import type {
	TextActFormatArtifact,
	TextActFormatOptimizationPrediction,
	TextActFormatOptimizerArtifactFile,
	TextActFormatOptimizerArtifactParetoEntry,
} from "./types.js";

function normalizeInstructionLine(line: string): string | undefined {
	const trimmed = line
		.trim()
		.replace(/^[*-]\s*/, "")
		.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function instructionTextToArtifactInstructions(instructionText: string | undefined): string[] | undefined {
	if (!instructionText || instructionText.trim().length === 0) {
		return undefined;
	}

	const instructions = instructionText
		.split(/\n+/)
		.map(normalizeInstructionLine)
		.filter((line) => line !== undefined);
	return instructions.length > 0 ? instructions : undefined;
}

export function getSeedInstructionText(baseArtifact: TextActFormatArtifact | undefined): string {
	if (baseArtifact?.instructions && baseArtifact.instructions.length > 0) {
		return baseArtifact.instructions.join("\n");
	}

	return baseArtifact?.description?.trim() ?? "";
}

export function buildTextActFormatArtifactFromInstruction(
	baseArtifact: TextActFormatArtifact | undefined,
	instructionText: string | undefined,
): TextActFormatArtifact {
	return {
		schemaVersion: 1,
		description: baseArtifact?.description,
		instructions: instructionTextToArtifactInstructions(instructionText) ?? baseArtifact?.instructions,
		examples: baseArtifact?.examples,
	};
}

function extractInstructionFromOptimization<Prediction extends TextActFormatOptimizationPrediction>(
	optimizedProgram: AxOptimizedProgram<Prediction>,
	targetId: string,
): string | undefined {
	return optimizedProgram.instructionMap?.[targetId] ?? optimizedProgram.instruction;
}

function buildParetoFront<Prediction extends TextActFormatOptimizationPrediction>(
	paretoResult: AxParetoResult<Prediction>,
	targetId: string,
): TextActFormatOptimizerArtifactParetoEntry[] | undefined {
	if (!paretoResult.paretoFront || paretoResult.paretoFront.length === 0) {
		return undefined;
	}

	const entries = paretoResult.paretoFront.flatMap((entry) => {
		const configuration = entry.configuration as {
			instruction?: string;
			instructionMap?: Record<string, string>;
		};
		const instruction = configuration.instructionMap?.[targetId] ?? configuration.instruction;

		return [
			{
				instruction,
				scores: entry.scores,
				dominatedSolutions: entry.dominatedSolutions,
			},
		];
	});

	return entries.length > 0 ? entries : undefined;
}

export function buildTextActFormatOptimizerArtifact<Prediction extends TextActFormatOptimizationPrediction>(
	baseArtifact: TextActFormatArtifact | undefined,
	paretoResult: AxParetoResult<Prediction>,
	targetId: string,
	createdAt = new Date().toISOString(),
): TextActFormatOptimizerArtifactFile | undefined {
	const optimizedProgram = paretoResult.optimizedProgram;
	if (!optimizedProgram) {
		return undefined;
	}

	return {
		...buildTextActFormatArtifactFromInstruction(
			baseArtifact,
			extractInstructionFromOptimization(optimizedProgram, targetId),
		),
		optimizer: {
			kind: "ax-gepa",
			createdAt,
			targetId,
			bestScore: optimizedProgram.bestScore,
			optimizerType: optimizedProgram.optimizerType,
			optimizationTime: optimizedProgram.optimizationTime,
			totalRounds: optimizedProgram.totalRounds,
			converged: optimizedProgram.converged,
		},
		paretoFront: buildParetoFront(paretoResult, targetId),
	};
}

export function writeTextActFormatOptimizerArtifact(
	filePath: string,
	artifact: TextActFormatOptimizerArtifactFile,
): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
}

export function readTextActFormatOptimizerArtifact(filePath: string): TextActFormatOptimizerArtifactFile {
	return JSON.parse(readFileSync(filePath, "utf-8")) as TextActFormatOptimizerArtifactFile;
}
