import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRawEngine } from "shiki/engine/javascript";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import typescript from "@shikijs/langs-precompiled/typescript";
import tsx from "@shikijs/langs-precompiled/tsx";
import json from "@shikijs/langs-precompiled/json";
import bash from "@shikijs/langs-precompiled/bash";
import python from "@shikijs/langs-precompiled/python";
import javascript from "@shikijs/langs-precompiled/javascript";
import css from "@shikijs/langs-precompiled/css";
import html from "@shikijs/langs-precompiled/html";
import diff from "@shikijs/langs-precompiled/diff";
export function create() {
  return createHighlighterCore({
    engine: createJavaScriptRawEngine(),
    themes: [githubLight, githubDark],
    langs: [typescript, tsx, json, bash, python, javascript, css, html, diff],
  });
}
