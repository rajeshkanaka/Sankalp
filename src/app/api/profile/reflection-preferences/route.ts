import { reflectionPreferencesSchema } from '@/domain/validation';
import { authenticated } from '@/server/http';
import { saveReflectionPreferences } from '@/server/journal';

export async function PUT(request: Request) {
  return authenticated(request, reflectionPreferencesSchema, saveReflectionPreferences);
}
