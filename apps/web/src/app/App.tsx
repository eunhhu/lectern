import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { I18nProvider } from "react-aria-components";
import { createApiClient } from "../api/index.ts";
import { ApiContext } from "../api/queries.ts";
import { createAppRouter } from "./router.tsx";

export function App() {
  const [api] = useState(createApiClient);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [router] = useState(createAppRouter);
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
