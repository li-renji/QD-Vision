/**
 * 工程列表页：卡片网格，按 `updatedAt` 倒序。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import {
  deleteProject,
  listProjects,
  type ProjectListItem,
} from '../../services/storage/projectRepo.js';
import { ProjectCard } from './ProjectCard.js';
import { EmptyState } from '../common/EmptyState.js';
import { Icon } from '../common/Icon.js';
import { Button } from '../common/Button.js';
import { ConfirmDialog } from '../common/ConfirmDialog.js';
import { toast } from '../common/Toast.js';

/** ProjectList 属性。 */
export interface ProjectListProps {
  /** 打开工程。 */
  onOpen: (projectId: string) => void;
  /** 新建工程。 */
  onCreate: () => void;
  /** 导入工程文件。 */
  onImport: () => void;
}

/**
 * 工程列表。
 */
export function ProjectList({ onOpen, onCreate, onImport }: ProjectListProps): JSX.Element {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ProjectListItem | null>(null);
  const [keyword, setKeyword] = useState('');

  const refresh = (): void => {
    void listProjects().then(setProjects);
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(query));
  }, [projects, keyword]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--cc-bg-app)] p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-lg font-semibold text-[var(--cc-fg-primary)]">
            {t('project.list.title')}
          </h1>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('project.list.search')}
            className="cc-input ml-auto w-56"
          />
          <Button variant="ghost" onClick={onImport}>
            {t('project.list.import')}
          </Button>
          <Button variant="primary" onClick={onCreate}>
            ＋ {t('project.list.create')}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title={t('project.list.empty')} icon={<Icon name="film" size={30} />} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {filtered.map((project) => (
              <ProjectCard
                key={project.projectId}
                project={project}
                onOpen={onOpen}
                onDelete={(projectId) =>
                  setPendingDelete(projects.find((item) => item.projectId === projectId) ?? null)
                }
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('project.list.delete')}
        description={
          pendingDelete
            ? t('project.list.deleteConfirm', { name: pendingDelete.name })
            : undefined
        }
        danger
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteProject(pendingDelete.projectId)
            .then(() => {
              toast(t('common.toast.saved'), 'success');
              refresh();
            })
            .catch((error: unknown) => {
              toast(
                t('common.toast.failed', {
                  reason: error instanceof Error ? error.message : String(error),
                }),
                'error',
              );
            });
        }}
      />
    </div>
  );
}
