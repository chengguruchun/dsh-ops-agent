/**
 * V0.5 Domain registry stub — ops + code-review as sibling domains.
 * Experimental: registration only; does not nest CR inside ops.
 */

export type DomainId = 'ops' | 'code-review' | string;

export type DomainDescriptor = {
  id: DomainId;
  name: string;
  packageName: string;
  toolPrefix: string;
  experimental?: boolean;
  description?: string;
};

export class DomainRegistry {
  private domains = new Map<DomainId, DomainDescriptor>();

  register(desc: DomainDescriptor): void {
    this.domains.set(desc.id, desc);
  }

  get(id: DomainId): DomainDescriptor | undefined {
    return this.domains.get(id);
  }

  list(): DomainDescriptor[] {
    return [...this.domains.values()];
  }

  has(id: DomainId): boolean {
    return this.domains.has(id);
  }
}

/** Default sibling domains shipped with this monorepo. */
export function createDefaultDomainRegistry(): DomainRegistry {
  const reg = new DomainRegistry();
  reg.register({
    id: 'ops',
    name: 'Ops / Oncall Closed Loop',
    packageName: '@dsh-ops-agent/ops-pipeline',
    toolPrefix: 'ops_',
    description: 'discover→diagnose→fix→review→release→verify',
  });
  reg.register({
    id: 'code-review',
    name: 'Code Review',
    packageName: '@dsh-ops-agent/code-review',
    toolPrefix: 'cr_',
    description: 'fetch→analyze→static?→summarize→publish? (sibling, not nested in ops)',
  });
  return reg;
}
