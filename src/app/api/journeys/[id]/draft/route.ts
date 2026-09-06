import { z } from 'zod';
import { journeyDraftSchema, mutationEnvelopeSchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { updateJourneyDraft } from '@/server/journeys/service';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(request, mutationEnvelopeSchema(journeyDraftSchema), async (userId, body) =>
    updateJourneyDraft(userId, z.uuid().parse((await context.params).id), body),
  );
}
