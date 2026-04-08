import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      version: "1.85.0",
      launchArgs: ["--disable-extensions"],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to run extension tests:", err);
    process.exit(1);
  }
}

void main();
