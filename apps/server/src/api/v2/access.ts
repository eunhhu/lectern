// Who may see what, for the fixture-backed stubs. The fixture user belongs to both fixture
// workspaces; any other workspace id is answered with 403, as a non-member would be.
// The real policy function (ARCHITECTURE §6 `can(user, action, resource)`) replaces this.

import { forbidden, type V2Request } from "./common.ts";
import * as F from "./fixtures.ts";

/** null when the caller may use `workspaceId`, else the 403 response. */
export function denyUnlessMember(req: V2Request, workspaceId: unknown): Response | null {
  return F.workspaces.some((w) => w.workspace.id === workspaceId) ? null : forbidden(req);
}
