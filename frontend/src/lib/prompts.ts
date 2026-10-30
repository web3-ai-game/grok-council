export type PromptPreset = {
  id: string;
  title: string;
  body: string;
};

export const PROMPT_PRESETS: PromptPreset[] = [
  { id: "brief", title: "简报", body: "用条目列出要点、风险与下一步，控制在 200 字内。" },
  { id: "review", title: "审稿", body: "当红队审这段内容：找漏洞、反例与含糊处。" },
  { id: "plan", title: "计划", body: "给出可执行步骤、依赖与验收标准。" },
  { id: "compare", title: "对比", body: "对比选项的取舍，指出分歧并给推荐。" },
];
