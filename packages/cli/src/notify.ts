import { spawn } from "node:child_process";

/**
 * Fire a desktop notification. Best-effort: uses macOS `osascript`; on other
 * platforms it prints to stderr. Never throws.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (process.platform === "darwin") {
    const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(
      title
    )} sound name "default"`;
    await run("osascript", ["-e", script]).catch(() => undefined);
    return;
  }
  process.stderr.write(`🔔 ${title}: ${body}\n`);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}
