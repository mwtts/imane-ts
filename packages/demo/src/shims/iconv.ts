// iconv-lite の代替。ブラウザの TextDecoder で Shift_JIS と UTF-16 を読む(UTF-32 には対応しない)

export default {
  decode(buf: Uint8Array, encoding: string): string {
    return new TextDecoder(encoding).decode(buf);
  },
};
