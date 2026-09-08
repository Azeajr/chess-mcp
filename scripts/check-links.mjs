// Every local markdown link has to resolve for someone who only has what git tracks. `stat` answers
// from the working tree, which also holds ignored and untracked files — that is how PR #58 passed
// locally twice while CI failed on links into a gitignored evidence directory.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";

const INLINE_LINK = /!?\[[^\]]*\]\(([^)]+)\)/g;
// A reference definition: `[label]: target "optional title"` at the start of a line.
const REFERENCE_LINK = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(\S+)/gm;

const isExternal = (target) => /^[a-z][a-z\d+.-]*:/i.test(target);

/** Resolves a link as written in `file` to a repository-relative path, or null when it is not one. */
export function resolveLinkTarget(file, rawTarget) {
  const raw = rawTarget.trim().replace(/^<|>$/g, "");
  if (!raw || raw.startsWith("#") || isExternal(raw)) return null;
  const [pathPart] = raw.split(/[?#]/, 1);
  if (!pathPart) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }
  const resolved = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(file), decoded));
  // A link that climbs out of the repository can never be satisfied by a tracked file.
  return resolved.startsWith("../") || resolved === ".."
    ? { escapes: true, path: resolved }
    : { escapes: false, path: resolved.replace(/\/$/, "") };
}

/**
 * @param {{ files: readonly string[], tracked: Iterable<string>, read: (file: string) => Promise<string> }} input
 * @returns {Promise<string[]>} one message per unresolvable link, in file order
 */
export async function collectLinkProblems({ files, tracked, read }) {
  const trackedFiles = new Set(tracked);
  // A link may point at a directory, which git never lists on its own.
  const trackedDirectories = new Set();
  for (const path of trackedFiles) {
    let parent = posix.dirname(path);
    while (parent !== "." && parent !== "/" && !trackedDirectories.has(parent)) {
      trackedDirectories.add(parent);
      parent = posix.dirname(parent);
    }
  }

  const problems = [];
  for (const file of files) {
    const contents = await read(file);
    const lineStarts = [0];
    for (let index = 0; index < contents.length; index += 1)
      if (contents[index] === "\n") lineStarts.push(index + 1);
    const lineOf = (offset) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return low + 1;
    };

    for (const pattern of [INLINE_LINK, REFERENCE_LINK]) {
      pattern.lastIndex = 0;
      for (const match of contents.matchAll(pattern)) {
        const target = resolveLinkTarget(file, match[1]);
        if (target === null) continue;
        const line = lineOf(match.index ?? 0);
        if (target.escapes) {
          problems.push(`${file}:${line}: link leaves the repository: ${match[1].trim()}`);
          continue;
        }
        if (trackedFiles.has(target.path) || trackedDirectories.has(target.path)) continue;
        problems.push(
          `${file}:${line}: link resolves to no tracked file: ${match[1].trim()} → ${target.path}`,
        );
      }
    }
  }
  return problems;
}

export function trackedPaths(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const tracked = trackedPaths(root);
  const files = tracked.filter((path) => path.endsWith(".md"));
  const problems = await collectLinkProblems({
    files,
    tracked,
    read: (file) => readFile(posix.join(root, file), "utf8"),
  });
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(
      `\n${problems.length} unresolvable link(s). A link satisfied only by an untracked or ignored file is broken for everyone else.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`links: ok (${files.length} tracked markdown files)`);
  }
}
