import { ScrollText, Stamp, TerminalSquare, Users } from 'lucide-react';
import { useApprovals, useAudit } from '../api/hooks';
import { useGovernanceParams } from '../routeParams';
import type { GovernanceTab } from '../routes';
import { Page, PageHeader, TabPanel, Tabs, formatCount } from '../ui';
import { ApprovalsTab } from './governance/ApprovalsTab';
import { AuditTab } from './governance/AuditTab';
import { ChainStatus } from './governance/ChainStatus';
import { RolesTab } from './governance/RolesTab';
import { SafetyTab } from './governance/SafetyTab';
import '../styles/governance.css';

const ID_PREFIX = 'gov';

/** `/governance?tab=audit|approvals|roles|safety`: Who did what, and what is blocked? */
export default function GovernancePage() {
  const { tab, setTab } = useGovernanceParams();
  const audit = useAudit({ limit: 1 });
  const approvals = useApprovals();

  return (
    <Page title="Governance">
      <PageHeader
        title="Governance"
        question="Who did what, and what is blocked?"
        eyebrow="Trust"
        meta="Audit chain verification, human approvals, roles and the command-safety policy."
      />
      <ChainStatus />
      <Tabs
        label="Governance sections"
        idPrefix={ID_PREFIX}
        value={tab}
        onValueChange={(next) => {
          setTab(next as GovernanceTab);
        }}
        className="gov-tabs"
        items={[
          {
            id: 'audit',
            label: 'Audit log',
            icon: <ScrollText size={15} />,
            ...(audit.data ? { count: formatCount(audit.data.total) } : {}),
          },
          {
            id: 'approvals',
            label: 'Approvals',
            icon: <Stamp size={15} />,
            ...(approvals.data ? { count: approvals.data.approvals.length } : {}),
          },
          { id: 'roles', label: 'Roles', icon: <Users size={15} /> },
          { id: 'safety', label: 'Command safety', icon: <TerminalSquare size={15} /> },
        ]}
      />
      <TabPanel idPrefix={ID_PREFIX} id="audit" value={tab}>
        <AuditTab />
      </TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="approvals" value={tab}>
        <ApprovalsTab />
      </TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="roles" value={tab}>
        <RolesTab />
      </TabPanel>
      <TabPanel idPrefix={ID_PREFIX} id="safety" value={tab}>
        <SafetyTab />
      </TabPanel>
    </Page>
  );
}
