/**
 * 新建工程对话框（名称、画布预设、帧率）。
 */

import { useState } from 'react';
import { useTranslation } from '../../i18n/index.js';
import { createEmptyProject } from '../../domain/project/factory.js';
import { projectId as newProjectId } from '../../utils/id.js';
import { saveProject } from '../../services/storage/projectRepo.js';
import { useProjectStore } from '../../state/projectStore.js';
import { Dialog } from '../common/Dialog.js';
import { Button } from '../common/Button.js';
import { TextField } from '../common/TextField.js';
import { Select } from '../common/Select.js';
import { NumberField } from '../common/NumberField.js';
import type { AspectPreset } from '@clipcut/shared-types';

/** 画布预设。 */
const CANVAS_PRESETS: { value: AspectPreset; width: number; height: number }[] = [
  { value: '16:9', width: 1920, height: 1080 },
  { value: '9:16', width: 1080, height: 1920 },
  { value: '1:1', width: 1080, height: 1080 },
  { value: '4:5', width: 1080, height: 1350 },
];

/** NewProjectDialog 属性。 */
export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 创建完成。 */
  onCreated: (projectId: string) => void;
}

/**
 * 新建工程对话框。
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: NewProjectDialogProps): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<AspectPreset>('16:9');
  // fps 下限与 Schema（minimum 10）保持一致，否则新建的工程 reload 时会被校验拒绝
  const [fps, setFps] = useState(30);

  const create = (): void => {
    const preset = CANVAS_PRESETS.find((item) => item.value === aspect) ?? CANVAS_PRESETS[0];
    const doc = createEmptyProject(name.trim() || t('project.new.namePlaceholder'));
    doc.projectId = newProjectId();
    doc.settings.canvas = {
      ...doc.settings.canvas,
      width: preset?.width ?? 1920,
      height: preset?.height ?? 1080,
      aspectPreset: aspect,
      fps,
    };
    doc.settings.export = {
      ...doc.settings.export,
      width: preset?.width ?? 1920,
      height: preset?.height ?? 1080,
      fps,
    };

    void saveProject(doc)
      .then(() => {
        useProjectStore.getState().setDoc(doc, { markDirty: false });
        onCreated(doc.projectId);
        onOpenChange(false);
        setName('');
      })
      .catch(() => {
        onOpenChange(false);
      });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.new.title')}
      className="w-[min(420px,92vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('project.new.cancel')}
          </Button>
          <Button variant="primary" onClick={create}>
            {t('project.new.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label={t('project.new.name')}
          value={name}
          placeholder={t('project.new.namePlaceholder')}
          onValueChange={setName}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <span className="cc-label w-20">{t('project.new.canvas')}</span>
          <Select
            value={aspect}
            onValueChange={(value) => setAspect(value as AspectPreset)}
            options={CANVAS_PRESETS.map((item) => ({ value: item.value, label: item.value }))}
            ariaLabel={t('project.new.canvas')}
          />
        </div>
        <div className="flex items-center gap-2">
          <NumberField
            label={t('project.new.fps')}
            value={fps}
            min={10}
            max={240}
            step={1}
            onValueChange={setFps}
          />
        </div>
      </div>
    </Dialog>
  );
}
