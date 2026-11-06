import { Check, Minus } from 'lucide-react';
import { ACTION_LABELS, type Action, ROLES, can } from '../../auth/rbac';
import { useAuth } from '../../auth/useAuth';
import { RoleBadge, ROLE_META } from '../../ui';

const GROUPS: { title: string; note: string; actions: Action[] }[] = [
  { title: 'Observe', note: 'Everyone can look.', actions: ['read', 'view_audit'] },
  {
    title: 'Operate',
    note: 'Prepare the evidence. Operators cannot approve.',
    actions: ['run_task', 'compile', 'replay', 'shadow', 'canary', 'inject_environment_change'],
  },
  {
    title: 'Decide',
    note: 'The human in the loop.',
    actions: ['promote', 'reject', 'rollback', 'approve_mutation'],
  },
  { title: 'Administer', note: 'Admins only.', actions: ['manage_settings', 'reset_demo'] },
];

/** The roles matrix: what each role may do, mirrored from what the API enforces. */
export function RolesTab() {
  const { role: current } = useAuth();
  return (
    <div className="gov-tab">
      <p className="gov-lede">
        Roles are enforced by the server: a forbidden action answers <code>403 forbidden</code> even
        if a control were somehow shown. Promotion, rejection, rollback and mutation approval always
        need a human reviewer or admin.
      </p>
      <div className="bf-table-wrap" tabIndex={0} role="region" aria-label="Roles and permissions">
        <table className="bf-table gov-matrix">
          <caption className="sr-only">What each role is permitted to do</caption>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className="bf-table__cell--center"
                  {...(role === current ? { 'aria-current': 'true' as const } : {})}
                >
                  <span className="gov-matrix__role">
                    <RoleBadge role={role} />
                    {role === current ? <span className="micro gov-matrix__you">You</span> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr className="gov-matrix__group">
                <th scope="colgroup" colSpan={ROLES.length + 1}>
                  <span className="micro">{group.title}</span>
                  <span className="gov-matrix__note">{group.note}</span>
                </th>
              </tr>
              {group.actions.map((action) => (
                <tr key={action}>
                  <th scope="row" className="gov-matrix__action">
                    <div className="gov-matrix__action-inner">
                      <span>{ACTION_LABELS[action].label}</span>
                      <span className="gov-matrix__detail">{ACTION_LABELS[action].detail}</span>
                    </div>
                  </th>
                  {ROLES.map((role) => {
                    const allowed = can(role, action);
                    return (
                      <td
                        key={role}
                        className="bf-table__cell--center"
                        data-allowed={allowed}
                        data-current={role === current ? 'true' : undefined}
                      >
                        {allowed ? (
                          <Check size={16} strokeWidth={2.25} aria-hidden="true" />
                        ) : (
                          <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
                        )}
                        <span className="sr-only">
                          {ROLE_META[role].label}: {allowed ? 'allowed' : 'not allowed'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
