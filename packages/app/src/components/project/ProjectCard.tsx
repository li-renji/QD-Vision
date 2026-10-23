/**
 * 单个工程卡片 + 打开 / 删除（二次确认）。
 */

import type { ProjectListItem } from '../../services/storage/projectRepo.js';
import { formatDateTime } from '../../utils/format.js';
import { formatDuration } from '@clipcut/shared-types';
import { useTranslation } from '../../i18n/index.js';
import { Icon } from '../common/Icon.js';

/** ProjectCard 属性。 */
export interface ProjectCardProps {
  project: ProjectListItem;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

/**
 * 工程卡片。
 */
export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="cc-panel group relative flex flex-col gap-1 p-3 transition-colors hover:border-[var(--cc-accent)]">
      <button
        type="button"
        onClick={() => onOpen(project.projectId)}
        className="text-left text-sm font-medium text-[var(--cc-fg-primary)] hover:text-[var(--cc-accent)]"
      >
        {project.name}
      </button>

      <div className="text-[11px] text-[var(--cc-fg-muted)]">
        {t('project.list.updatedAt', { time: formatDateTime(project.updatedAt) })}
      </div>
      <div className="text-[11px] text-[var(--cc-fg-muted)]">
        {t('project.list.duration', { time: formatDuration(project.durationMs) })}
      </div>

      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
        <button
          type="button"
          aria-label={t('project.list.delete')}
          onClick={() => onDelete(project.projectId)}
          className="inline-flex h-5 w-5 items-center justify-center rounded bg-black/50 text-[var(--cc-danger)] transition-colors hover:bg-black/75"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
