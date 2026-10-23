/**
 * MCP 工具集定义（FR-053）：15 个工具的入参/出参 TS 类型 + JSON Schema。
 *
 * 同一份定义同时服务：
 * - `packages/mcp-server`（注册为 MCP 工具，JSON Schema 直接可用）
 * - `packages/app/src/domain`（校验工具入参）
 */

/** 最小可用的 JSON Schema 类型（draft 2020-12 子集）。 */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly (string | number | boolean | null)[];
  additionalProperties?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

// ============ project.* ============

export interface ProjectGetInfoArgs {
  [key: string]: unknown;
}

export interface ProjectInfoResult {
  name: string;
  schemaVersion: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  trackCount: number;
  assetCount: number;
}

export interface ProjectListAssetsArgs {
  /** 按类型筛选 */
  type?: 'video' | 'audio' | 'image';
  /** 按名称关键字筛选 */
  keyword?: string;
}

export interface AssetSummary {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  durationMs: number;
  width: number | null;
  height: number | null;
  playable: boolean;
}

export interface ProjectListAssetsResult {
  assets: AssetSummary[];
}

// ============ timeline.* ============

export interface TimelineGetStateArgs {
  [key: string]: unknown;
}

export interface ClipSnapshot {
  id: string;
  assetId: string | null;
  startMs: number;
  durationMs: number;
  inMs: number;
  outMs: number;
  speed: number;
  isOverlay: boolean;
  zIndex: number;
  trackId: string;
}

export interface TrackSnapshot {
  id: string;
  type: 'video' | 'audio' | 'text';
  name: string;
  order: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  clips: ClipSnapshot[];
}

export interface TimelineGetStateResult {
  tracks: TrackSnapshot[];
}

export interface TimelineAddTrackArgs {
  type: 'video' | 'audio' | 'text';
  name: string;
  /** 插入位置，省略时追加到末尾 */
  index?: number;
}

export interface TimelineAddTrackResult {
  trackId: string;
}

export interface TimelineRemoveTrackArgs {
  trackId: string;
}

export interface TimelineRemoveTrackResult {
  [key: string]: unknown;
}

export interface TimelineAddClipArgs {
  assetId: string;
  trackId: string;
  startMs: number;
  inMs: number;
  outMs: number;
  speed?: number;
}

export interface TimelineAddClipResult {
  clipId: string;
}

export interface TimelineSplitClipArgs {
  clipId: string;
  atMs: number;
}

export interface TimelineSplitClipResult {
  leftClipId: string;
  rightClipId: string;
}

export interface TimelineTrimClipArgs {
  clipId: string;
  newInMs?: number;
  newOutMs?: number;
}

export interface TimelineTrimClipResult {
  clip: ClipSnapshot;
}

export interface TimelineMoveClipArgs {
  clipId: string;
  trackId?: string;
  startMs: number;
}

export interface TimelineMoveClipResult {
  clip: ClipSnapshot;
}

export interface TimelineDeleteClipArgs {
  clipId: string;
}

export interface TimelineDeleteClipResult {
  [key: string]: unknown;
}

export interface TimelineSetClipPropertyArgs {
  clipId: string;
  /** 点分路径，如 `audio.gain` / `transform.scale` / `text.fontSize` */
  path: string;
  value: unknown;
}

export interface TimelineSetClipPropertyResult {
  clip: ClipSnapshot;
}

// ============ text.* ============

export interface TextCreateOverlayArgs {
  trackId: string;
  startMs: number;
  durationMs: number;
  content: string;
}

export interface TextCreateOverlayResult {
  clipId: string;
}

// ============ subtitle.* ============

export interface SubtitleImportSrtArgs {
  content: string;
}

export interface SubtitleImportSrtResult {
  cueCount: number;
  errorCount: number;
}

// ============ export.* ============

export interface ExportStartArgs {
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
}

export interface ExportStartResult {
  jobId: string;
}

export interface ExportGetStatusArgs {
  jobId: string;
}

