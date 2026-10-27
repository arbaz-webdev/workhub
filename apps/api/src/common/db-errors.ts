/** A Postgres unique-constraint violation (23505), raw or wrapped by Drizzle. */
export function isUniqueViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  return (err as { code?: string })?.code === '23505' || cause?.code === '23505';
}
