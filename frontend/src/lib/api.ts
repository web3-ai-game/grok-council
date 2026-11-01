import type {
  ApiErrorBody,
  Chat,
  ChatMessage,
  Generation,
  MemoryItem,
  ModelsResponse,
  Project,
  TaskItem,
  TaskRun,
  UploadedFile,
  User,
} from "./types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body as ApiErrorBody | null;
    const error = new Error(err?.error?.message ?? `HTTP ${response.status}`);
    (error as Error & { code?: string; retryable?: boolean; retryAfter?: number }).code =
      err?.error?.code;
    (error as Error & { retryable?: boolean }).retryable = err?.error?.retryable;
    (error as Error & { retryAfter?: number }).retryAfter = err?.error?.retry_after;
    throw error;
  }
  return body as T;
}

export function fetchModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>("/api/models");
}

export function register(username: string, password: string): Promise<{ user: User }> {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function login(username: string, password: string): Promise<{ user: User }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function fetchMe(): Promise<{ user: User }> {
  return request("/api/auth/me");
}

export function fetchChats(q?: string): Promise<{ chats: Chat[] }> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
  return request(`/api/chats${suffix}`);
}

export function patchChat(
  id: string,
  body: { title?: string; pinned?: boolean },
): Promise<{ chat: Chat }> {
  return request(`/api/chats/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function createChat(
  title?: string,
  projectId?: string,
): Promise<{ chat: Chat }> {
  return request("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title, project_id: projectId }),
  });
}

export function fetchChat(
  id: string,
): Promise<{ chat: Chat; messages: ChatMessage[]; councils?: unknown[] }> {
  return request(`/api/chats/${id}`);
}

export function deleteChat(id: string): Promise<{ ok: boolean }> {
  return request(`/api/chats/${id}`, { method: "DELETE" });
}

export function stopChat(id: string): Promise<{ ok: boolean }> {
  return request(`/api/chats/${id}/stop`, { method: "POST" });
}

export function regenerateMessage(
  chatId: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`/api/chats/${chatId}/messages/${messageId}/regenerate`, {
    method: "POST",
    credentials: "include",
    signal,
  });
}

export function postMessage(
  chatId: string,
  body: {
    content: string;
    mode: string;
    model?: string;
    effort?: string;
    edit_of?: string;
    heavy_engine?: "council" | "native";
    tools?: string[];
    attachments?: string[];
  },
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export function fetchProjects(): Promise<{ projects: Project[] }> {
  return request("/api/projects");
}

export function createProject(
  name: string,
  instructions = "",
): Promise<{ project: Project }> {
  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, instructions }),
  });
}

export function patchProject(
  id: string,
  body: { name?: string; instructions?: string },
): Promise<{ project: Project }> {
  return request(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string): Promise<{ ok: boolean }> {
  return request(`/api/projects/${id}`, { method: "DELETE" });
}

export function fetchFiles(projectId?: string): Promise<{ files: UploadedFile[] }> {
  const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  return request(`/api/files${suffix}`);
}

export async function uploadFile(
  file: File,
  projectId?: string,
): Promise<{ file: UploadedFile }> {
  const data = new FormData();
  data.append("file", file);
  if (projectId) data.append("project_id", projectId);
  const response = await fetch("/api/files", {
    method: "POST",
    credentials: "include",
    body: data,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }
  return body as { file: UploadedFile };
}

export function fetchGenerations(): Promise<{ generations: Generation[] }> {
  return request("/api/imagine");
}

export function generateImage(body: {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  file_id?: string;
}): Promise<{ generation: Generation }> {
  return request("/api/imagine/image", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function generateVideo(body: {
  prompt: string;
  model?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}): Promise<{ generation: Generation }> {
  return request("/api/imagine/video", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchMemories(): Promise<{ memories: MemoryItem[]; enabled: boolean }> {
  return request("/api/memories");
}

export function createMemory(content: string): Promise<{ memory: MemoryItem }> {
  return request("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function patchMemory(
  id: string,
  body: { content?: string; pinned?: boolean },
): Promise<{ memory: MemoryItem }> {
  return request(`/api/memories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteMemory(id: string): Promise<{ ok: boolean }> {
  return request(`/api/memories/${id}`, { method: "DELETE" });
}

export function clearMemories(): Promise<{ ok: boolean; deleted: number }> {
  return request("/api/memories", { method: "DELETE" });
}

export function patchSettings(body: {
  memory_enabled: boolean;
}): Promise<{ memory_enabled: boolean }> {
  return request("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function fetchTasks(): Promise<{ tasks: TaskItem[] }> {
  return request("/api/tasks");
}

export function createTask(body: {
  name: string;
  cron: string;
  prompt: string;
  mode?: string;
  enabled?: boolean;
}): Promise<{ task: TaskItem }> {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchTask(
  id: string,
  body: Partial<{
    name: string;
    cron: string;
    prompt: string;
    mode: string;
    enabled: boolean;
  }>,
): Promise<{ task: TaskItem }> {
  return request(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteTask(id: string): Promise<{ ok: boolean }> {
  return request(`/api/tasks/${id}`, { method: "DELETE" });
}

export function fetchTaskRuns(id: string): Promise<{ runs: TaskRun[] }> {
  return request(`/api/tasks/${id}/runs`);
}

export async function transcribeAudio(blob: Blob, filename = "audio.webm"): Promise<{ text: string }> {
  const data = new FormData();
  data.append("file", blob, filename);
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    credentials: "include",
    body: data,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = body as ApiErrorBody | null;
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }
  return body as { text: string };
}

export async function fetchSpeech(text: string): Promise<Blob> {
  const response = await fetch("/api/voice/speak", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.blob();
}