export type ExportJobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ExportGetStatusResult {
  status: ExportJobStatus;
  /** 0~1 */
  progress: number;
  currentTimeMs: number;
  estimatedRemainingMs: number;
  artifactUrl?: string;
}

// ============ 工具清单 ============

/** 工具名联合类型。 */
export type McpToolName =
  | 'project.get_info'
  | 'project.list_assets'
  | 'timeline.get_state'
  | 'timeline.add_track'
  | 'timeline.remove_track'
  | 'timeline.add_clip'
  | 'timeline.split_clip'
  | 'timeline.trim_clip'
  | 'timeline.move_clip'
  | 'timeline.delete_clip'
  | 'timeline.set_clip_property'
  | 'text.create_overlay'
  | 'subtitle.import_srt'
  | 'export.start'
  | 'export.get_status';

/** 工具定义（供 MCP Server 直接注册）。 */
export interface McpToolDefinition<A, R> {
  name: McpToolName;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /** 仅用于类型推导 */
  __args?: A;
  __result?: R;
}

const EMPTY_OBJECT_SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: true };

const TRACK_TYPE_ENUM = ['video', 'audio', 'text'] as const;

/** 15 个工具的完整定义。 */
export const MCP_TOOL_DEFINITIONS = {
  'project.get_info': {
    name: 'project.get_info',
    title: '读取工程信息',
    description: '返回当前工程的名称、版本、画布参数、总时长与轨道/素材数量。',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        schemaVersion: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        fps: { type: 'number' },
        durationMs: { type: 'number' },
        trackCount: { type: 'number' },
        assetCount: { type: 'number' },
      },
      required: [
        'name',
        'schemaVersion',
        'width',
        'height',
        'fps',
        'durationMs',
        'trackCount',
        'assetCount',
      ],
    },
  },
  'project.list_assets': {
    name: 'project.list_assets',
    title: '列出素材',
    description: '列出工程中的素材摘要，可按类型与关键字筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['video', 'audio', 'image'] },
        keyword: { type: 'string' },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        assets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', enum: ['video', 'audio', 'image'] },
              durationMs: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              playable: { type: 'boolean' },
            },
            required: ['id', 'name', 'type', 'durationMs', 'playable'],
          },
        },
      },
      required: ['assets'],
    },
  },
  'timeline.get_state': {
    name: 'timeline.get_state',
    title: '读取时间线',
    description: '返回全部轨道与 clip 的快照。',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    outputSchema: {
      type: 'object',
      properties: {
        tracks: { type: 'array', items: { type: 'object' } },
      },
      required: ['tracks'],
    },
  },
  'timeline.add_track': {
    name: 'timeline.add_track',
    title: '新增轨道',
    description: '新增一条视频/音频/文字轨道。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: TRACK_TYPE_ENUM },
        name: { type: 'string' },
        index: { type: 'number', minimum: 0 },
      },
      required: ['type', 'name'],
    },
    outputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string' } },
      required: ['trackId'],
    },
  },
  'timeline.remove_track': {
    name: 'timeline.remove_track',
    title: '删除轨道',
    description: '按轨道 id 删除轨道（及其上的 clip）。',
    inputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string' } },
      required: ['trackId'],
    },
    outputSchema: EMPTY_OBJECT_SCHEMA,
  },
  'timeline.add_clip': {
    name: 'timeline.add_clip',
    title: '添加 clip',
    description: '在指定轨道与时间点插入一个素材 clip。',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        trackId: { type: 'string' },
        startMs: { type: 'number', minimum: 0 },
        inMs: { type: 'number', minimum: 0 },
        outMs: { type: 'number', minimum: 0 },
        speed: { type: 'number', minimum: 0.1, maximum: 10 },
      },
      required: ['assetId', 'trackId', 'startMs', 'inMs', 'outMs'],
    },
    outputSchema: {
      type: 'object',
      properties: { clipId: { type: 'string' } },
      required: ['clipId'],
    },
  },
  'timeline.split_clip': {
    name: 'timeline.split_clip',
    title: '分割 clip',
    description: '在指定时间点把 clip 切成两段。',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        atMs: { type: 'number', minimum: 0 },
      },
      required: ['clipId', 'atMs'],
    },
    outputSchema: {
      type: 'object',
      properties: { leftClipId: { type: 'string' }, rightClipId: { type: 'string' } },
      required: ['leftClipId', 'rightClipId'],
    },
  },
  'timeline.trim_clip': {
    name: 'timeline.trim_clip',
    title: '裁剪 clip',
    description: '修改 clip 的源入点或出点。',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        newInMs: { type: 'number', minimum: 0 },
        newOutMs: { type: 'number', minimum: 0 },
      },
      required: ['clipId'],
    },
    outputSchema: {
      type: 'object',
      properties: { clip: { type: 'object' } },
      required: ['clip'],
    },
  },
  'timeline.move_clip': {
    name: 'timeline.move_clip',
    title: '移动 clip',
    description: '移动 clip 的时间线位置，可选跨轨道移动。',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        trackId: { type: 'string' },
        startMs: { type: 'number', minimum: 0 },
      },
      required: ['clipId', 'startMs'],
    },
    outputSchema: {
      type: 'object',
      properties: { clip: { type: 'object' } },
      required: ['clip'],
    },
  },
  'timeline.delete_clip': {
    name: 'timeline.delete_clip',
    title: '删除 clip',
    description: '按 clip id 删除 clip。',
    inputSchema: {
      type: 'object',
      properties: { clipId: { type: 'string' } },
      required: ['clipId'],
    },
    outputSchema: EMPTY_OBJECT_SCHEMA,
  },
  'timeline.set_clip_property': {
    name: 'timeline.set_clip_property',
    title: '设置 clip 属性',
    description: '按点分路径设置 clip 属性，如 `audio.gain`、`transform.scale`。',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string' },
        path: { type: 'string' },
        value: {},
      },
      required: ['clipId', 'path', 'value'],
    },
    outputSchema: {
      type: 'object',
      properties: { clip: { type: 'object' } },
      required: ['clip'],
    },
  },
  'text.create_overlay': {
    name: 'text.create_overlay',
    title: '新建文字',
    description: '在文字轨道上创建一个文字片段。',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        startMs: { type: 'number', minimum: 0 },
        durationMs: { type: 'number', minimum: 0 },
        content: { type: 'string' },
      },
      required: ['trackId', 'startMs', 'durationMs', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: { clipId: { type: 'string' } },
      required: ['clipId'],
    },
  },
  'subtitle.import_srt': {
    name: 'subtitle.import_srt',
    title: '导入 SRT 字幕',
    description: '解析 SRT 文本并导入为字幕条目。',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
    outputSchema: {
      type: 'object',
      properties: { cueCount: { type: 'number' }, errorCount: { type: 'number' } },
      required: ['cueCount', 'errorCount'],
    },
  },
  'export.start': {
    name: 'export.start',
    title: '启动导出',
    description: '启动一次导出任务并返回 jobId。',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['mp4', 'webm'] },
        width: { type: 'number', minimum: 1 },
        height: { type: 'number', minimum: 1 },
        fps: { type: 'number', minimum: 1 },
      },
      required: ['format', 'width', 'height', 'fps'],
    },
    outputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  'export.get_status': {
    name: 'export.get_status',
    title: '查询导出状态',
    description: '查询指定导出任务的进度与状态。',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['idle', 'running', 'done', 'failed', 'cancelled'],
        },
        progress: { type: 'number' },
        currentTimeMs: { type: 'number' },
        estimatedRemainingMs: { type: 'number' },
        artifactUrl: { type: 'string' },
      },
      required: ['status', 'progress', 'currentTimeMs', 'estimatedRemainingMs'],
    },
  },
} as const satisfies Record<string, McpToolDefinition<unknown, unknown>>;

/** 工具名列表。 */
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_DEFINITIONS) as McpToolName[];

/** 工具数量（V1.0 固定 15 个）。 */
export const MCP_TOOL_COUNT = MCP_TOOL_NAMES.length;
