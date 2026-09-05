import { z } from 'zod';
import { authenticated } from '@/server/http';
import { mutationEnvelopeSchema, practiceValuesSchema } from '@/domain/validation';
import { savePractices } from '@/server/sessions/service';
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(practiceValuesSchema),
    async (userId, body) => savePractices(userId, z.uuid().parse((await context.params).id), body),
  );
}
