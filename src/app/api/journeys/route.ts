import { authenticated } from '@/server/http';
import { journeyDraftSchema } from '@/domain/validation';
import { createJourney } from '@/server/journeys/service';
import { z } from 'zod';
import { AppError } from '@/server/errors';
export async function POST(request: Request) {
  return authenticated(request, journeyDraftSchema, (userId, draft) => {
    const key = z.uuid().safeParse(request.headers.get('idempotency-key'));
    if (!key.success)
      throw new AppError(422, 'INVALID_OPERATION_ID', 'Reload the form and try saving again.');
    return createJourney(userId, draft, key.data);
  });
}
