/**
 * Contrato mínimo de almacenamiento. Cada "tabla" es una lista de objetos planos
 * cuyos valores son string | number | boolean | null.
 *
 * Implementaciones:
 *  - sheets.ts : Google Sheets API (producción, Vercel)
 *  - file.ts   : archivo JSON local (desarrollo) / memoria (tests)
 */
export type Cell = string | number | boolean | null;
export type RawRow = Record<string, Cell>;

export interface Driver {
  /** Crea las tabs/headers que falten. Idempotente. */
  ensureSchema(): Promise<void>;
  /** Devuelve todas las filas de la tabla (sin el header). */
  readAll(table: string): Promise<RawRow[]>;
  /** Agrega filas al final. */
  append(table: string, rows: RawRow[]): Promise<void>;
  /** Reemplaza la fila cuyo `keyField` === `key`. Devuelve false si no existe. */
  update(table: string, keyField: string, key: string, row: RawRow): Promise<boolean>;
  /** Elimina la fila cuyo `keyField` === `key`. Devuelve false si no existe. */
  remove(table: string, keyField: string, key: string): Promise<boolean>;
  /** Reemplaza el contenido completo de la tabla (usado para operaciones masivas). */
  replaceAll(table: string, rows: RawRow[]): Promise<void>;
}
