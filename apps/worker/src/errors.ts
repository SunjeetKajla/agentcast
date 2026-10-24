/** An error with the HTTP status the API answers with. */
export class WorkerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkerError";
  }
}
