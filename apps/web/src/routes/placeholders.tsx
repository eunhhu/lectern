// Not-found route and the session error page (every other screen has its own module).

import { useNavigate, useRouter } from "@tanstack/react-router";
import { errorMessage } from "../api/errors.ts";
import { usePageTitle } from "../app/RootLayout.tsx";
import { Button, EmptyState, ErrorBox } from "../ui/controls.tsx";
import layout from "../app/layout.module.css";

export function NotFoundPage() {
  usePageTitle("찾을 수 없음");
  const navigate = useNavigate();
  return (
    <div className={layout.page}>
      <h1 className={layout.pageTitle}>페이지를 찾을 수 없습니다.</h1>
      <EmptyState icon="search" title="주소가 바뀌었거나 삭제된 페이지입니다." action={<Button onPress={() => void navigate({ to: "/" })}>홈으로</Button>} />
    </div>
  );
}

/** The session check itself failed (server down, network): nothing to show yet. */
export function SessionErrorPage({ error, reset }: { error: unknown; reset: () => void }) {
  usePageTitle("연결할 수 없음");
  const router = useRouter();
  return (
    <main id="main" className={layout.page}>
      <h1 className={layout.pageTitle}>Lectern에 연결하지 못했습니다.</h1>
      <ErrorBox
        title={errorMessage(error, "서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.")}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </main>
  );
}
