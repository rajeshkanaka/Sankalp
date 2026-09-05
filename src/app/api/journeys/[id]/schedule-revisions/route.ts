import { z } from 'zod';
import { scheduleRevisionRequestSchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { applyScheduleRevision, previewScheduleRevision } from '@/server/journeys/revisions';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(request, scheduleRevisionRequestSchema, async (userId, body) => {
    const id = z.uuid().parse((await context.params).id);
    return body.mode === 'preview'
      ? previewScheduleRevision(userId, id, body)
      : applyScheduleRevision(userId, id, body);
  });
}
