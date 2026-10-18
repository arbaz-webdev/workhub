import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/** Validates and normalises a request body with a shared zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return result.data;
  }
}
