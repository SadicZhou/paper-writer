/** Validate a book/paper ID for use in filesystem paths. */
export function isSafeBookId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  return /^[a-zA-Z0-9一-鿿][-a-zA-Z0-9一-鿿]{0,39}$/.test(id);
}

export function assertSafeBookId(id: string): void {
  if (!isSafeBookId(id)) {
    throw new Error(
      `Invalid book/paper ID: "${id}". Must be 1-40 chars, alphanumeric + Chinese chars + hyphens, no leading hyphen.`,
    );
  }
}

export function deriveBookIdFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
