import { describe, it, expect } from "vitest";
import { stripAnsi, OSC7_REGEX } from "./agent";

describe("stripAnsi", () => {
  it("removes plain CSI color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("removes nested CSI codes with semicolons", () => {
    expect(stripAnsi("\x1b[1;32;40mbold green on black\x1b[0m")).toBe(
      "bold green on black",
    );
  });

  it("removes ?25l / ?25h cursor toggles", () => {
    expect(stripAnsi("hi\x1b[?25lhidden\x1b[?25h")).toBe("hihidden");
  });

  it("removes OSC 7 cwd sequence (BEL terminator)", () => {
    const raw = "\x1b]7;file://host/home/lucky\x07$ ls";
    expect(stripAnsi(raw)).toBe("$ ls");
  });

  it("removes OSC 7 cwd sequence (ST terminator)", () => {
    const raw = "\x1b]7;file://host/tmp\x1b\\done";
    expect(stripAnsi(raw)).toBe("done");
  });

  it("removes generic OSC sequences besides OSC 7", () => {
    const raw = "\x1b]0;title\x07body";
    expect(stripAnsi(raw)).toBe("body");
  });

  it("strips \\r carriage return", () => {
    expect(stripAnsi("a\r\nb")).toBe("a\nb");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("OSC7_REGEX", () => {
  it("matches BEL-terminated OSC 7", () => {
    expect(OSC7_REGEX.test("\x1b]7;file://host/path\x07")).toBe(true);
  });

  it("matches ST-terminated OSC 7", () => {
    expect(OSC7_REGEX.test("\x1b]7;file://host/path\x1b\\")).toBe(true);
  });

  it("does not match other OSC codes", () => {
    expect(OSC7_REGEX.test("\x1b]0;window title\x07")).toBe(false);
  });

  it("does not match plain text", () => {
    expect(OSC7_REGEX.test("$ cd /tmp")).toBe(false);
  });

  it("matches when embedded in larger buffer", () => {
    const buf =
      "output line\n\x1b]7;file://host/home\x07user@host:~$ ";
    expect(OSC7_REGEX.test(buf)).toBe(true);
  });
});
