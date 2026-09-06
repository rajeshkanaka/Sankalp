import { notFound } from 'next/navigation';
import { AppError } from '../errors';
import { getJourneyView } from './service';

export async function getPageJourneyView(userId: string, id: string) {
  try {
    return await getJourneyView(userId, id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
}
