// Every file location the project uses, in one place.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const RESUME_DIR = path.join(DATA, 'resume');
export const CAMPAIGNS_DIR = path.join(DATA, 'campaigns');
export const PROFILE_FILE = path.join(DATA, 'profile.json');
export const HISTORY_FILE = path.join(DATA, 'history.json');
export const STYLE_FILE = path.join(DATA, 'style-examples.md');
export const GOOGLE_CREDENTIALS_FILE = path.join(DATA, 'google-credentials.json');
export const GOOGLE_TOKEN_FILE = path.join(DATA, 'google-token.json');
