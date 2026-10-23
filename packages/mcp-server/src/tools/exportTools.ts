/**
 * `export.start` / `export.get_status` 工具定义与空 handler。
 */

import {
  MCP_TOOL_DEFINITIONS,
  type JsonSchema,
  type ExportGetStatusArgs,
  type ExportGetStatusResult,
  type ExportStartArgs,
  type ExportStartResult,
} from '@clipcut/shared-types';
import { NotImplementedError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';

/** 工具定义。 */
export const exportToolDefinitions = [
  MCP_TOOL_DEFINITIONS['export.start'],
  MCP_TOOL_DEFINITIONS['export.get_status'],
];

/** 工具入参 schema。 */
export const exportToolSchemas: Record<string, JsonSchema> = {
  'export.start': MCP_TOOL_DEFINITIONS['export.start'].inputSchema,
  'export.get_status': MCP_TOOL_DEFINITIONS['export.get_status'].inputSchema,
};

/**
 * `export.start` handler（V1.0 空实现）。
 */
export async function handleExportStart(
  _bridge: ClipCutBridge,
  _args: ExportStartArgs,
): Promise<ExportStartResult> {
  throw new NotImplementedError('export.start');
}

/**
 * `export.get_status` handler（V1.0 空实现）。
 */
export async function handleExportGetStatus(
  _bridge: ClipCutBridge,
  _args: ExportGetStatusArgs,
): Promise<ExportGetStatusResult> {
  throw new NotImplementedError('export.get_status');
}
