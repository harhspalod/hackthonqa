import * as assert from "assert";
import * as vscode from "vscode";

suite("AutoPM Extension Test Suite", () => {
  test("registers expected commands", async () => {
    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("autopm.reviewFile"));
    assert.ok(commands.includes("autopm.reviewSelection"));
    assert.ok(commands.includes("autopm.generateFix"));
    assert.ok(commands.includes("autopm.pushToGitHub"));
    assert.ok(commands.includes("autopm.runPipeline"));
  });
});
