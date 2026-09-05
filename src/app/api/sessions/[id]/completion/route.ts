import { z } from 'zod';
import { authenticated } from '@/server/http';
import { mutationEnvelopeSchema, completionSchema } from '@/domain/validation';
import { confirmSession } from '@/server/sessions/service';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(request, mutationEnvelopeSchema(completionSchema), async (userId, body) =>
    confirmSession(userId, z.uuid().parse((await context.params).id), body),
  );
}
