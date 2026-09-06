import { authenticated } from '@/server/http';
import { journeyDraftSchema } from '@/domain/validation';
import { createJourney } from '@/server/journeys/service';
import { z } from 'zod';
export async function POST(request: Request) {
  return authenticated(request, journeyDraftSchema, (userId, draft) =>
    createJourney(userId, draft, z.uuid().parse(request.headers.get('idempotency-key'))),
  );
}
