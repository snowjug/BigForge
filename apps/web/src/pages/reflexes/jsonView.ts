/** A tiny JSON tokenizer for the read-only spec viewer: colours keys, strings, numbers and literals. */

export type JsonTokenType = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space';

export interface JsonToken {
  text: string;
  type: JsonTokenType;
}

const VALUE = /^(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/** Splits pretty-printed JSON (`JSON.stringify(x, null, 2)`) into lines of tokens. */
export function tokenizeJson(text: string): JsonToken[][] {
  return text.split('\n').map((line) => {
    const tokens: JsonToken[] = [];
    let rest = line;
    const indent = /^\s+/.exec(rest);
    if (indent) {
      tokens.push({ text: indent[0], type: 'space' });
      rest = rest.slice(indent[0].length);
    }
    const key = /^("(?:[^"\\]|\\.)*")(\s*:\s*)/.exec(rest);
    if (key) {
      tokens.push(
        { text: key[1] as string, type: 'key' },
        { text: key[2] as string, type: 'punct' },
      );
      rest = rest.slice(key[0].length);
    }
    while (rest.length > 0) {
      const value = VALUE.exec(rest);
      if (value) {
        const t = value[0];
        const type: JsonTokenType = t.startsWith('"')
          ? 'string'
          : /^(?:true|false|null)$/.test(t)
            ? 'literal'
            : 'number';
        tokens.push({ text: t, type });
        rest = rest.slice(t.length);
        continue;
      }
      const punct = /^[\s,[\]{}:]+/.exec(rest);
      const chunk = punct ? punct[0] : (rest[0] as string);
      tokens.push({ text: chunk, type: 'punct' });
      rest = rest.slice(chunk.length);
    }
    return tokens;
  });
}
