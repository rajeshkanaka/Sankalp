import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Cut the test origin's real connections; this does not emulate navigator.onLine. */
export async function setUiNetworkDisconnected(disconnected: boolean): Promise<void> {
  const generation = randomUUID();
  const state = { disconnected, generation };
  const controlPath = resolve('.local/ui-network.json');
  const temporary = `${controlPath}.${generation}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, controlPath);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const applied = JSON.parse(await readFile(resolve('.local/ui-network-applied.json'), 'utf8'));
      if (applied.generation === generation && applied.disconnected === disconnected) return;
    } catch {
      // The fixture may still be replacing its acknowledgment file.
    }
    await setTimeout(25);
  }
  throw new Error('UI network fixture did not acknowledge the requested state within 5 seconds.');
}
