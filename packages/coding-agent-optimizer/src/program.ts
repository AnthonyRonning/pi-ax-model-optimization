import {
	type AxAIService,
	type AxGenStreamingOut,
	type AxOptimizedProgram,
	type AxProgramDemos,
	type AxProgramForwardOptions,
	type AxProgrammable,
	type AxProgramStreamingForwardOptions,
	type AxProgramTrace,
	type AxProgramUsage,
	AxSignature,
} from "@ax-llm/ax";
import { buildTextActFormatArtifactFromInstruction, getSeedInstructionText } from "./artifact.js";
import type {
	TextActFormatArtifact,
	TextActFormatOptimizationExample,
	TextActFormatOptimizationPrediction,
	TextActFormatOptimizationRunner,
} from "./types.js";

export interface TextActFormatOptimizationProgramOptions<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
> {
	baseArtifact?: TextActFormatArtifact;
	programId?: string;
	programDescription?: string;
	targetId?: string;
	runner: TextActFormatOptimizationRunner<Example, Prediction>;
}

export class TextActFormatOptimizationProgram<
	Example extends TextActFormatOptimizationExample = TextActFormatOptimizationExample,
	Prediction extends TextActFormatOptimizationPrediction = TextActFormatOptimizationPrediction,
> implements AxProgrammable<Example, Prediction>
{
	private readonly signature = AxSignature.create("example:json -> prediction:json");
	private readonly runner: TextActFormatOptimizationRunner<Example, Prediction>;
	private readonly baseArtifact?: TextActFormatArtifact;
	private readonly targetId: string;
	private id: string;
	private instructionText: string;
	private traces: AxProgramTrace<Example, Prediction>[] = [];
	private usage: AxProgramUsage[] = [];

	constructor(options: TextActFormatOptimizationProgramOptions<Example, Prediction>) {
		this.runner = options.runner;
		this.baseArtifact = options.baseArtifact;
		this.targetId = options.targetId ?? "text-act-format.instructions";
		this.id = options.programId ?? this.targetId;
		this.instructionText = getSeedInstructionText(options.baseArtifact);
		this.signature.setDescription(
			options.programDescription ??
				"Optimize PromptForge Text Act Format instructions for reliable coding-agent acts.",
		);
	}

	getId(): string {
		return this.id;
	}

	setId(id: string): void {
		this.id = id;
	}

	getTargetId(): string {
		return this.targetId;
	}

	getSignature(): AxSignature<{ example: object }, { prediction: object }> {
		return this.signature;
	}

	getInstruction(): string {
		return this.instructionText;
	}

	setInstruction(instruction: string): void {
		this.instructionText = instruction.trim();
	}

	getCurrentArtifact(): TextActFormatArtifact {
		return buildTextActFormatArtifactFromInstruction(this.baseArtifact, this.instructionText);
	}

	getTraces(): AxProgramTrace<Example, Prediction>[] {
		return this.traces;
	}

	setDemos(_demos: readonly AxProgramDemos<Example, Prediction>[]): void {
		// Text Act Format optimization only tunes instructions in v1.
	}

	applyOptimization(optimizedProgram: AxOptimizedProgram<Prediction>): void {
		const nextInstruction = optimizedProgram.instructionMap?.[this.targetId] ?? optimizedProgram.instruction;
		if (nextInstruction) {
			this.setInstruction(nextInstruction);
		}
	}

	getUsage(): AxProgramUsage[] {
		return this.usage;
	}

	resetUsage(): void {
		this.usage = [];
	}

	async forward(
		_ai: Readonly<AxAIService>,
		values: Example,
		_options?: Readonly<AxProgramForwardOptions<string>>,
	): Promise<Prediction> {
		const prediction = await this.runner({
			example: values,
			artifact: this.getCurrentArtifact(),
		});

		this.traces = [];
		return prediction;
	}

	async *streamingForward(
		ai: Readonly<AxAIService>,
		values: Example,
		options?: Readonly<AxProgramStreamingForwardOptions<string>>,
	): AxGenStreamingOut<Prediction> {
		const prediction = await this.forward(ai, values, options);
		yield {
			version: 0,
			index: 0,
			delta: prediction,
			partial: prediction,
		};
	}
}
