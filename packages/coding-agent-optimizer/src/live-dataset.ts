import type { LiveTextActFormatInput, LiveTextActFormatToolSpec } from "./live-prompt.js";
import type { TextActFormatOptimizationDataset, TextActFormatOptimizationExample } from "./types.js";

const READ_TOOL: LiveTextActFormatToolSpec = {
	name: "read",
	description: "Read the contents of a file. Supports optional offset and limit for large files.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			offset: { type: "number" },
			limit: { type: "number" },
		},
		required: ["path"],
	},
};

const BASH_TOOL: LiveTextActFormatToolSpec = {
	name: "bash",
	description: "Execute a bash command in the current working directory.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string" },
			timeout: { type: "number" },
		},
		required: ["command"],
	},
};

const EDIT_TOOL: LiveTextActFormatToolSpec = {
	name: "edit",
	description: "Edit a single file using exact text replacement.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			edits: {
				type: "array",
				items: {
					type: "object",
					properties: {
						oldText: { type: "string" },
						newText: { type: "string" },
					},
					required: ["oldText", "newText"],
				},
			},
		},
		required: ["path", "edits"],
	},
};

const WRITE_TOOL: LiveTextActFormatToolSpec = {
	name: "write",
	description: "Create or overwrite a file.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			content: { type: "string" },
		},
		required: ["path", "content"],
	},
};

