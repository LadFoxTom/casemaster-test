/**
 * AST node types for the .cms language. Phase 1 covers only what the
 * `ping` function needs: `function`, `set`, `if`, `iterate iterator.ofEntity`,
 * a handful of expressions, and `response.*` calls. Each node carries a
 * `loc` so error messages can point back to the original .cms file.
 */

export interface Loc {
  file: string;
  line: number;
  col: number;
}

export type Node = Func | Resource | Stmt | Expr;

// ─── Top-level ─────────────────────────────────────────────────────
export interface Func {
  kind: 'Func';
  name: string;
  params: string[];
  body: Stmt[];
  loc: Loc;
}

export interface Resource {
  kind: 'Resource';
  name: string;
  // The resource body is a single expression — usually a `<@page/...>`
  // qualifier — that's evaluated lazily on `page.get('./name')`.
  body: Expr;
  loc: Loc;
}

// ─── Statements ────────────────────────────────────────────────────
export type Stmt =
  | Set
  | If
  | Iterate
  | Return
  | Raise
  | ExprStmt;

export interface Set {
  kind: 'Set';
  name: string;
  value: Expr;
  loc: Loc;
}

export interface If {
  kind: 'If';
  cond: Expr;
  then: Stmt[];
  elseIfs: { cond: Expr; body: Stmt[] }[];
  else_: Stmt[] | null;
  loc: Loc;
}

export interface Iterate {
  kind: 'Iterate';
  // The iterator expression — typically `iterator.ofEntity(<@iterator/entity name:'x',entity:'…',where:'…',orderBy:'…'>)`
  source: Expr;
  body: Stmt[];
  loc: Loc;
}

export interface Return {
  kind: 'Return';
  value: Expr | null;
  loc: Loc;
}

export interface Raise {
  kind: 'Raise';
  exType: Expr; // exceptionType.fatal etc.
  message: Expr;
  loc: Loc;
}

export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
  loc: Loc;
}

// ─── Expressions ───────────────────────────────────────────────────
export type Expr =
  | StrLit
  | NumLit
  | BoolLit
  | NullLit
  | VarRef     // [name]
  | Ident      // bare identifier (e.g. function name token)
  | MemberAcc  // a.b   used as the head of a call
  | Call       // foo(args) or a.b(args)
  | Qualifier  // <@page/container content: …>
  | NamedArg;  // `name: value` inside a call

export interface StrLit {
  kind: 'StrLit';
  value: string;
  // True for backticked template literals (multi-line, may contain expressions)
  template: boolean;
  loc: Loc;
}
export interface NumLit  { kind: 'NumLit';  value: number;  loc: Loc; }
export interface BoolLit { kind: 'BoolLit'; value: boolean; loc: Loc; }
export interface NullLit { kind: 'NullLit'; loc: Loc; }

export interface VarRef  { kind: 'VarRef';  name: string;   loc: Loc; }
export interface Ident   { kind: 'Ident';   name: string;   loc: Loc; }

export interface MemberAcc {
  kind: 'MemberAcc';
  object: Expr;
  member: string;
  loc: Loc;
}

export interface Call {
  kind: 'Call';
  callee: Expr;            // Ident, MemberAcc, or Qualifier
  args: Expr[];
  loc: Loc;
}

export interface Qualifier {
  kind: 'Qualifier';
  // `<@page/container content: …>`  → path = ['page','container'], props = {content: …}
  path: string[];
  props: Record<string, Expr>;
  loc: Loc;
}

export interface NamedArg {
  kind: 'NamedArg';
  name: string;
  value: Expr;
  loc: Loc;
}
