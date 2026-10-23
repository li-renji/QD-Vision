/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIXABAY_API_KEY?: string;
  readonly VITE_FREESOUND_API_KEY?: string;
  readonly VITE_MCP_WS_URL?: string;
  readonly VITE_MCP_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
