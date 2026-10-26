/**
 * 根组件：路由（工程列表 ↔ 编辑器工作区）、全局快捷键、全局对话框宿主。
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from './i18n/index.js';
import { useProjectStore } from './state/projectStore.js';
import { usePlaybackStore } from './state/playbackStore.js';
import { useUiStore } from './state/uiStore.js';
import { installStoreMiddleware } from './state/storeMiddleware.js';
import { useHistoryStore } from './state/historyStore.js';
import {
  copySelectedClips,
  deleteSelectedClips,
  pasteClips,
  redo,
  splitSelectedClip,
  undo,
} from './state/actions.js';
import { loadProject, saveProject } from './services/storage/projectRepo.js';
import { useHotkeys, type HotkeyHandlers } from './hooks/useHotkeys.js';
import { useFileDrop } from './hooks/useFileDrop.js';
import { AppLayout } from './components/layout/AppLayout.js';
import { TopToolbar } from './components/layout/TopToolbar.js';
import { StatusBar } from './components/layout/StatusBar.js';
import { MediaPanel } from './components/media/MediaPanel.js';
import { PreviewPanel } from './components/preview/PreviewPanel.js';
import { InspectorPanel } from './components/inspector/InspectorPanel.js';
import { TimelinePanel } from './components/timeline/TimelinePanel.js';
import { ProjectList } from './components/project/ProjectList.js';
import { NewProjectDialog } from './components/project/NewProjectDialog.js';
import { ImportProjectDialog } from './components/project/ImportProjectDialog.js';
import { RelinkDialog } from './components/project/RelinkDialog.js';
import { SettingsDialog } from './components/settings/SettingsDialog.js';
import { FileDropOverlay, ToastHost } from './components/common/index.js';
import { importFiles } from './services/media/assetService.js';
import { toast } from './components/common/Toast.js';

/**
 * 应用根组件。
 */
export function App(): JSX.Element {
  const { t } = useTranslation();
  const [view, setView] = useState<'projects' | 'editor'>('projects');
  const [showNewProject, setShowNewProject] = useState(false);
  const [showImportProject, setShowImportProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [relinkAssetId, setRelinkAssetId] = useState<string | null>(null);

  const doc = useProjectStore((state) => state.doc);
  const durationMs = useProjectStore((state) => state.doc.meta.durationMs);
  const setSelectedClipIds = useUiStore((state) => state.setSelectedClipIds);

  // 安装自动保存中间件
  useEffect(() => {
    const middleware = installStoreMiddleware({
      onError: (error) => {
        toast(
          t('common.toast.failed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
          'error',
        );
      },
    });
    return () => middleware.dispose();
  }, [t]);

  // 打开工程
  const openProject = useCallback(
    (projectId: string): void => {
      void loadProject(projectId).then((loaded) => {
        if (!loaded) {
          toast(t('common.error'), 'error');
          return;
        }
        useProjectStore.getState().setDoc(loaded, { markDirty: false });
        useHistoryStore.getState().reset();
        setView('editor');
      });
    },
    [t],
  );

  // 快捷键
  useHotkeys(
    useCallback(
      (): HotkeyHandlers => ({
        onTogglePlay: () => usePlaybackStore.getState().togglePlay(),
        onStepFrame: (direction) => usePlaybackStore.getState().stepFrame(direction),
        onSplit: () => {
          splitSelectedClip();
        },
        onDelete: () => {
          deleteSelectedClips();
        },
        onUndo: () => {
          undo();
        },
        onRedo: () => {
          redo();
        },
        onCopy: () => {
          copySelectedClips();
        },
        onPaste: () => {
          pasteClips();
        },
        onSelectAll: () => {
          const all = useProjectStore
            .getState()
            .doc.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
          setSelectedClipIds(all);
        },
        onSeekStart: () => usePlaybackStore.getState().seekToStart(durationMs),
        onSeekEnd: () => usePlaybackStore.getState().seekToEnd(durationMs),
      }),
      [durationMs, setSelectedClipIds],
    ),
  );

  // 全局拖拽导入
  const { isDragging } = useFileDrop({
    onFiles: (files) => {
      void importFiles(files).then((result) => {
        toast(t('media.imported', { imported: result.imported, failed: result.failed }), 'success');
      });
    },
  });

  if (view === 'projects') {
    return (
      <>
        <ProjectList
          onOpen={openProject}
          onCreate={() => setShowNewProject(true)}
          onImport={() => setShowImportProject(true)}
        />
        <NewProjectDialog
          open={showNewProject}
          onOpenChange={setShowNewProject}
          onCreated={(projectId) => {
            setView('editor');
            void projectId;
          }}
        />
        <ImportProjectDialog
          open={showImportProject}
          onOpenChange={setShowImportProject}
          onImported={() => setView('editor')}
        />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <AppLayout
        toolbar={
          <TopToolbar
            onOpenSettings={() => setShowSettings(true)}
            onOpenProjects={() => {
              void saveProject(doc);
              setView('projects');
            }}
          />
        }
        media={<MediaPanel />}
        preview={<PreviewPanel />}
        inspector={<InspectorPanel onRelink={setRelinkAssetId} />}
        timeline={<TimelinePanel />}
        statusBar={<StatusBar />}
      />

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <RelinkDialog
        open={relinkAssetId !== null}
        onOpenChange={(open) => {
          if (!open) setRelinkAssetId(null);
        }}
        assetId={relinkAssetId}
      />
      <FileDropOverlay visible={isDragging} hint={t('media.dropHint')} />
      <ToastHost />
    </>
  );
}

