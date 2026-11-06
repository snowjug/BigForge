import { Compass } from 'lucide-react';
import { useLocation } from 'react-router';
import { ButtonLink, EmptyState, Page, PageHeader } from '../ui';

export default function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <Page title="Page not found" width="narrow">
      <PageHeader
        title="Page not found"
        question="That address does not lead anywhere in BigForge."
      />
      <EmptyState
        icon={<Compass size={18} />}
        title={`There is no page at ${pathname}`}
        description="Use the navigation to return to a view, or start from the Forge Floor."
        action={
          <ButtonLink to="/" variant="primary">
            Go to the Forge Floor
          </ButtonLink>
        }
      />
    </Page>
  );
}
