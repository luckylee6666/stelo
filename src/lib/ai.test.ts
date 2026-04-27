import { describe, it, expect, beforeEach } from "vitest";
import { extractCodeBlocks, buildContextSystem } from "./ai";
import { useSessionStore } from "../stores/sessions";

describe("extractCodeBlocks", () => {
  it("extracts a single bash block", () => {
    const md = "要列目录：\n```bash\nls -la\n```\n完毕";
    const blocks = extractCodeBlocks(md);
    expect(blocks).toEqual([{ lang: "bash", code: "ls -la" }]);
  });

  it("extracts multiple blocks with different langs", () => {
    const md = "```bash\necho 1\n```\n中间\n```sh\necho 2\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0].lang).toBe("bash");
    expect(blocks[1].lang).toBe("sh");
  });

  it("handles blocks without language tag", () => {
    const md = "```\nraw\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks[0].lang).toBe("");
    expect(blocks[0].code).toBe("raw");
  });

  it("returns empty array when no code block", () => {
    expect(extractCodeBlocks("纯文本没有代码")).toEqual([]);
  });

  it("trims leading/trailing whitespace from code", () => {
    const md = "```bash\n\n  echo hi\n  \n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks[0].code).toBe("echo hi");
  });

  it("handles multiline code", () => {
    const md = "```bash\nset -e\nls\necho done\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks[0].code).toBe("set -e\nls\necho done");
  });
});

describe("buildContextSystem", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activeId: null });
  });

  it("returns base prompt when no active session", () => {
    const s = buildContextSystem(false);
    expect(s).toMatch(/运维助手/);
    expect(s).not.toMatch(/目标主机/);
  });

  it("adds Agent-mode addendum when agentMode=true", () => {
    const s = buildContextSystem(true);
    expect(s).toMatch(/Agent 模式/);
    expect(s).toMatch(/rm -rf/);
  });

  it("injects host/user/port when an ssh session is active", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "a",
          kind: "ssh",
          name: "n",
          host: "example.com",
          port: 2222,
          user: "root",
          status: "connected",
          backendId: "b1",
          cwd: "/var/log",
        },
      ],
      activeId: "a",
    });
    const s = buildContextSystem(false);
    expect(s).toMatch(/root@example\.com:2222/);
    expect(s).toMatch(/\/var\/log/);
    expect(s).toMatch(/已连接/);
  });

  it("omits host info for local sessions", () => {
    useSessionStore.setState({
      sessions: [{ id: "l", kind: "local", name: "local", status: "connected" }],
      activeId: "l",
    });
    const s = buildContextSystem(false);
    expect(s).not.toMatch(/目标主机/);
  });
});
