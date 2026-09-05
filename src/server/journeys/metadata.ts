import { z } from 'zod';

import type { JourneyDraft, JourneyMetadata, MutationEnvelope } from '../../domain/contracts';
import { journeyDraftSchema, journeyMetadataSchema } from '../../domain/validation';
import { getRuntimeInfo } from '../config';
import { withUser } from '../db/client';
import { assertRevision, idempotent } from '../db/operations';
import { notFound } from '../errors';
import { readJourneyView } from './service';

interface JourneyRow {
  id: string;
  draft: JourneyDraft;
  revision: number;
}

export async function updateJourneyMetadata(
  userId: string,
  id: string,
  input: MutationEnvelope<JourneyMetadata>,
) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const metadata = journeyMetadataSchema.parse(input.payload);
  const { now } = getRuntimeInfo();
  return withUser(userId, (client) =>
    idempotent(client, userId, input.operationId, `journey-metadata:${id}`, input, async () => {
      const result = await client.query<JourneyRow>(
        'select id,draft,revision from app.journey where id=$1 for update',
        [id],
      );
      const row = result.rows[0];
      if (!row) throw notFound();
      assertRevision(row.revision, input.baseRevision, {
        id: row.id,
        revision: row.revision,
      });
      const draft = journeyDraftSchema.parse(row.draft) as JourneyDraft;
      const nextDraft = { ...draft, ...metadata };
      await client.query(
        'update app.journey set title=$2,intention=$3,draft=$4,revision=revision+1 where id=$1',
        [id, metadata.title, metadata.intention, JSON.stringify(nextDraft)],
      );
      return readJourneyView(client, id, now);
    }),
  );
}
