export interface ParseError {
  code: string;
  line: number;
  message: string;
}

export function mkErr(code: string, line: number, message: string): ParseError {
  return { code, line, message };
}
