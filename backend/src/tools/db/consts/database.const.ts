import { join } from 'node:path';

export const DATABASE = Symbol('DATABASE');
export const MIGRATIONS_FOLDER = join(__dirname, '..', 'migrations');
