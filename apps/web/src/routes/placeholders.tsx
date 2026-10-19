// Not-found route (every other screen has its own module).

import { useNavigate } from "@tanstack/react-router";
import { usePageTitle } from "../app/RootLayout.tsx";
import { Button, EmptyState } from "../ui/controls.tsx";
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
