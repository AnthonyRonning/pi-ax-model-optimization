import type { AxAIService } from "@ax-llm/ax";
import { describe, expect, it } from "vitest";
import { feedbackRecordToOptimizationExample } from "../src/feedback.js";
import { scalarizeTextActFormatScores, scoreTextActFormatPrediction } from "../src/metrics.js";
import { optimizeTextActFormat } from "../src/optimize.js";
import { createTextActFormatPrediction } from "../src/prediction.js";
import type { TextActFormatFeedbackRecord } from "../src/types.js";

const mockAI = {
	chat: async () => ({
		results: [
			{
				index: 0,
				content: "```\nEmit explicit <tool_call> acts for required tools.\n```",
			},
		],
	}),
	getOptions: () => ({}),
	getLogger: () => undefined,
} as unknown as AxAIService;

describe("coding-agent-optimizer", () => {
	it("creates normalized predictions from raw Text Act Format output", () => {
		const prediction = createTextActFormatPrediction(
			['<tool_call name="read">', '{"filePath":"src/index.ts"}', "</tool_call>"].join("\n"),
		);

		expect(prediction.toolCalls).toEqual([
			{
				name: "read",
				arguments: { filePath: "src/index.ts" },
				recovered: false,
			},
		]);
		expect(prediction.completion).toBe("tool_call");
		expect(prediction.usedPlainTextFallback).toBe(false);
	});

	it("scores structured tool-use predictions higher than plain text fallbacks", () => {
		const example = {
			input: { task: "Inspect src/index.ts" },
			criteria: "Use the read tool explicitly.",
			expectedActs: ["tool_call"] as const,
			requiredTools: ["read"],
			expectedCompletion: "tool_call" as const,
			penalizedFailureTags: ["missing_tool_attempt"] as const,
		};

		const goodPrediction = createTextActFormatPrediction(
			['<tool_call name="read">', '{"filePath":"src/index.ts"}', "</tool_call>"].join("\n"),
		);
		const weakPrediction = createTextActFormatPrediction("I will inspect src/index.ts next.", {
			failureTags: ["missing_tool_attempt"],
		});

		const goodScores = scoreTextActFormatPrediction(example, goodPrediction);
		const weakScores = scoreTextActFormatPrediction(example, weakPrediction);

		expect(scalarizeTextActFormatScores(goodScores)).toBeGreaterThan(scalarizeTextActFormatScores(weakScores));
		expect(goodScores.toolSelection).toBe(1);
		expect(weakScores.failureAvoidance).toBe(0);
	});

	it("turns feedback queue records into optimization examples", () => {
		const record: TextActFormatFeedbackRecord = {
			schemaVersion: 1,
			createdAt: "2026-04-10T00:00:00.000Z",
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			failureTag: "missing_tool_attempt",
			canonicalIntent: "Keep working until complete.",
			tools: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
			transcript: [{ role: "user", content: "Inspect src/index.ts", timestamp: 1 }],
			rawAssistantOutput: "I will inspect src/index.ts next.",
			parsedActs: [{ type: "message", text: "I will inspect src/index.ts next." }],
			hadExplicitToolAttempt: false,
			usedPlainTextFallback: true,
			note: "Needed an explicit read call.",
		};

		const example = feedbackRecordToOptimizationExample(record);

		expect(example.expectedActs).toEqual(["tool_call"]);
		expect(example.requiredTools).toEqual(["read"]);
		expect(example.penalizedFailureTags).toEqual(["missing_tool_attempt"]);
		expect(example.criteria).toContain("Operator note");
	});

	it("optimizes Text Act Format instructions with Ax GEPA and emits a runtime artifact", async () => {
		const result = await optimizeTextActFormat({
			studentAI: mockAI,
			teacherAI: mockAI,
			baseArtifact: {
				schemaVersion: 1,
				description: "Base adapter.",
				instructions: ["Be helpful."],
			},
			dataset: {
				train: [
					{
						input: { task: "Inspect src/index.ts" },
						criteria: "Emit an explicit read tool call.",
						expectedActs: ["tool_call"],
						requiredTools: ["read"],
						expectedCompletion: "tool_call",
						penalizedFailureTags: ["missing_tool_attempt"],
					},
					{
						input: { task: "Inspect src/lib.ts" },
						criteria: "Emit an explicit read tool call.",
						expectedActs: ["tool_call"],
						requiredTools: ["read"],
						expectedCompletion: "tool_call",
						penalizedFailureTags: ["missing_tool_attempt"],
					},
				],
				validation: [
					{
						input: { task: "Inspect src/index.ts" },
						criteria: "Emit an explicit read tool call.",
						expectedActs: ["tool_call"],
						requiredTools: ["read"],
						expectedCompletion: "tool_call",
						penalizedFailureTags: ["missing_tool_attempt"],
					},
				],
			},
			runner: async ({ artifact }) => {
				const instructionText = artifact.instructions?.join("\n") ?? "";
				return instructionText.includes("explicit <tool_call>")
					? createTextActFormatPrediction(
							['<tool_call name="read">', '{"filePath":"src/index.ts"}', "</tool_call>"].join("\n"),
						)
					: createTextActFormatPrediction("I will inspect src/index.ts next.", {
							failureTags: ["missing_tool_attempt"],
						});
			},
			maxMetricCalls: 8,
			numTrials: 1,
			minibatch: false,
			earlyStoppingTrials: 1,
			apply: true,
		});

		expect(result.optimizedProgram?.instruction).toContain("explicit <tool_call>");
		expect(result.artifact?.instructions?.join("\n")).toContain("explicit <tool_call>");
		expect(result.program.getCurrentArtifact().instructions?.join("\n")).toContain("explicit <tool_call>");
	});
});
