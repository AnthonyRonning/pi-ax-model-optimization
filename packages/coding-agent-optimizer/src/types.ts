import type {
	AxAIService,
	AxFieldValue,
	AxMetricFn,
	AxMultiMetricFn,
	AxOptimizationProgress,
	AxOptimizationStats,
	AxOptimizedProgram,
	AxOptimizerLoggerData,
	AxParetoResult,
} from "@ax-llm/ax";

export type TextActCompletionState = "tool_call" | "ask_user" | "blocked" | "done" | "message" | "empty";

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

export type TextActFormatAct =
	| { type: "message"; text: string }
	| { type: "tool_call"; name: string; arguments: Record<string, unknown>; rawArguments: string; recovered: boolean }
	| { type: "ask_user"; text: string }
	| { type: "blocked"; text: string }
	| { type: "done" };

export interface TextActFormatParseResult {
	acts: TextActFormatAct[];
	hadExplicitToolAttempt: boolean;
	usedPlainTextFallback: boolean;
}

export type TextActFormatFailureTag =
	| "missing_tool_attempt"
	| "premature_stop"
	| "misread_tool_output"
	| "failed_to_ask_user"
	| "unparseable_act"
	| "other";

export interface TextActFormatTextContent {
	type: "text";
	text: string;
}

export interface TextActFormatImageContent {
	type: "image";
	mimeType: string;
	data?: string;
}

export interface TextActFormatThinkingContent {
	type: "thinking";
	thinking: string;
}

export interface TextActFormatToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface TextActFormatUserMessage {
	role: "user";
	content: string | Array<TextActFormatTextContent | TextActFormatImageContent>;
	timestamp: number;
}

export interface TextActFormatAssistantMessage {
	role: "assistant";
	content: Array<TextActFormatTextContent | TextActFormatThinkingContent | TextActFormatToolCallContent>;
	api?: string;
	provider?: string;
	model?: string;
	usage?: unknown;
	stopReason?: string;
	errorMessage?: string;
	timestamp: number;
}

export interface TextActFormatToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: Array<TextActFormatTextContent | TextActFormatImageContent>;
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

export type TextActFormatFeedbackMessage =
	| TextActFormatUserMessage
	| TextActFormatAssistantMessage
	| TextActFormatToolResultMessage;

export interface TextActFormatFeedbackRecord {
	schemaVersion: 1;
	createdAt: string;
	model: {
		provider: string;
		id: string;
	};
	failureTag: TextActFormatFailureTag;
	canonicalIntent?: string;
	tools: Array<{
		name: string;
		description: string;
		parameters: unknown;
	}>;
	transcript: TextActFormatFeedbackMessage[];
	rawAssistantOutput: string;
	parsedActs: TextActFormatAct[];
	hadExplicitToolAttempt: boolean;
	usedPlainTextFallback: boolean;
	note?: string;
	artifactPath?: string;
}

export interface TextActFormatOptimizationToolCall {
	name: string;
	arguments: Record<string, unknown>;
	recovered: boolean;
}

export interface TextActFormatOptimizationPrediction {
	[key: string]: AxFieldValue;
	rawAssistantOutput: string;
	parsedActs: TextActFormatAct[];
	toolCalls: TextActFormatOptimizationToolCall[];
	completion: TextActCompletionState;
	hadExplicitToolAttempt: boolean;
	usedPlainTextFallback: boolean;
	failureTags?: TextActFormatFailureTag[];
	usedToolResultGrounding?: boolean;
	metadata?: Record<string, AxFieldValue>;
}

export interface TextActFormatOptimizationExample<
	Input extends Record<string, AxFieldValue> = Record<string, AxFieldValue>,
> {
	[key: string]: AxFieldValue;
	input: Input;
	criteria: string;
	expectedActs?: readonly TextActFormatAct["type"][];
	requiredTools?: readonly string[];
	forbiddenTools?: readonly string[];
	expectedCompletion?: Exclude<TextActCompletionState, "empty">;
	penalizedFailureTags?: readonly TextActFormatFailureTag[];
	requiresToolResultGrounding?: boolean;
	metadata?: Record<string, AxFieldValue>;
}

export type TextActFormatOptimizationDataset<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
> =
	| readonly Example[]
	| {
			train: readonly Example[];
			validation?: readonly Example[];
	  };

export interface TextActFormatScoreVector {
	[key: string]: number;
	actParsing: number;
	toolSelection: number;
	completion: number;
	toolGrounding: number;
	failureAvoidance: number;
}

export interface TextActFormatScalarizationWeights {
	actParsing?: number;
	toolSelection?: number;
	completion?: number;
	toolGrounding?: number;
	failureAvoidance?: number;
}

export interface TextActFormatOptimizationRunnerArgs<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
> {
	example: Example;
	artifact: TextActFormatArtifact;
	signal?: AbortSignal;
}

export type TextActFormatOptimizationRunner<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
> = (args: Readonly<TextActFormatOptimizationRunnerArgs<Example>>) => Promise<Prediction>;

export interface TextActFormatOptimizerArtifactMetadata {
	kind: "ax-gepa";
	createdAt: string;
	targetId: string;
	bestScore: number;
	optimizerType: string;
	optimizationTime: number;
	totalRounds: number;
	converged: boolean;
}

export interface TextActFormatOptimizerArtifactParetoEntry {
	instruction?: string;
	scores: Record<string, number>;
	dominatedSolutions: number;
}

export interface TextActFormatOptimizerArtifactFile extends TextActFormatArtifact {
	optimizer?: TextActFormatOptimizerArtifactMetadata;
	paretoFront?: TextActFormatOptimizerArtifactParetoEntry[];
}

export interface OptimizeTextActFormatOptions<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
> {
	studentAI: AxAIService;
	teacherAI?: AxAIService;
	dataset: TextActFormatOptimizationDataset<Example>;
	runner: TextActFormatOptimizationRunner<Example, Prediction>;
	baseArtifact?: TextActFormatArtifact;
	metric?: AxMetricFn | AxMultiMetricFn;
	targetId?: string;
	programId?: string;
	programDescription?: string;
	apply?: boolean;
	maxMetricCalls: number;
	numTrials?: number;
	minibatch?: boolean;
	minibatchSize?: number;
	earlyStoppingTrials?: number;
	minImprovementThreshold?: number;
	sampleCount?: number;
	seed?: number;
	verbose?: boolean;
	debugOptimizer?: boolean;
	optimizerLogger?: (data: AxOptimizerLoggerData) => void;
	onProgress?: (progress: Readonly<AxOptimizationProgress>) => void;
	onEarlyStop?: (reason: string, stats: Readonly<AxOptimizationStats>) => void;
}

export interface OptimizeTextActFormatResult<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
> {
	artifact?: TextActFormatOptimizerArtifactFile;
	axResult: AxParetoResult<Prediction>;
	optimizedProgram?: AxOptimizedProgram<Prediction>;
	program: import("./program.js").TextActFormatOptimizationProgram<Example, Prediction>;
}

export interface TextActFormatFeedbackOptimizationInput {
	[key: string]: AxFieldValue;
	canonicalIntent?: string;
	transcript: TextActFormatFeedbackRecord["transcript"];
	availableTools: TextActFormatFeedbackRecord["tools"];
	rawAssistantOutput: string;
}
