export type Attachment = {
  localPath: string;
  name: string;
  kind: "file" | "dir";
  status: "pending" | "uploading" | "done" | "error";
  remotePath?: string;
  error?: string;
};

export type Turn = {
  role: "user" | "assistant" | "exec";
  content: string;
  command?: string;
};

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string };
