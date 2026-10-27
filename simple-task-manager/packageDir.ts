import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The package root, whether this runs from source (tsx) or compiled `dist/`. Hints are built from
 *  it because a clone can live anywhere. */
export const PACKAGE_DIR: string = basename(here) === 'dist' ? dirname(here) : here;
