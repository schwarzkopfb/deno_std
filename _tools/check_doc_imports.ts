// Copyright 2022-2022 the Deno authors. All rights reserved. MIT license.

import { blue, red, yellow } from "../fmt/colors.ts";
import { toFileUrl } from "../path/mod.ts";
import { walk } from "../fs/walk.ts";
import { doc } from "https://deno.land/x/deno_doc@0.47.0/mod.ts";
import {
  createSourceFile,
  ImportDeclaration,
  ScriptTarget,
  StringLiteral,
  SyntaxKind,
} from "https://esm.sh/typescript";

const EXTENSIONS = [".mjs", ".js", ".ts", ".md"];
const EXCLUDED_PATHS = [
  ".git",
  ".github",
  "_tools",
  "node",
];

const ROOT = new URL("../", import.meta.url);
const ROOT_LENGTH = ROOT.pathname.slice(0, -1).length;
const FAIL_FAST = Deno.args.includes("--fail-fast");
const TEST_MODE = Deno.args.includes("--test-mode");
const RX_CODE_BLOCK = /`{3}([\w]*)\n([\S\s]+?)\n`{3}/gm;

const root = TEST_MODE ? new URL("./_tools/testdata", ROOT) : ROOT;

let shouldFail = false;
let countChecked = 0;

function checkImportStatements(
  codeBlock: string,
  filePath: string,
  lineNumber: number,
): void {
  const sourceFile = createSourceFile(
    "doc-import-checker$",
    codeBlock,
    ScriptTarget.Latest,
    true,
  );
  const importDeclarations = sourceFile.statements.filter((s) =>
    s.kind === SyntaxKind.ImportDeclaration
  ) as ImportDeclaration[];

  for (const importDeclaration of importDeclarations) {
    const { moduleSpecifier } = importDeclaration;
    const importPath = (moduleSpecifier as StringLiteral).text;
    const isRelative = importPath.startsWith(".");
    const isInternal = importPath.startsWith(
      "https://deno.land/std@$STD_VERSION/",
    );
    const line = lineNumber +
      sourceFile.getLineAndCharacterOfPosition(moduleSpecifier.pos).line;

    if (isRelative || !isInternal) {
      console.log(
        yellow("Warn ") +
          (isRelative
            ? "relative import path"
            : "external or incorrectly versioned dependency") +
          ": " +
          red(`"${importPath}"`) + " at " +
          blue(
            filePath.substring(ROOT_LENGTH + 1),
          ) + yellow(":" + line),
      );

      if (FAIL_FAST) {
        Deno.exit(1);
      }
      shouldFail = true;
    }
  }
}

for await (
  const { path } of walk(root, {
    exts: EXTENSIONS,
    includeDirs: false,
    skip: EXCLUDED_PATHS.map((p) => new RegExp(`(${p})$`)),
  })
) {
  countChecked++;

  if (path.endsWith(".md")) {
    const content = await Deno.readTextFile(path);

    for (const codeBlockMatch of content.matchAll(RX_CODE_BLOCK)) {
      const [, , codeBlock] = codeBlockMatch;
      const codeBlockLineNumber =
        content.slice(0, codeBlockMatch.index).split("\n").length + 1;

      checkImportStatements(
        codeBlock,
        path,
        codeBlockLineNumber,
      );
    }
  } else {
    for (const { location: { line }, jsDoc } of await doc(toFileUrl(path).href, { includeAll: true })) { 
      const doc = jsDoc?.doc;

      if (!doc) {
        continue;
      }

      for (const codeBlockMatch of doc.matchAll(RX_CODE_BLOCK)) {
        const [, , codeBlock] = codeBlockMatch;
        const codeBlockLineNumber =
          doc.slice(0, codeBlockMatch.index).split("\n").length + 1;

        checkImportStatements(
          codeBlock,
          path,
          line + codeBlockLineNumber,
        );
      }
    }
  }
}

console.log(`Checked ${countChecked} files`);
if (shouldFail) Deno.exit(1);
