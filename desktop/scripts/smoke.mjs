#!/usr/bin/env node
// Starts the packaged app and checks it actually comes up.
//
// Packaging is the step that can succeed and still ship something broken, and
// the ways it breaks are all invisible to a build log: the bundle inside the
// package is stale, the module worker refuses to start because the scheme is
// not what it needs, the wasm module is served with the wrong type. None of
// those produce an error at build time - they produce a window that opens and
// then does nothing.
//
// So this drives the packaged binary through the DevTools protocol and asks it
// four questions: is it where it should be, can the page reach Node (it must
// not), is the shell there, and - the real one - does a calculation come back.
// That last one is the whole chain: worker started, wasm compiled, results
// rendered.
//
// Plain Node, no dependencies: `WebSocket` and `fetch` are globals from Node
// 22 on, and a smoke test that needed its own dependency tree would be one
// more thing between a build and the answer.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RELEASE = path.resolve(HERE, "..", "release");
const PORT = Number(process.env.SMOKE_PORT ?? 9455);
const TIMEOUT_MS = 90_000;

/**
 * The unpacked application, whatever electron-builder decided to call it.
 *
 * Guessing the name is what broke this the first time it ran on Linux: the
 * executable there is named after the package, not after the product, and the
 * two differ. So the names come out of package.json, and if none of them is
 * found the error says what WAS there - one failed run should be enough to fix
 * it, not two.
 */
function findExecutable() {
  if (!existsSync(RELEASE)) {
    throw new Error(`nothing under ${RELEASE} - run electron-builder before this`);
  }

  const manifest = JSON.parse(readFileSync(path.resolve(HERE, "..", "package.json"), "utf8"));
  const product = manifest.build?.productName ?? manifest.name;
  const names = new Set(
    [product, product.toLowerCase(), manifest.name, manifest.build?.executableName]
      .filter(Boolean)
      .flatMap((name) => [name, `${name}.exe`]),
  );

  const found = [];
  for (const entry of readdirSync(RELEASE)) {
    const directory = path.join(RELEASE, entry);
    if (!statSync(directory).isDirectory()) continue;

    // Windows and Linux: the executable sits at the top of the unpacked tree.
    if (entry.includes("unpacked")) {
      for (const file of readdirSync(directory)) {
        if (names.has(file)) found.push(path.join(directory, file));
      }
    }

    // macOS: inside a bundle, in a directory whose name carries the
    // architecture, so it is looked up rather than spelled out.
    if (entry.startsWith("mac")) {
      for (const bundle of readdirSync(directory)) {
        if (!bundle.endsWith(".app")) continue;
        const macos = path.join(directory, bundle, "Contents", "MacOS");
        if (!existsSync(macos)) continue;
        for (const file of readdirSync(macos)) found.push(path.join(macos, file));
      }
    }
  }

  const executable = found.find((file) => statSync(file).isFile());
  if (!executable) {
    const listing = readdirSync(RELEASE).join(", ") || "(empty)";
    throw new Error(
      `no application named any of [${[...names].join(", ")}] under ${RELEASE}
` +
        `what is there: ${listing}`,
    );
  }
  return executable;
}

async function pageTarget(deadline, child) {
  while (Date.now() < deadline) {
    // The app takes a single-instance lock, so a copy that is already running
    // makes this one quit before it opens a port. Saying that is worth more
    // than ninety seconds of waiting followed by "never exposed a page".
    if (child.exitCode !== null) {
      throw new Error(
        `the application exited immediately (code ${child.exitCode}) - another copy is probably already running`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // The app has not opened the port yet; that is the normal first second.
    }
    await sleep(250);
  }
  throw new Error("the application never exposed a page to talk to");
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

/**
 * Evaluates in the page.
 *
 * The expression is wrapped as `return (\n...\n)`: a bare return followed by a
 * newline becomes `return;` through automatic semicolon insertion, which would
 * make every check here quietly pass on `undefined`.
 */
async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {\nreturn (\n${expression}\n);\n})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return result.result.value;
}

async function waitFor(session, expression, deadline, what) {
  while (Date.now() < deadline) {
    if (await evaluate(session, expression)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checks = [];
function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const executable = findExecutable();
  console.log(`smoke test: ${executable}`);

  // A build machine may need to be told to do without a GPU or a sandbox; the
  // application itself has no opinion about either.
  const extra = (process.env.SMOKE_EXTRA_ARGS ?? "").split(/[ 	]+/).filter(Boolean);
  const child = spawn(executable, [`--remote-debugging-port=${PORT}`, ...extra], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", (error) => {
    console.error(`could not start it: ${error.message}`);
    process.exit(1);
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let session = null;
  try {
    const target = await pageTarget(deadline, child);
    session = connect(target.webSocketDebuggerUrl);
    await session.ready;
    await session.send("Runtime.enable");
    await session.send("Page.enable");

    const origin = await evaluate(session, "location.origin");
    check("served over the app scheme", origin === "app://elamx", origin);
    check(
      "the page cannot reach Node",
      await evaluate(session, "typeof require === 'undefined' && typeof process === 'undefined'"),
    );
    check("the shell is exposed", await evaluate(session, "!!window.elamxDesktop"));
    // Not a failure: a build machine without a GPU falls back to the 2D view,
    // which is what that fallback is for. Worth reporting all the same.
    console.log(
      `note  WebGL2: ${await evaluate(session, "!!document.createElement('canvas').getContext('webgl2')")}`,
    );

    // The real check. Reaching a legend means the worker started, the wasm
    // module compiled and a plate was solved - the whole chain the packaging
    // could have broken without saying so.
    //
    // Whichever laminate the app has, not a name written down here: the app
    // remembers the last project it opened, so a fixed id would be testing a
    // laminate that may no longer exist and reporting it as a broken build.
    await waitFor(
      session,
      "document.querySelector('a[href^=\"#/laminates/\"]') !== null",
      deadline,
      "the application to mount",
    );
    const route = await evaluate(
      session,
      "document.querySelector('a[href^=\"#/laminates/\"]').getAttribute('href') + '/modules/deformation'",
    );
    await evaluate(session, `location.hash = ${JSON.stringify(route.slice(1))}`);
    await waitFor(
      session,
      "document.querySelector('.plate3d-legend') !== null",
      deadline,
      "a plate calculation to come back",
    );
    check(
      "a calculation came back",
      true,
      await evaluate(session, "document.querySelector('.plate3d-legend-title').textContent"),
    );
  } finally {
    // Both unconditionally: an open socket keeps Node alive, so a failed check
    // would hang instead of reporting.
    session?.close();
    child.kill();
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    if (stderr.trim()) console.error(`\napplication stderr:\n${stderr.trim()}`);
    console.error(`\n${failed.length} of ${checks.length} checks failed`);
    process.exit(1);
  }
  console.log(`\nall ${checks.length} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
