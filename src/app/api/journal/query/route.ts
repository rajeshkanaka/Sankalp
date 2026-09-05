import { journalQuerySchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { queryJournal } from '@/server/journal';

export async function POST(request: Request) {
  return authenticated(request, journalQuerySchema, queryJournal);
}
