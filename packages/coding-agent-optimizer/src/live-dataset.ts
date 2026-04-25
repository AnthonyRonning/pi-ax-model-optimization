import type { LiveTextActFormatInput, LiveTextActFormatToolSpec } from "./live-prompt.js";
import type { TextActFormatOptimizationDataset, TextActFormatOptimizationExample } from "./types.js";

const READ_TOOL: LiveTextActFormatToolSpec = {
	name: "read",
	description: "Read the contents of a file.",
	parameters: {
		type: "object",
		properties: {
			filePath: { type: "string" },
		},
		required: ["filePath"],
	},
};

const GREP_TOOL: LiveTextActFormatToolSpec = {
	name: "grep",
	description: "Search file contents for a pattern.",
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string" },
			include: { type: "string" },
		},
		required: ["pattern"],
	},
};

const EDIT_TOOL: LiveTextActFormatToolSpec = {
	name: "edit",
	description: "Replace text inside an existing file.",
	parameters: {
		type: "object",
		properties: {
			filePath: { type: "string" },
			oldString: { type: "string" },
			newString: { type: "string" },
		},
		required: ["filePath", "oldString", "newString"],
	},
};

const WRITE_TOOL: LiveTextActFormatToolSpec = {
	name: "write",
	description: "Create or overwrite a file.",
	parameters: {
		type: "object",
		properties: {
			filePath: { type: "string" },
			content: { type: "string" },
		},
		required: ["filePath", "content"],
	},
};

function example(
	input: LiveTextActFormatInput,
	config: {
		criteria: string;
		expectedActs?: TextActFormatOptimizationExample<LiveTextActFormatInput>["expectedActs"];
		requiredTools?: TextActFormatOptimizationExample<LiveTextActFormatInput>["requiredTools"];
		forbiddenTools?: TextActFormatOptimizationExample<LiveTextActFormatInput>["forbiddenTools"];
		expectedCompletion?: TextActFormatOptimizationExample<LiveTextActFormatInput>["expectedCompletion"];
		penalizedFailureTags?: TextActFormatOptimizationExample<LiveTextActFormatInput>["penalizedFailureTags"];
		requiresToolResultGrounding?: boolean;
		metadata?: TextActFormatOptimizationExample<LiveTextActFormatInput>["metadata"];
	},
): TextActFormatOptimizationExample<LiveTextActFormatInput> {
	return {
		input,
		...config,
	};
}

export function createDefaultLiveTextActFormatDataset(): TextActFormatOptimizationDataset<
	TextActFormatOptimizationExample<LiveTextActFormatInput>
> {
	return {
		train: [
			example(
				{
					task: "Inspect src/index.ts and tell me whether it exports runTask.",
					availableTools: [READ_TOOL, GREP_TOOL, EDIT_TOOL, WRITE_TOOL],
				},
				{
					criteria: "Emit an explicit read-oriented tool call instead of describing the action in plain text.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "hey what's up?",
					canonicalIntent:
						"If the user did not give you a concrete task in their first message, read README.md, then ask which module(s) to work on.",
					availableTools: [READ_TOOL, GREP_TOOL, EDIT_TOOL, WRITE_TOOL],
				},
				{
					criteria:
						'Follow the first-message instruction by calling read for README.md using the required <tool_call name="read"> JSON format. A bare tool-name XML tag such as <read path="README.md"> is invalid and should be scored as a missing tool attempt.',
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
					metadata: {
						observedFailure: '<read path="/Users/tony/Dev/ThirdParties/pi-mono/README.md">',
					},
				},
			),
			example(
				{
					task: "Find all references to createAgentSession in the repo.",
					availableTools: [READ_TOOL, GREP_TOOL],
				},
				{
					criteria: "Use grep to search the repo and emit an explicit tool call.",
					expectedActs: ["tool_call"],
					requiredTools: ["grep"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "Update the file I mentioned earlier so the test passes.",
					availableTools: [READ_TOOL, EDIT_TOOL, WRITE_TOOL],
				},
				{
					criteria: "Ask the user which file to change before attempting any tool call.",
					expectedActs: ["ask_user"],
					expectedCompletion: "ask_user",
					penalizedFailureTags: ["failed_to_ask_user"],
				},
			),
			example(
				{
					task: "Edit src/index.ts so it exports runTask.",
					availableTools: [READ_TOOL, GREP_TOOL],
				},
				{
					criteria: "Report that you are blocked because no edit-capable tool is available.",
					expectedActs: ["blocked"],
					expectedCompletion: "blocked",
				},
			),
			example(
				{
					task: "Continue.",
					availableTools: [READ_TOOL, EDIT_TOOL],
					transcript: [
						"<message>\nI will inspect src/missing.ts.\n</message>",
						'<tool_result name="read" tool_call_id="read_1" status="error">\nFile not found: src/missing.ts\n</tool_result>',
					],
				},
				{
					criteria:
						"Use the error tool result as ground truth and ask the user for the correct path instead of repeating the same failing action.",
					expectedActs: ["ask_user"],
					expectedCompletion: "ask_user",
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output", "failed_to_ask_user"],
				},
			),
			example(
				{
					task: "Answer the user's question using the tool result below and do not call another tool.",
					availableTools: [READ_TOOL, GREP_TOOL],
					transcript: [
						'<tool_result name="read" tool_call_id="read_2" status="ok">\nexport const CONFIG_PATH = "/etc/app.conf";\n</tool_result>',
					],
				},
				{
					criteria:
						"Use the tool result as ground truth, answer directly in a message, and avoid unnecessary tool calls.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "grep"],
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output", "premature_stop"],
				},
			),
		],
		validation: [
			example(
				{
					task: "Search the repo for TODO markers.",
					availableTools: [READ_TOOL, GREP_TOOL],
				},
				{
					criteria: "Use grep explicitly for repo search.",
					expectedActs: ["tool_call"],
					requiredTools: ["grep"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt"],
				},
			),
			example(
				{
					task: "Continue.",
					availableTools: [READ_TOOL, GREP_TOOL],
					transcript: [
						'<tool_result name="read" tool_call_id="read_3" status="ok">\nThe file defines export function runTask() {}\n</tool_result>',
					],
				},
				{
					criteria: "Answer directly from the tool result without another tool call.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "grep"],
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output"],
				},
			),
			example(
				{
					task: "Fix the regression in the file from before.",
					availableTools: [READ_TOOL, EDIT_TOOL, WRITE_TOOL],
				},
				{
					criteria: "Ask the user which file they mean before acting.",
					expectedActs: ["ask_user"],
					expectedCompletion: "ask_user",
					penalizedFailureTags: ["failed_to_ask_user"],
				},
			),
		],
	};
}
