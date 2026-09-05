import { authenticated } from '@/server/http';
import { journeyDraftSchema } from '@/domain/validation';
import { createJourney } from '@/server/journeys/service';
export async function POST(request: Request) {
  return authenticated(request, journeyDraftSchema, createJourney);
}
