import { randomBytes } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Job, STAGES, StoredJob, jobPaths, type JobConfig, type StageName, type StageState } from "@agentcast/shared";
import { ArtifactError, readArtifact, writeArtifact } from "@agentcast/shared/node";
import { WorkerError } from "./errors.ts";

const JOB_ID = /^job_[a-z0-9]+$/;

/** Jobs on disk: $AGENTCAST_HOME/jobs/<id>/state.json (validated on every read and write). */
export class JobStore {
  readonly jobsDir: string;

  constructor(readonly home: string) {
    this.jobsDir = join(home, "jobs");
  }

  /** The job's dir. The id pattern keeps request paths from escaping jobsDir. */
  dir(id: string): string {
    if (!JOB_ID.test(id)) throw new WorkerError(404, `no job ${id}`);
    return join(this.jobsDir, id);
  }

  async create(config: JobConfig): Promise<Job> {
    const id = `job_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
    const now = new Date().toISOString();
    const stages = Object.fromEntries(
      STAGES.map((s) => [s.name, { status: "pending", attempts: 0 } satisfies StageState]),
    ) as Record<StageName, StageState>;
    const job: Job = {
      schemaVersion: 3,
      id,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      config,
      stages,
    };
    await mkdir(this.dir(id), { recursive: true });
    await this.save(job);
    return job;
  }

  async load(id: string): Promise<Job | undefined> {
    try {
      return await readArtifact(join(this.dir(id), jobPaths.state), StoredJob);
    } catch (err) {
      if (err instanceof ArtifactError && (err.cause as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      if (err instanceof WorkerError) return undefined;
      throw err;
    }
  }

  async save(job: Job): Promise<void> {
    await writeArtifact(join(this.dir(job.id), jobPaths.state), Job, job);
  }

  async ids(): Promise<string[]> {
    try {
      return (await readdir(this.jobsDir)).filter((name) => JOB_ID.test(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
