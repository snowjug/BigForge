import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ButtonLink, ErrorState, ForgeLogo, Page, PageHeader } from '../ui';
import { Button } from '../ui';

/** Shown when a route fails to load (a failed lazy import) or a page throws while rendering. */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';
  return (
    <div className="bf-splash">
      <ForgeLogo size={36} wordmark />
      <Page title="Something broke" width="narrow">
        <PageHeader title="Something went wrong" question="This view failed to load." />
        <ErrorState title="The page could not be shown" error={new Error(message)} />
        <div className="cluster" style={{ marginTop: 16 }}>
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <ButtonLink to="/">Forge Floor</ButtonLink>
        </div>
      </Page>
    </div>
  );
}
