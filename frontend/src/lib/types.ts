export type TextPricing = {
  input_per_mtok: number[];
  cached_input_per_mtok: number[];
  output_per_mtok: number[];
};

export type ImaginePricing = {
  usd: number;
};

export type TextModel = {
  id: string;
  kind: "text";
  available: boolean;
  context_window: number;
  pricing: TextPricing;
  capabilities: string[];
};

export type ImagineModel = {
  id: string;
  kind: "imagine";
  available: boolean;
  unit: "image" | "second";
  pricing: ImaginePricing;
  capabilities: string[];
};

export type Model = TextModel | ImagineModel;

export type ModelsResponse = {
  default_model: string;
  models: Model[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retry_after?: number;
  };
};

export type User = {
  id: string;
  username: string;
  created_at?: string;
};

export type Chat = {
  id: string;
  title: string;
  mode: string;
  model: string;
  pinned: boolean;
  temporary: boolean;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
};

export type UploadedFile = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  project_id?: string | null;
  created_at: string;
  url: string;
};

export type Generation = {
  id: string;
  kind: "image" | "video";
  prompt: string;
  model: string;
  mime: string | null;
  cost_usd: number;
  created_at: string;
  url: string;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_summary: string | null;
  model: string | null;
  mode: string | null;
  parent_id: string | null;
  created_at: string;
};

export type ChatMode = "auto" | "fast" | "expert" | "heavy";

export type UsageEvent = {
  prompt: number;
  completion: number;
  reasoning: number;
  cost_usd: number;
};

export type Citation = {
  url: string;
  title: string;
  source_type?: string;
};

export type CouncilExpertView = {
  id: string;
  name: string;
  content: string;
  reasoning: string;
  review?: string;
  reviewTarget?: string;
  challengedBy?: string;
  critiquing?: boolean;
  status: "pending" | "running" | "done" | "error" | "standby";
  error?: string;
  tools: string[];
  emoji?: string;
};

export type CouncilView = {
  message_id: string;
  engine: "council" | "native";
  gating: boolean;
  synthesizing?: boolean;
  note?: string;
  experts: CouncilExpertView[];
  citations: Citation[];
};

export type HeavyEngine = "council" | "native";

export type MemoryItem = {
  id: string;
  content: string;
  source_chat_id: string | null;
  pinned: boolean;
  created_at: string;
};

export type TaskItem = {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  mode: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export type TaskRun = {
  id: string;
  task_id: string;
  status: string;
  output: string | null;
  created_at: string;
};
