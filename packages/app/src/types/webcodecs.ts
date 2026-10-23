/**
 * WebCodecs 相关能力的**最小结构化类型**。
 *
 * 说明：TypeScript 的 `lib.dom.d.ts` 对 WebCodecs 的覆盖随版本波动，
 * 为了让本项目在任意 TS 版本下都能稳定编译，这里不声明同名全局类型，
 * 而是通过 `globalThis` 的结构化断言来安全地探测与使用。
 */

/** `VideoEncoder.configure()` 的配置形状。 */
export interface VideoEncoderConfigLike {
  codec: string;
  width: number;
  height: number;
  bitrate?: number;
  framerate?: number;
  latencyMode?: 'realtime' | 'quality';
  avc?: { format?: 'annexb' | 'avc' };
}

/** `VideoEncoder.isConfigSupported()` 的返回值。 */
export interface VideoEncoderSupportLike {
  supported: boolean;
  config?: VideoEncoderConfigLike;
}

/** `VideoEncoder` 的最小结构。 */
export interface VideoEncoderLike {
  configure(config: VideoEncoderConfigLike): void;
  encode(frame: unknown, options?: { keyFrame?: boolean; duration?: number }): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
}

/** `VideoEncoder` 构造器。 */
export interface VideoEncoderCtorLike {
  new (init: { output: (chunk: unknown, metadata?: unknown) => void; error?: (e: unknown) => void }): VideoEncoderLike;
  isConfigSupported(config: VideoEncoderConfigLike): Promise<VideoEncoderSupportLike>;
}

/** `AudioEncoder` 的最小结构。 */
export interface AudioEncoderLike {
  configure(config: { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number }): void;
  encode(data: unknown): void;
  flush(): Promise<void>;
  close(): void;
  readonly encodeQueueSize: number;
}

/** `AudioEncoder` 构造器。 */
export interface AudioEncoderCtorLike {
  new (init: { output: (chunk: unknown, metadata?: unknown) => void; error?: (e: unknown) => void }): AudioEncoderLike;
  isConfigSupported(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    bitrate?: number;
  }): Promise<{ supported: boolean }>;
}

/** `VideoDecoder` 的最小结构。 */
export interface VideoDecoderLike {
  configure(config: { codec: string; codedWidth?: number; codedHeight?: number; optimizeForLatency?: boolean }): void;
  decode(chunk: unknown): void;
  flush(): Promise<void>;
  close(): void;
  readonly decodeQueueSize: number;
}

/** `VideoDecoder` 构造器。 */
export interface VideoDecoderCtorLike {
  new (init: { output: (frame: unknown) => void; error?: (e: unknown) => void }): VideoDecoderLike;
  isConfigSupported(config: { codec: string; codedWidth?: number; codedHeight?: number }): Promise<{ supported: boolean }>;
}

/** 全局对象上可能存在的 WebCodecs 构造器集合。 */
interface WebCodecsGlobals {
  VideoEncoder?: VideoEncoderCtorLike;
  AudioEncoder?: AudioEncoderCtorLike;
  VideoDecoder?: VideoDecoderCtorLike;
}

function codecsGlobals(): WebCodecsGlobals {
  return globalThis as unknown as WebCodecsGlobals;
}

/** 取得 `VideoEncoder` 构造器（不可用时返回 undefined）。 */
export function getVideoEncoderCtor(): VideoEncoderCtorLike | undefined {
  return codecsGlobals().VideoEncoder;
}

/** 取得 `AudioEncoder` 构造器（不可用时返回 undefined）。 */
export function getAudioEncoderCtor(): AudioEncoderCtorLike | undefined {
  return codecsGlobals().AudioEncoder;
}

/** 取得 `VideoDecoder` 构造器（不可用时返回 undefined）。 */
export function getVideoDecoderCtor(): VideoDecoderCtorLike | undefined {
  return codecsGlobals().VideoDecoder;
}
