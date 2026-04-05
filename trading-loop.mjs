#!/usr/bin/env node
import { spawn } from "child_process";

const args = process.argv.slice(2);
const child = spawn(process.execPath, ["src/cli.mjs", "run", ...args], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
