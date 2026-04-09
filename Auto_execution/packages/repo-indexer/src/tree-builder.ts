import { Octokit } from "@octokit/rest";

export interface FunctionDef {
  name: string;
  line: number;
  type: "function" | "class" | "method" | "export";
}

export interface FileNode {
  path: string;
  language: string;
  size: number;
  functions: FunctionDef[];
  imports: string[];
  summary: string;
}

export interface RepoTree {
  owner: string;
  repo: string;
  branch: string;
  indexedAt: string;
  files: FileNode[];
  totalFiles: number;
}

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go",
  ".java", ".rb", ".php", ".cs", ".cpp", ".c",
  ".rs", ".swift", ".kt"
]);

const SKIP_PATHS = new Set([
  "node_modules", "dist", "build", ".git",
  "coverage", "__pycache__", ".next"
]);

function detectLanguage(path: string): string {
  const ext = "." + path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".go": "go",
    ".java": "java", ".rb": "ruby",
    ".php": "php", ".cs": "csharp",
    ".cpp": "cpp", ".c": "c",
    ".rs": "rust", ".swift": "swift", ".kt": "kotlin"
  };
  return map[ext] ?? "unknown";
}

function extractFunctions(content: string, language: string): FunctionDef[] {
  const defs: FunctionDef[] = [];
  const lines = content.split("\n");

  const patterns: Record<string, RegExp[]> = {
    typescript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^\s+(?:async\s+)?(\w+)\s*\(/,
      /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
    ],
    javascript: [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      /^(?:export\s+)?class\s+(\w+)/,
      /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
    ],
    python: [
      /^def\s+(\w+)/,
      /^class\s+(\w+)/,
      /^\s+def\s+(\w+)/,
    ],
  };

  const lang = language === "typescript" ? "typescript" : 
               language === "javascript" ? "javascript" :
               language === "python" ? "python" : "typescript";

  const pats = patterns[lang] ?? patterns.typescript;

  lines.forEach((line, idx) => {
    for (const pattern of pats) {
      const match = line.match(pattern);
      if (match?.[1] && match[1].length > 1) {
        const type = line.includes("class ") ? "class" :
                     line.includes("export ") ? "export" : "function";
        defs.push({
          name: match[1],
          line: idx + 1,
          type,
        });
        break;
      }
    }
  });

  return defs;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /^import\s+.*\s+from\s+['"]([^'"]+)['"]/gm,
    /^const\s+\w+\s*=\s*require\(['"]([^'"]+)['"]\)/gm,
    /^from\s+([^\s]+)\s+import/gm,
    /^import\s+([^\s]+)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return [...new Set(imports)];
}

export async function buildRepoTree(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<RepoTree> {
  const octokit = new Octokit({ auth: token });

  console.log(`[tree-builder] Fetching tree for ${owner}/${repo}@${branch}`);

  const { data: treeData } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "1",
  });

  const codeFiles = treeData.tree.filter(item => {
    if (item.type !== "blob") return false;
    const parts = (item.path ?? "").split("/");
    if (parts.some(p => SKIP_PATHS.has(p))) return false;
    const ext = "." + (item.path ?? "").split(".").pop()?.toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  });

  console.log(`[tree-builder] Found ${codeFiles.length} code files`);

  const fileNodes: FileNode[] = [];

  // Process files in batches to avoid rate limiting
  const BATCH = 10;
  for (let i = 0; i < codeFiles.length; i += BATCH) {
    const batch = codeFiles.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: file.path!,
            ref: branch,
          });

          if (!("content" in data)) return null;
          const content = Buffer.from(data.content, "base64").toString("utf8");
          const language = detectLanguage(file.path!);
          const functions = extractFunctions(content, language);
          const imports = extractImports(content);

          // Create a brief summary of the file
          const summary = [
            `File: ${file.path}`,
            `Language: ${language}`,
            `Functions/Classes: ${functions.map(f => f.name).join(", ") || "none"}`,
            `Imports: ${imports.slice(0, 5).join(", ") || "none"}`,
            `First 200 chars: ${content.slice(0, 200).replace(/\n/g, " ")}`,
          ].join(" | ");

          return {
            path: file.path!,
            language,
            size: file.size ?? 0,
            functions,
            imports,
            summary,
          } as FileNode;
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        fileNodes.push(result.value);
      }
    }

    console.log(`[tree-builder] Processed ${Math.min(i + BATCH, codeFiles.length)}/${codeFiles.length} files`);
  }

  return {
    owner,
    repo,
    branch,
    indexedAt: new Date().toISOString(),
    files: fileNodes,
    totalFiles: fileNodes.length,
  };
}
