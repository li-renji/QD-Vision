/**
 * 素材来源连接器（FR-012 ① 接口定义）。
 *
 * ## 定位
 *
 * 这是「开源 + 可插拔」定位的**对外承诺**：任何人都可以实现一个连接器，
 * 把外部素材源（Pixabay、Unsplash、本地文件夹、自建图库……）接入 QD视界。
 *
 * ## 为什么此刻只有接口、没有实现
 *
 * PM 明确判定：现在**不实现** `LocalFolderConnector` 等具体类。
 * 理由是用一个假实现去验证尚无真实用例的抽象，会把接口设计**锁死在想象中的需求上**。
 * 真正接口应在**首个真实实现**（FR-011 Pixabay 接入）出现时反推确定。
 *
 * 因此本文件只定义**最小可用契约**（约 15 行），不预设任何具体来源的字段。
 */

/** 连接器提供的素材条目。 */
export interface MaterialSourceItem {
  /** 来源侧的唯一 id（用于翻页 / 详情查询） */
  id: string;
  /** 展示名 */
  name: string;
  /** 素材类型 */
  type: 'video' | 'audio' | 'image';
  /** 缩略图 URL（可选） */
  thumbnailUrl?: string | null;
  /** 授权信息（可选） */
  license?: {
    name: string;
    url?: string | null;
    author?: string | null;
  } | null;
}

/** 分页查询参数。 */
export interface MaterialSourceQuery {
  /** 搜索关键词 */
  keyword?: string;
  /** 起始偏移 */
  offset?: number;
  /** 返回条数 */
  limit?: number;
  /** 类型过滤 */
  type?: 'video' | 'audio' | 'image';
}

/** 分页结果。 */
export interface MaterialSourcePage {
  items: MaterialSourceItem[];
  /** 是否还有更多 */
  hasMore: boolean;
  /** 下一页的偏移量 */
  nextOffset?: number | null;
}

/**
 * 素材来源连接器。
 *
 * 实现方负责：搜索、鉴权（用自己的 API Key）、下载素材字节并交给上层落盘。
 * **连接器只返回元数据与字节，不直接写 IndexedDB** —— 落盘由 `assetService` 统一负责，
 * 保证「素材字节只走 Blob → IndexedDB」的零上传约束。
 */
export interface MaterialSourceConnector {
  /** 稳定唯一 id */
  readonly id: string;
  /** 展示名 */
  readonly name: string;
  /** 是否需要 API Key */
  readonly requiresApiKey: boolean;
  /** 是否已配置完成（缺少 API Key 时为 false） */
  isConfigured(): boolean;
  /** 搜索素材。 */
  search(query: MaterialSourceQuery): Promise<MaterialSourcePage>;
  /** 按 id 下载素材字节。 */
  fetchMaterial(id: string): Promise<Blob>;
  /** 释放资源。 */
  dispose?(): void | Promise<void>;
}