const ALL_TOOLS = [READ_TOOL, BASH_TOOL, EDIT_TOOL, WRITE_TOOL];

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
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						'Emit an explicit read tool call instead of describing the action in plain text. Use <tool_call name="read">{"path":"src/index.ts"}</tool_call>, not prose or a bare <read> tag.',
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "hey what's up?",
					canonicalIntent:
						"If the user did not give you a concrete task in their first message, read README.md, then ask which module(s) to work on.",
					availableTools: ALL_TOOLS,
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
					task: "do you know about the project we're in right now?",
					transcript: [
						"<message>\nHey! Ready to help with whatever you need. What would you like to work on?\n</message>",
					],
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						'Read project context before answering. Emit complete, separate read tool calls such as <tool_call name="read">{"path":"README.md"}</tool_call> and <tool_call name="read">{"path":"AGENTS.md"}</tool_call>. The malformed form `<tool_call>\\nread path="README.md"` is not acceptable.',
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
					metadata: {
						observedFailure: '<tool_call>\nread path="README.md"\n<tool_call>\nread path="AGENTS.md"',
					},
				},
			),
			example(
				{
					task: "Find all references to createAgentSession in the repo.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria:
						'Use bash with an rg command to search the repo and emit an explicit tool call, for example <tool_call name="bash">{"command":"rg \\"createAgentSession\\"","timeout":120}</tool_call>.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "List the files at the repo root.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						'Use bash for directory listing with a valid JSON argument object, for example <tool_call name="bash">{"command":"ls","timeout":120}</tool_call>. Do not output <bash command="ls">.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
					metadata: {
						observedFailure: '<bash command="ls">',
					},
				},
			),
			example(
				{
					task: "Read /Users/tony/Dev/ThirdParties/pi-mono/package.json.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"Preserve the absolute path in a read tool call using the path argument. The output should be a tool_call for read, not a message containing the path.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Read the next 120 lines of packages/coding-agent/src/core/sdk.ts starting at line 200.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"Use read with JSON arguments containing path, offset, and limit. Do not use bash, cat, sed, or a bare <read> tag.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					forbiddenTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Run npm run check.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria:
						'Use the bash tool with {"command":"npm run check"} in a <tool_call name="bash"> block. Do not just tell the user to run the command.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: 'Create notes/promptforge.txt containing the single line "ready".',
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						'Use write with path and content JSON arguments. The intended action is file creation, so a message like "I will create it" is insufficient.',
					expectedActs: ["tool_call"],
					requiredTools: ["write"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Replace the text `foo` with `bar` in src/config.ts.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"Use edit with path and edits:[{oldText,newText}] JSON arguments. Do not use write for a precise replacement and do not emit oldString/newString.",
					expectedActs: ["tool_call"],
					requiredTools: ["edit"],
					forbiddenTools: ["write"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "In README.md replace `alpha` with `beta` and `gamma` with `delta`.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"Use one edit tool call with an edits array containing both replacements. The goal is correct tool-call structure for a multi-edit intent.",
					expectedActs: ["tool_call"],
					requiredTools: ["edit"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Inspect src/index.ts before changing it to export runTask.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"The intended first action is inspection. Emit a read tool call first and wait for the result before editing.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					forbiddenTools: ["edit"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "Read package.json and tsconfig.json.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"Emit explicit read tool calls for the files rather than summarizing intent. Multiple tool_call blocks are acceptable.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Use grep to find TODO markers.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria:
						'There is no grep tool in the available tools; use bash with an rg or grep command inside <tool_call name="bash">.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					forbiddenTools: ["grep"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Show the current git status.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria:
						'Use bash with {"command":"git status --short"} or equivalent. The intended action is a shell command, not a message.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "Tell me what is in the file.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria: "The file is unspecified. Ask the user which file to read before calling a tool.",
					expectedActs: ["ask_user"],
					expectedCompletion: "ask_user",
					penalizedFailureTags: ["failed_to_ask_user"],
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
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria: "Report that you are blocked because no edit-capable tool is available.",
					expectedActs: ["blocked"],
					expectedCompletion: "blocked",
				},
			),
			example(
				{
					task: "Run npm run check.",
					availableTools: [READ_TOOL, EDIT_TOOL, WRITE_TOOL],
				},
				{
					criteria:
						"The requested action requires shell execution, but bash is not available. Report blocked instead of inventing a command-like tag or using write/edit.",
					expectedActs: ["blocked"],
					expectedCompletion: "blocked",
					penalizedFailureTags: ["missing_tool_attempt", "other"],
				},
			),
			example(
				{
					task: "Read README.md.",
					availableTools: [],
				},
				{
					criteria:
						"No tools are available, so report blocked. Do not output a read-shaped tag when the read tool is absent.",
					expectedActs: ["blocked"],
					expectedCompletion: "blocked",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
				},
			),
			example(
				{
					task: "Say ready.",
					availableTools: [],
				},
				{
					criteria: "No tool is required. Reply with a <message> block and do not call a tool.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "bash", "edit", "write"],
					penalizedFailureTags: ["premature_stop"],
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
					availableTools: [READ_TOOL, BASH_TOOL],
					transcript: [
						'<tool_result name="read" tool_call_id="read_2" status="ok">\nexport const CONFIG_PATH = "/etc/app.conf";\n</tool_result>',
					],
				},
				{
					criteria:
						"Use the tool result as ground truth, answer directly in a message, and avoid unnecessary tool calls.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "bash"],
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output", "premature_stop"],
				},
			),
			example(
				{
					task: "Continue.",
					availableTools: [READ_TOOL, BASH_TOOL],
					transcript: [
						'<tool_result name="bash" tool_call_id="bash_1" status="ok">\npackages/foo/src/index.ts: export function runTask() {}\n</tool_result>',
					],
				},
				{
					criteria:
						"Use the successful bash result as ground truth and answer in a message. Do not run another search.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "bash"],
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output", "premature_stop"],
				},
			),
			example(
				{
					task: "Continue.",
					availableTools: [READ_TOOL],
					transcript: [
						'<tool_result name="read" tool_call_id="read_3" status="error">\nFile not found: src/missing.ts\n</tool_result>',
					],
				},
				{
					criteria:
						"The previous read failed and no new path was provided. Ask the user for the correct path instead of retrying the same read.",
					expectedActs: ["ask_user"],
					expectedCompletion: "ask_user",
					forbiddenTools: ["read"],
					requiresToolResultGrounding: true,
					penalizedFailureTags: ["misread_tool_output", "failed_to_ask_user"],
				},
			),
			example(
				{
					task: "Read package.json.",
					availableTools: [READ_TOOL],
				},
				{
					criteria:
						'The name attribute must be on the <tool_call> tag. `<tool_call>{"name":"read","path":"package.json"}</tool_call>` is invalid because the parser will not see a tool name.',
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
					metadata: {
						observedFailure: '<tool_call>{"name":"read","path":"package.json"}</tool_call>',
					},
				},
			),
			example(
				{
					task: "Run pwd.",
					availableTools: [BASH_TOOL],
				},
				{
					criteria:
						'Tool arguments must be a JSON object. `<tool_call name="bash">"pwd"</tool_call>` is invalid; use {"command":"pwd"}.',
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
					metadata: {
						observedFailure: '<tool_call name="bash">"pwd"</tool_call>',
					},
				},
			),
			example(
				{
					task: "Create tmp/result.txt with the text ok.",
					availableTools: [WRITE_TOOL],
				},
				{
					criteria:
						"Tool arguments must be valid JSON. Avoid single quotes and trailing commas in the write tool arguments.",
					expectedActs: ["tool_call"],
					requiredTools: ["write"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
					metadata: {
						observedFailure: "<tool_call name=\"write\">{'path':'tmp/result.txt','content':'ok',}</tool_call>",
					},
				},
			),
		],
		validation: [
			example(
				{
					task: "Search the repo for TODO markers.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria: "Use bash with an explicit search command for repo search.",
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt"],
				},
			),
			example(
				{
					task: "Read README.md and package.json.",
					availableTools: ALL_TOOLS,
				},
				{
					criteria: "Use explicit read tool calls; do not emit bare <read> tags or prose-only intent.",
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act", "premature_stop"],
				},
			),
			example(
				{
					task: "Run git diff --stat.",
					availableTools: [READ_TOOL, BASH_TOOL],
				},
				{
					criteria: "Use bash with valid JSON arguments and do not summarize the command instead of calling it.",
					expectedActs: ["tool_call"],
					requiredTools: ["bash"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "premature_stop"],
				},
			),
			example(
				{
					task: "Patch src/foo.ts by replacing hello with goodbye.",
					availableTools: [READ_TOOL, EDIT_TOOL],
				},
				{
					criteria:
						"Use edit with path and edits array in JSON. Do not invent apply_patch or write a shell command.",
					expectedActs: ["tool_call"],
					requiredTools: ["edit"],
					forbiddenTools: ["bash", "write"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
				},
			),
			example(
				{
					task: "Continue.",
					availableTools: [READ_TOOL, BASH_TOOL],
					transcript: [
						'<tool_result name="read" tool_call_id="read_4" status="ok">\nThe file defines export function runTask() {}\n</tool_result>',
					],
				},
				{
					criteria: "Answer directly from the tool result without another tool call.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "bash"],
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
			example(
				{
					task: "Run the test command.",
					availableTools: [READ_TOOL, EDIT_TOOL],
				},
				{
					criteria: "The command is unspecified and bash is unavailable; ask for clarification or report blocked.",
					expectedActs: ["ask_user", "blocked"],
					expectedCompletion: "ask_user",
					penalizedFailureTags: ["failed_to_ask_user", "missing_tool_attempt"],
				},
			),
			example(
				{
					task: "What is 2 + 2?",
					availableTools: ALL_TOOLS,
				},
				{
					criteria:
						"No tool is needed for this direct question. Reply with a message and avoid unnecessary tool calls.",
					expectedActs: ["message"],
					expectedCompletion: "message",
					forbiddenTools: ["read", "bash", "edit", "write"],
					penalizedFailureTags: ["premature_stop"],
				},
			),
			example(
				{
					task: "Open package.json.",
					availableTools: [READ_TOOL],
				},
				{
					criteria:
						'Use the read tool with the path argument. The XML-ish `<read path="package.json">` shape is not a valid tool call.',
					expectedActs: ["tool_call"],
					requiredTools: ["read"],
					expectedCompletion: "tool_call",
					penalizedFailureTags: ["missing_tool_attempt", "unparseable_act"],
				},
			),
		],
	};
}
