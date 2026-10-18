import type { JSX } from 'react';
import { PROJECT_COLORS, type Project } from '@ledge/protocol';

/** A project's colour swatch (`.side-swatch`), or the dashed one of « Sans projet » (`.filter-none`) for null. */
export function ProjectSwatch({ project }: { project: Pick<Project, 'color'> | null }): JSX.Element {
  return project ? <i className="side-swatch" style={{ background: PROJECT_COLORS[project.color] }} /> : <i className="filter-none" />;
}
