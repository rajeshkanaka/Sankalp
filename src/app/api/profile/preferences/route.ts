import { progressPreferencesSchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { saveProgressPreferences } from '@/server/progress/service';

export async function PUT(request: Request) {
  return authenticated(request, progressPreferencesSchema, saveProgressPreferences);
}
