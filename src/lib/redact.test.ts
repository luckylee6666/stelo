import { describe, expect, it } from "vitest";
import { redactSecrets, redactWithReport } from "./redact";

describe("redactSecrets", () => {
  it("masks URL credentials", () => {
    expect(redactSecrets("curl https://alice:hunter2@example.com/api")).toBe(
      "curl https://alice:***@example.com/api",
    );
  });

  it("masks Authorization Bearer header", () => {
    expect(redactSecrets('curl -H "Authorization: Bearer abcdef0123456789xyz"')).toContain(
      "Bearer ***",
    );
  });

  it("masks bare Bearer token in -H value", () => {
    const out = redactSecrets("curl -H 'Authorization: Bearer abcdef0123456789'");
    expect(out).not.toContain("abcdef0123456789");
  });

  it("masks key=value password", () => {
    expect(redactSecrets("mysql --password=hunter2 db")).toContain("--password ***");
    expect(redactSecrets("foo password=hunter2 bar")).toBe("foo password=*** bar");
    expect(redactSecrets('PASSWORD="my secret"')).toBe("PASSWORD=***");
  });

  it("masks api_key / api-key / token forms", () => {
    expect(redactSecrets("api_key=abcd1234")).toBe("api_key=***");
    expect(redactSecrets("api-key=abcd1234")).toBe("api-key=***");
    expect(redactSecrets("token=abcd1234")).toBe("token=***");
  });

  it("masks --token flag", () => {
    expect(redactSecrets("gh --token ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain(
      "--token ***",
    );
  });

  it("masks mysql -p<password> attached form", () => {
    expect(redactSecrets("mysql -uroot -phunter2 mydb")).toContain("-p***");
  });

  it("masks AWS access key id (key=value form via aws_access_key_id rule)", () => {
    const out = redactSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("masks bare AWS access key id literal", () => {
    expect(redactSecrets("see AKIAIOSFODNN7EXAMPLE today")).toContain("AKIA***");
  });

  it("masks GitHub PAT", () => {
    expect(
      redactSecrets("export GH_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz"),
    ).toContain("gh*_***");
  });

  it("masks OpenAI / Anthropic style keys", () => {
    expect(redactSecrets("sk-abcdefghij1234567890XYZ")).toContain("sk-***");
    expect(redactSecrets("sk-ant-abcdefghij1234567890XYZ")).toContain("sk-***");
  });

  it("masks JWT (bare)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSecrets(`paste: ${jwt}`)).toContain("eyJ***");
    expect(redactSecrets(`paste: ${jwt}`)).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  });

  it("masks JWT in token: prefix form", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    // token: 前缀让"token"规则优先吃掉，结果是 token=*** —— 也是脱敏成功
    const out = redactSecrets(`token: ${jwt}`);
    expect(out).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  });

  it("leaves benign text untouched", () => {
    expect(redactSecrets("ls -la /tmp")).toBe("ls -la /tmp");
    expect(redactSecrets("git push origin main")).toBe("git push origin main");
  });

  it("handles empty input", () => {
    expect(redactSecrets("")).toBe("");
  });
});

describe("redactWithReport", () => {
  it("hits=0 on benign text", () => {
    const r = redactWithReport("ls -la /tmp && echo done");
    expect(r.hits).toBe(0);
    expect(r.text).toBe("ls -la /tmp && echo done");
  });

  it("counts at least one hit when secret matches", () => {
    const r = redactWithReport('curl -H "Authorization: Bearer abcdef0123456789xyz" https://x');
    expect(r.hits).toBeGreaterThanOrEqual(1);
    expect(r.text).not.toContain("abcdef0123456789xyz");
  });

  it("counts multiple distinct rule categories", () => {
    const r = redactWithReport(
      'export AWS_SECRET_ACCESS_KEY=abc; curl -H "Authorization: Bearer xyzxyzxyzxyzxyz"',
    );
    expect(r.hits).toBeGreaterThanOrEqual(2);
  });

  it("hits=0 on empty input", () => {
    const r = redactWithReport("");
    expect(r.hits).toBe(0);
  });
});
