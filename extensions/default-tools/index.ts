/**
 * Adds grep, find, and ls to the active toolset by default,
 * unless --tools was explicitly passed on the CLI.
 */
export default function (pi: Pi) {
  const toolsExplicit = process.argv.includes("--tools") || process.argv.includes("--no-tools");

  if (!toolsExplicit) {
    pi.on("session_start", () => {
      const current = pi.getActiveTools();
      pi.setActiveTools([...new Set([...current, "grep", "find", "ls"])]);
    });
  }
}
