/**
 * Parser for the .cms language. Phase 1 covers only what `ping` needs:
 * function declarations, set/if/iterate/return statements, calls with
 * positional + named args, qualifier blocks, var refs, dotted member
 * access, string/number/bool/null literals.
 *
 * No grammar generator — see HOW.md for why. The parser is two parts:
 *   skipNL()       — consume any pending NEWLINE tokens
 *   parseFile()    — top-level loop, picks `function` or skips other things
 */

import { Tok } from './lex.js';
import * as A from './ast.js';

export class ParseError extends Error {
  constructor(public file: string, public line: number, public col: number, msg: string) {
    super(`${file}:${line}:${col}: ${msg}`);
  }
}

export interface ParsedFile {
  funcs: A.Func[];
  resources: A.Resource[];
}

export function parse(toks: Tok[], file: string): ParsedFile {
  const p = new Parser(toks, file);
  return p.parseFile();
}

/**
 * Parse a free-standing expression — used by resolveTemplate to evaluate
 * a single `{{…}}` chunk. Toks should be the lex output of the chunk's
 * source, no surrounding `function` / `end-function`.
 */
export function parseExpression(toks: Tok[], file: string): A.Expr {
  const p = new Parser(toks, file);
  p.skipNL();
  const e = p.parseExprPublic();
  return e;
}

class Parser {
  i = 0;
  constructor(public toks: Tok[], public file: string) {}

  peek(off = 0): Tok { return this.toks[this.i + off]!; }
  eof() { return this.peek().kind === 'EOF'; }
  loc(): A.Loc { const t = this.peek(); return { file: this.file, line: t.line, col: t.col }; }

  err(msg: string): never {
    const t = this.peek();
    throw new ParseError(this.file, t.line, t.col, `${msg} (got ${t.kind} '${t.value}')`);
  }

  eat(kind: Tok['kind']): Tok {
    if (this.peek().kind !== kind) this.err(`expected ${kind}`);
    return this.toks[this.i++]!;
  }
  match(...kinds: Tok['kind'][]): boolean {
    if (kinds.includes(this.peek().kind)) { this.i++; return true; }
    return false;
  }
  skipNL() { while (this.peek().kind === 'NEWLINE') this.i++; }

  // Public wrapper for the standalone expression parser. Called by
  // parseExpression() above (for resolveTemplate's {{…}} chunks).
  parseExprPublic(): A.Expr { return this.parseExpr(); }

  // ─── Top level ─────────────────────────────────────────────
  parseFile(): ParsedFile {
    const funcs: A.Func[] = [];
    const resources: A.Resource[] = [];
    this.skipNL();
    while (!this.eof()) {
      if (this.peek().kind === 'KW_INHERITS') {
        // `inherits 'base'` — no-op for Phase 1
        this.i++;
        if (this.peek().kind === 'STR') this.i++;
        this.skipNL();
        continue;
      }
      if (this.peek().kind === 'KW_PROTECTED') { this.i++; this.skipNL(); }
      if (this.peek().kind === 'KW_FUNCTION') {
        funcs.push(this.parseFunction());
        this.skipNL();
        continue;
      }
      if (this.peek().kind === 'KW_RESOURCE') {
        resources.push(this.parseResource());
        this.skipNL();
        continue;
      }
      // Anything else at top level: skip the token to keep the parser
      // forward-progressing on unknown directives. Phase 10 adds a
      // strict validator.
      this.i++;
    }
    return { funcs, resources };
  }

  parseResource(): A.Resource {
    const loc = this.loc();
    this.eat('KW_RESOURCE');
    const name = this.eat('IDENT').value;
    this.skipNL();
    const body = this.parseExpr();
    this.skipNL();
    this.eat('KW_END_RESOURCE');
    return { kind: 'Resource', name, body, loc };
  }

  // ─── Function ──────────────────────────────────────────────
  parseFunction(): A.Func {
    const startLoc = this.loc();
    this.eat('KW_FUNCTION');
    const name = this.eat('IDENT').value;
    this.eat('LPAREN');
    const params: string[] = [];
    while (this.peek().kind !== 'RPAREN') {
      params.push(this.eat('IDENT').value);
      if (this.peek().kind === 'COMMA') this.i++;
    }
    this.eat('RPAREN');
    this.skipNL();
    const body = this.parseStmts(['KW_END_FUNCTION']);
    this.eat('KW_END_FUNCTION');
    return { kind: 'Func', name, params, body, loc: startLoc };
  }

