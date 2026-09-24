// The one place that loads Dafny's generated JavaScript (SPEC §5.5).
// src/ast.ts converts core program JSON into Dafny values, src/lint.ts and
// src/interp.ts drive the compiled core, and everything else sees plain JS.
//
// Compiled Dafny checks nothing at run time: not preconditions, not nat,
// int, bool or char. So the adapters check them: anything they can't
// represent exactly is an error (Unsupported), never a silent rewrite.

// Static imports, so a single-file bundle can inline them (SPEC §5.5).
import BigNumberLib from "bignumber.js";
import core from "../core/generated/core.cjs";

// Dafny's output has no types, so it's `any` here and in the adapters.
export const gen: any = core;
export const BigNumber: any = BigNumberLib;
export const { _dafny } = gen;

/** Input the core can't represent exactly. */
export class Unsupported extends Error {}
