// One share link in a list (the share dialog and Settings → 공유 링크): what it includes,
// whether it has a password, when it expires, and 회수 behind a confirmation. The link's
// address is never shown here: it exists only in the create response (D-0-7).

import { useMemo, useState } from "react";
import { useRevokeShareLink } from "../../api/queries.ts";
import type { ShareLinkDto } from "../../api/types.ts";
import { formatDate } from "../../lib/format.ts";
import { Badge, Button, ModalDialog } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import s from "./share.module.css";

export function ShareLinkRow({ link, title, ws }: { link: ShareLinkDto; title?: string; ws: string }) {
  const revoke = useRevokeShareLink(ws);
  const [confirming, setConfirming] = useState(false);
  const now = useMemo(() => new Date(), []);
  const includes = [link.scope.transcript && "전사 포함", link.scope.audio && "오디오 포함"].filter((x): x is string => Boolean(x));

  const doRevoke = async () => {
    try {
      await revoke.mutateAsync(link.id);
      setConfirming(false);
      showToast({ title: "공유 링크를 회수했습니다." });
    } catch (err) {
      setConfirming(false);
      toastError("공유 링크를 회수하지 못했습니다.", err);
    }
  };

  return (
    <li className={s.row}>
      <span className={s.text}>
        {title && <span className={s.title}>{title}</span>}
        <span className={s.badges}>
          {includes.length ? includes.map((label) => <Badge key={label}>{label}</Badge>) : <Badge>문서만</Badge>}
          {link.has_password && <Badge tone="info">비밀번호 있음</Badge>}
        </span>
        <span className={s.muted}>
          {link.expires_at ? `${formatDate(link.expires_at, now)} 만료` : "만료 없음"} · {formatDate(link.created_at, now)} 만듦
        </span>
      </span>
      <Button size="sm" variant="dangerText" aria-label={`공유 링크 회수: ${title ?? "이 녹음"}`} onPress={() => setConfirming(true)}>
        회수
      </Button>
      <ModalDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="공유 링크를 회수할까요?"
        role="alertdialog"
        footer={
          <>
            <Button onPress={() => setConfirming(false)}>취소</Button>
            <Button variant="danger" onPress={() => void doRevoke()} isDisabled={revoke.isPending}>
              회수
            </Button>
          </>
        }
      >
        <p>회수하면 이 링크로는 더 이상 열 수 없습니다. 되돌릴 수 없습니다.</p>
      </ModalDialog>
    </li>
  );
}