  // ─── Statements ────────────────────────────────────────────
  parseStmts(terminators: Tok['kind'][]): A.Stmt[] {
    const out: A.Stmt[] = [];
    this.skipNL();
    while (!this.eof() && !terminators.includes(this.peek().kind) &&
           this.peek().kind !== 'KW_ELSE' && this.peek().kind !== 'KW_ELSE_IF') {
      out.push(this.parseStmt());
      this.skipNL();
    }
    return out;
  }

  parseStmt(): A.Stmt {
    const t = this.peek();
    switch (t.kind) {
      case 'KW_IF':       return this.parseIf();
      case 'KW_ITERATE':  return this.parseIterate();
      case 'KW_RETURN':   return this.parseReturn();
      case 'KW_RAISE':    return this.parseRaise();
      default: {
        // `set('name', expr)` is just a Call expression statement; we
        // recognise it generically (no special-casing).
        const expr = this.parseExpr();
        // Synthesise a Set node when the expression is `set(...)` so the
        // interpreter can branch cheaply.
        if (expr.kind === 'Call' && expr.callee.kind === 'Ident' && expr.callee.name === 'set'
            && expr.args.length === 2 && expr.args[0]!.kind === 'StrLit') {
          return { kind: 'Set', name: (expr.args[0] as A.StrLit).value, value: expr.args[1]!, loc: expr.loc };
        }
        return { kind: 'ExprStmt', expr, loc: expr.loc };
      }
    }
  }

  parseIf(): A.If {
    const loc = this.loc();
    this.eat('KW_IF');
    const cond = this.parseExpr();
    this.skipNL();
    const then = this.parseStmts(['KW_END_IF']);
    const elseIfs: { cond: A.Expr; body: A.Stmt[] }[] = [];
    let else_: A.Stmt[] | null = null;
    while (this.peek().kind === 'KW_ELSE_IF') {
      this.i++;
      const c = this.parseExpr();
      this.skipNL();
      const b = this.parseStmts(['KW_END_IF']);
      elseIfs.push({ cond: c, body: b });
    }
    if (this.peek().kind === 'KW_ELSE') {
      this.i++;
      this.skipNL();
      else_ = this.parseStmts(['KW_END_IF']);
    }
    this.eat('KW_END_IF');
    return { kind: 'If', cond, then, elseIfs, else_, loc };
  }

  parseIterate(): A.Iterate {
    const loc = this.loc();
    this.eat('KW_ITERATE');
    const source = this.parseExpr();
    this.skipNL();
    const body = this.parseStmts(['KW_END_ITERATE']);
    this.eat('KW_END_ITERATE');
    return { kind: 'Iterate', source, body, loc };
  }

  parseReturn(): A.Return {
    const loc = this.loc();
    this.eat('KW_RETURN');
    if (this.peek().kind === 'NEWLINE' || this.peek().kind === 'EOF' ||
        this.peek().kind === 'KW_END_FUNCTION') {
      return { kind: 'Return', value: null, loc };
    }
    const value = this.parseExpr();
    return { kind: 'Return', value, loc };
  }

  parseRaise(): A.Raise {
    const loc = this.loc();
    this.eat('KW_RAISE');
    const exType = this.parseExpr();
    this.eat('COMMA');
    const message = this.parseExpr();
    return { kind: 'Raise', exType, message, loc };
  }

  // ─── Expressions ───────────────────────────────────────────
  parseExpr(): A.Expr {
    return this.parsePrimary();
  }

