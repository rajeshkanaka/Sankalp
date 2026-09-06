import { z } from 'zod';
import { authenticated } from '@/server/http';
import { mutationEnvelopeSchema } from '@/domain/validation';
import { activateJourney } from '@/server/journeys/service';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(z.strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })),
    async (userId, body) =>
      activateJourney(userId, z.uuid().parse((await context.params).id), body),
  );
}
