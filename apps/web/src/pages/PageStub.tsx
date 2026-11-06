import { Check, Hourglass } from 'lucide-react';
import { PAGE_META, type PageId } from './pageMeta';
import { stagesForPath } from '../stages';
import { Chip, EmptyState, Page, PageHeader } from '../ui';
import '../styles/stub.css';

/** Where each stub's query convention is documented, shown to whoever builds the page. */
const QUERY_HINT: Partial<Record<PageId, string>> = {
  run: '/run?task=<taskId>&run=<runId>',
  traces: '/traces/:runId',
  learn: '/learn?family=<familyId>',
  reflexes: '/reflexes/:versionId',
  shadow: '/shadow?version=<versionId>',
  drift: '/drift?version=<versionId>',
};

/**
 * A navigable placeholder for a page that has not been built yet. It leads with the question the page
 * answers (from the design brief) and states honestly that the view is not built. Replace the page file,
 * not this component: `src/pages/<Name>Page.tsx` keeps its default export.
 */
export function PageStub({ page }: { page: PageId }) {
  const meta = PAGE_META[page];
  const stage = stagesForPath(meta.path)[0];
  const hint = QUERY_HINT[page];
  return (
    <Page title={meta.title}>
      <PageHeader
        title={meta.title}
        question={meta.question}
        {...(stage ? { eyebrow: `Forge stage · ${stage}` } : {})}
        actions={
          <Chip tone="ash" variant="outline" dashed icon={<Hourglass size={12} />}>
            Not built yet
          </Chip>
        }
      />
      <div className="bf-stub">
        <dl className="bf-stub__brief">
          <div>
            <dt className="micro">Decision</dt>
            <dd>{meta.decision}</dd>
          </div>
          <div>
            <dt className="micro">Evidence</dt>
            <dd>{meta.evidence}</dd>
          </div>
          <div>
            <dt className="micro">Action</dt>
            <dd>{meta.action}</dd>
          </div>
        </dl>
        <EmptyState
          icon={<Check size={18} />}
          title={`${meta.title} is not built yet`}
          description={
            <>
              The route, navigation and data hooks are wired.
              {hint ? (
                <>
                  {' '}
                  Deep link: <code>{hint}</code>.
                </>
              ) : null}
            </>
          }
        />
      </div>
    </Page>
  );
}
