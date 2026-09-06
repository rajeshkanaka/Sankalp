import { z } from 'zod';
import { journeyMetadataSchema, mutationEnvelopeSchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { updateJourneyMetadata } from '@/server/journeys/metadata';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(journeyMetadataSchema),
    async (userId, body) =>
      updateJourneyMetadata(userId, z.uuid().parse((await context.params).id), body),
  );
}
