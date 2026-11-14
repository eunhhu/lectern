// 설정 › 연동 (P4-07, D-P4-2/3): the Google Calendar connection and the ICS subscription
// URL. While the server has the calendar feature off (501), both say "준비 중입니다.".
// The feed URL carries its token, so it is shown only right after it was made.

import { useEffect, useMemo, useState } from "react";
import { Input, Label, TextField } from "react-aria-components";
import { isNotReady } from "../../api/errors.ts";
import {
  useCalendarFeed,
  useCreateCalendarFeed,
  useDeleteCalendarFeed,
  useDisconnectIntegration,
  useIntegrations,
  useStartGoogleIntegration,
} from "../../api/queries.ts";
import { useWorkspace } from "../../app/workspace.tsx";
import { formatDate } from "../../lib/format.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Badge, Button, ModalDialog, uiStyles } from "../../ui/controls.tsx";
import { showToast } from "../../ui/toast.tsx";
import { toastError } from "../library/organise.ts";
import s from "./settings.module.css";

export const NEEDS_REAUTH_TEXT = "Google 연결이 만료되었습니다. 다시 연결해야 일정이 동기화됩니다.";
const RETURN_TO = "/app/settings#integrations";
const NOT_READY_TEXT = "준비 중입니다.";

export function Integrations() {
  const { workspaceId } = useWorkspace();
  // The feed answers 501 while LECTERN_CALENDAR is off: the whole section is not ready then.
  const feed = useCalendarFeed(workspaceId);
  const off = isNotReady(feed.error);
  return (
    <section id="integrations" className={s.section} aria-labelledby="set-integrations">
      <h2 id="set-integrations" className={s.heading}>
        연동
      </h2>
      <GoogleCalendarCard off={off} />
      <CalendarFeedCard off={off} />
    </section>
  );
}

/** The `?google=connected|error` the OAuth callback sends back: a toast, then the query is removed. */
function useGoogleResultToast() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") showToast({ title: "Google 캘린더를 연결했습니다." });
    else showToast({ title: "Google 캘린더를 연결하지 못했습니다. 다시 시도해 주세요.", tone: "danger" });
    params.delete("google");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);
}

function GoogleCalendarCard({ off }: { off: boolean }) {
  const { workspaceId } = useWorkspace();
  const integrations = useIntegrations(workspaceId);
  const start = useStartGoogleIntegration(workspaceId);
  const disconnect = useDisconnectIntegration(workspaceId);
  const [notReady, setNotReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useGoogleResultToast();

  const google = integrations.data?.find((i) => i.provider === "google" && i.status !== "revoked");
  const connect = async () => {
    try {
      const { authorization_url } = await start.mutateAsync(RETURN_TO);
      window.location.assign(authorization_url);
    } catch (err) {
      if (isNotReady(err)) setNotReady(true);
      else toastError("Google 캘린더 연결을 시작하지 못했습니다.", err);
    }
  };
  const runDisconnect = async () => {
    if (!google) return;
    setConfirming(false);
    try {
      await disconnect.mutateAsync(google.id);
      showToast({ title: "연결을 해제했습니다." });
    } catch (err) {
      toastError("연결을 해제하지 못했습니다.", err);
    }
  };

  let body;
  if (off || notReady) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (integrations.isPending) {
    body = <p className={s.muted}>불러오는 중…</p>;
  } else if (google?.status === "active") {
    body = (
      <div className={s.cardActions}>
        <Button size="sm" variant="dangerText" onPress={() => setConfirming(true)}>
          연결 해제
        </Button>
      </div>
    );
  } else if (google) {
    body = (
      <>
        <p className={s.warning} role="status">
          <Icon name="alert" size={16} />
          {NEEDS_REAUTH_TEXT}
        </p>
        <div className={s.cardActions}>
          <Button size="sm" variant="primary" onPress={connect} isDisabled={start.isPending}>
            다시 연결
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className={s.muted}>수락한 일정을 Google 캘린더의 "Lectern" 캘린더에 넣습니다. Lectern은 자신이 만든 캘린더만 읽고 씁니다.</p>
        <div className={s.cardActions}>
          <Button size="sm" variant="primary" onPress={connect} isDisabled={start.isPending}>
            Google 캘린더 연결
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.deviceIcon}>
          <Icon name="calendar" />
        </span>
        <h3 className={s.memberName}>
          Google 캘린더
          {!off && !notReady && google?.status === "active" && <Badge tone="success">연결됨</Badge>}
        </h3>
      </div>
      {body}
      <ModalDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Google 캘린더 연결을 해제할까요?"
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setConfirming(false)} autoFocus>
              취소
            </Button>
            <Button variant="danger" onPress={runDisconnect}>
              연결 해제
            </Button>
          </>
        }
      >
        <p>Lectern이 더 이상 일정을 넣지 않습니다. 이미 Google 캘린더에 들어간 일정은 지워지지 않습니다.</p>
      </ModalDialog>
    </div>
  );
}

