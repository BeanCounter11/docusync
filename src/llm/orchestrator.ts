import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { DocuSyncConfig } from '../config/schema.js';
import { formatLlmFailureMessage } from '../utils/llm-errors.js';
import { logWarn } from '../utils/logger.js';
import { getLLMModel } from './providers.js';
import {
  buildDraftDocUserPrompt,
  DRAFT_DOC_SYSTEM_PROMPT,
  type DraftDocPromptInput,
} from './prompts/draft-doc.js';
import {
  buildUpdateDocUserPrompt,
  UPDATE_DOC_SYSTEM_PROMPT,
  type UpdateDocPromptInput,
} from './prompts/update-doc.js';

export const CONFIDENCE_THRESHOLD = 0.6;

export const UpdateDocSchema = z.object({
  updatedMarkdown: z.string().min(1),
  changeSummary: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const DraftDocSchema = z.object({
  draftMarkdown: z.string().min(1),
  suggestedTitle: z.string().min(1),
  rationale: z.string().min(1),
});

export type UpdateDocResult = z.infer<typeof UpdateDocSchema>;
export type DraftDocResult = z.infer<typeof DraftDocSchema>;

export interface OrchestratorSuccess<T> {
  success: true;
  data: T;
}

export interface OrchestratorFailure {
  success: false;
  reason: string;
  confidence?: number;
}

export type OrchestratorResult<T> = OrchestratorSuccess<T> | OrchestratorFailure;

export type GenerateObjectFn = typeof generateObject;

export interface LlmExecutionOptions {
  config: DocuSyncConfig;
  model?: LanguageModel;
  generateObjectFn?: GenerateObjectFn;
}

function resolveModel(options: LlmExecutionOptions): LanguageModel {
  return options.model ?? getLLMModel(options.config);
}

function resolveGenerationParams(config: DocuSyncConfig): {
  temperature: number;
  maxTokens: number;
} {
  return {
    temperature: config.llm.temperature ?? 0.2,
    maxTokens: config.llm.maxTokens ?? 4096,
  };
}

function logLowConfidence(context: string, confidence: number): void {
  logWarn(
    `Low confidence (${confidence.toFixed(2)}) for ${context}. ` +
      `Threshold is ${CONFIDENCE_THRESHOLD}. Skipping unsafe write.`,
  );
}

export interface ExecuteDocUpdateInput extends UpdateDocPromptInput {
  config: DocuSyncConfig;
  model?: LanguageModel;
  generateObjectFn?: GenerateObjectFn;
}

export async function executeDocUpdate(
  input: ExecuteDocUpdateInput,
): Promise<OrchestratorResult<UpdateDocResult>> {
  const generate = input.generateObjectFn ?? generateObject;
  const model = resolveModel(input);
  const { temperature, maxTokens } = resolveGenerationParams(input.config);

  try {
    const { object } = await generate({
      model,
      schema: UpdateDocSchema,
      schemaName: 'UpdateDoc',
      schemaDescription:
        'Structured documentation update with full markdown and confidence score',
      system: UPDATE_DOC_SYSTEM_PROMPT,
      prompt: buildUpdateDocUserPrompt(input),
      temperature,
      maxTokens,
    });

    if (object.confidence < CONFIDENCE_THRESHOLD) {
      logLowConfidence(`doc update (${input.docPath})`, object.confidence);
      return {
        success: false,
        reason: `Confidence ${object.confidence.toFixed(2)} is below threshold ${CONFIDENCE_THRESHOLD}`,
        confidence: object.confidence,
      };
    }

    return { success: true, data: object };
  } catch (error) {
    return {
      success: false,
      reason: formatLlmFailureMessage(error),
    };
  }
}

export interface ExecuteDocDraftInput extends DraftDocPromptInput {
  config: DocuSyncConfig;
  model?: LanguageModel;
  generateObjectFn?: GenerateObjectFn;
}

export async function executeDocDraft(
  input: ExecuteDocDraftInput,
): Promise<OrchestratorResult<DraftDocResult>> {
  const generate = input.generateObjectFn ?? generateObject;
  const model = resolveModel(input);
  const { temperature, maxTokens } = resolveGenerationParams(input.config);

  try {
    const { object } = await generate({
      model,
      schema: DraftDocSchema,
      schemaName: 'DraftDoc',
      schemaDescription:
        'Structured draft documentation for a new or significantly changed module',
      system: DRAFT_DOC_SYSTEM_PROMPT,
      prompt: buildDraftDocUserPrompt(input),
      temperature,
      maxTokens,
    });

    return { success: true, data: object };
  } catch (error) {
    return {
      success: false,
      reason: formatLlmFailureMessage(error),
    };
  }
}
