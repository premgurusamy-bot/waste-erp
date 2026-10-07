export type SP = Record<string, string | string[] | undefined>;

export function str(sp: SP, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

export function listParams(sp: SP, pageSize = 25) {
  const page = Math.max(1, Number(str(sp, "page") ?? 1) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, q: str(sp, "q"), status: str(sp, "status") };
}

export function flat(sp: SP): Record<string, string | undefined> {
  return Object.fromEntries(Object.keys(sp).map((k) => [k, str(sp, k)]));
}

export const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
