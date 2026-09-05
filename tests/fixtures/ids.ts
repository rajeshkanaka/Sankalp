export const FIXTURE_PROFILE = 'M1' as const;
// The identity marker remains stable when a named demo profile changes.
export const DEMO_PROFILES = ['M1', 'M2'] as const;
export type DemoProfile = (typeof DEMO_PROFILES)[number];
export const FIXTURE_MARKER_KEY = 'sankalpa_fixture' as const;
export const M1_DEMO_NOW = '2026-09-05T00:45:00Z' as const;
export const M2_DEMO_NOW = '2026-09-11T22:31:00Z' as const;

export const FIXTURE_NAMESPACES = ['demo', 'ui', 'ui-http', 'integration'] as const;
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
