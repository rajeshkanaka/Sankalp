import { z } from 'zod';
import { authenticated } from '@/server/http';
import {
  mutationEnvelopeSchema,
  completionSchema,
  completionUndoSchema,
} from '@/domain/validation';
import { confirmSession, removeCompletion } from '@/server/sessions/service';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(request, mutationEnvelopeSchema(completionSchema), async (userId, body) =>
    confirmSession(userId, z.uuid().parse((await context.params).id), body),
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(completionUndoSchema),
    async (userId, body) =>
      removeCompletion(userId, z.uuid().parse((await context.params).id), body),
  );
}
