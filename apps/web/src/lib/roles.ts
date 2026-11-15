// Workspace roles in Korean (P5-11): the settings tables, the invitation form and the
// account menu all say them the same way.

import type { MembershipRole } from "../api/types.ts";

export const ROLE_LABEL: Record<MembershipRole, string> = { owner: "소유자", admin: "관리자", member: "멤버", viewer: "보기 전용" };