  parsePrimary(): A.Expr {
    const t = this.peek();
    let head: A.Expr;
    switch (t.kind) {
      case 'STR':       this.i++; head = { kind: 'StrLit', value: t.value, template: false, loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'TBSTR':     this.i++; head = { kind: 'StrLit', value: t.value, template: true,  loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'NUM':       this.i++; head = { kind: 'NumLit', value: parseFloat(t.value), loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_TRUE':   this.i++; head = { kind: 'BoolLit', value: true,  loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_FALSE':  this.i++; head = { kind: 'BoolLit', value: false, loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_NULL':   this.i++; head = { kind: 'NullLit', loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'LBRACK': {
        this.i++;
        const name = this.eat('IDENT').value;
        // Allow `[//route.script]` style nested paths — collect into one name.
        let n = name;
        while (this.peek().kind === 'DOT' || this.peek().kind === 'IDENT' || this.peek().value === '/') {
          if (this.peek().kind === 'DOT') { this.i++; n += '.' + this.eat('IDENT').value; }
          else break;
        }
        this.eat('RBRACK');
        head = { kind: 'VarRef', name: n, loc: { file: this.file, line: t.line, col: t.col } };
        break;
      }
      case 'LANGAT':    this.i++; head = this.parseQualifier(); break;
      case 'LANG':      head = this.parsePbLiteral(); break;
      case 'IDENT':     head = this.parseIdentOrCall(); break;
      // `if(cond, then, else)` is also valid as an *expression* in CMS;
      // treat the keyword as a plain identifier when used in expression
      // position. The statement form is handled higher up via parseIf().
      case 'KW_IF': {
        this.i++;
        head = { kind: 'Ident', name: 'if', loc: { file: this.file, line: t.line, col: t.col } };
        break;
      }
      case 'LPAREN': {
        this.i++;
        const e = this.parseExpr();
        this.eat('RPAREN');
        head = e;
        break;
      }
      default:
        this.err(`unexpected expression start`);
    }
    // postfix: dotted member access + call
    while (true) {
      if (this.peek().kind === 'DOT') {
        const dotLoc = this.loc();
        this.i++;
        const member = this.eat('IDENT').value;
        head = { kind: 'MemberAcc', object: head, member, loc: dotLoc };
        continue;
      }
      if (this.peek().kind === 'LPAREN') {
        const cLoc = this.loc();
        this.i++;
        const args: A.Expr[] = [];
        this.skipNL();
        while (this.peek().kind !== 'RPAREN') {
          // Named arg: `name: value`
          if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'COLON') {
            const nLoc = this.loc();
            const name = this.eat('IDENT').value;
            this.eat('COLON');
            const value = this.parseExpr();
            args.push({ kind: 'NamedArg', name, value, loc: nLoc });
          } else {
            args.push(this.parseExpr());
          }
          this.skipNL();
          if (this.peek().kind === 'COMMA') { this.i++; this.skipNL(); }
        }
        this.eat('RPAREN');
        head = { kind: 'Call', callee: head, args, loc: cLoc };
        continue;
      }
      break;
    }
    return head;
  }

  parseIdentOrCall(): A.Expr {
    const t = this.eat('IDENT');
    return { kind: 'Ident', name: t.value, loc: { file: this.file, line: t.line, col: t.col } };
  }

  parseQualifier(): A.Qualifier {
    const loc = this.loc();
    // `<@page/container content: …>` — already consumed `<@`
    const path: string[] = [this.eat('IDENT').value];
    while (this.peek().kind === 'SLASH') {
      this.i++;
      path.push(this.eat('IDENT').value);
    }
    const props: Record<string, A.Expr> = {};
    let positional = 0;
    while (this.peek().kind !== 'RANG' && this.peek().kind !== 'EOF') {
      this.skipNL();
      if (this.peek().kind === 'RANG') break;
      // Named arg vs positional — `<@page/html "literal">` is positional.
      if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'COLON') {
        const name = this.eat('IDENT').value;
        this.eat('COLON');
        props[name] = this.parseExpr();
      } else {
        props[String(positional++)] = this.parseExpr();
      }
      if (this.peek().kind === 'COMMA') this.i++;
      this.skipNL();
    }
    this.eat('RANG');
    return { kind: 'Qualifier', path, props, loc };
  }

  parsePbLiteral(): A.Expr {
    // `< … >` literal. In .cms this is used both for property bags and
    // for typed-list arguments to `entities:`. We capture the inner
    // expressions as a synthetic qualifier `_list`, with positional
    // children stored under numeric keys ("0", "1", …). The interpreter
    // turns `_list` qualifiers into JS arrays.
    const loc = this.loc();
    this.eat('LANG');
    const props: Record<string, A.Expr> = {};
    let n = 0;
    while (this.peek().kind !== 'RANG' && this.peek().kind !== 'EOF') {
      this.skipNL();
      if (this.peek().kind === 'RANG') break;
      // `key: value` (named PB entry) or just `value` (positional list entry)
      if (this.peek().kind === 'IDENT' && this.peek(1).kind === 'COLON') {
        const name = this.eat('IDENT').value;
        this.eat('COLON');
        props[name] = this.parseExpr();
      } else {
        props[String(n++)] = this.parseExpr();
      }
      if (this.peek().kind === 'COMMA') this.i++;
      this.skipNL();
    }
    this.eat('RANG');
    return { kind: 'Qualifier', path: ['_list'], props, loc };
  }
}
