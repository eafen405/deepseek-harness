/** A loader entry configuration that cannot form a valid parent tree. */
export class EntryStructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntryStructureError'
  }
}
