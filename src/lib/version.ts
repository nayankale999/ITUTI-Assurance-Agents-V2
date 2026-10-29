/* The app version: the VERSION file shipped in on-premises bundles (beside server.js), else package.json. */
import fs from 'fs';
import path from 'path';
import pkg from '../../package.json';

function bundled() {
  try { return fs.readFileSync(path.join(process.cwd(), 'VERSION'), 'utf8').trim() || null; } catch { return null; }
}
export const APP_VERSION = process.env.APP_VERSION || bundled() || pkg.version;
export const DEPLOYMENT = process.env.ITUTI_DEPLOYMENT === 'onprem' ? 'On-premises' : 'Cloud';
