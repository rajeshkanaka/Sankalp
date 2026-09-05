import { z } from 'zod';
import { reflectionPayloadSchema, mutationEnvelopeSchema } from '@/domain/validation';
import { getApiUser } from '@/server/auth/server';
import { assertExpectedAccount, authenticated, handleApi } from '@/server/http';
import { getReflection, saveReflection } from '@/server/journal';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await getApiUser();
    assertExpectedAccount(request, user.id);
    return getReflection(user.id, z.uuid().parse((await context.params).id));
  });
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(reflectionPayloadSchema),
    async (userId, body) => saveReflection(userId, z.uuid().parse((await context.params).id), body),
  );
}
