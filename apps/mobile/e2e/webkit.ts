import { existsSync } from 'node:fs';
import { webkit } from '@playwright/test';

/** WebKit only runs where its browser is installed; nothing is downloaded here. Specs skip it, visibly, when it is missing. */
export const hasWebkit = existsSync(webkit.executablePath());