function CalendarFeedCard({ off }: { off: boolean }) {
  const { workspaceId } = useWorkspace();
  const feed = useCalendarFeed(workspaceId);
  const create = useCreateCalendarFeed(workspaceId);
  const remove = useDeleteCalendarFeed(workspaceId);
  const [url, setUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"recreate" | "delete" | null>(null);
  const now = useMemo(() => new Date(), []);

  const make = async () => {
    setConfirm(null);
    try {
      setUrl((await create.mutateAsync()).url);
    } catch (err) {
      toastError("구독 주소를 만들지 못했습니다.", err);
    }
  };
  const runDelete = async () => {
    setConfirm(null);
    try {
      await remove.mutateAsync();
      setUrl(null);
      showToast({ title: "구독 주소를 삭제했습니다." });
    } catch (err) {
      toastError("구독 주소를 삭제하지 못했습니다.", err);
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast({ title: "주소를 복사했습니다." });
    } catch {
      showToast({ title: "주소를 복사하지 못했습니다.", description: "주소를 직접 선택해 복사하세요.", tone: "danger" });
    }
  };

  let body;
  if (off) {
    body = <p className={s.muted}>{NOT_READY_TEXT}</p>;
  } else if (url) {
    body = (
      <>
        <div className={s.urlRow}>
          <TextField className={uiStyles.field} value={url} isReadOnly>
            <Label className={uiStyles.label}>구독 주소</Label>
            {/* Focus lands on the address just made, ready to select or copy. */}
            <Input className={uiStyles.input} autoFocus />
          </TextField>
          <Button icon="copy" onPress={copy}>
            복사
          </Button>
        </div>
        <p className={s.warning}>
          <Icon name="alert" size={16} />
          이 주소는 지금만 볼 수 있습니다. 주소를 아는 사람은 누구나 일정을 볼 수 있으니 공유하지 마세요.
        </p>
      </>
    );
  } else if (feed.data?.exists) {
    body = (
      <>
        <p className={s.muted}>구독 주소가 있습니다. ({feed.data.created_at ? formatDate(feed.data.created_at, now) : "만든 날짜 모름"})</p>
        <div className={s.cardActions}>
          <Button size="sm" onPress={() => setConfirm("recreate")} isDisabled={create.isPending}>
            다시 만들기
          </Button>
          <Button size="sm" variant="dangerText" onPress={() => setConfirm("delete")} isDisabled={remove.isPending}>
            삭제
          </Button>
        </div>
      </>
    );
  } else if (feed.data) {
    body = (
      <>
        <p className={s.muted}>Apple 캘린더, Outlook 같은 앱에서 이 주소를 구독하면 수락한 일정이 보입니다.</p>
        <div className={s.cardActions}>
          <Button size="sm" variant="primary" onPress={make} isDisabled={create.isPending}>
            구독 주소 만들기
          </Button>
        </div>
      </>
    );
  } else {
    body = <p className={s.muted}>{feed.isPending ? "불러오는 중…" : "구독 주소를 불러오지 못했습니다."}</p>;
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.deviceIcon}>
          <Icon name="calendar" />
        </span>
        <h3 className={s.memberName}>캘린더 구독 주소(ICS)</h3>
      </div>
      {body}
      <ModalDialog
        isOpen={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "delete" ? "구독 주소 삭제" : "구독 주소 다시 만들기"}
        role="alertdialog"
        size="form"
        footer={
          <>
            <Button variant="ghost" onPress={() => setConfirm(null)} autoFocus>
              취소
            </Button>
            {confirm === "delete" ? (
              <Button variant="danger" onPress={runDelete}>
                삭제
              </Button>
            ) : (
              <Button variant="primary" onPress={make}>
                다시 만들기
              </Button>
            )}
          </>
        }
      >
        <p>
          {confirm === "delete"
            ? "구독 주소를 삭제할까요? 구독 중인 캘린더 앱에서 일정이 더 이상 갱신되지 않습니다."
            : "새 주소를 만들면 예전 주소는 더 이상 동작하지 않습니다."}
        </p>
      </ModalDialog>
    </div>
  );
}
