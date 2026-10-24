import { checkWorkspace, describeIssues, errorsOf } from "./check.ts";

// The check the director runs in its workspace: prints every issue, exits 1 while there are errors.
const result = await checkWorkspace(process.cwd());
const errors = errorsOf(result);
if (result.issues.length) console.log(describeIssues(result.issues));
console.log(
  errors.length ? `${errors.length} error(s): fix them and run the check again.` : "edl.json passes the check.",
);
process.exitCode = errors.length ? 1 : 0;
