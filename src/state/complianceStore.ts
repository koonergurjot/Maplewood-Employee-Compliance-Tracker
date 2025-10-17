import type { RequirementKey } from "@/config/requirements";

export type Emp = { id: string; initials: string; name: string; meta?: string };
export type CellStatus = 'pending' | 'ok' | 'expired';
export type Matrix = Record<string, Record<RequirementKey, CellStatus>>;

// TODO: Replace with your real imported employees
export const employeesSeed: Emp[] = [
  { id: 'EA', initials: 'EA', name: 'Edrin Abiona', meta: 'CA • Active' },
  { id: 'VA', initials: 'VA', name: 'Vipan K Ahuja', meta: 'CA • Active' },
  { id: 'PA', initials: 'PA', name: 'Priyaveer Atwal', meta: 'CA • Active' },
  { id: 'AB', initials: 'AB', name: 'Aman S Badhan', meta: 'CA • Active' },
];

export function newMatrix(emps: Emp[], reqs: RequirementKey[]): Matrix {
  const m: Matrix = {};
  for (const e of emps) {
    m[e.id] = {};
    for (const r of reqs) m[e.id][r] = 'pending';
  }
  return m;
}
