import { z } from 'zod';
import { reminderPreferencesSchema } from '@/domain/reminders';
import { mutationEnvelopeSchema } from '@/domain/validation';
import { getApiUser } from '@/server/auth/server';
import { assertExpectedAccount, authenticated, handleApi } from '@/server/http';
import { getReminderPreferences, updateReminderPreferences } from '@/server/reminders/preferences';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const user = await getApiUser();
    assertExpectedAccount(request, user.id);
    return getReminderPreferences(user.id, z.uuid().parse((await context.params).id));
  });
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(
    request,
    mutationEnvelopeSchema(reminderPreferencesSchema),
    async (userId, body) =>
      updateReminderPreferences(userId, z.uuid().parse((await context.params).id), body),
  );
}
