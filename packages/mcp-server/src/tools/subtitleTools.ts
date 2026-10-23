/**
 * `subtitle.import_srt` 工具定义与空 handler。
 */

import {
  MCP_TOOL_DEFINITIONS,
  type JsonSchema,
  type SubtitleImportSrtArgs,
  type SubtitleImportSrtResult,
} from '@clipcut/shared-types';
import { NotImplementedError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';

/** 工具定义。 */
export const subtitleToolDefinitions = [MCP_TOOL_DEFINITIONS['subtitle.import_srt']];

/** 工具入参 schema。 */
export const subtitleToolSchemas: Record<string, JsonSchema> = {
  'subtitle.import_srt': MCP_TOOL_DEFINITIONS['subtitle.import_srt'].inputSchema,
};

/**
 * `subtitle.import_srt` handler（V1.0 空实现）。
 */
export async function handleSubtitleImportSrt(
  _bridge: ClipCutBridge,
  _args: SubtitleImportSrtArgs,
): Promise<SubtitleImportSrtResult> {
  throw new NotImplementedError('subtitle.import_srt');
}
