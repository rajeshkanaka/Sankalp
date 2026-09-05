export const FIXTURE_PROFILE = 'M1' as const;
export const FIXTURE_MARKER_KEY = 'sankalpa_fixture' as const;
export const M1_DEMO_NOW = '2026-09-05T00:45:00Z' as const;

export const FIXTURE_NAMESPACES = ['demo', 'ui', 'integration'] as const;
export type FixtureNamespace = (typeof FIXTURE_NAMESPACES)[number];

export const FIXTURE_PEOPLE = ['maya', 'arun'] as const;
export type FixturePerson = (typeof FIXTURE_PEOPLE)[number];

const displayNames: Record<FixturePerson, string> = {
  maya: 'Maya',
  arun: 'Arun',
};

export interface FixtureAccountSpec {
  person: FixturePerson;
  displayName: string;
  email: string;
}

export function fixtureAccounts(namespace: FixtureNamespace): FixtureAccountSpec[] {
  return FIXTURE_PEOPLE.map((person) => ({
    person,
    displayName: displayNames[person],
    email: `${namespace === 'demo' ? '' : `${namespace}-`}${person}@example.test`,
  }));
}

export function fixtureIdentityFileName(namespace: FixtureNamespace): string {
  return `${FIXTURE_PROFILE}-${namespace}.json`;
}
