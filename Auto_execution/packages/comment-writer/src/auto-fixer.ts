import { config } from "dotenv";
config();
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

export async function autoFixAndPush(
  event: any,
  findings: any[]
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !event.repo || !event.pullRequest) {
    console.log("[auto-fixer] No token or PR info — skipping");
    return;
  }

  const octokit = new Octokit({ auth: token });
  const { owner, name } = event.repo;
  const { headSha, headBranch } = event.pullRequest;

  // Group findings by file
  const byFile = new Map<string, any[]>();
  for (const f of findings) {
    if (!f.file) continue;
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  console.log(`[auto-fixer] Fixing ${byFile.size} files...`);

  for (const [filePath, fileFindings] of byFile) {
    try {
      // Get current file content
      const { data } = await octokit.repos.getContent({
        owner,
        repo: name,
        path: filePath,
        ref: headSha,
      });

      if (!("content" in data)) continue;

      const originalContent = Buffer.from(data.content, "base64").toString("utf8");
      const fileSha = data.sha;

      // Ask Groq to fix all issues in the file
      const issuesList = fileFindings
        .map((f, i) => `${i + 1}. [${f.severity}] Line ${f.line}: ${f.title} — ${f.suggestion}`)
        .join("\n");

      console.log(`[auto-fixer] Fixing ${filePath} — ${fileFindings.length} issues`);

      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `Fix ALL the following security issues in this code. Return ONLY the complete fixed file content, no explanation, no markdown fences.

Issues to fix:
${issuesList}

Original code:
\`\`\`
${originalContent}
\`\`\`

Return ONLY the fixed code:`,
          },
        ],
        max_tokens: 2048,
      });

      let fixedContent = response.choices[0]?.message?.content ?? "";
      fixedContent = fixedContent
        .replace(/^```[\w]*\n?/i, "")
        .replace(/```\s*$/, "")
        .trim();

      if (!fixedContent || fixedContent === originalContent) {
        console.log(`[auto-fixer] No changes for ${filePath}`);
        continue;
      }

      // Push the fix directly to the PR branch
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo: name,
        path: filePath,
        message: `fix: auto-fix security issues in ${filePath} [autopm]`,
        content: Buffer.from(fixedContent).toString("base64"),
        sha: fileSha,
        branch: headBranch,
      });

      console.log(`[auto-fixer] Pushed fix for ${filePath}`);

    } catch (err: any) {
      console.error(`[auto-fixer] Failed to fix ${filePath}:`, err.message);
    }
  }

  console.log("[auto-fixer] Done pushing fixes");
}
