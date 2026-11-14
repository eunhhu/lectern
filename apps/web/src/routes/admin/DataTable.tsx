// A sortable table for the admin console (P5-12): a real <table> with a <caption>,
// column headers with scope, and sortable headers as buttons that carry `aria-sort` on
// their <th>. Enter and Space sort (they are buttons): first ascending, then descending.
// Number columns align right in tabular figures.

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../ui/Icon.tsx";
import s from "./admin.module.css";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Present on sortable columns. Null sorts last either way. */
  sortValue?: (row: T) => string | number | null;
  align?: "left" | "right";
}

export type SortDir = "asc" | "desc";

/** Rows ordered by `col`; nulls last in both directions, equal values keep their order. */
export function sortRows<T>(rows: readonly T[], col: Column<T>, dir: SortDir): T[] {
  const value = col.sortValue;
  if (!value) return [...rows];
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), "ko");
      return c !== 0 ? sign * c : a.index - b.index;
    })
    .map((x) => x.row);
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  /** A mouse shortcut only: the row must also hold a link or button that does the same. */
  onRowClick?: (row: T) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return col && sort ? sortRows(rows, col, sort.dir) : rows;
  }, [rows, columns, sort]);

  const toggle = (key: string) => setSort((cur) => (cur?.key !== key ? { key, dir: "asc" } : { key, dir: cur.dir === "asc" ? "desc" : "asc" }));

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <caption className={s.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const dir = sort?.key === col.key ? sort.dir : null;
              const ariaSort = !col.sortValue ? undefined : dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
              return (
                <th key={col.key} scope="col" aria-sort={ariaSort} data-align={col.align ?? "left"}>
                  {col.sortValue ? (
                    <button type="button" className={s.sortButton} onClick={() => toggle(col.key)}>
                      {col.header}
                      <span className={s.sortIcon} data-active={dir ? "" : undefined}>
                        <Icon name={dir === "desc" ? "chevronDown" : "chevronUp"} size={12} />
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={s.empty}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                data-clickable={onRowClick ? "" : undefined}
                onClick={
                  onRowClick
                    ? (e) => {
                        // Let the row's own controls do their job.
                        if ((e.target as HTMLElement).closest("a, button, input, [role=button]")) return;
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} data-align={col.align ?? "left"}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
