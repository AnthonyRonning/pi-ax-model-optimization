import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Context, Usage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { streamTextActFormat } from "../src/core/text-act-format/adapter.js";
import { loadTextActFormatArtifact } from "../src/core/text-act-format/artifacts.js";
import { appendTextActFormatFeedbackRecord } from "../src/core/text-act-format/feedback.js";
import { parseTextActFormat } from "../src/core/text-act-format/parser.js";
import { buildTextActFormatContext } from "../src/core/text-act-format/render.js";
import { createReadTool, readTool } from "../src/core/tools/index.js";
import { createFauxStreamFn, fauxModel } from "./test-harness.js";

const zeroUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("Text Act Format", () => {
	it("recovers a trailing tool call without a closing tag", () => {
		const parsed = parseTextActFormat(
			["<message>", "Looking it up.", "</message>", '<tool_call name="read">', 'filePath: "src/index.ts"'].join(
				"\n",
			),
		);

		expect(parsed.hadExplicitToolAttempt).toBe(true);
		expect(parsed.usedPlainTextFallback).toBe(false);
		expect(parsed.acts).toEqual([
			{ type: "message", text: "Looking it up." },
			{
				type: "tool_call",
				name: "read",
				arguments: { filePath: "src/index.ts" },
				rawArguments: 'filePath: "src/index.ts"',
				recovered: true,
			},
		]);
	});

	it("renders prior messages into text-native context and disables native tools", () => {
		const context: Context = {
			systemPrompt: "Base system prompt.",
			tools: [readTool],
			messages: [
				{ role: "user", content: "Please inspect src/index.ts", timestamp: 1 },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I will inspect the file." },
						{ type: "toolCall", id: "call_1", name: "read", arguments: { filePath: "src/index.ts" } },
					],
					api: fauxModel.api,
					provider: fauxModel.provider,
					model: fauxModel.id,
					usage: zeroUsage,
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "read",
					content: [{ type: "text", text: "export const value = 1;" }],
					isError: false,
					timestamp: 3,
				},
			],
		};

		const rendered = buildTextActFormatContext(context);

		expect(rendered.tools).toBeUndefined();
		expect(rendered.systemPrompt).toContain("# Text Act Format");
		expect(rendered.systemPrompt).toContain('<tool name="read">');

		const assistantMessage = rendered.messages[1];
		expect(assistantMessage.role).toBe("assistant");
		if (assistantMessage.role === "assistant") {
			const textBlock = assistantMessage.content[0];
			expect(textBlock.type).toBe("text");
			if (textBlock.type === "text") {
				expect(textBlock.text).toContain("<message>");
				expect(textBlock.text).toContain('<tool_call name="read">');
			}
		}

		const toolResultMessage = rendered.messages[2];
		expect(toolResultMessage.role).toBe("user");
		if (toolResultMessage.role === "user" && Array.isArray(toolResultMessage.content)) {
			const textBlock = toolResultMessage.content[0];
			expect(textBlock.type).toBe("text");
			if (textBlock.type === "text") {
				expect(textBlock.text).toContain("<tool_result");
				expect(textBlock.text).toContain("export const value = 1;");
			}
		}
	});

	it("lowers text acts into assistant text and tool call events", async () => {
		const { streamFn, state } = createFauxStreamFn([
			[
				"<message>",
				"Looking now.",
				"</message>",
				'<tool_call name="read">',
				'{"filePath":"src/index.ts"}',
				"</tool_call>",
			].join("\n"),
		]);

		const context: Context = {
			systemPrompt: "Base system prompt.",
			tools: [readTool],
			messages: [{ role: "user", content: "Inspect src/index.ts", timestamp: 1 }],
		};

		const stream = await streamTextActFormat(fauxModel, context, undefined, streamFn);
		let textSeen = false;
		let toolCallSeen = false;

		for await (const event of stream) {
			if (event.type === "text_end") {
				textSeen = true;
				expect(event.content).toBe("Looking now.");
			}

			if (event.type === "toolcall_end") {
				toolCallSeen = true;
				expect(event.toolCall.name).toBe("read");
				expect(event.toolCall.arguments).toEqual({ filePath: "src/index.ts" });
			}
		}

		expect(textSeen).toBe(true);
		expect(toolCallSeen).toBe(true);

		const result = await stream.result();
		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toEqual([
			{ type: "text", text: "Looking now." },
			{ type: "toolCall", id: "text_act_format_0", name: "read", arguments: { filePath: "src/index.ts" } },
		]);

		expect(state.contexts).toHaveLength(1);
		expect(state.contexts[0]?.tools).toBeUndefined();
		expect(state.contexts[0]?.systemPrompt).toContain("# Text Act Format");
	});

	it("ignores transport stop reasons when explicit tool acts are present", async () => {
		const { streamFn } = createFauxStreamFn([
			{
				text: [
					"<message>",
					"Reading both files.",
					"</message>",
					'<tool_call name="read">',
					'{"filePath":"src/index.ts"}',
					"</tool_call>",
					'<tool_call name="read">',
					'{"filePath":"src/lib.ts"}',
					"</tool_call>",
				].join("\n"),
				stopReason: "length",
			},
		]);

		const stream = await streamTextActFormat(
			fauxModel,
			{
				systemPrompt: "Base system prompt.",
				tools: [readTool],
				messages: [{ role: "user", content: "Inspect src/index.ts and src/lib.ts", timestamp: 1 }],
			},
			undefined,
			streamFn,
		);

		const result = await stream.result();
		expect(result.stopReason).toBe("toolUse");
		expect(
			result.content
				.filter((block) => block.type === "toolCall")
				.map((block) => block.type === "toolCall" && block.name),
		).toEqual(["read", "read"]);
	});

	it("lowers ask_user and done into assistant text without tool calls", async () => {
		const { streamFn } = createFauxStreamFn([
			{
				text: ["<ask_user>", "Which file should I inspect?", "</ask_user>", "<done />"].join("\n"),
				stopReason: "length",
			},
		]);

		const stream = await streamTextActFormat(
			fauxModel,
			{
				systemPrompt: "Base system prompt.",
				tools: [readTool],
				messages: [{ role: "user", content: "Take a look.", timestamp: 1 }],
			},
			undefined,
			streamFn,
		);

		const result = await stream.result();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "Which file should I inspect?" }]);
	});

	it("loads the most specific artifact and injects adapter hints into the prompt", () => {
		const tempDir = join(tmpdir(), `pi-text-act-format-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwd = join(tempDir, "project");
		const agentDir = join(tempDir, "agent");
		const artifactDir = join(cwd, ".pi", "promptforge", "text-act-format", fauxModel.provider);

		try {
			mkdirSync(artifactDir, { recursive: true });
			mkdirSync(join(agentDir, "promptforge", "text-act-format", fauxModel.provider), { recursive: true });

			writeFileSync(
				join(cwd, ".pi", "promptforge", "text-act-format", "default.json"),
				JSON.stringify({
					schemaVersion: 1,
					description: "Fallback artifact.",
					instructions: ["Use the fallback."],
				}),
			);
			writeFileSync(
				join(artifactDir, `${fauxModel.id}.json`),
				JSON.stringify({
					schemaVersion: 1,
					description: "Model-specific adapter.",
					instructions: ["Prefer explicit <tool_call> acts."],
					examples: [
						{
							input: "Read src/index.ts",
							output: '<tool_call name="read">{"filePath":"src/index.ts"}</tool_call>',
						},
					],
				}),
			);

			const loaded = loadTextActFormatArtifact({
				cwd,
				agentDir,
				model: fauxModel,
			});

			expect(loaded?.path).toBe(join(artifactDir, `${fauxModel.id}.json`));

			const rendered = buildTextActFormatContext(
				{
					systemPrompt: "Base system prompt.",
					tools: [readTool],
					messages: [],
				},
				loaded?.artifact,
			);

			expect(rendered.systemPrompt).toContain("# Model adapter");
			expect(rendered.systemPrompt).toContain("Model-specific adapter.");
			expect(rendered.systemPrompt).toContain("Prefer explicit <tool_call> acts.");
			expect(rendered.systemPrompt).toContain("Expected Text Act Format output:");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("writes feedback records to the project review queue", () => {
		const tempDir = join(tmpdir(), `pi-text-act-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwd = join(tempDir, "project");
		const agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });

		try {
			const { path, record } = appendTextActFormatFeedbackRecord({
				cwd,
				agentDir,
				model: fauxModel,
				context: {
					systemPrompt: "Base system prompt.",
					tools: [readTool],
					messages: [{ role: "user", content: "Inspect src/index.ts", timestamp: 1 }],
				},
				rawAssistantOutput: "I will inspect the file next.",
				failureTag: "missing_tool_attempt",
				note: "Expected an explicit read call.",
			});

			expect(path).toBe(join(cwd, ".pi", "promptforge", "feedback", "text-act-format.jsonl"));
			expect(record.failureTag).toBe("missing_tool_attempt");
			expect(record.tools.map((tool) => tool.name)).toEqual(["read"]);
			expect(record.parsedActs).toEqual([{ type: "message", text: "I will inspect the file next." }]);

			const saved = JSON.parse(readFileSync(path, "utf-8").trim()) as typeof record;
			expect(saved.note).toBe("Expected an explicit read call.");
			expect(saved.usedPlainTextFallback).toBe(true);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("continues through a real pi tool call using the adapter", async () => {
		const tempDir = join(tmpdir(), `pi-text-act-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const projectDir = join(tempDir, "project");
		const srcDir = join(projectDir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "index.ts"), "export const value = 1;\n");

		try {
			const { streamFn: providerStreamFn } = createFauxStreamFn([
				[
					"<message>",
					"Reading the file.",
					"</message>",
					'<tool_call name="read">',
					'{"filePath":"src/index.ts"}',
					"</tool_call>",
				].join("\n"),
				["<message>", "The file exports value = 1.", "</message>", "<done />"].join("\n"),
			]);

			const agent = new Agent({
				initialState: {
					model: fauxModel,
					systemPrompt: "Base system prompt.",
					tools: [createReadTool(projectDir)],
				},
				streamFn: (model, context, options) => streamTextActFormat(model, context, options, providerStreamFn),
			});

			await agent.prompt("Inspect src/index.ts");

			expect(agent.state.messages.map((message) => message.role)).toEqual([
				"user",
				"assistant",
				"toolResult",
				"assistant",
			]);

			const toolResult = agent.state.messages[2];
			expect(toolResult?.role).toBe("toolResult");
			if (toolResult?.role === "toolResult") {
				expect(toolResult.toolName).toBe("read");
				expect(toolResult.content[0]?.type).toBe("text");
			}

			const finalAssistant = agent.state.messages[3];
			expect(finalAssistant?.role).toBe("assistant");
			if (finalAssistant?.role === "assistant") {
				expect(finalAssistant.stopReason).toBe("stop");
				expect(finalAssistant.content).toEqual([{ type: "text", text: "The file exports value = 1." }]);
			}
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
