import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I18nProvider } from "react-aria-components";
import { createApiClient } from "../api/index.ts";
import { ApiContext, queryKeys } from "../api/queries.ts";
import { ApiClientError } from "../api/client.ts";
import { createAppRouter } from "./router.tsx";

export function App() {
  const [api] = useState(createApiClient);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // A client error (401, 404, 501 …) will not change by asking again.
            retry: (count, err) => count < 1 && !(err instanceof ApiClientError && ((err.status >= 400 && err.status < 500) || err.status === 501)),
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [router] = useState(() => createAppRouter({ api, queryClient }));

  // The session ended while the app was open (expired, signed out elsewhere): forget it
  // and send the user to sign in, then back to where they were.
  useEffect(
    () =>
      api.onUnauthorized(() => {
        queryClient.setQueryData(queryKeys.session, null);
        const here = router.state.location;
        if (here.pathname === "/login") return;
        void router.navigate({ to: "/login", search: { next: here.href } });
      }),
    [api, queryClient, router],
  );

  return (
    <I18nProvider locale="ko-KR">
      <ApiContext.Provider value={api}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ApiContext.Provider>
    </I18nProvider>
  );
}
