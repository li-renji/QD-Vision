/**
 * `timeline.*` 共 8 个工具定义与空 handler。
 */

import {
  MCP_TOOL_DEFINITIONS,
  type JsonSchema,
  type TimelineAddClipArgs,
  type TimelineAddClipResult,
  type TimelineAddTrackArgs,
  type TimelineAddTrackResult,
  type TimelineDeleteClipArgs,
  type TimelineDeleteClipResult,
  type TimelineGetStateArgs,
  type TimelineGetStateResult,
  type TimelineMoveClipArgs,
  type TimelineMoveClipResult,
  type TimelineRemoveTrackArgs,
  type TimelineRemoveTrackResult,
  type TimelineSetClipPropertyArgs,
  type TimelineSetClipPropertyResult,
  type TimelineSplitClipArgs,
  type TimelineSplitClipResult,
  type TimelineTrimClipArgs,
  type TimelineTrimClipResult,
} from '@clipcut/shared-types';
import { NotImplementedError } from '../bridge/errors.js';
import type { ClipCutBridge } from '../bridge/clipcutBridge.js';

/** 工具定义。 */
export const timelineToolDefinitions = [
  MCP_TOOL_DEFINITIONS['timeline.get_state'],
  MCP_TOOL_DEFINITIONS['timeline.add_track'],
  MCP_TOOL_DEFINITIONS['timeline.remove_track'],
  MCP_TOOL_DEFINITIONS['timeline.add_clip'],
  MCP_TOOL_DEFINITIONS['timeline.split_clip'],
  MCP_TOOL_DEFINITIONS['timeline.trim_clip'],
  MCP_TOOL_DEFINITIONS['timeline.move_clip'],
  MCP_TOOL_DEFINITIONS['timeline.delete_clip'],
  MCP_TOOL_DEFINITIONS['timeline.set_clip_property'],
];

/** 工具入参 schema。 */
export const timelineToolSchemas: Record<string, JsonSchema> = {
  'timeline.get_state': MCP_TOOL_DEFINITIONS['timeline.get_state'].inputSchema,
  'timeline.add_track': MCP_TOOL_DEFINITIONS['timeline.add_track'].inputSchema,
  'timeline.remove_track': MCP_TOOL_DEFINITIONS['timeline.remove_track'].inputSchema,
  'timeline.add_clip': MCP_TOOL_DEFINITIONS['timeline.add_clip'].inputSchema,
  'timeline.split_clip': MCP_TOOL_DEFINITIONS['timeline.split_clip'].inputSchema,
  'timeline.trim_clip': MCP_TOOL_DEFINITIONS['timeline.trim_clip'].inputSchema,
  'timeline.move_clip': MCP_TOOL_DEFINITIONS['timeline.move_clip'].inputSchema,
  'timeline.delete_clip': MCP_TOOL_DEFINITIONS['timeline.delete_clip'].inputSchema,
  'timeline.set_clip_property': MCP_TOOL_DEFINITIONS['timeline.set_clip_property'].inputSchema,
};

/** 各工具的 handler（V1.0 全部为空实现）。 */
export const timelineToolHandlers: Record<
  string,
  (bridge: ClipCutBridge, args: never) => Promise<unknown>
> = {
  'timeline.get_state': async (_bridge, args: TimelineGetStateArgs): Promise<TimelineGetStateResult> => {
    void args;
    throw new NotImplementedError('timeline.get_state');
  },
  'timeline.add_track': async (
    _bridge,
    args: TimelineAddTrackArgs,
  ): Promise<TimelineAddTrackResult> => {
    void args;
    throw new NotImplementedError('timeline.add_track');
  },
  'timeline.remove_track': async (
    _bridge,
    args: TimelineRemoveTrackArgs,
  ): Promise<TimelineRemoveTrackResult> => {
    void args;
    throw new NotImplementedError('timeline.remove_track');
  },
  'timeline.add_clip': async (
    _bridge,
    args: TimelineAddClipArgs,
  ): Promise<TimelineAddClipResult> => {
    void args;
    throw new NotImplementedError('timeline.add_clip');
  },
  'timeline.split_clip': async (
    _bridge,
    args: TimelineSplitClipArgs,
  ): Promise<TimelineSplitClipResult> => {
    void args;
    throw new NotImplementedError('timeline.split_clip');
  },
  'timeline.trim_clip': async (
    _bridge,
    args: TimelineTrimClipArgs,
  ): Promise<TimelineTrimClipResult> => {
    void args;
    throw new NotImplementedError('timeline.trim_clip');
  },
  'timeline.move_clip': async (
    _bridge,
    args: TimelineMoveClipArgs,
  ): Promise<TimelineMoveClipResult> => {
    void args;
    throw new NotImplementedError('timeline.move_clip');
  },
  'timeline.delete_clip': async (
    _bridge,
    args: TimelineDeleteClipArgs,
  ): Promise<TimelineDeleteClipResult> => {
    void args;
    throw new NotImplementedError('timeline.delete_clip');
  },
  'timeline.set_clip_property': async (
    _bridge,
    args: TimelineSetClipPropertyArgs,
  ): Promise<TimelineSetClipPropertyResult> => {
    void args;
    throw new NotImplementedError('timeline.set_clip_property');
  },
};
