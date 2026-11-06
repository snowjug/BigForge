import { hashPassword } from '@bigforge/security';
import type { PersonaDto, Role } from '@bigforge/schemas';
import type { Store } from './db/store';

export const DEMO_PASSWORD = 'forge-demo';

interface SeedUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: Role;
  blurb: string;
}

export const SEED_TENANTS = [
  { id: 'ten_acme', slug: 'acme', name: 'Acme Platform Engineering' },
  { id: 'ten_globex', slug: 'globex', name: 'Globex Build Infrastructure' },
] as const;

/** The demo tenant whose admin may reset the (shared) demo database. */
export const PRIMARY_DEMO_TENANT = 'ten_acme';

export const SEED_USERS: SeedUser[] = [
  {
    id: 'usr_ada',
    tenantId: 'ten_acme',
    email: 'ada@acme.test',
    displayName: 'Ada Okafor',
    role: 'admin',
    blurb: 'Platform admin. Can reset the demo and change settings.',
  },
  {
    id: 'usr_grace',
    tenantId: 'ten_acme',
    email: 'grace@acme.test',
    displayName: 'Grace Lindqvist',
    role: 'reviewer',
    blurb: 'Reviewer. The only role (besides admin) that can promote a Reflex.',
  },
  {
    id: 'usr_linus',
    tenantId: 'ten_acme',
    email: 'linus@acme.test',
    displayName: 'Linus Marek',
    role: 'operator',
    blurb: 'Operator. Runs tasks, replays and shadow runs, but cannot promote.',
  },
  {
    id: 'usr_vera',
    tenantId: 'ten_acme',
    email: 'vera@acme.test',
    displayName: 'Vera Tanaka',
    role: 'viewer',
    blurb: 'Viewer. Read-only.',
  },
  {
    id: 'usr_gus',
    tenantId: 'ten_globex',
    email: 'gus@globex.test',
    displayName: 'Gus Ferreira',
    role: 'admin',
    blurb: 'Admin of a different tenant. Cannot see Acme data.',
  },
  {
    id: 'usr_gwen',
    tenantId: 'ten_globex',
    email: 'gwen@globex.test',
    displayName: 'Gwen Holloway',
    role: 'reviewer',
    blurb: 'Reviewer of a different tenant.',
  },
];

let cachedHash: string | null = null;

/** Seeds the two demo tenants and local identities. Demo credentials are public by design. */
export function seedDemoIdentities(store: Store, now: string): void {
  for (const t of SEED_TENANTS) store.insertTenant({ ...t, createdAt: now });
  cachedHash ??= hashPassword(DEMO_PASSWORD);
  for (const u of SEED_USERS) {
    store.insertUser({
      id: u.id,
      tenantId: u.tenantId,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      passwordHash: cachedHash,
      createdAt: now,
    });
  }
}

export function seedBootstrapAdmin(
  store: Store,
  now: string,
  email: string,
  password: string,
): void {
  store.insertTenant({
    id: 'ten_default',
    slug: 'default',
    name: 'Default tenant',
    createdAt: now,
  });
  store.insertUser({
    id: 'usr_admin',
    tenantId: 'ten_default',
    email: email.toLowerCase(),
    displayName: 'Administrator',
    role: 'admin',
    passwordHash: hashPassword(password),
    createdAt: now,
  });
}

export function personas(): PersonaDto[] {
  return SEED_USERS.map((u) => ({
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    tenant: {
      slug: SEED_TENANTS.find((t) => t.id === u.tenantId)?.slug ?? '',
      name: SEED_TENANTS.find((t) => t.id === u.tenantId)?.name ?? '',
    },
    blurb: u.blurb,
  }));
}
