import { isSafeBookId as isSafeCoreBookId } from "@actalk/inkos-core";

/** Validates bookId for API inputs and filesystem-backed book operations. */
export function isSafeBookId(bookId: unknown): bookId is string {
  if (typeof bookId !== "string") return false;
  return isSafeCoreBookId(bookId);
}
