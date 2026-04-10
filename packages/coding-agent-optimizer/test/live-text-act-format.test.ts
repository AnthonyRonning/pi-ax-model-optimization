import type { AxAIService } from "@ax-llm/ax";
import { describe, expect, it } from "vitest";
import { createDefaultLiveTextActFormatDataset } from "../src/live-dataset.js";
import { buildLiveTextActFormatSystemPrompt, buildLiveTextActFormatUserPrompt } from "../src/live-prompt.js";
import { createLiveTextActFormatRunner } from "../src/live-runner.js";
import {
	createLiveTextActFormatTargets,
	DEFAULT_LIVE_STUDENT_MODEL,
	DEFAULT_LIVE_STUDENT_PROVIDER,
} from "../src/live-targets.js";

describe("live Text Act Format helpers", () => {
	it("renders a system prompt with tools and artifact hints", () => {
		const prompt = buildLiveTextActFormatSystemPrompt(
			{
				canonicalIntent: "You are a coding agent.",
				availableTools: [
					{
						name: "read",
						description: "Read a file",
						parameters: { type: "object", properties: { filePath: { type: "string" } } },
					},
				],
			},
			{
				schemaVersion: 1,
				description: "Adapter description.",
				instructions: ["Prefer explicit tool calls."],
			},
		);

		expect(prompt).toContain("# Text Act Format");
		expect(prompt).toContain('<tool name="read">');
		expect(prompt).toContain("Adapter description.");
		expect(prompt).toContain("Prefer explicit tool calls.");
	});

	it("builds a mixed seed dataset with train and validation coverage", () => {
		const dataset = createDefaultLiveTextActFormatDataset();
		if (Array.isArray(dataset)) {
			throw new Error("Expected split dataset");
		}
		const splitDataset = dataset as {
			train: ReadonlyArray<{ expectedCompletion?: string }>;
			validation?: ReadonlyArray<unknown>;
		};

		expect(splitDataset.train.length).toBeGreaterThanOrEqual(6);
		expect(splitDataset.validation?.length).toBeGreaterThanOrEqual(3);
		expect(splitDataset.train.some((example) => example.expectedCompletion === "ask_user")).toBe(true);
		expect(splitDataset.train.some((example) => example.expectedCompletion === "blocked")).toBe(true);
	});

	it("runs the live runner against a real chat response surface", async () => {
		const studentAI = {
			chat: async () =>
				({
					results: [
						{
							index: 0,
							content: '<tool_call name="read">{"filePath":"src/index.ts"}</tool_call>',
						},
					],
				}) as import("@ax-llm/ax").AxChatResponse,
			getOptions: () => ({}),
			getLogger: () => undefined,
		} as unknown as AxAIService;

		const runner = createLiveTextActFormatRunner({ studentAI });
		const prediction = await runner({
			example: {
				input: {
					task: "Inspect src/index.ts",
					availableTools: [
						{
							name: "read",
							description: "Read a file",
							parameters: { type: "object", properties: { filePath: { type: "string" } } },
						},
					],
				},
				criteria: "Emit a read tool call.",
				expectedActs: ["tool_call"],
				requiredTools: ["read"],
				expectedCompletion: "tool_call",
			},
			artifact: {
				schemaVersion: 1,
				instructions: ["Use explicit tool calls."],
			},
		});

		expect(prediction.toolCalls[0]?.name).toBe("read");
		expect(prediction.completion).toBe("tool_call");
		expect(buildLiveTextActFormatUserPrompt({ task: "Inspect src/index.ts", availableTools: [] })).toContain(
			"# Task",
		);
	});

	it("creates model-scoped targets for multiple student models", () => {
		const targets = createLiveTextActFormatTargets({
			cwd: "/tmp/promptforge",
			studentModels: "moonshotai/kimi-k2.5,\nqwen/qwen3-32b",
		});

		expect(targets).toEqual([
			{
				provider: DEFAULT_LIVE_STUDENT_PROVIDER,
				model: "moonshotai/kimi-k2.5",
				outputPath: "/tmp/promptforge/.pi/promptforge/text-act-format/openrouter/moonshotai/kimi-k2.5.json",
			},
			{
				provider: DEFAULT_LIVE_STUDENT_PROVIDER,
				model: "qwen/qwen3-32b",
				outputPath: "/tmp/promptforge/.pi/promptforge/text-act-format/openrouter/qwen/qwen3-32b.json",
			},
		]);

		expect(
			createLiveTextActFormatTargets({
				cwd: "/tmp/promptforge",
			}),
		).toEqual([
			{
				provider: DEFAULT_LIVE_STUDENT_PROVIDER,
				model: DEFAULT_LIVE_STUDENT_MODEL,
				outputPath: "/tmp/promptforge/.pi/promptforge/text-act-format/openrouter/moonshotai/kimi-k2.5.json",
			},
		]);
	});

	it("rejects a shared artifact path for multiple student models", () => {
		expect(() =>
			createLiveTextActFormatTargets({
				cwd: "/tmp/promptforge",
				studentModels: "moonshotai/kimi-k2.5,qwen/qwen3-32b",
				artifactPath: "/tmp/shared.json",
			}),
		).toThrow("PROMPTFORGE_ARTIFACT_PATH can only be used with a single student model.");
	});
});
