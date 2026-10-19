import { HEADER, versionETag } from "@lectern/domain";
import { defineRouter, notFound, notImplemented, ok, okPage, type Handler, type V2Request } from "./common.ts";
import * as F from "./fixtures.ts";

type Document = (typeof F.documents)[number];

function withDocument(handler: (req: V2Request, document: Document) => Response): Handler {
  return (req) => {
    const document = F.documents.find((d) => d.id === req.params.document_id);
    return document ? handler(req, document) : notFound(req, "문서");
  };
}

const versionsOf = (documentId: string) => F.documentVersions.filter((v) => v.document_id === documentId);

export const documentsRouter = defineRouter({
  getDocument: withDocument((req, document) => {
    const version = versionsOf(document.id).find((v) => v.version === document.current_version);
    return ok(req, { document, version }, { headers: { [HEADER.etag]: versionETag(document.current_version) } });
  }),
  listDocumentVersions: withDocument((req, document) =>
    okPage(
      req,
      versionsOf(document.id)
        .sort((a, b) => b.version - a.version)
        .map(({ body: _body, rendered_md: _md, ...summary }) => summary)
    )
  ),
  getDocumentVersion: withDocument((req, document) => {
    const version = versionsOf(document.id).find((v) => v.version === req.params.version);
    return version ? ok(req, version) : notFound(req, "문서 버전");
  }),
  // If-Match is still checked first (428 when missing), so clients can rely on that now.
  createDocumentVersion: notImplemented,
});
